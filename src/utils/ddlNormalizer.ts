/**
 * DDL Normalizer
 *
 * 입력 DDL을 eGovFrame 표준 명명규칙에 가깝게 1차 정규화하고,
 * 진단(report) 형태로 변경/경고를 모아 돌려준다.
 *
 * 설계 원칙
 * ---------
 * - **파서를 깨지 않는다.** `src/utils/scaffold/ddlParser.ts` 가 받기 전에
 *   적용되므로, 의미를 바꾸지 않는 보수적 변환만 수행한다.
 *   (식별자 lower, 데이터 타입 upper, 인용부호 제거, 줄별 공백 정리)
 * - **자동 치환은 하지 않는다.** 표준 미준수 컬럼명을 임의로 바꾸면
 *   사용자가 의도한 컬럼명을 잃는다. 변환은 케이스/공백에 한정하고,
 *   표준 미준수는 `report.issues` 로만 보고한다.
 */

import { findMatchingParen, splitTopLevel, stripSqlComments } from "./sqlText.js";

const KNOWN_DATA_TYPES = new Set<string>([
  // dataTypes.ts 와 일치시킨다. 파서 사전을 직접 import 하지 않는 것은
  // 정규화가 파서보다 먼저 실행되기 때문 — 사전 변경 시 양쪽을 함께 갱신한다.
  "VARCHAR",
  "VARCHAR2",
  "CHAR",
  "TEXT",
  "MEDIUMTEXT",
  "INT",
  "INTEGER",
  "NUMBER",
  "BIGINT",
  "SMALLINT",
  "TINYINT",
  "DECIMAL",
  "NUMERIC",
  "FLOAT",
  "REAL",
  "DOUBLE",
  "SMALLSERIAL",
  "SERIAL",
  "BIGSERIAL",
  "DATE",
  "TIME",
  "DATETIME",
  "TIMESTAMP",
  "BOOLEAN",
  "BIT",
  "ENUM",
  "SET",
]);

/**
 * 정규화 과정에서 실제 적용된 변경 1건.
 */
export interface NormalizationChange {
  kind:
    | "identifier_case"
    | "identifier_quote"
    | "data_type_case"
    | "whitespace"
    | "escape_sequence"
    | "sql_comment";
  before: string;
  after: string;
  /** 컬럼/제약 라인 번호 (DDL body 안에서 0-base). 메타 변경(전체 trim 등)은 생략 */
  lineIndex?: number;
}

/**
 * 정규화 과정에서 발견된 진단 항목.
 *
 * - `mixed_case_identifier`: 식별자가 SNAKE_CASE(UPPER) 가 아닌 경우(eGovFrame 표준 권장)
 * - `unknown_data_type`: `dataTypes.ts` 사전에 없는 데이터 타입
 */
export interface NormalizationIssue {
  severity: "warning" | "info";
  kind: "mixed_case_identifier" | "unknown_data_type";
  /** 영향을 받은 컬럼 이름(원본 기준 lower-snake_case) */
  column?: string;
  /** 영향을 받은 단어/타입 토큰 */
  token?: string;
  message: string;
  /** 사용자가 채택할 수 있는 권장 값(있을 때만) */
  suggestion?: string;
}

export interface NormalizationReport {
  /** 입력 DDL에서 추출한 테이블 식별자(원본 케이스 보존) */
  tableName: string;
  /** 실제 적용된 변경 목록 (없으면 빈 배열) */
  changes: NormalizationChange[];
  /** 진단 목록 (심각도와 무관하게 모두 포함) */
  issues: NormalizationIssue[];
}

export interface NormalizeDdlOptions {
  /** 식별자 lower-case 적용 (기본 true) */
  normalizeIdentifierCase?: boolean;
  /** 데이터 타입 upper-case 적용 (기본 true) */
  normalizeDataTypeCase?: boolean;
}

export interface NormalizeResult {
  normalizedDdl: string;
  report: NormalizationReport;
}

/**
 * DDL을 정규화하고 진단 보고서를 함께 돌려준다.
 *
 * 변환 규칙(파서 의미 보존)
 * - 식별자: 백틱/큰따옴표 제거 + lower-case (`board_id` 유지, `BoardId` → `boardid` 가 아니라 snake 변환은 안 함)
 *   - 단, snake_case 가 깨질 수 있으므로 카멜 → 스네이크 변환은 진단(issue)으로만 보고
 * - 데이터 타입: upper-case (`varchar(36)` → `VARCHAR(36)`)
 * - 줄별 trim, 컬럼 사이 공백 1칸 정리
 */
