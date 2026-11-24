/**
 * DDL Parser — public entry point
 *
 * scaffold 가 사용하는 표준 IR (`ParsedDDL`) 을 돌려준다.
 * 내부적으로 다음 순서로 파싱을 시도한다.
 *
 *   1. AST 파서 (`ddlParserAst.ts`, MySQL dialect, `node-sql-parser`)
 *      - 정확성과 확장성 우선. `COMMENT 'x, y'` 같은 컬럼 안의 콤마 등
 *        정규식 파서가 다루기 어려운 케이스를 정확히 처리한다.
 *   2. Legacy 정규식 파서 (`ddlParserLegacy.ts`)
 *      - AST 가 dialect 한계로 실패한 입력 (`CREATE MEMORY TABLE` HSQLDB,
 *        `VARCHAR2` / `NUMBER` Oracle, `JSONB` PostgreSQL 등) 에 대해
 *        기존 동작을 보장하는 안전벨트.
 *
 * 두 경로 모두 같은 `ParsedDDL` 모양을 돌려주므로 호출부는 변경이 없다.
 *
 * 향후 Phase 3 의 dialect 어댑터(`DialectAdapter`) 도입 시 이 라우터를
 * MySQL/PostgreSQL/Oracle 등 dialect 라우팅 로직으로 확장한다.
 */

import { parseDDLWithAst } from "./ddlParserAst.js";
import { parseDDLLegacy } from "./ddlParserLegacy.js";
import { NON_MYSQL_TYPE_HINTS } from "./dialectTypes.js";
import { nonRetryable } from "./toolMessages.js";

export interface Column {
  ccName: string;
  columnName: string;
  isPrimaryKey: boolean;
  pcName: string;
  dataType: string;
  javaType: string;
  maxLength: number;
  /** DECIMAL/NUMERIC/NUMBER 의 소수 자릿수(scale). DDL 에 지정되지 않았으면 0. */
  scale?: number;
  isDate: boolean;
  /**
   * "본문성 긴 텍스트" 여부 — Register view 등에서 `<textarea>` 로 렌더링할지 결정.
   *
   * 판정 규칙:
   *   - TEXT / MEDIUMTEXT / LONGTEXT / CLOB / NTEXT 등 본질적으로 긴 타입 → true
   *   - VARCHAR / VARCHAR2 / NVARCHAR 의 maxLength >= 500 → true
   *   - 그 외 → false
   *
   * 임계값 500 은 "본문/설명/메모" 류와 "이름/제목/코드" 류를 구분하는 합리적 분기점.
   */
  isLongText: boolean;
  /**
   * "Y/N 플래그" 여부 — Register view 에서 `<select>` 로 렌더링할지 결정.
   *
   * 판정 규칙: `CHAR(1)` (maxLength ≤ 1) AND 컬럼명이 `_YN` 으로 끝남 (대소문자 무관).
   * 예: `USE_YN`, `DEL_YN`, `use_yn` → true. `STATUS_CD` 같은 다른 1자 코드는 false.
   *
   * 라벨은 메시지 키 `input.yes` / `input.no` 로 렌더링되며, 기본 선택값은 `Y`.
   */
  isYnFlag: boolean;
  /**
   * 외래키(FK) 참조 정보 — DDL 의 REFERENCES 절에서 추출.
   *
   * - `targetTable`: 부모 테이블 이름 (대문자, 따옴표 제거)
   * - `targetColumn`: 부모 테이블의 참조 컬럼 (보통 PK)
   *
   * null 이면 FK 아님. 인라인 `col VARCHAR(20) REFERENCES PARENT(PK)` 와
   * 제약절 `CONSTRAINT FK_X FOREIGN KEY (col) REFERENCES PARENT(PK)` 모두에서 추출.
   *
   * 이 정보만으로는 Register view 의 lookup select 가 동작하지 않는다 — 부모 엔티티의
   * 표시 컬럼 정보가 추가로 필요하며, 그건 `entityDiscovery` 가 프로젝트를 스캔해 채운다.
   */
  fk: { targetTable: string; targetColumn: string } | null;
  /**
   * FK 부모 엔티티의 해석 결과 — 런타임에 채워진다 (파서가 채우지 않음).
   *
   * `egov_add_entity` 가 `discoverParentEntity` 로 부모 정보를 찾으면 이 필드를 채운다.
   * 채워져 있으면 (a) Register view 가 `<select>` 로, (b) List view 가 부모 표시 컬럼으로,
   * (c) Controller 가 부모 콤보 리스트를 model 에 주입하도록 분기한다.
   *
   * undefined 이면 FK 자체는 있어도 부모 엔티티를 찾지 못한 상태 — Register view 는
   * plain input 으로 fallback 한다 (graceful degrade).
   */
  fkParent?: {
    entityName: string;
    entityNameLower: string;
    packageName: string;
    pkField: string;
    pkColumn: string;
    displayFields: string[];
    displayColumns: string[];
  };
  /**
   * 컬럼 단위 `NOT NULL` 제약 여부 — DDL 의 NOT NULL 절에서 추출.
   * PK 컬럼은 정의상 NOT NULL 이므로 이 플래그와 무관하게 항상 NOT NULL.
   */
  isNotNull: boolean;
  /**
   * 컬럼 단위 `DEFAULT` 절 — DDL 에서 추출된 SQL 표현. 이미 따옴표/함수 호출
   * 형태로 렌더링되어 있어 SQL 생성 시 그대로 박을 수 있다.
   *   예: "'ENROLLED'", "'Y'", "CURRENT_TIMESTAMP", "1", "TRUE"
   * 없으면 null.
   */
  defaultValue: string | null;
  /**
   * 컬럼 COMMENT 원문 (trim 만 적용). 없거나 빈 문자열이면 null.
   *
   * AST 경로는 인라인 `COMMENT '...'`, legacy 경로는 인라인과 `COMMENT ON COLUMN t.c IS '...'`
   * (Oracle/Tibero/PostgreSQL) 둘 다에서 채운다. 화면 라벨로 쓸지의 판정(콤마·괄호·길이 규칙)은
   * 여기서 하지 않고 `messageLabel.deriveLabelFromComment` 가 생성 컨텍스트 단계에서 적용한다.
   */
  comment: string | null;
  /**
   * 화면 라벨 — 런타임에 채워진다 (파서가 채우지 않음).
   * `scaffoldGenerator.applyLabels` 가 `comment` 규칙 → FK 부모 엔티티명 → `pcName` 순으로 결정한다.
   * 메시지 번들 템플릿 전용 필드.
   */
  label?: string;
}

