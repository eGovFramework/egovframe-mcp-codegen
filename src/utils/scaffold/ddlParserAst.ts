/**
 * AST-based DDL parser (MySQL dialect)
 *
 * `node-sql-parser` 를 이용해 CREATE TABLE DDL 을 AST 로 파싱한 뒤,
 * scaffold 가 쓰는 표준 IR (`ParsedDDL`) 로 매핑한다.
 *
 * 설계 원칙
 * ---------
 * - **공용 API 표면 유지**: 호출자는 `parseDDL` 만 보면 되도록 출력 IR 모양을
 *   기존 정규식 파서와 동일하게 유지한다. AST 도입은 내부 변경.
 * - **MySQL 우선**: 첫 dialect 어댑터로 MySQL 을 채택. PostgreSQL/Oracle 등은
 *   추후 `parseDDL` 의 dialect 라우팅으로 확장할 수 있다.
 * - **실패는 명확히**: AST 가 파싱하지 못하면 그대로 throw 한다. 라우터
 *   (`ddlParser.ts`) 가 이 에러를 잡아 legacy 정규식 파서로 fallback 한다.
 *
 * Phase 2-C 의 1차 도구. dialect 어댑터 인터페이스(`DialectAdapter`) 도입 시
 * 이 모듈을 MySQL 어댑터로 그대로 흡수할 수 있도록 출력 모양을 단순하게 둔다.
 */

// node-sql-parser 는 CommonJS 패키지. ESM 빌드(`"type": "module"`)에서
// `import { Parser } from "node-sql-parser"` named import 는 런타임에 실패하므로
// default import 후 구조 분해한다. (Node.js ESM-CJS interop)
import nodeSqlParser from "node-sql-parser";
import { getJavaClassName } from "./dataTypes.js";
import type { Column, ParsedDDLCore } from "./ddlParser.js";
import { computeIsLongText, computeIsYnFlag, renderDefaultValue } from "./ddlParser.js";

const { Parser } = nodeSqlParser as unknown as {
  Parser: new () => { astify(sql: string, opt?: { database: string }): unknown };
};
const MYSQL_OPT = { database: "MySQL" } as const;

const DATE_JAVA_TYPES = new Set([
  "java.sql.Date",
  "java.sql.Time",
  "java.sql.Timestamp",
  "java.util.Date",
]);

// 모듈 전역 파서 인스턴스. node-sql-parser 는 internal 상태가 없으므로 안전하다.
const parser = new Parser();

interface AstColumnRef {
  type: "column_ref";
  column: string;
  collate?: unknown;
}

interface AstColumnDefinition {
  resource: "column";
  column: AstColumnRef;
  definition: {
    dataType: string;
    length?: number;
    scale?: number;
    parentheses?: boolean;
    suffix?: unknown;
  };
  nullable?: { type: "not null" | "null"; value: string };
  primary_key?: string;
  unique?: string;
  comment?: unknown;
  default_val?: unknown;
}

interface AstConstraintDefinition {
  resource: "constraint";
  constraint: string | null;
  /** node-sql-parser 는 'primary key' / 'unique key' / 'check' / 'foreign key' 등을 돌려준다. */
  constraint_type: string;
  definition: AstColumnRef[];
  keyword?: unknown;
  index_type?: unknown;
}

interface AstIndexDefinition {
  resource: "index";
  index?: string;
  definition: AstColumnRef[];
  keyword?: unknown;
}

type AstCreateDefinition =
  | AstColumnDefinition
  | AstConstraintDefinition
  | AstIndexDefinition;

interface AstCreateTable {
  type: "create";
  keyword: string; // 'table'
  table: Array<{ db: string | null; table: string }>;
  create_definitions: AstCreateDefinition[];
}

function isColumnDefinition(d: AstCreateDefinition): d is AstColumnDefinition {
  return d.resource === "column";
}
function isConstraintDefinition(d: AstCreateDefinition): d is AstConstraintDefinition {
  return d.resource === "constraint";
}

function snakeToCamel(s: string): string {
  return s.toLowerCase().replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
}

function pascalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * 인라인 REFERENCES 절 (예: `CUST_ID VARCHAR(20) REFERENCES CUSTOMER(CUSTOMER_ID)`)
 * 을 컬럼 정의 AST 에서 추출. 단일 컬럼 참조만 지원한다.
 * 제약절 형태 (`CONSTRAINT FK_X FOREIGN KEY (..) REFERENCES ..`) 는 본 함수가 아닌
 * 메인 파싱 흐름의 2차 패스에서 처리한다.
 */
function extractInlineFk(
  def: AstColumnDefinition,
): { targetTable: string; targetColumn: string } | null {
  const refDef = (def as { reference_definition?: unknown }).reference_definition as
    | { definition?: Array<{ column?: string }>; table?: Array<{ table?: string }> }
    | undefined;
  const targetTable = refDef?.table?.[0]?.table;
  const targetColumn = refDef?.definition?.[0]?.column;
  if (!targetTable || !targetColumn) return null;
  return { targetTable, targetColumn };
}

/**
 * `parseDDLWithAst` 가 던지는 에러. `node-sql-parser`(pegjs 기반)의 구문 에러
 * 위치(line/column, 1-base)가 있으면 `location` 에 실어 라우터(`ddlParser.ts`)
 * 가 "N행 M열" 진단 메시지를 만드는 데 재사용할 수 있게 한다.
 */
export interface AstParseError extends Error {
  location?: { line: number; column: number };
}

