/**
 * DDL parser unit tests
 *
 * `src/utils/scaffold/ddlParser.ts`의 회귀 위험 케이스를 고정합니다.
 * 새로운 케이스가 깨지면 파서 개선 PR과 함께 갱신하세요.
 */
import { describe, it, expect } from "vitest";
import { parseDDL } from "../../src/utils/scaffold/ddlParser.js";

describe("parseDDL — table name", () => {
  it("snake_case 테이블명을 PascalCase로 변환한다", () => {
    const r = parseDDL(`CREATE TABLE user_account (id VARCHAR(36) PRIMARY KEY)`);
    expect(r.tableName).toBe("UserAccount");
  });

  it("backtick 식별자를 처리한다", () => {
    const r = parseDDL("CREATE TABLE `board` (id VARCHAR(36) PRIMARY KEY)");
    expect(r.tableName).toBe("Board");
  });

  it("CREATE MEMORY TABLE 구문 (HSQLDB)을 처리한다", () => {
    const r = parseDDL(`CREATE MEMORY TABLE board (id VARCHAR(36) PRIMARY KEY)`);
    expect(r.tableName).toBe("Board");
  });

  it("이미 단일 단어 테이블명은 그대로 PascalCase로 변환한다", () => {
    const r = parseDDL(`CREATE TABLE board (id VARCHAR(36) PRIMARY KEY)`);
    expect(r.tableName).toBe("Board");
  });

  it("테이블명이 없으면 명확한 에러를 던진다", () => {
    expect(() => parseDDL("INSERT INTO foo VALUES (1)")).toThrow(/table name/i);
  });
});

describe("parseDDL — columns & primary keys", () => {
  it("인라인 PRIMARY KEY를 인식한다", () => {
    const r = parseDDL(`CREATE TABLE t (id VARCHAR(36) PRIMARY KEY, name VARCHAR(100))`);
    expect(r.attributes).toHaveLength(2);
    expect(r.pkAttributes).toHaveLength(1);
    expect(r.pkAttributes[0].columnName).toBe("id");
  });

  it("PRIMARY KEY 제약절을 인식한다", () => {
    const r = parseDDL(
      `CREATE TABLE t (id VARCHAR(36), name VARCHAR(100), PRIMARY KEY (id))`,
    );
    expect(r.pkAttributes).toHaveLength(1);
    expect(r.pkAttributes[0].columnName).toBe("id");
  });

  it("복합 PRIMARY KEY를 모두 인식한다", () => {
    const r = parseDDL(
      `CREATE TABLE link (left_id VARCHAR(36), right_id VARCHAR(36), PRIMARY KEY (left_id, right_id))`,
    );
    expect(r.pkAttributes).toHaveLength(2);
    expect(r.pkAttributes.map((c) => c.columnName).sort()).toEqual([
      "left_id",
      "right_id",
    ]);
  });

  it("snake_case 컬럼명을 camelCase(ccName)과 PascalCase(pcName)으로 변환한다", () => {
    const r = parseDDL(`CREATE TABLE t (board_id VARCHAR(36) PRIMARY KEY, created_at TIMESTAMP)`);
    const ids = r.attributes.find((a) => a.columnName === "board_id")!;
    const ca = r.attributes.find((a) => a.columnName === "created_at")!;
    expect(ids.ccName).toBe("boardId");
    expect(ids.pcName).toBe("BoardId");
    expect(ca.ccName).toBe("createdAt");
    expect(ca.pcName).toBe("CreatedAt");
  });

  it("UNIQUE KEY / KEY / CONSTRAINT 라인은 컬럼에서 제외한다", () => {
    const r = parseDDL(
      `CREATE TABLE t (
        id VARCHAR(36),
        email VARCHAR(200),
        UNIQUE KEY uk_email (email),
        KEY idx_email (email),
        CONSTRAINT pk_t PRIMARY KEY (id)
      )`,
    );
    // 컬럼은 id, email 둘만 인식되어야 함
    expect(r.attributes.map((a) => a.columnName).sort()).toEqual(["email", "id"]);
  });
});

