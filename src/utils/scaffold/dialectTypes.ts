/**
 * SQL Dialect Type Mapper
 *
 * DDL 파서가 추출한 정규화된 raw type (대문자) 과 maxLength 를
 * 목표 방언의 컬럼 타입 문자열로 변환한다.
 *
 * 지원 방언:
 *   - "oracle"     : Oracle
 *   - "tibero"     : Tibero — Oracle 호환 (alias)
 *   - "altibase"   : Altibase — Oracle 호환 (alias)
 *   - "goldilocks" : Goldilocks — Oracle 호환 (alias)
 *   - "cubrid"     : CUBRID — 자체 방언 (VARCHAR / INTEGER / STRING 등)
 *   - "mysql"      : MySQL / MariaDB (호환)
 *   - "postgres"   : PostgreSQL
 *   - "hsql"       : HSQLDB 기본 모드 — 임베디드 부트 시드 전용
 *
 * 목적: 사용자가 어떤 형태의 DDL (HSQL, Oracle, PostgreSQL ...) 을 입력하든
 *       방언별 마이그레이션 가이드 SQL 을 일관되게 생성하기 위해 단일 진실원본을
 *       제공한다.
 */

export type Dialect =
  | "oracle"
  | "tibero"
  | "altibase"
  | "goldilocks"
  | "cubrid"
  | "mysql"
  | "postgres"
  // 임베디드 시드(src/main/resources/db/*.sql) 전용 — 운영 DB 마이그레이션
  // fan-out 대상이 아니므로 manifestLoader 의 SUPPORTED_DIALECTS 에는 추가 금지.
  | "hsql";

/**
 * "명백히 비 MySQL 방언" 데이터 타입 토큰 → MySQL 호환 대체 타입 힌트.
 *
 * `ddlParser.ts` 가 AST/Legacy 두 경로 모두 파싱에 실패했을 때, 입력 DDL 에 이
 * 토큰들이 등장하는지 스캔해 "Oracle 등 타 DBMS 방언으로 보입니다" 진단 힌트를
 * 만드는 데 사용한다. 이 파일의 방언별 `mapType()` 매핑에 등장하는 소스 타입
 * 어휘(VARCHAR2/NVARCHAR2/NUMBER/CLOB/BYTEA 등)에, `mapType()` 출력에만 등장해
 * 소스 키로는 없는 Oracle 전용 확장 타입(BINARY_DOUBLE/BINARY_FLOAT/RAW 등)을
 * 더해 구성했다.
 */
export const NON_MYSQL_TYPE_HINTS: Record<string, string> = {
  VARCHAR2: "VARCHAR",
  NVARCHAR2: "VARCHAR",
  NVARCHAR: "VARCHAR",
  NCHAR: "CHAR",
  NUMBER: "DECIMAL",
  BINARY_DOUBLE: "DOUBLE",
  BINARY_FLOAT: "FLOAT",
  CLOB: "TEXT",
  NCLOB: "TEXT",
  NTEXT: "TEXT",
  RAW: "VARBINARY",
  LONG: "LONGTEXT",
  BYTEA: "BLOB",
  JSONB: "JSON",
  SERIAL: "INT AUTO_INCREMENT",
  BIGSERIAL: "BIGINT AUTO_INCREMENT",
  SMALLSERIAL: "SMALLINT AUTO_INCREMENT",
};

/** 길이 정보가 의미있는 타입군. 이 외에는 (N) 을 붙이지 않는다. */
const LENGTH_AWARE = new Set([
  "VARCHAR",
  "VARCHAR2",
  "NVARCHAR",
  "NVARCHAR2",
  "CHAR",
  "NCHAR",
  "DECIMAL",
  "NUMERIC",
  "NUMBER",
]);

/**
 * 한 컬럼의 (rawType, maxLength) → "TYPE(LEN)" 문자열.
 *
 * 길이가 의미 없는 타입(CLOB/TEXT/DATE/TIMESTAMP/BLOB/INTEGER/BIGINT 등) 에는
 * 길이를 붙이지 않는다.
 */
export function dialectFullType(
  rawType: string,
  maxLength: number,
  dialect: Dialect,
): string {
  const t = String(rawType || "").toUpperCase();
  const mapped = mapType(t, dialect);
  // 매핑 결과에 길이가 이미 박혀 있으면 (NUMBER(10), TINYINT(1) 등) 완결된
  // 타입이다 — INT(11) 처럼 입력에 표시 폭이 딸려 와도 재부착하지 않는다.
  if (mapped.includes("(")) {
    return mapped;
  }
  if (LENGTH_AWARE.has(mapped) && maxLength > 0) {
    return `${mapped}(${maxLength})`;
  }
  return mapped;
}