/**
 * `node-sql-parser`(pegjs 기반)가 던지는 SyntaxError 에서 `{ line, column }`
 * 위치 정보를 추출한다. pegjs 에러는 `location.start.{line,column}` 형태이며,
 * 이 모양이 아니면(=일반 Error 등) undefined 를 돌려준다.
 */
function extractPegjsLocation(e: unknown): { line: number; column: number } | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const loc = (e as { location?: { start?: { line?: unknown; column?: unknown } } })
    .location;
  const line = loc?.start?.line;
  const column = loc?.start?.column;
  return typeof line === "number" && typeof column === "number" ? { line, column } : undefined;
}

/**
 * AST 경로로 DDL 을 파싱한다. 실패하면 throw — 라우터가 fallback 한다.
 */
export function parseDDLWithAst(ddl: string): ParsedDDLCore {
  // node-sql-parser 는 `;` 가 없어도 동작하지만 일부 다중 문장 케이스에서
  // 안전을 위해 trim 만 해 두고 입력은 변경하지 않는다.
  const trimmed = ddl.trim();
  if (!/^CREATE\s+/i.test(trimmed)) {
    throw new Error("Unable to parse table name from DDL: not a CREATE TABLE statement");
  }

  let ast: unknown;
  try {
    ast = parser.astify(trimmed, MYSQL_OPT);
  } catch (e) {
    const err = new Error(
      `AST parse failed: ${e instanceof Error ? e.message : String(e)}`,
    ) as AstParseError;
    const location = extractPegjsLocation(e);
    if (location) err.location = location;
    throw err;
  }

  const node = Array.isArray(ast) ? ast[0] : ast;
  if (!isCreateTable(node)) {
    throw new Error("AST did not produce a CREATE TABLE node");
  }

  const tableEntry = node.table?.[0];
  if (!tableEntry?.table) {
    throw new Error("Unable to parse table name from DDL");
  }
  const tableName = pascalize(snakeToCamel(tableEntry.table));

  // 1차 패스: 컬럼 정의 수집 (PK 마킹은 인라인 + 제약절 두 방식 모두 고려)
  const attributes: Column[] = [];
  const columnByName = new Map<string, Column>();

  for (const def of node.create_definitions ?? []) {
    if (!isColumnDefinition(def)) continue;
    const columnName = def.column.column;
    const rawType = (def.definition.dataType || "").toUpperCase();
    const length = typeof def.definition.length === "number" ? def.definition.length : 0;
    const scale = typeof def.definition.scale === "number" ? def.definition.scale : 0;
    const isInlinePk =
      typeof def.primary_key === "string" && def.primary_key.toLowerCase() === "primary key";

    const javaType = getJavaClassName(rawType);
    const ccName = snakeToCamel(columnName);
    // 인라인 REFERENCES 가 있으면 def.reference_definition 에 들어온다.
    const inlineFk = extractInlineFk(def);
    // NOT NULL / DEFAULT 추출
    const nullable = (def as { nullable?: { type?: string } }).nullable;
    const isNotNull = nullable?.type?.toLowerCase() === "not null";
    const defaultValue = renderDefaultValue(
      (def as { default_val?: unknown }).default_val,
    );
    const col: Column = {
      ccName,
      columnName,
      isPrimaryKey: isInlinePk,
      pcName: pascalize(ccName),
      dataType: rawType,
      javaType,
      maxLength: length,
      scale,
      isDate: DATE_JAVA_TYPES.has(javaType),
      isLongText: computeIsLongText(rawType, length),
      isYnFlag: computeIsYnFlag(rawType, length, columnName),
      fk: inlineFk,
      isNotNull,
      defaultValue,
    };
    attributes.push(col);
    columnByName.set(columnName, col);
  }

  // 2차 패스: 제약절에서 PK / FK 추가 마킹
  for (const def of node.create_definitions ?? []) {
    if (!isConstraintDefinition(def)) continue;
    if (def.constraint_type === "primary key") {
      for (const ref of def.definition) {
        const col = columnByName.get(ref.column);
        if (col) col.isPrimaryKey = true;
      }
      continue;
    }
    // FOREIGN KEY 는 케이스가 'FOREIGN KEY' (대문자) 로 들어옴
    if (
      typeof def.constraint_type === "string" &&
      def.constraint_type.toUpperCase() === "FOREIGN KEY"
    ) {
      const refDef = (def as { reference_definition?: unknown }).reference_definition as
        | { definition?: Array<{ column?: string }>; table?: Array<{ table?: string }> }
        | undefined;
      const targetTable = refDef?.table?.[0]?.table;
      const targetColumn = refDef?.definition?.[0]?.column;
      if (!targetTable || !targetColumn) continue;
      // 단일 컬럼 FK 만 지원 (복합 FK 는 현재 범위 밖)
      const localCols = (def.definition || []) as Array<{ column?: string }>;
      for (const ref of localCols) {
        if (!ref.column) continue;
        const col = columnByName.get(ref.column);
        if (col && !col.fk) {
          col.fk = { targetTable, targetColumn };
        }
      }
    }
  }

  const pkAttributes = attributes.filter((a) => a.isPrimaryKey);

  if (attributes.length === 0) {
    throw new Error("No valid columns found in DDL");
  }

  return { tableName, attributes, pkAttributes };
}

function isCreateTable(node: unknown): node is AstCreateTable {
  if (typeof node !== "object" || node === null) return false;
  const obj = node as { type?: unknown; keyword?: unknown };
  if (obj.type !== "create") return false;
  // keyword 가 누락되었거나 비정상 객체이면 false. 정상 케이스는 'table' 문자열.
  return typeof obj.keyword === "string" && obj.keyword.toLowerCase() === "table";
}