describe("parseDDL — data types & length", () => {
  it("VARCHAR(n)에서 길이를 추출한다", () => {
    const r = parseDDL(`CREATE TABLE t (name VARCHAR(200) PRIMARY KEY)`);
    expect(r.attributes[0].maxLength).toBe(200);
    expect(r.attributes[0].dataType).toBe("VARCHAR");
    expect(r.attributes[0].javaType).toBe("java.lang.String");
  });

  it("VARCHAR2 (Oracle)을 String으로 매핑한다", () => {
    const r = parseDDL(`CREATE TABLE t (name VARCHAR2(100) PRIMARY KEY)`);
    expect(r.attributes[0].javaType).toBe("java.lang.String");
  });

  it("NUMBER (Oracle)을 Integer로 매핑한다", () => {
    const r = parseDDL(`CREATE TABLE t (cnt NUMBER PRIMARY KEY)`);
    expect(r.attributes[0].javaType).toBe("java.lang.Integer");
  });

  it("BIGINT을 Long으로 매핑한다", () => {
    const r = parseDDL(`CREATE TABLE t (id BIGINT PRIMARY KEY)`);
    expect(r.attributes[0].javaType).toBe("java.lang.Long");
  });

  it("DECIMAL(p,s)에서 첫 번째 인자(precision)를 maxLength로 잡는다", () => {
    const r = parseDDL(`CREATE TABLE t (price DECIMAL(10,2) PRIMARY KEY)`);
    expect(r.attributes[0].dataType).toBe("DECIMAL");
    expect(r.attributes[0].maxLength).toBe(10);
    expect(r.attributes[0].javaType).toBe("java.math.BigDecimal");
  });

  it("TIMESTAMP에 대해 isDate=true 플래그를 설정한다", () => {
    const r = parseDDL(`CREATE TABLE t (id VARCHAR(36) PRIMARY KEY, ts TIMESTAMP)`);
    const ts = r.attributes.find((a) => a.columnName === "ts")!;
    expect(ts.isDate).toBe(true);
  });

  it("TEXT를 String으로 매핑하고 maxLength=0이 된다", () => {
    const r = parseDDL(`CREATE TABLE t (id VARCHAR(36) PRIMARY KEY, content TEXT)`);
    const content = r.attributes.find((a) => a.columnName === "content")!;
    expect(content.javaType).toBe("java.lang.String");
    expect(content.maxLength).toBe(0);
  });

  it("TEXT 계열은 isLongText=true (textarea 렌더링 트리거)", () => {
    const r = parseDDL(
      `CREATE TABLE t (id VARCHAR(36) PRIMARY KEY, body TEXT, summary MEDIUMTEXT, blob LONGTEXT)`,
    );
    expect(r.attributes.find((a) => a.columnName === "body")!.isLongText).toBe(true);
    expect(r.attributes.find((a) => a.columnName === "summary")!.isLongText).toBe(true);
    expect(r.attributes.find((a) => a.columnName === "blob")!.isLongText).toBe(true);
  });

  it("VARCHAR maxLength>=500 은 isLongText=true, 그 미만은 false", () => {
    const r = parseDDL(
      `CREATE TABLE t (id VARCHAR(36) PRIMARY KEY, title VARCHAR(200), content VARCHAR(2000), summary VARCHAR(500))`,
    );
    expect(r.attributes.find((a) => a.columnName === "id")!.isLongText).toBe(false);
    expect(r.attributes.find((a) => a.columnName === "title")!.isLongText).toBe(false);
    expect(r.attributes.find((a) => a.columnName === "content")!.isLongText).toBe(true);
    // 정확히 임계값(500) 도 true 가 되어야 한다 (>= 500)
    expect(r.attributes.find((a) => a.columnName === "summary")!.isLongText).toBe(true);
  });

  it("DATE/INT/CHAR 등 비-텍스트 타입은 isLongText=false", () => {
    const r = parseDDL(
      `CREATE TABLE t (id VARCHAR(36) PRIMARY KEY, created DATE, score INT, flag CHAR(1))`,
    );
    for (const c of r.attributes) {
      expect(c.isLongText).toBe(false);
    }
  });

  it("CHAR(1) + _YN 컬럼은 isYnFlag=true", () => {
    const r = parseDDL(
      `CREATE TABLE t (id VARCHAR(36) PRIMARY KEY, use_yn CHAR(1), del_yn CHAR(1), name VARCHAR(50))`,
    );
    expect(r.attributes.find((a) => a.columnName === "use_yn")!.isYnFlag).toBe(true);
    expect(r.attributes.find((a) => a.columnName === "del_yn")!.isYnFlag).toBe(true);
    expect(r.attributes.find((a) => a.columnName === "name")!.isYnFlag).toBe(false);
  });

  it("CHAR(1) 이어도 _YN 이 아니면 isYnFlag=false", () => {
    const r = parseDDL(
      `CREATE TABLE t (id VARCHAR(36) PRIMARY KEY, status_cd CHAR(1), gender CHAR(1))`,
    );
    expect(r.attributes.find((a) => a.columnName === "status_cd")!.isYnFlag).toBe(false);
    expect(r.attributes.find((a) => a.columnName === "gender")!.isYnFlag).toBe(false);
  });

  it("_YN 이어도 CHAR(1) 이 아니면 isYnFlag=false (VARCHAR 등 거부)", () => {
    const r = parseDDL(
      `CREATE TABLE t (id VARCHAR(36) PRIMARY KEY, use_yn VARCHAR(10))`,
    );
    expect(r.attributes.find((a) => a.columnName === "use_yn")!.isYnFlag).toBe(false);
  });

  it("CONSTRAINT FOREIGN KEY 절에서 FK 메타데이터를 추출한다", () => {
    const r = parseDDL(`CREATE TABLE ORDER_HEADER (
      ORDER_ID VARCHAR(20) NOT NULL PRIMARY KEY,
      CUSTOMER_ID VARCHAR(20) NOT NULL,
      CONSTRAINT FK_ORDER_CUSTOMER FOREIGN KEY (CUSTOMER_ID) REFERENCES CUSTOMER(CUSTOMER_ID)
    )`);
    const cust = r.attributes.find((a) => a.columnName === "CUSTOMER_ID")!;
    expect(cust.fk).toEqual({ targetTable: "CUSTOMER", targetColumn: "CUSTOMER_ID" });
    const oid = r.attributes.find((a) => a.columnName === "ORDER_ID")!;
    expect(oid.fk).toBeNull();
  });

  it("인라인 REFERENCES 절도 FK 메타데이터로 추출한다", () => {
    const r = parseDDL(
      `CREATE TABLE ORDER_HEADER (ORDER_ID VARCHAR(20) PRIMARY KEY, CUSTOMER_ID VARCHAR(20) REFERENCES CUSTOMER(CUSTOMER_ID))`,
    );
    const cust = r.attributes.find((a) => a.columnName === "CUSTOMER_ID")!;
    expect(cust.fk).toEqual({ targetTable: "CUSTOMER", targetColumn: "CUSTOMER_ID" });
  });

  it("REFERENCES 가 없으면 fk=null", () => {
    const r = parseDDL(
      `CREATE TABLE t (id VARCHAR(20) PRIMARY KEY, name VARCHAR(50))`,
    );
    expect(r.attributes.find((a) => a.columnName === "name")!.fk).toBeNull();
  });

  it("NOT NULL / DEFAULT 절을 컬럼별로 추출한다", () => {
    const r = parseDDL(`CREATE TABLE t (
      id VARCHAR(20) NOT NULL PRIMARY KEY,
      status VARCHAR(20) DEFAULT 'ENROLLED' NOT NULL,
      use_yn CHAR(1) DEFAULT 'Y' NOT NULL,
      created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      note VARCHAR(100)
    )`);
    const status = r.attributes.find((a) => a.columnName === "status")!;
    expect(status.isNotNull).toBe(true);
    expect(status.defaultValue).toBe("'ENROLLED'");

    const useYn = r.attributes.find((a) => a.columnName === "use_yn")!;
    expect(useYn.isNotNull).toBe(true);
    expect(useYn.defaultValue).toBe("'Y'");

    const created = r.attributes.find((a) => a.columnName === "created")!;
    expect(created.isNotNull).toBe(false);
    expect(created.defaultValue).toBe("CURRENT_TIMESTAMP");

    const note = r.attributes.find((a) => a.columnName === "note")!;
    expect(note.isNotNull).toBe(false);
    expect(note.defaultValue).toBeNull();
  });

  it("PK NOT NULL 은 isNotNull=true 이며 defaultValue 는 null (있을 수 있음)", () => {
    const r = parseDDL(`CREATE TABLE t (id VARCHAR(20) NOT NULL PRIMARY KEY)`);
    const pk = r.attributes.find((a) => a.columnName === "id")!;
    expect(pk.isPrimaryKey).toBe(true);
    expect(pk.isNotNull).toBe(true);
    expect(pk.defaultValue).toBeNull();
  });

  it("알 수 없는 타입은 Object로 매핑한다", () => {
    const r = parseDDL(`CREATE TABLE t (id VARCHAR(36) PRIMARY KEY, payload JSONB)`);
    const payload = r.attributes.find((a) => a.columnName === "payload")!;
    expect(payload.javaType).toBe("java.lang.Object");
  });
});