/**
 * AST 의 default_val 노드 또는 정규식 매칭 결과를 SQL 표현 문자열로 렌더링한다.
 * 두 파서가 같은 형식으로 결과를 만들도록 공용 유틸로 둔다.
 */
export function renderDefaultValue(astValue: unknown): string | null {
  if (astValue == null || typeof astValue !== "object") return null;
  // AST 의 default_val 구조: { type: "default", value: <expr> }
  const wrapper = astValue as { type?: string; value?: unknown };
  const expr = wrapper.value ?? astValue; // 정규식 경로에서는 wrapper 없이 바로 expr 가 올 수 있음

  if (expr == null) return null;
  if (typeof expr === "string") return expr; // 이미 정규식으로 추출된 문자열

  const e = expr as {
    type?: string;
    value?: unknown;
    name?: { name?: Array<{ value?: string }> };
  };

  switch (e.type) {
    case "single_quote_string":
      return `'${String(e.value ?? "")}'`;
    case "double_quote_string":
      return `"${String(e.value ?? "")}"`;
    case "string":
      return `'${String(e.value ?? "")}'`;
    case "number":
      return String(e.value ?? "");
    case "bool":
    case "boolean":
      return e.value ? "TRUE" : "FALSE";
    case "null":
      return "NULL";
    case "function": {
      // CURRENT_TIMESTAMP 같은 nullary 함수는 이름만 출력
      const name = e.name?.name?.[0]?.value ?? "";
      return name.toUpperCase();
    }
    default:
      return null;
  }
}

/**
 * 본문성 long-text 컬럼 판정 임계값. VARCHAR(maxLength) 가 이 값 이상이면 textarea 로 렌더링.
 * 정의상 긴 TEXT/CLOB 계열은 별도 집합으로 처리되므로 이 임계값과 무관하다.
 */
export const LONG_TEXT_LENGTH_THRESHOLD = 500;

/**
 * "정의상 긴" 텍스트 타입들의 집합 — VARCHAR 와 달리 길이를 보지 않고 무조건 textarea.
 */
export const LONG_TEXT_TYPES = new Set<string>([
  "TEXT",
  "MEDIUMTEXT",
  "LONGTEXT",
  "TINYTEXT",
  "CLOB",
  "NCLOB",
  "NTEXT",
]);