function mapType(t: string, dialect: Dialect): string {
  // Tibero / Altibase / Goldilocks 는 Oracle 호환 방언 — 동일 매핑 사용.
  // 사용자 가이드에서는 별도 섹션으로 노출하되 출력 SQL 은 Oracle 형식과 동일.
  if (dialect === "tibero" || dialect === "altibase" || dialect === "goldilocks") {
    return mapType(t, "oracle");
  }

  if (dialect === "hsql") {
    // 임베디드 부트 시드용. Spring EmbeddedDatabaseBuilder(HSQL) 는 호환 플래그
    // 없는 기본 모드(jdbc:hsqldb:mem)로 뜨므로, 기본 모드가 거부하는 타입만
    // 지원 타입으로 치환하고 나머지는 입력을 보존한다.
    // 아래 매핑은 HSQLDB 2.7.2/2.7.3/2.7.4 에서 CREATE TABLE 실측으로 확정.
    switch (t) {
      case "VARCHAR2":
      case "NVARCHAR":
      case "NVARCHAR2":
        return "VARCHAR";
      case "NCHAR":
        return "CHAR";
      case "TEXT":
      case "TINYTEXT":
      case "MEDIUMTEXT":
      case "LONGTEXT":
      case "NTEXT":
      case "CLOB":
      case "NCLOB":
        // 기본 설정(sql.longvar_is_lob=false)에서 VARCHAR(16M) 으로 동작 —
        // MyBatis 문자열 매핑과 궁합이 좋아 CLOB 대신 LONGVARCHAR 를 쓴다.
        return "LONGVARCHAR";
      case "NUMBER":
        return "NUMERIC";
      case "MEDIUMINT":
        return "INTEGER";
      case "SMALLSERIAL":
        return "SMALLINT";
      case "SERIAL":
        return "INTEGER";
      case "BIGSERIAL":
        return "BIGINT";
      case "BOOL":
        return "BOOLEAN";
      case "ENUM":
      case "SET":
        // 파서가 java.lang.String 으로 매핑하는 열거 타입 — 시드에서는 넉넉한
        // VARCHAR 로 수용한다 (길이가 박혀 있으므로 (LEN) 재부착 없음).
        return "VARCHAR(255)";
      case "BYTEA":
      case "LONGBLOB":
      case "MEDIUMBLOB":
        return "BLOB";
      default:
        return t;
    }
  }

  if (dialect === "cubrid") {
    switch (t) {
      case "VARCHAR":
      case "VARCHAR2":
      case "NVARCHAR":
      case "NVARCHAR2":
        return "VARCHAR";
      case "INT":
      case "INTEGER":
      case "MEDIUMINT":
        return "INTEGER";
      case "TINYINT":
      case "SMALLINT":
        return "SMALLINT";
      case "BIGINT":
        return "BIGINT";
      case "BOOLEAN":
      case "BOOL":
        return "SMALLINT";
      case "DECIMAL":
      case "NUMERIC":
      case "NUMBER":
        return "NUMERIC";
      case "TEXT":
      case "MEDIUMTEXT":
      case "LONGTEXT":
      case "CLOB":
      case "NTEXT":
        return "STRING";
      case "BLOB":
      case "BYTEA":
      case "LONGBLOB":
      case "MEDIUMBLOB":
        return "BLOB";
      case "DATETIME":
        return "DATETIME";
      case "TIMESTAMP":
        return "TIMESTAMP";
      case "DATE":
        return "DATE";
      case "FLOAT":
      case "REAL":
        return "FLOAT";
      case "DOUBLE":
        return "DOUBLE";
      default:
        return t;
    }
  }

  if (dialect === "oracle") {
    switch (t) {
      case "VARCHAR":
      case "VARCHAR2":
        return "VARCHAR2";
      case "NVARCHAR":
      case "NVARCHAR2":
        return "NVARCHAR2";
      case "INT":
      case "INTEGER":
      case "MEDIUMINT":
      case "SMALLINT":
      case "TINYINT":
        return "NUMBER(10)";
      case "BIGINT":
        return "NUMBER(19)";
      case "BOOLEAN":
      case "BOOL":
        return "NUMBER(1)";
      case "DECIMAL":
      case "NUMERIC":
      case "NUMBER":
        return "NUMBER";
      case "TEXT":
      case "MEDIUMTEXT":
      case "LONGTEXT":
      case "CLOB":
      case "NTEXT":
        return "CLOB";
      case "BLOB":
      case "BYTEA":
      case "LONGBLOB":
      case "MEDIUMBLOB":
        return "BLOB";
      case "DATETIME":
      case "TIMESTAMP":
        return "TIMESTAMP";
      case "DATE":
        return "DATE";
      case "FLOAT":
        return "BINARY_FLOAT";
      case "DOUBLE":
      case "REAL":
        return "BINARY_DOUBLE";
      default:
        return t;
    }
  }

  if (dialect === "mysql") {
    switch (t) {
      case "VARCHAR2":
      case "NVARCHAR2":
        return "VARCHAR";
      case "NVARCHAR":
        return "VARCHAR";
      case "NUMBER":
        return "DECIMAL";
      case "CLOB":
      case "NTEXT":
        return "TEXT";
      case "BLOB":
      case "BYTEA":
        return "BLOB";
      case "DATETIME":
        return "DATETIME";
      case "TIMESTAMP":
        return "TIMESTAMP";
      case "DATE":
        return "DATE";
      case "BOOLEAN":
      case "BOOL":
        return "TINYINT(1)";
      default:
        return t;
    }
  }

  // postgres
  switch (t) {
    case "VARCHAR2":
    case "NVARCHAR":
    case "NVARCHAR2":
      return "VARCHAR";
    case "NUMBER":
      return "NUMERIC";
    case "CLOB":
    case "NTEXT":
    case "MEDIUMTEXT":
    case "LONGTEXT":
      return "TEXT";
    case "BLOB":
    case "LONGBLOB":
    case "MEDIUMBLOB":
      return "BYTEA";
    case "DATETIME":
      return "TIMESTAMP";
    case "TIMESTAMP":
      return "TIMESTAMP";
    case "DATE":
      return "DATE";
    case "TINYINT":
    case "SMALLINT":
      return "SMALLINT";
    case "MEDIUMINT":
    case "INT":
    case "INTEGER":
      return "INTEGER";
    case "BIGINT":
      return "BIGINT";
    case "BOOLEAN":
    case "BOOL":
      return "BOOLEAN";
    case "DOUBLE":
      return "DOUBLE PRECISION";
    case "FLOAT":
    case "REAL":
      return "REAL";
    default:
      return t;
  }
}
