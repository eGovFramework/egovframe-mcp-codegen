/**
 * 메시지 번들 라벨 유틸
 *
 * DDL 의 컬럼/테이블 COMMENT 를 화면 라벨(메시지 번들 `title.*`, `nav.*` 등의 값)로 쓸 때
 * 적용하는 규칙과, properties 값 위치에 안전하게 기록하기 위한 이스케이프를 모아 둔다.
 *
 * 라벨 규칙 (순서 고정, 어느 단계든 폴백이면 null → 호출자가 현행 컬럼명 표기를 사용)
 *   ① 괄호 밖에 구분 문자(`,` `/` `;` `:`) 가 있으면 폴백 — 나열이나 설명문으로 본다.
 *      괄호 안의 구분 문자(`사용여부(Y/N)`, `제목(a, b)`)는 ② 에서 잘려 나가므로 폴백 조건이 아니다.
 *   ② 여는 괄호(`(` 또는 전각 `（`) 가 있으면 그 앞부분만 trim 해서 취한다. 앞부분이 비면 폴백.
 *   ③ 남은 값이 코드 포인트 기준 10자를 넘으면(11자 이상) 설명문으로 보고 폴백.
 *   ④ 남은 값이 비어 있으면 폴백.
 *
 * 10자 임계값은 "공지사항제목", "최종수정일시" 같은 공공 표준 논리명은 통과시키고
 * "이 컬럼은 공지사항의 제목입니다" 같은 설명문은 걸러내는 경험적 분기점이다.
 */

const LABEL_MAX_CODE_POINTS = 10;
const OPEN_PAREN_PATTERN = /[(（]/;
const SEPARATOR_CHARS = new Set([",", "/", ";", ":"]);

/** 괄호(`()` 또는 전각 `（）`) 깊이 0 위치에 구분 문자가 하나라도 있는지 */
function hasSeparatorOutsideParens(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(" || ch === "（") depth++;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    else if (depth === 0 && SEPARATOR_CHARS.has(ch)) return true;
  }
  return false;
}

/**
 * 코멘트 원문에서 화면 라벨을 도출한다. 규칙에 걸리면 `null` 을 돌려주며,
 * 호출자는 코멘트가 없을 때와 동일한 폴백 값을 사용해야 한다.
 */
export function deriveLabelFromComment(comment: string | null | undefined): string | null {
  if (typeof comment !== "string") return null;
  const trimmed = comment.trim();
  if (trimmed === "") return null;

  // ① 괄호 밖 구분 문자
  if (hasSeparatorOutsideParens(trimmed)) return null;

  // ② 괄호 앞부분
  let label = trimmed;
  const paren = OPEN_PAREN_PATTERN.exec(trimmed);
  if (paren) {
    label = trimmed.slice(0, paren.index).trim();
    if (label === "") return null;
  }

  // ③ 길이
  if (Array.from(label).length > LABEL_MAX_CODE_POINTS) return null;

  // ④ 빈 값 (②에서 이미 걸러지지만 규칙 명세와 1:1 로 둔다)
  return label === "" ? null : label;
}

/**
 * ASCII 가 아닌 문자를 properties 의 \uXXXX 이스케이프로 바꾼다 (UTF-16 코드 유닛 단위).
 * 16진수는 대문자로 기록해 템플릿에 미리 적힌 고정 문구(`\uBAA9\uB85D`)와 표기를 맞춘다.
 */
export function escapeNonAscii(s: string): string {
  return s.replace(
    /[^\x20-\x7e]/g,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"),
  );
}

/**
 * properties 파일의 "값" 위치에 기록할 문자열로 이스케이프한다.
 *
 * - `\` → `\\`, 줄바꿈 → `\n`, 캐리지리턴 → `\r`, 탭 → `\t`
 * - 선행 공백은 `\ ` 로 보존 (properties 는 값 앞 공백을 버린다)
 * - `=` 와 `:` 는 값 위치에서는 구분자가 아니므로 그대로 둔다
 * - `unicodeEscape` 가 참이면(번들을 ISO-8859-1 로 읽는 WAR 4.3) 비ASCII 를 `\uXXXX` 로 바꾼다
 */
export function escapePropertiesValue(s: string, unicodeEscape: boolean): string {
  let out = s
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  if (out.startsWith(" ")) out = "\\" + out;
  return unicodeEscape ? escapeNonAscii(out) : out;
}