/**
 * Column.isLongText 를 계산. 두 파서(AST/Legacy) 가 같은 규칙을 쓰도록 공용 헬퍼로 둔다.
 */
export function computeIsLongText(rawType: string, maxLength: number): boolean {
  const t = rawType.toUpperCase();
  if (LONG_TEXT_TYPES.has(t)) return true;
  // VARCHAR family with sufficient length
  if (/VARCHAR|NVARCHAR|VARCHAR2/.test(t) && maxLength >= LONG_TEXT_LENGTH_THRESHOLD) {
    return true;
  }
  return false;
}

/**
 * Column.isYnFlag 를 계산. CHAR(1) + `_YN` 접미사 컬럼만 YN 플래그로 인정한다.
 * 두 파서가 같은 규칙을 쓰도록 공용 헬퍼로 둔다.
 */
export function computeIsYnFlag(
  rawType: string,
  maxLength: number,
  columnName: string,
): boolean {
  const t = rawType.toUpperCase();
  // CHAR / NCHAR 만 인정. maxLength 가 0 (length 정보 없음) 이거나 1 이하면 통과.
  const isCharOne = /^N?CHAR$/.test(t) && (maxLength === 0 || maxLength <= 1);
  if (!isCharOne) return false;
  // 컬럼명 끝이 _YN (대소문자 무관)
  return /_YN$/i.test(columnName);
}

/**
 * 두 내부 파서(AST/Legacy) 가 공통으로 돌려주는 순수 파싱 결과.
 * 어느 경로가 쓰였는지는 내부 파서가 알 수 없으므로 라우터(`parseDDL`) 가
 * `ParsedDDL` 로 확장해 채운다.
 */
export interface ParsedDDLCore {
  tableName: string;
  attributes: Column[];
  pkAttributes: Column[];
  /**
   * 테이블 COMMENT 원문 (trim 만 적용). 없으면 null.
   * MySQL `) COMMENT='...'` 와 `COMMENT ON TABLE t IS '...'` 둘 다에서 채운다.
   */
  tableComment: string | null;
}

/**
 * 파서가 읽은 코멘트 값을 IR 형식으로 정규화한다: 문자열이면 trim, 빈 문자열/비문자열이면 null.
 * 두 파서가 같은 규칙을 쓰도록 공용 헬퍼로 둔다.
 */
