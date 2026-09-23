/**
 * CSS 구조 분석 유틸리티
 * AI에게 현재 CSS의 구조를 전달하기 위한 파싱 기능
 */

export interface CssVariable {
  name: string;
  value: string;
  line: number;
}

export interface CssProperty {
  property: string;
  value: string;
}

export interface CssRule {
  selector: string;
  properties: CssProperty[];
  line: number;
}

export interface CssStructure {
  variables: CssVariable[];
  rules: CssRule[];
  mediaQueries: { query: string; rules: CssRule[] }[];
  keyframes: { name: string; line: number }[];
  imports: string[];
  totalLines: number;
  totalRules: number;
}

/**
 * CSS 코드를 파싱하여 구조 정보 추출
 */
export function parseCssStructure(css: string): CssStructure {
  const lines = css.split("\n");
  const structure: CssStructure = {
    variables: [],
    rules: [],
    mediaQueries: [],
    keyframes: [],
    imports: [],
    totalLines: lines.length,
    totalRules: 0,
  };

  if (!css.trim()) return structure;

  // CSS 변수 추출 (:root 또는 --로 시작하는 변수)
  const variableRegex = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = variableRegex.exec(css)) !== null) {
    const lineNumber = css.substring(0, match.index).split("\n").length;
    structure.variables.push({
      name: match[1],
      value: match[2].trim(),
      line: lineNumber,
    });
  }

  // @import 추출
  const importRegex = /@import\s+(?:url\()?["']?([^"')]+)["']?\)?;/g;
  while ((match = importRegex.exec(css)) !== null) {
    structure.imports.push(match[1]);
  }

  // @keyframes 추출
  const keyframesRegex = /@keyframes\s+([\w-]+)/g;
  while ((match = keyframesRegex.exec(css)) !== null) {
    const lineNumber = css.substring(0, match.index).split("\n").length;
    structure.keyframes.push({
      name: match[1],
      line: lineNumber,
    });
  }

  // @media 쿼리와 일반 규칙 파싱
  const ruleRegex = /([^{}@]+)\{([^{}]*)\}/g;
  const mediaRegex = /@media\s*([^{]+)\{([\s\S]*?)\}\s*\}/g;

  // 미디어 쿼리 추출
  while ((match = mediaRegex.exec(css)) !== null) {
    const query = match[1].trim();
    const innerCss = match[2];
    const mediaRules: CssRule[] = [];

    let innerMatch;
    const innerRuleRegex = /([^{}]+)\{([^{}]*)\}/g;
    while ((innerMatch = innerRuleRegex.exec(innerCss)) !== null) {
      const selector = innerMatch[1].trim();
      if (selector && !selector.startsWith("@")) {
        mediaRules.push({
          selector,
          properties: parseProperties(innerMatch[2]),
          line: css.substring(0, match.index).split("\n").length,
        });
      }
    }

    if (mediaRules.length > 0) {
      structure.mediaQueries.push({ query, rules: mediaRules });
    }
  }

  // 일반 규칙 추출 (미디어 쿼리 외부)
  // 미디어 쿼리와 keyframes 블록을 제거한 CSS에서 추출
  let cleanCss = css
    .replace(/@media\s*[^{]+\{[\s\S]*?\}\s*\}/g, "")
    .replace(/@keyframes\s+[\w-]+\s*\{[\s\S]*?\}/g, "");

  while ((match = ruleRegex.exec(cleanCss)) !== null) {
    const selector = match[1].trim();
    // @import, @charset 등은 제외
    if (selector && !selector.startsWith("@") && !selector.includes("@")) {
      const lineNumber = css.indexOf(match[0]);
      const line = lineNumber >= 0 ? css.substring(0, lineNumber).split("\n").length : 0;

      structure.rules.push({
        selector,
        properties: parseProperties(match[2]),
        line,
      });
    }
  }

  structure.totalRules = structure.rules.length +
    structure.mediaQueries.reduce((acc, mq) => acc + mq.rules.length, 0);

  return structure;
}

/**
 * CSS 속성 문자열을 파싱
 */
function parseProperties(propsString: string): CssProperty[] {
  const properties: CssProperty[] = [];
  const propRegex = /([\w-]+)\s*:\s*([^;]+);?/g;
  let match;

  while ((match = propRegex.exec(propsString)) !== null) {
    properties.push({
      property: match[1].trim(),
      value: match[2].trim(),
    });
  }

  return properties;
}

/**
 * CSS 구조를 AI 프롬프트용 텍스트로 변환
 */
export function cssStructureToPrompt(structure: CssStructure): string {
  if (structure.totalRules === 0 && structure.variables.length === 0) {
    return "현재 CSS가 비어있습니다.";
  }

  const parts: string[] = [];

  // 요약
  parts.push(`[CSS 구조 분석]`);
  parts.push(`- 총 ${structure.totalLines}줄, ${structure.totalRules}개 규칙`);

  // 변수
  if (structure.variables.length > 0) {
    parts.push(`\n[CSS 변수 ${structure.variables.length}개]`);
    structure.variables.slice(0, 10).forEach((v) => {
      parts.push(`  ${v.name}: ${v.value}`);
    });
    if (structure.variables.length > 10) {
      parts.push(`  ... 외 ${structure.variables.length - 10}개`);
    }
  }

  // 주요 셀렉터
  if (structure.rules.length > 0) {
    parts.push(`\n[주요 셀렉터 ${structure.rules.length}개]`);
    structure.rules.slice(0, 15).forEach((r) => {
      const propsPreview = r.properties.slice(0, 3).map((p) => p.property).join(", ");
      parts.push(`  ${r.selector} { ${propsPreview}${r.properties.length > 3 ? ", ..." : ""} }`);
    });
    if (structure.rules.length > 15) {
      parts.push(`  ... 외 ${structure.rules.length - 15}개`);
    }
  }

  // 미디어 쿼리
  if (structure.mediaQueries.length > 0) {
    parts.push(`\n[미디어 쿼리 ${structure.mediaQueries.length}개]`);
    structure.mediaQueries.forEach((mq) => {
      parts.push(`  @media ${mq.query} (${mq.rules.length}개 규칙)`);
    });
  }

  // 키프레임
  if (structure.keyframes.length > 0) {
    parts.push(`\n[애니메이션 ${structure.keyframes.length}개]`);
    structure.keyframes.forEach((kf) => {
      parts.push(`  @keyframes ${kf.name}`);
    });
  }

  return parts.join("\n");
}

/**
 * 특정 셀렉터 찾기
 */
export function findSelector(structure: CssStructure, selector: string): CssRule | undefined {
  return structure.rules.find((r) => r.selector.includes(selector));
}

/**
 * 특정 속성을 사용하는 규칙 찾기
 */
export function findRulesWithProperty(structure: CssStructure, property: string): CssRule[] {
  return structure.rules.filter((r) =>
    r.properties.some((p) => p.property === property)
  );
}