describe("parseDDL — whitespace & formatting", () => {
  it("여러 줄에 걸친 DDL을 처리한다", () => {
    const r = parseDDL(`
      CREATE TABLE board (
        board_id VARCHAR(36) NOT NULL,
        title    VARCHAR(200) NOT NULL,
        PRIMARY KEY (board_id)
      )
    `);
    expect(r.tableName).toBe("Board");
    expect(r.attributes.map((a) => a.columnName).sort()).toEqual([
      "board_id",
      "title",
    ]);
  });

  it("탭과 다중 공백을 정규화한다", () => {
    const r = parseDDL("CREATE\tTABLE  board  (id   VARCHAR(36)  PRIMARY  KEY)");
    expect(r.tableName).toBe("Board");
    expect(r.attributes).toHaveLength(1);
  });
});

describe("parseDDL — error cases", () => {
  it("유효한 컬럼이 없으면 에러를 던진다", () => {
    expect(() => parseDDL("CREATE TABLE t ()")).toThrow();
  });

  it("괄호가 전혀 없으면 컬럼 정의 파싱 에러", () => {
    expect(() => parseDDL("CREATE TABLE foo")).toThrow();
  });
});

/**
 * Phase 2-C 에서 AST 파서가 흡수한 케이스들.
 * 과거 정규식 파서의 한계로 `.fails` 마커가 붙어 있었으나, `node-sql-parser`
 * 도입 후 정상 처리된다. AST 경로가 실패하면 legacy 정규식 fallback 으로
 * 떨어지므로 이전 동작도 함께 보호된다.
 */