export function normalizeComment(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

export interface ParsedDDL extends ParsedDDLCore {
  /**
   * 어떤 파서가 최종 결과를 만들었는지.
   * - "ast":    node-sql-parser (MySQL dialect) — 정상 경로.
   * - "legacy": AST 가 실패해 정규식 파서로 폴백 — 입력 DDL 이 비표준일 가능성.
   */
  parserUsed: "ast" | "legacy";
  /**
   * 사용자에게 노출할 경고 목록. legacy 폴백이 발생하면 그 사실과 AST 실패
   * 사유가 담긴다. 정상(ast) 경로에서는 빈 배열.
   */
  warnings: string[];
}

/**
 * 파싱 경로별 진단 정보를 함께 돌려주는 변형. `parseDDL` 이 이 결과를 바탕으로
 * `parserUsed` / `warnings` 를 채우며, 원시 진단이 필요한 곳은 직접 사용할 수 있다.
 */
export interface ParseDDLDiagnostics {
  parsed: ParsedDDLCore;
  /** 어떤 경로가 최종 결과를 만들었는지 */
  source: "ast" | "legacy";
  /** AST 가 실패했다면 그 이유 */
  astError?: string;
  /**
   * AST 실패 사유에 `node-sql-parser`(pegjs) 구문 위치가 있었다면 그 line/column
   * (1-base). 없으면 undefined — `astError` 가 AST 레벨 의미 오류(예: "No valid
   * columns found in DDL")일 때는 구문 위치가 없다.
   */
  astErrorLocation?: { line: number; column: number };
}

/**
 * `node-sql-parser`(pegjs) 구문 에러의 line/column 위치와 그 줄의 원문(앞뒤 공백
 * 트리밍)을 "N행 M열: <원문>" 형태로 만든다. 사용자 자신이 입력한 DDL 을 그대로
 * 돌려주는 것이므로 내부 SQL 노출 금지 규칙에 해당하지 않는다.
 * 위치 정보가 없으면 undefined.
 */
function buildLocationSnippet(
  ddl: string,
  location: { line: number; column: number } | undefined,
): string | undefined {
  if (!location) return undefined;
  const lines = ddl.split(/\r\n|\r|\n/);
  const lineText = lines[location.line - 1]?.trim();
  const pos = `${location.line}행 ${location.column}열`;
  return lineText ? `${pos}: ${lineText}` : pos;
}

/**
 * 입력 DDL 에서 잘 알려진 비-MySQL 방언 타입 토큰(`NON_MYSQL_TYPE_HINTS`)을
 * 스캔해, 발견되면 "Oracle 등 타 DBMS 방언으로 보입니다" 힌트 문장을 만든다.
 * 아무 토큰도 없으면 undefined.
 */
function buildForeignDialectHint(ddl: string): string | undefined {
  const upper = ddl.toUpperCase();
  const found = Object.keys(NON_MYSQL_TYPE_HINTS).filter((token) =>
    new RegExp(`\\b${token}\\b`).test(upper),
  );
  if (found.length === 0) return undefined;
  const conversions = found.map((t) => `${t} → ${NON_MYSQL_TYPE_HINTS[t]}`).join(", ");
  return (
    `Oracle 등 타 DBMS 방언으로 보입니다 — ${conversions} 변환 또는 ` +
    `normalizeDdl 옵션 활용을 검토하세요.`
  );
}

/**
 * AST/Legacy 두 경로 모두 실패했을 때의 최종 에러를 만든다. 같은 인자로
 * 재호출해도 항상 같은 이유로 실패하므로 `nonRetryable` 로 감싸 재시도 루프를
 * 차단한다.
 */
function buildParseFailureError(
  ddl: string,
  astError: string | undefined,
  astErrorLocation: { line: number; column: number } | undefined,
  legacyError: string,
): Error {
  const locationSnippet = buildLocationSnippet(ddl, astErrorLocation);
  const astPart = locationSnippet
    ? `AST(MySQL) 경로: ${astError ?? "n/a"} (${locationSnippet})`
    : `AST(MySQL) 경로: ${astError ?? "n/a"}`;

  const messageParts = [`DDL 파싱 실패. ${astPart} / Legacy 경로: ${legacyError}`];
  const dialectHint = buildForeignDialectHint(ddl);
  if (dialectHint) messageParts.push(dialectHint);

  return nonRetryable(messageParts.join(" "));
}

export function parseDDL(ddl: string): ParsedDDL {
  const { parsed, source, astError, astErrorLocation } = parseDDLWithDiagnostics(ddl);
  const warnings: string[] = [];
  if (source === "legacy") {
    const locationSnippet = buildLocationSnippet(ddl, astErrorLocation);
    const astErrorText = locationSnippet
      ? `${astError ?? "알 수 없음"} (${locationSnippet})`
      : astError ?? "알 수 없음";
    warnings.push(
      `입력 DDL 이 표준 SQL(MySQL dialect) 로 파싱되지 않아 legacy 정규식 파서로 처리되었습니다. ` +
        `비표준 문법(HSQLDB CREATE MEMORY TABLE, Oracle VARCHAR2/NUMBER, PostgreSQL JSONB 등)이 ` +
        `포함된 것으로 보입니다. (AST 파싱 실패 사유: ${astErrorText})`,
    );
  }
  return { ...parsed, parserUsed: source, warnings };
}

export function parseDDLWithDiagnostics(ddl: string): ParseDDLDiagnostics {
  let astError: string | undefined;
  let astErrorLocation: { line: number; column: number } | undefined;
  try {
    const parsed = parseDDLWithAst(ddl);
    // 안전 검사: AST 가 컬럼 0개를 돌려주면 legacy 로 한 번 더 시도한다.
    if (parsed.attributes.length > 0) {
      return { parsed, source: "ast" };
    }
    astError = "AST produced 0 columns";
  } catch (e) {
    astError = e instanceof Error ? e.message : String(e);
    astErrorLocation =
      typeof e === "object" && e !== null
        ? (e as { location?: { line: number; column: number } }).location
        : undefined;
  }

  try {
    const parsed = parseDDLLegacy(ddl);
    return { parsed, source: "legacy", astError, astErrorLocation };
  } catch (legacyErr) {
    // 둘 다 실패하면 사용자에게 두 경로 정보를 모두 노출한다.
    const legacyMsg = legacyErr instanceof Error ? legacyErr.message : String(legacyErr);
    throw buildParseFailureError(ddl, astError, astErrorLocation, legacyMsg);
  }
}
