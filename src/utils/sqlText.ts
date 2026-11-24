/**
 * SQL 텍스트 분리 유틸
 *
 * DDL 문자열을 정규식만으로 다루면 `COMMENT 'x, y'` 같은 리터럴 안의 콤마·괄호·세미콜론을
 * 구조 문자로 오인한다. 이 모듈은 따옴표(`'`, `"`, `` ` ``) 와 괄호 깊이를 추적하는
 * 단일 패스 스캐너로 그 문제를 공통 해결한다. 정규화기(`ddlNormalizer.ts`) 와
 * legacy 파서(`ddlParserLegacy.ts`) 가 함께 사용한다.
 *
 * 따옴표 안에서 같은 따옴표가 두 번 연속 나오면(`''`) SQL 이스케이프로 보고 종료로 치지 않는다.
 */

type QuoteChar = "'" | '"' | "`";

function isQuote(ch: string): ch is QuoteChar {
  return ch === "'" || ch === '"' || ch === "`";
}

/**
 * 괄호 깊이 0 이고 따옴표 밖에 있는 `separator` 에서만 문자열을 나눈다.
 * 빈 조각(공백만 있는 조각 포함)은 버린다. 조각의 앞뒤 공백은 보존한다.
 */
export function splitTopLevel(text: string, separator: "," | ";"): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: QuoteChar | null = null;
  let buf = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      buf += ch;
      if (ch === quote) {
        if (text[i + 1] === quote) {
          buf += text[i + 1];
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (isQuote(ch)) {
      quote = ch;
      buf += ch;
    } else if (ch === "(") {
      depth++;
      buf += ch;
    } else if (ch === ")") {
      depth--;
      buf += ch;
    } else if (ch === separator && depth === 0) {
      if (buf.trim().length > 0) out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim().length > 0) out.push(buf);
  return out;
}

/**
 * SQL 주석을 제거한다. `-- ...` 는 줄 끝까지(줄바꿈은 보존), `/* ... *\/` 는 공백 하나로 바꾼다.
 * 문자열 리터럴 안의 `--` 와 `/*` 는 주석이 아니므로 그대로 둔다.
 * `onComment` 를 넘기면 제거한 주석 원문(trim)을 순서대로 알려 준다 — 정규화 보고서용.
 */
export function stripSqlComments(text: string, onComment?: (comment: string) => void): string {
  let out = "";
  let quote: QuoteChar | null = null;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (text[i + 1] === quote) {
          out += text[i + 1];
          i += 2;
          continue;
        }
        quote = null;
      }
      i++;
      continue;
    }
    if (isQuote(ch)) {
      quote = ch;
      out += ch;
      i++;
    } else if (ch === "-" && text[i + 1] === "-") {
      let end = text.indexOf("\n", i);
      if (end === -1) end = text.length;
      onComment?.(text.slice(i, end).trim());
      i = end; // 줄바꿈 문자는 다음 반복에서 그대로 출력된다
    } else if (ch === "/" && text[i + 1] === "*") {
      let end = text.indexOf("*/", i + 2);
      end = end === -1 ? text.length : end + 2;
      onComment?.(text.slice(i, end).trim());
      out += " ";
      i = end;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/**
 * `openIndex` 위치의 `(` 와 짝이 되는 `)` 의 인덱스를 돌려준다. 따옴표 안의 괄호는 무시한다.
 * 짝이 없거나 `openIndex` 가 `(` 가 아니면 -1.
 */
export function findMatchingParen(text: string, openIndex: number): number {
  if (text[openIndex] !== "(") return -1;
  let depth = 0;
  let quote: QuoteChar | null = null;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (isQuote(ch)) {
      quote = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * SQL 문자열 리터럴의 양끝 따옴표를 벗기고 `''` / `""` 이스케이프를 복원한다.
 * 양끝에 같은 따옴표가 없으면 trim 만 해서 돌려준다.
 */
export function unquoteSqlString(literal: string): string {
  const t = literal.trim();
  if (t.length >= 2) {
    const q = t[0];
    if (isQuote(q) && t[t.length - 1] === q) {
      const inner = t.slice(1, -1);
      return inner.split(q + q).join(q);
    }
  }
  return t;
}