describe("parseDDL — AST 파서가 해소한 케이스", () => {
  it("COMMENT 안의 콤마를 컬럼 구분자로 오인하지 않는다", () => {
    const r = parseDDL(
      `CREATE TABLE t (id VARCHAR(36) PRIMARY KEY COMMENT 'id, the primary')`,
    );
    expect(r.attributes).toHaveLength(1);
    expect(r.attributes[0].columnName).toBe("id");
    expect(r.pkAttributes).toHaveLength(1);
  });

  it("DEFAULT 'a, b, c' 리터럴 안의 콤마도 컬럼 구분자로 오인하지 않는다", () => {
    const r = parseDDL(
      `CREATE TABLE t (id VARCHAR(36) PRIMARY KEY, tags VARCHAR(100) DEFAULT 'a,b,c')`,
    );
    expect(r.attributes).toHaveLength(2);
    expect(r.attributes.map((a) => a.columnName).sort()).toEqual(["id", "tags"]);
  });

  it("DECIMAL(p,s) 의 콤마도 컬럼 구분자로 오인하지 않고 length=p 를 추출한다", () => {
    const r = parseDDL(
      `CREATE TABLE t (id INT PRIMARY KEY, price DECIMAL(10,2) NOT NULL)`,
    );
    expect(r.attributes).toHaveLength(2);
    const price = r.attributes.find((a) => a.columnName === "price")!;
    expect(price.dataType).toBe("DECIMAL");
    expect(price.maxLength).toBe(10);
  });

  it("CONSTRAINT pk_name PRIMARY KEY 형태도 PK 로 인식한다", () => {
    const r = parseDDL(
      `CREATE TABLE t (id VARCHAR(36) NOT NULL, name VARCHAR(100), CONSTRAINT pk_t PRIMARY KEY (id))`,
    );
    expect(r.pkAttributes.map((a) => a.columnName)).toEqual(["id"]);
  });
});