export function normalizeDdl(
  ddl: string,
  options: NormalizeDdlOptions = {},
): NormalizeResult {
  const opts = {
    normalizeIdentifierCase: options.normalizeIdentifierCase ?? true,
    normalizeDataTypeCase: options.normalizeDataTypeCase ?? true,
  };

  const changes: NormalizationChange[] = [];
  const issues: NormalizationIssue[] = [];

  // 0) 리터럴 escape 시퀀스 교정 (헤더/본문 파싱보다 먼저).
  //    모델이 줄바꿈을 정상적인 줄바꿈(`\n`)이 아니라 이중 escape (`\\n`) 하면,
  //    JSON 파싱 후 DDL 문자열에는 백슬래시+n 두 글자가 그대로 들어와
  //    아래 공백 정리/컬럼 정규식을 빠져나가
  //    컬럼명이 `\n` 으로 오인되는 손상을 일으킨다.
  //    파서가 보기 전에 실제 문자로 되돌린다.
  const repaired = repairEscapeSequences(ddl);
  ddl = repaired.ddl;
  changes.push(...repaired.changes);

  // 0-b) SQL 주석(`-- ...`, `/* ... */`) 제거. 주석 안의 따옴표·괄호·콤마가 아래 분리 로직을
  //      오염시키지 않도록 먼저 걷어내고, 제거 사실은 보고서에 남긴다 (문자열 리터럴 안은 보존).
  ddl = stripSqlComments(ddl, (comment) => {
    changes.push({ kind: "sql_comment", before: comment, after: "", lineIndex: -1 });
  });

  // 1) 테이블 헤더와 컬럼 본문 분리
  const headerMatch = /^\s*CREATE\s+(?:MEMORY\s+)?TABLE\s+([`"]?)(\w+)\1\s*\(/i.exec(
    ddl,
  );
  if (!headerMatch) {
    // 파서가 던질 에러를 여기서 미리 던지지 않는다. 정규화 실패는 원본 반환 + 빈 리포트.
    return {
      normalizedDdl: ddl,
      report: { tableName: "", changes, issues },
    };
  }

  const tableName = headerMatch[2];
  const headerEnd = headerMatch.index + headerMatch[0].length;

  // 2) 본문을 닫는 ')' 찾기 — 헤더 끝의 '(' 와 짝이 되는 괄호. 코멘트 리터럴 안의 ')' 나
  //    후속 COMMENT ON 문장의 괄호를 본문 끝으로 오인하지 않도록 따옴표 인식 스캐너를 쓴다.
  const bodyStart = headerEnd;
  const bodyEnd = findMatchingParen(ddl, headerEnd - 1);
  if (bodyEnd <= bodyStart) {
    return {
      normalizedDdl: ddl,
      report: { tableName, changes, issues },
    };
  }

  const body = ddl.slice(bodyStart, bodyEnd);
  const trailing = ddl.slice(bodyEnd); // ')' 와 그 뒤(세미콜론 등)

  // 3) 컬럼/제약 단위로 split (괄호 안 콤마 보호)
  const lines = splitTopLevelCommas(body);

  const normalizedLines = lines.map((rawLine, lineIndex) => {
    const trimmed = rawLine.replace(/\s+/g, " ").trim();
    if (!trimmed) return ""; // 빈 라인은 그대로 비움 (대부분 마지막 trailing comma 뒤)

    // 제약 라인 처리
    const upperHead = trimmed.toUpperCase();
    if (
      upperHead.startsWith("PRIMARY KEY") ||
      upperHead.startsWith("UNIQUE KEY") ||
      upperHead.startsWith("KEY ") ||
      upperHead.startsWith("CONSTRAINT") ||
      upperHead.startsWith("FOREIGN KEY")
    ) {
      return normalizeConstraintLine(trimmed, lineIndex, changes, opts);
    }

    return normalizeColumnLine(trimmed, lineIndex, changes, issues, opts);
  });

  // 4) 본문 재조립: 가독성을 위해 한 줄에 한 컬럼, 들여쓰기 2칸
  const indented = normalizedLines
    .filter((l) => l.length > 0)
    .map((l) => `  ${l}`)
    .join(",\n");

  // 5) 전체 DDL 재조립
  const headerOut = ddl.slice(0, headerEnd).replace(/\s+$/, "");
  // headerOut 끝의 '(' 직후 줄바꿈 → 본문 → 닫는 ')' + trailing
  const normalizedDdl = `${headerOut}\n${indented}\n${trailing}`.trimEnd();

  return {
    normalizedDdl,
    report: { tableName, changes, issues },
  };
}

// ---------------------------------------------------------------------------
// 내부 구현
// ---------------------------------------------------------------------------

/**
 * 리터럴 escape 시퀀스(`\n`·`\r`·`\t`)를 실제 제어문자로 되돌린다.
 *
 * 배경
 * ----
 * 도구 인자는 JSON 문자열로 전달된다. 모델이 줄바꿈을 올바르게 `\n` 으로 적으면
 * JSON 파서가 실제 줄바꿈(LF)으로 풀어 주지만, **이중 escape (`\\n`)** 로 적으면
 * 파싱 결과에 백슬래시(`\`)+`n` 두 글자가 텍스트로 남는다. 이 텍스트는 공백이 아니라
 * 일반 정규화(`\s+` 정리, 컬럼 정규식)를 빠져나가 컬럼명을 오염시킨다.
 *
 * 규칙(보수적)
 * - 백슬래시 1개 이상 + `n`/`r` → 실제 줄바꿈(`\n`)
 * - 백슬래시 1개 이상 + `t` → 실제 탭(`\t`)
 *   (`\\+` 로 quad-escape 된 `\\\\n` 같은 형태까지 함께 흡수한다.)
 * - 변환된 실제 공백은 이후 `\s+` 정리 단계에서 일관되게 다듬어진다.
 *
 * DDL 본문에 정상적인 백슬래시가 들어오는 경우는 사실상 없으므로 오탐 위험은 무시할 수준이다.
 * 적용된 교정은 `escape_sequence` change 로 보고해 사용자가 깨진 입력을 인지하게 한다.
 */
export function repairEscapeSequences(ddl: string): {
  ddl: string;
  changes: NormalizationChange[];
} {
  const changes: NormalizationChange[] = [];
  const out = ddl.replace(/\\+([nrt])/g, (_match, letter: string) => {
    changes.push({
      kind: "escape_sequence",
      // before: 화면에 보이던 깨진 텍스트(백슬래시+문자). after: 사람이 읽을 라벨
      //   (실제 제어문자를 리포트에 그대로 쏟지 않도록 라벨로 치환).
      before: `\\${letter}`,
      after: letter === "t" ? "(탭)" : "(줄바꿈)",
    });
    return letter === "t" ? "\t" : "\n";
  });
  return { ddl: out, changes };
}

/**
 * 괄호 안 콤마를 보호하면서 top-level 콤마로 split.
 * `VARCHAR(36)` 같은 타입 인자가 split 되지 않게 한다.
 */
/**
 * 본문을 최상위 콤마에서 나눈다. 괄호 안(`DECIMAL(10,2)`) 과 따옴표 안(`COMMENT 'x, y'`) 의
 * 콤마는 구분자로 보지 않는다 — 구현은 `sqlText.splitTopLevel` 에 위임한다.
 */
function splitTopLevelCommas(body: string): string[] {
  return splitTopLevel(body, ",");
}

interface NormalizeOpts {
  normalizeIdentifierCase: boolean;
  normalizeDataTypeCase: boolean;
}

function normalizeColumnLine(
  line: string,
  lineIndex: number,
  changes: NormalizationChange[],
  issues: NormalizationIssue[],
  opts: NormalizeOpts,
): string {
  // <ident> <TYPE>(?<rest>...) 패턴
  const m = /^([`"]?)(\w+)\1\s+([A-Za-z][A-Za-z0-9]*)(\s*\([^)]*\))?(.*)$/.exec(line);
  if (!m) return line;

  const [, quote, rawIdent, rawType, typeArgs, rest] = m;

  // 식별자 정규화
  let ident = rawIdent;
  if (quote) {
    changes.push({
      kind: "identifier_quote",
      before: `${quote}${rawIdent}${quote}`,
      after: rawIdent,
      lineIndex,
    });
  }
  // 식별자 케이스 정규화: eGovFrame 표준 = SNAKE_CASE (UPPER).
  // 소문자가 한 글자라도 섞이면 전체를 대문자로 변환한다.
  if (opts.normalizeIdentifierCase && /[a-z]/.test(ident)) {
    const upper = ident.toUpperCase();
    changes.push({
      kind: "identifier_case",
      before: ident,
      after: upper,
      lineIndex,
    });
    // 카멜/파스칼 식별자(예: BoardId, deptId) 는 단어 분리가 모호해지므로
    // 자동 변환 후에도 mixed_case 진단으로 알린다 — DEPT_ID 같은 명시적 SNAKE_CASE 를 권장.
    if (!ident.includes("_") && /^[A-Za-z][A-Za-z0-9]*$/.test(ident)) {
      issues.push({
        severity: "warning",
        kind: "mixed_case_identifier",
        column: upper,
        message: `식별자 '${ident}' 가 SNAKE_CASE(UPPER) 가 아닙니다. eGovFrame 표준은 컬럼명을 대문자 SNAKE_CASE 로 권장합니다.`,
        suggestion: camelToSnake(ident).toUpperCase(),
      });
    }
    ident = upper;
  }

  // 데이터 타입 정규화
  let type = rawType;
  if (opts.normalizeDataTypeCase && type !== type.toUpperCase()) {
    const upper = type.toUpperCase();
    changes.push({
      kind: "data_type_case",
      before: type,
      after: upper,
      lineIndex,
    });
    type = upper;
  }
  if (!KNOWN_DATA_TYPES.has(type.toUpperCase())) {
    issues.push({
      severity: "warning",
      kind: "unknown_data_type",
      column: ident,
      token: type,
      message: `데이터 타입 '${type}' 는 사전에 없습니다(java.lang.Object 로 매핑됨). dataTypes.ts 매핑을 보강하거나 표준 타입을 사용하세요.`,
    });
  }

  // 인자/뒷부분은 보수적으로 그대로 둔다 (whitespace만 정리)
  const args = (typeArgs || "").replace(/\s+/g, "");
  const tail = (rest || "").replace(/\s+/g, " ").trimEnd();

  return `${ident} ${type}${args}${tail}`;
}

function normalizeConstraintLine(
  line: string,
  lineIndex: number,
  changes: NormalizationChange[],
  opts: NormalizeOpts,
): string {
  // PRIMARY KEY (foo, "Bar")  →  PRIMARY KEY (foo, bar)
  return line.replace(/\(([^)]*)\)/g, (_full, inside) => {
    const cols = inside.split(",").map((c: string) => {
      const trimmed = c.trim();
      const stripped = trimmed.replace(/[`"']/g, "");
      let out = stripped;
      if (stripped !== trimmed) {
        changes.push({
          kind: "identifier_quote",
          before: trimmed,
          after: stripped,
          lineIndex,
        });
      }
      if (opts.normalizeIdentifierCase && /[a-z]/.test(out)) {
        const upper = out.toUpperCase();
        changes.push({
          kind: "identifier_case",
          before: out,
          after: upper,
          lineIndex,
        });
        out = upper;
      }
      return out;
    });
    return `(${cols.join(", ")})`;
  });
}

/**
 * 사람이 읽기 좋은 보고서 요약(여러 줄 텍스트).
 * 빈 보고서면 빈 문자열을 돌려준다.
 */
export function formatNormalizationReport(report: NormalizationReport): string {
  if (report.changes.length === 0 && report.issues.length === 0) return "";
  const lines: string[] = [];

  // 같은 식별자가 컬럼 정의 + 제약절 양쪽에 등장할 때 동일 변환이 중복 신고되는
  // 노이즈를 줄이기 위해 (kind, before, after) 기준으로 dedupe 한다.
  const dedupedChanges: NormalizationChange[] = [];
  {
    const seen = new Set<string>();
    for (const c of report.changes) {
      const key = `${c.kind}|${c.before}|${c.after}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedupedChanges.push(c);
    }
  }

  if (dedupedChanges.length > 0) {
    lines.push(`적용된 정규화 변경 ${dedupedChanges.length}건:`);
    for (const c of dedupedChanges.slice(0, 10)) {
      lines.push(`  - [${c.kind}] '${c.before}' → '${c.after}'`);
    }
    if (dedupedChanges.length > 10) {
      lines.push(`  - … 외 ${dedupedChanges.length - 10}건`);
    }
  }
  // issues 도 같은 (kind, column, message) 가 여러 번 신고될 수 있어 dedupe.
  const dedupedIssues: NormalizationIssue[] = [];
  {
    const seen = new Set<string>();
    for (const i of report.issues) {
      const key = `${i.kind}|${i.column ?? ""}|${i.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedupedIssues.push(i);
    }
  }
  const warnings = dedupedIssues.filter((i) => i.severity === "warning");
  const infos = dedupedIssues.filter((i) => i.severity === "info");
  if (warnings.length > 0) {
    lines.push(`표준 미준수 경고 ${warnings.length}건:`);
    for (const i of warnings.slice(0, 10)) {
      const sug = i.suggestion ? ` (권장: '${i.suggestion}')` : "";
      lines.push(`  - [${i.kind}] ${i.message}${sug}`);
    }
    if (warnings.length > 10) {
      lines.push(`  - … 외 ${warnings.length - 10}건`);
    }
  }
  if (infos.length > 0) {
    lines.push(`참고 ${infos.length}건은 검증 결과 표준 사전에 없는 항목입니다.`);
  }
  return lines.join("\n");
}

function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
