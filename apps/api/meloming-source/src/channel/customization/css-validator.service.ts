import { Injectable } from '@nestjs/common';
import { parse, walk, CssNode } from 'css-tree';

/**
 * CSS 검증 결과 인터페이스
 */
export interface CssValidationResult {
  isValid: boolean;
  errors: Array<{
    message: string;
    line?: number;
    column?: number;
  }>;
}

/**
 * CSS 검증 서비스
 * 크기, 보안, 문법 검증을 수행합니다.
 */
@Injectable()
export class CssValidatorService {
  private readonly MAX_CSS_SIZE = 100 * 1024; // 100KB

  // @import 허용 도메인 (폰트 서비스)
  private readonly ALLOWED_IMPORT_DOMAINS = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.jsdelivr.net',
    'fastly.jsdelivr.net',
    'unpkg.com',
    'cdnjs.cloudflare.com',
  ];

  /**
   * CSS 검증 (크기 + 보안 + 문법)
   *
   * @param css 검증할 CSS 문자열
   * @returns 검증 결과
   */
  validate(css: string): CssValidationResult {
    const errors: CssValidationResult['errors'] = [];

    // 빈 문자열은 허용 (삭제 시나리오)
    if (!css || css.trim().length === 0) {
      return { isValid: true, errors: [] };
    }

    // 1. 크기 검증
    const sizeInBytes = new TextEncoder().encode(css).length;
    if (sizeInBytes > this.MAX_CSS_SIZE) {
      errors.push({
        message: `CSS 크기가 너무 큽니다. 최대 ${this.MAX_CSS_SIZE / 1024}KB까지 허용됩니다.`,
      });
      return { isValid: false, errors };
    }

    // 2. 기본 보안 검증 (정규식)
    const securityErrors = this.validateSecurity(css);
    if (securityErrors.length > 0) {
      errors.push(...securityErrors);
      return { isValid: false, errors };
    }

    // 3. CSS 문법 검증 (css-tree 파서)
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const ast = parse(css, {
        positions: true, // 라인/컬럼 정보 포함
      }) as CssNode;

      // 4. 추가 검증: 위험한 패턴 탐지 (AST 기반)
      const dangerousPatterns = this.detectDangerousPatterns(ast);
      if (dangerousPatterns.length > 0) {
        errors.push(...dangerousPatterns);
        return { isValid: false, errors };
      }

      return { isValid: true, errors: [] };
    } catch (parseError: unknown) {
      // 파싱 오류 = 문법 오류
      const errorMessage =
        parseError instanceof Error
          ? parseError.message
          : 'CSS 문법 오류가 있습니다.';
      const errorLoc =
        parseError &&
        typeof parseError === 'object' &&
        'loc' in parseError &&
        parseError.loc &&
        typeof parseError.loc === 'object' &&
        'start' in parseError.loc &&
        parseError.loc.start &&
        typeof parseError.loc.start === 'object'
          ? parseError.loc.start
          : null;

      errors.push({
        message: errorMessage,
        line:
          errorLoc && 'line' in errorLoc
            ? (errorLoc.line as number)
            : undefined,
        column:
          errorLoc && 'column' in errorLoc
            ? (errorLoc.column as number)
            : undefined,
      });
      return { isValid: false, errors };
    }
  }

  /**
   * 보안 검증 (정규식 기반)
   * 위험한 패턴을 빠르게 차단합니다.
   *
   * @param css 검증할 CSS 문자열
   * @returns 보안 오류 목록
   */
  private validateSecurity(css: string): Array<{ message: string }> {
    const errors: Array<{ message: string }> = [];
    const dangerousPatterns = [
      {
        pattern: /<script/gi,
        message: '스크립트 태그는 허용되지 않습니다.',
      },
      {
        pattern: /javascript:/gi,
        message: 'javascript: 프로토콜은 허용되지 않습니다.',
      },
      {
        pattern: /expression\s*\(/gi,
        message: 'expression() 함수는 허용되지 않습니다.',
      },
      {
        pattern: /url\s*\(\s*['"]?\s*javascript:/gi,
        message: 'javascript: URL은 허용되지 않습니다.',
      },
      {
        pattern: /behavior\s*:/gi,
        message: 'behavior 속성은 허용되지 않습니다.',
      },
    ];

    for (const { pattern, message } of dangerousPatterns) {
      if (pattern.test(css)) {
        errors.push({ message });
      }
    }

    // @import 도메인 검증 (허용된 도메인만 통과)
    const importErrors = this.validateImports(css);
    errors.push(...importErrors);

    return errors;
  }

  /**
   * @import 규칙 검증
   * 허용된 도메인(폰트 서비스)에서의 @import만 허용합니다.
   *
   * @param css 검증할 CSS 문자열
   * @returns @import 관련 오류 목록
   */
  private validateImports(css: string): Array<{ message: string }> {
    const errors: Array<{ message: string }> = [];

    // @import url(...) 또는 @import "..." 패턴 찾기
    const importPattern =
      /@import\s+(?:url\s*\(\s*)?['"]?(https?:\/\/[^'"\s)]+)/gi;
    let match;

    while ((match = importPattern.exec(css)) !== null) {
      const url = match[1];
      try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;

        if (!this.ALLOWED_IMPORT_DOMAINS.includes(domain)) {
          errors.push({
            message: `허용되지 않은 도메인에서 @import: ${domain}. 허용된 도메인: ${this.ALLOWED_IMPORT_DOMAINS.join(', ')}`,
          });
        }
      } catch {
        errors.push({
          message: `잘못된 @import URL: ${url}`,
        });
      }
    }

    // 상대 경로 또는 로컬 파일 @import 차단
    const localImportPattern =
      /@import\s+(?:url\s*\(\s*)?['"]?(?!https?:\/\/)/gi;
    if (localImportPattern.test(css)) {
      // https:// 로 시작하지 않는 @import가 있는지 추가 확인
      const allImports = css.match(/@import\s+[^;]+/gi) || [];
      for (const importRule of allImports) {
        if (!/https?:\/\//.test(importRule)) {
          errors.push({
            message:
              '외부 URL이 아닌 @import는 허용되지 않습니다. https:// 로 시작하는 URL만 사용하세요.',
          });
          break;
        }
      }
    }

    return errors;
  }

  /**
   * 위험한 패턴 탐지 (AST 기반)
   * 정규식으로 잡히지 않은 패턴도 탐지할 수 있습니다.
   *
   * @param ast CSS AST 노드
   * @returns 위험 패턴 오류 목록
   */
  private detectDangerousPatterns(ast: CssNode): Array<{ message: string }> {
    const errors: Array<{ message: string }> = [];

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    walk(ast, (node: CssNode) => {
      // @import 규칙은 validateImports에서 이미 검증하므로 AST에서는 스킵
      // (정규식 기반 도메인 검증이 더 정확함)

      // expression() 함수 체크
      if (
        node.type === 'Function' &&
        'name' in node &&
        node.name === 'expression'
      ) {
        errors.push({
          message: 'expression() 함수는 허용되지 않습니다.',
        });
      }
    });

    return errors;
  }
}
