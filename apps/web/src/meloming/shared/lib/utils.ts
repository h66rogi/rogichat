import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { KS_X_1001_HANGUL } from "@/meloming/shared/constants/hangul";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 주어진 배경색(HEX)에 대비되는 텍스트 색상('black' 또는 'white')을 반환합니다.
 * WCAG 명암비 공식을 기반으로 하되, 시각적 선호도를 고려하여 흰색 텍스트에 가중치를 부여합니다.
 * @param {string} hexColor - #RRGGBB 또는 RRGGBB 형식의 HEX 색상 코드
 * @returns {'black' | 'white'} - 가독성이 좋은 텍스트 색상
 */
export function getContrastingTextColor(hexColor: string): "black" | "white" {
  // # 기호 제거 및 3자리 HEX 코드를 6자리로 변환
  let sanitizedHex = hexColor.startsWith("#") ? hexColor.slice(1) : hexColor;
  if (sanitizedHex.length === 3) {
    sanitizedHex = sanitizedHex
      .split("")
      .map((char) => char + char)
      .join("");
  }

  const r = parseInt(sanitizedHex.substring(0, 2), 16);
  const g = parseInt(sanitizedHex.substring(2, 4), 16);
  const b = parseInt(sanitizedHex.substring(4, 6), 16);

  // WCAG 상대 휘도(Relative Luminance) 계산
  const luminance = [r, g, b]
    .map((val) => {
      const sRGB = val / 255.0;
      if (sRGB <= 0.03928) {
        return sRGB / 12.92;
      }
      return Math.pow((sRGB + 0.055) / 1.055, 2.4);
    })
    .reduce((acc, val, i) => acc + val * [0.2126, 0.7152, 0.0722][i], 0);

  const contrastWithWhite = (1.0 + 0.05) / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / (0.0 + 0.05);

  // --- 로직 변경: 흰색 텍스트에 1.8배의 가중치를 부여하여 비교 ---
  // 이 값은 디자인 선호도에 따라 조절할 수 있습니다.
  return contrastWithWhite * 1.8 >= contrastWithBlack ? "white" : "black";
}

/**
 * 한국 시간(KST, UTC+9) 기준으로 오늘 날짜를 YYYY-MM-DD 형식으로 반환합니다.
 * 사용자의 실제 시간대와 관계없이 항상 KST 기준으로 날짜를 계산합니다.
 * @returns {string} YYYY-MM-DD 형식의 KST 기준 오늘 날짜
 */
export function getTodayKST(): string {
  const now = new Date();
  // UTC 시간에 9시간을 더해 KST로 변환
  const kstOffset = 9 * 60; // 9시간을 분으로 변환
  const kstTime = new Date(now.getTime() + kstOffset * 60 * 1000);

  // ISO 문자열에서 날짜 부분만 추출 (YYYY-MM-DD)
  return kstTime.toISOString().slice(0, 10);
}

/**
 * 날짜/시간 값을 KST(Asia/Seoul) 기준 'M/D (ddd) HH:mm' 형식으로 변환합니다.
 * (예: "4/25 (Sat) 17:00")
 *
 * dayjs(...).format() 은 runtime 로컬 타임존을 사용하기 때문에 SSR(UTC)과
 * 클라이언트(KST) 간 텍스트 mismatch 로 React #418 hydration 에러를
 * 유발한다. 이 헬퍼는 Intl.DateTimeFormat 의 timeZone 옵션을 통해 양쪽에서
 * 동일한 문자열을 생성한다.
 */
export function formatShortDateTimeKST(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("month")}/${get("day")} (${get("weekday")}) ${hour}:${get("minute")}`;
}

/**
 * 날짜 값을 KST(Asia/Seoul) 기준 'M/D (ddd)' 형식으로 변환합니다.
 * (예: "4/25 (Sat)")
 *
 * formatShortDateTimeKST 와 동일한 이유로 필요함 (SSR/클라이언트 타임존
 * 차이로 인한 hydration mismatch 방지).
 */
export function formatShortDateKST(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("month")}/${get("day")} (${get("weekday")})`;
}

/**
 * 날짜/시간 값을 KST(Asia/Seoul) 기준 'YYYY년 MM월 DD일 HH:mm' 형식으로 변환합니다.
 */
export function formatDateTimeKST(
  value: string | Date | null | undefined
): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(parsed);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  const hour = getPart("hour");
  const minute = getPart("minute");

  if (!year || !month || !day || !hour || !minute) {
    return formatter.format(parsed);
  }

  return `${year}년 ${month}월 ${day}일 ${hour}:${minute}`;
}

/**
 * 문자열이 Paperlogy 폰트에서 렌더링 가능한지 확인합니다.
 *
 * Paperlogy 폰트는 KS X 1001 완성형 한글 2,350자만 지원합니다.
 * 유니코드 한글 음절(11,172자) 중 일부만 포함되어 있어,
 * '땽', '뷁' 같은 글자는 지원하지 않습니다.
 *
 * 이 함수는 문자열의 모든 한글이 KS X 1001에 포함되어 있는지 확인합니다.
 * 영문, 숫자, 특수문자 등 한글이 아닌 문자는 무시합니다.
 *
 * @param text 확인할 문자열
 * @returns 모든 한글이 KS X 1001에 포함되면 true, 그렇지 않으면 false
 */
export function isKSX1001Compatible(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);

    // 유니코드 한글 음절 범위 (가 ~ 힣: U+AC00 ~ U+D7A3)
    const isHangulSyllable = code >= 0xac00 && code <= 0xd7a3;

    // 한글 호환 자모 (ㄱ ~ ㅣ: U+3131 ~ U+3163)
    const isHangulJamo = code >= 0x3131 && code <= 0x3163;

    // 한글 문자인 경우에만 KS X 1001 호환성 확인
    if (isHangulSyllable || isHangulJamo) {
      if (!KS_X_1001_HANGUL.has(char)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * 배열을 무작위로 섞습니다 (Fisher-Yates shuffle).
 * 원본 배열을 변경하지 않고 새로운 배열을 반환합니다.
 */
export function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}