describe("parseDDL — passing edge cases (회귀 보호용)", () => {
  it("DEFAULT CURRENT_TIMESTAMP 가 있어도 컬럼은 정상 파싱한다", () => {
    const r = parseDDL(
      `CREATE TABLE t (id VARCHAR(36) PRIMARY KEY, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    );
    expect(r.attributes).toHaveLength(2);
    const created = r.attributes.find((a) => a.columnName === "created_at");
    expect(created).toBeDefined();
    expect(created!.javaType).toBe("java.sql.Timestamp");
  });

  it("HSQLDB CREATE MEMORY TABLE 은 legacy fallback 으로 처리된다", () => {
    const r = parseDDL(
      `CREATE MEMORY TABLE board (id VARCHAR(36) PRIMARY KEY, title VARCHAR(200))`,
    );
    expect(r.tableName).toBe("Board");
    expect(r.attributes.map((a) => a.columnName).sort()).toEqual(["id", "title"]);
  });

  it("Oracle VARCHAR2 은 legacy fallback 으로 처리되어 String 으로 매핑된다", () => {
    const r = parseDDL(`CREATE TABLE t (name VARCHAR2(100) PRIMARY KEY)`);
    expect(r.attributes[0].javaType).toBe("java.lang.String");
  });

  it("PostgreSQL JSONB 는 legacy fallback 으로 처리되어 Object 로 매핑된다", () => {
    const r = parseDDL(
      `CREATE TABLE t (id VARCHAR(36) PRIMARY KEY, payload JSONB)`,
    );
    const payload = r.attributes.find((a) => a.columnName === "payload")!;
    expect(payload.javaType).toBe("java.lang.Object");
  });
});

describe("parseDDL — parserUsed & warnings", () => {
  it("표준 MySQL DDL 은 parserUsed='ast' 이고 warnings 는 빈 배열이다", () => {
    const r = parseDDL(
      `CREATE TABLE board (board_id VARCHAR(36) PRIMARY KEY, title VARCHAR(200))`,
    );
    expect(r.parserUsed).toBe("ast");
    expect(r.warnings).toEqual([]);
  });

  it("CREATE MEMORY TABLE (HSQLDB) 은 parserUsed='legacy' 이고 폴백 경고가 담긴다", () => {
    const r = parseDDL(
      `CREATE MEMORY TABLE board (id VARCHAR(36) PRIMARY KEY, title VARCHAR(200))`,
    );
    expect(r.parserUsed).toBe("legacy");
    expect(r.warnings.length).toBeGreaterThan(0);
    // 사용자가 "내 DDL 이 비표준이구나" 를 알 수 있는 문구여야 한다.
    expect(r.warnings.join("\n")).toMatch(/legacy 정규식 파서/);
    expect(r.warnings.join("\n")).toMatch(/표준/);
  });

  it("legacy 폴백 경고에는 AST 실패 사유가 포함된다", () => {
    const r = parseDDL(
      `CREATE MEMORY TABLE board (id VARCHAR(36) PRIMARY KEY)`,
    );
    expect(r.parserUsed).toBe("legacy");
    expect(r.warnings.join("\n")).toMatch(/AST/);
  });
});

describe("parseDDLWithDiagnostics — 경로 추적", () => {
  it("MySQL 표준 DDL 은 ast 경로로 처리된다", async () => {
    const { parseDDLWithDiagnostics } = await import(
      "../../src/utils/scaffold/ddlParser.js"
    );
    const r = parseDDLWithDiagnostics(
      `CREATE TABLE board (board_id VARCHAR(36) PRIMARY KEY, title VARCHAR(200))`,
    );
    expect(r.source).toBe("ast");
    expect(r.astError).toBeUndefined();
  });

  it("CREATE MEMORY TABLE (HSQLDB) 는 legacy 경로로 fallback 된다", async () => {
    const { parseDDLWithDiagnostics } = await import(
      "../../src/utils/scaffold/ddlParser.js"
    );
    const r = parseDDLWithDiagnostics(
      `CREATE MEMORY TABLE board (id VARCHAR(36) PRIMARY KEY)`,
    );
    expect(r.source).toBe("legacy");
    expect(r.astError).toBeDefined();
  });
});

describe("parseDDL — comments", () => {
  it("[AST] 인라인 COMMENT 와 테이블 COMMENT= 를 읽는다", () => {
    const r = parseDDL(`CREATE TABLE NOTICE (
      NTT_ID NUMERIC(20) NOT NULL COMMENT '공지사항ID',
      NTT_SJ VARCHAR(2000) COMMENT "공지사항제목",
      NTT_CN TEXT,
      PRIMARY KEY (NTT_ID)) COMMENT='공지사항'`);
    expect(r.parserUsed).toBe("ast");
    expect(r.attributes.map((a) => a.comment)).toEqual(["공지사항ID", "공지사항제목", null]);
    expect(r.tableComment).toBe("공지사항");
  });

  it("[AST] 빈 COMMENT '' 는 null", () => {
    const r = parseDDL(`CREATE TABLE T (A INT COMMENT '', B INT COMMENT '  ')`);
    expect(r.parserUsed).toBe("ast");
    expect(r.attributes.map((a) => a.comment)).toEqual([null, null]);
    expect(r.tableComment).toBeNull();
  });

  it("[legacy] 인라인 COMMENT 와 '' 복원", () => {
    const r = parseDDL(
      `CREATE TABLE T (ID NUMBER(10) PRIMARY KEY COMMENT 'it''s id', NM VARCHAR2(50) COMMENT "이름")`,
    );
    expect(r.parserUsed).toBe("legacy");
    expect(r.attributes.map((a) => a.comment)).toEqual(["it's id", "이름"]);
  });

  it("[legacy] COMMENT ON COLUMN / TABLE 문을 읽고 컬럼명은 대소문자 무관 매칭", () => {
    const r = parseDDL(`CREATE TABLE NOTICE (NTT_ID NUMBER(20) NOT NULL, ntt_sj VARCHAR2(2000), PRIMARY KEY (NTT_ID));
      COMMENT ON TABLE NOTICE IS '공지사항';
      COMMENT ON COLUMN NOTICE.NTT_SJ IS '공지사항제목';
      COMMENT ON COLUMN notice.ntt_id IS 'ID';`);
    expect(r.parserUsed).toBe("legacy");
    expect(r.attributes).toHaveLength(2);
    expect(r.attributes.find((a) => a.columnName === "ntt_sj")?.comment).toBe("공지사항제목");
    expect(r.attributes.find((a) => a.columnName === "NTT_ID")?.comment).toBe("ID");
    expect(r.tableComment).toBe("공지사항");
  });

  it("[legacy] 테이블 COMMENT 에 괄호가 있어도 컬럼 본문 추출이 깨지지 않는다", () => {
    const r = parseDDL(`CREATE TABLE T (ID NUMBER(10) PRIMARY KEY, NM VARCHAR2(50)) COMMENT='공지(사항)'`);
    expect(r.parserUsed).toBe("legacy");
    expect(r.attributes.map((a) => a.columnName)).toEqual(["ID", "NM"]);
    expect(r.tableComment).toBe("공지(사항)");
  });

  it("[legacy] COMMENT 리터럴 안의 콤마를 컬럼 구분자로 보지 않는다", () => {
    const r = parseDDL(`CREATE TABLE T (ID NUMBER(10) PRIMARY KEY COMMENT 'a, b', NM VARCHAR2(50))`);
    expect(r.parserUsed).toBe("legacy");
    expect(r.attributes).toHaveLength(2);
    expect(r.attributes[0].comment).toBe("a, b");
  });

  it("코멘트가 없으면 두 경로 모두 null", () => {
    const ast = parseDDL(`CREATE TABLE T (A INT PRIMARY KEY)`);
    expect(ast.parserUsed).toBe("ast");
    expect(ast.attributes[0].comment).toBeNull();
    expect(ast.tableComment).toBeNull();
    const legacy = parseDDL(`CREATE TABLE T (A NUMBER(5) PRIMARY KEY)`);
    expect(legacy.parserUsed).toBe("legacy");
    expect(legacy.attributes[0].comment).toBeNull();
    expect(legacy.tableComment).toBeNull();
  });
});

describe("parseDDL — comments (리뷰 보강)", () => {
  it("[legacy] 코멘트 리터럴 안의 키워드(PRIMARY KEY/NOT NULL/DEFAULT)를 제약으로 오인하지 않는다", () => {
    const r = parseDDL(
      `CREATE TABLE T (ID NUMBER(10) PRIMARY KEY, A VARCHAR2(10) COMMENT 'PRIMARY KEY 참조', B VARCHAR2(10) COMMENT 'NOT NULL 여부', C NUMBER(3) COMMENT '상태 (DEFAULT 0: 대기)')`,
    );
    expect(r.parserUsed).toBe("legacy");
    expect(r.pkAttributes.map((a) => a.columnName)).toEqual(["ID"]);
    expect(r.attributes.find((a) => a.columnName === "B")?.isNotNull).toBe(false);
    const c = r.attributes.find((a) => a.columnName === "C")!;
    expect(c.defaultValue).toBeNull();
    expect(c.comment).toBe("상태 (DEFAULT 0: 대기)");
  });

  it("[legacy] 스키마 한정·따옴표 식별자 COMMENT ON 을 읽는다", () => {
    const r = parseDDL(`CREATE TABLE NOTICE (NTT_ID NUMBER(20) PRIMARY KEY, NTT_SJ VARCHAR2(200));
      COMMENT ON TABLE SCOTT.NOTICE IS '공지사항';
      COMMENT ON COLUMN SCOTT.NOTICE.NTT_SJ IS '제목';
      COMMENT ON COLUMN "SCOTT"."NOTICE"."NTT_ID" IS 'ID';`);
    expect(r.parserUsed).toBe("legacy");
    expect(r.tableComment).toBe("공지사항");
    expect(r.attributes.map((a) => a.comment)).toEqual(["ID", "제목"]);
  });

  it("[legacy] -- 줄 주석 안의 아포스트로피가 뒤 컬럼을 삼키지 않는다", () => {
    const r = parseDDL(`CREATE TABLE T (\n A NUMBER(5) -- it's the id\n , B NUMBER(5),\n PRIMARY KEY (A)\n)`);
    expect(r.parserUsed).toBe("legacy");
    expect(r.attributes.map((a) => a.columnName)).toEqual(["A", "B"]);
    expect(r.pkAttributes.map((a) => a.columnName)).toEqual(["A"]);
  });

  it("[AST] COMMENT 리터럴의 '' / \"\" 이스케이프를 복원한다", () => {
    const r = parseDDL(`CREATE TABLE T (A INT COMMENT 'it''s', B INT COMMENT "dq ""x""")`);
    expect(r.parserUsed).toBe("ast");
    expect(r.attributes.map((a) => a.comment)).toEqual(["it's", 'dq "x"']);
  });
});
