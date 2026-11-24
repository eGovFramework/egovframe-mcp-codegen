# DDL COMMENT → 화면 라벨 반영 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DDL 의 컬럼/테이블 COMMENT 를 읽어 생성 프로젝트의 메시지 번들(`title.*`, `nav.*`, `list.*`, `confirm.required.*`) 값으로 쓰고, 콤마·괄호·10자 초과 규칙으로 설명문을 걸러낸다.

**Architecture:** 두 DDL 파서가 `Column.comment` 와 `ParsedDDLCore.tableComment` 를 채운다. `buildContext` 와 `egov_add_entity` 의 FK 해석 뒤에 `applyLabels(ctx)` 가 라벨 규칙을 적용해 `Column.label` / `ctx.entityLabel` 을 채운다. 메시지 번들 Handlebars 템플릿은 `{{msg label}}` 헬퍼로 출력하며, 헬퍼가 스택의 `messageUnicodeEscape` 에 따라 `\uXXXX` 이스케이프한다. 화면 템플릿은 바꾸지 않는다.

**Tech Stack:** TypeScript (strict, ESM), node-sql-parser, Handlebars, vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-ddl-comment-labels-design.md`

## Global Constraints

- 코멘트가 없는 DDL 의 모든 산출물은 바이트 단위로 불변이어야 한다 (골든 매니페스트는 픽스처 DDL 에 코멘트를 넣어 갱신하되, 코멘트 없는 경로의 출력은 비교 테스트로 고정).
- `_en` 번들 템플릿(`message-common_en.properties.hbs`, `message-entity-keys_en.properties.hbs`) 은 수정하지 않는다.
- 화면 템플릿(JSP, Thymeleaf), `egov_add_query_view` 는 수정하지 않는다.
- 라벨 규칙(순서 고정): ① 코멘트에 `,` 가 있으면 폴백 → ② 여는 괄호(`(` 또는 `（`) 가 있으면 그 앞부분만 trim 해서 취하고, 비면 폴백 → ③ 남은 값이 코드 포인트 11자 이상이면 폴백 → ④ 빈 문자열이면 폴백.
- 폴백 값: 컬럼은 `fkParent.entityName` → `pcName` 순(현행), 테이블은 `entityName`(현행).
- WAR 4.3(`stack.messageUnicodeEscape === true`) 번들 값의 비ASCII 문자는 `\uXXXX` 로 기록한다. Boot 는 원문 그대로.
- 커밋 메시지는 Conventional Commits, 한국어 제목, `Co-Authored-By` trailer 없음 (레포 CLAUDE.md).
- 모든 테스트 명령은 레포 루트(`egovframe-mcp-codegen/`) 에서 `npx vitest run <파일>` 로 실행한다. 통합 테스트는 빌드가 필요하지 않다 (소스를 직접 import).

## Review Focus

- properties 특수문자: 코멘트에 `\`, `=`, `:`, 줄바꿈이 들어오면 번들 값이 깨지지 않아야 한다. → Task 1 `escapePropertiesValue` 테스트.
- 빈 코멘트(`COMMENT ''`, 공백만) 은 코멘트 없음과 같아야 한다. → Task 1 규칙 테스트, Task 3 파서 테스트.
- `COMMENT ON COLUMN NOTICE.NTT_SJ` 의 컬럼명과 정규화된 컬럼명의 대소문자가 달라도 매칭되어야 한다. → Task 3.
- 레거시 경로에서 테이블 코멘트에 괄호가 있어도(`COMMENT='공지(사항)'`) 컬럼 본문 추출이 그 괄호까지 삼키지 않아야 한다. → Task 3.
- 정규화기가 식별자를 대문자로 바꿀 때 코멘트 문자열(`'Notice Title'`) 의 대소문자를 바꾸지 않아야 한다. → Task 2.

---

### Task 1: 라벨 규칙과 properties 값 이스케이프 유틸

**Files:**
- Create: `src/utils/scaffold/messageLabel.ts`
- Modify: `src/tools/egovAddQueryView.ts:585-589` (`escapeNonAscii` 를 새 유틸 import 로 교체)
- Test: `tests/scaffold/messageLabel.test.ts`

**Interfaces:**
- Produces:
  - `deriveLabelFromComment(comment: string | null | undefined): string | null` — 규칙 ①~④ 적용 결과. 폴백이면 `null`.
  - `escapeNonAscii(s: string): string` — 기존 `egovAddQueryView.ts` 구현을 그대로 옮긴 것.
  - `escapePropertiesValue(s: string, unicodeEscape: boolean): string` — `\` → `\\`, 줄바꿈 → `\n`, 캐리지리턴 → `\r`, 선행 공백 → `\ `, 그리고 `unicodeEscape` 가 참이면 `escapeNonAscii` 적용. `=` 와 `:` 는 값 위치에서는 이스케이프하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/scaffold/messageLabel.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { deriveLabelFromComment, escapePropertiesValue } from "../../src/utils/scaffold/messageLabel.js";

describe("deriveLabelFromComment", () => {
  it("일반 논리명은 그대로", () => expect(deriveLabelFromComment("공지사항제목")).toBe("공지사항제목"));
  it("양끝 공백 trim", () => expect(deriveLabelFromComment("  제목 ")).toBe("제목"));
  it("콤마가 있으면 폴백(null)", () => expect(deriveLabelFromComment("제목, 부제")).toBeNull());
  it("괄호 앞부분만 취한다", () => expect(deriveLabelFromComment("사용여부(Y/N)")).toBe("사용여부"));
  it("전각 괄호도 괄호로 본다", () => expect(deriveLabelFromComment("사용여부（Y/N）")).toBe("사용여부"));
  it("괄호 앞이 공백뿐이면 폴백", () => expect(deriveLabelFromComment(" (설명)")).toBeNull());
  it("괄호 안에 콤마가 있어도 콤마 규칙이 먼저 적용되어 폴백", () => expect(deriveLabelFromComment("제목(a, b)")).toBeNull());
  it("10글자는 통과", () => expect(deriveLabelFromComment("가나다라마바사아자차")).toBe("가나다라마바사아자차"));
  it("11글자는 폴백", () => expect(deriveLabelFromComment("가나다라마바사아자차카")).toBeNull());
  it("괄호 제거 후 10자 이하면 통과", () => expect(deriveLabelFromComment("공지사항제목(이 컬럼은 공지사항의 제목입니다)")).toBe("공지사항제목"));
  it("빈 문자열/공백/null/undefined 는 폴백", () => {
    for (const v of ["", "   ", null, undefined]) expect(deriveLabelFromComment(v)).toBeNull();
  });
});

describe("escapePropertiesValue", () => {
  it("unicodeEscape=false 면 한글을 그대로 둔다", () => expect(escapePropertiesValue("공지", false)).toBe("공지"));
  it("unicodeEscape=true 면 \\uXXXX 로 바꾼다", () => expect(escapePropertiesValue("공지", true)).toBe("\\uACF5\\uC9C0"));
  it("백슬래시와 줄바꿈을 이스케이프한다", () => expect(escapePropertiesValue("a\\b\nc", false)).toBe("a\\\\b\\nc"));
  it("= 와 : 는 값 위치에서 그대로 둔다", () => expect(escapePropertiesValue("a=b:c", false)).toBe("a=b:c"));
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/scaffold/messageLabel.test.ts`
Expected: FAIL — 모듈을 찾을 수 없음.

- [ ] **Step 3: `src/utils/scaffold/messageLabel.ts` 구현** — Interfaces 블록의 세 함수. 10자 판정은 `Array.from(s).length > 10`. 파일 상단 주석에 규칙 ①~④ 와 그 이유(설명문 차단) 를 적는다.

- [ ] **Step 4: `egovAddQueryView.ts` 의 로컬 `escapeNonAscii` 함수를 삭제하고 새 유틸을 import** — 동작은 동일해야 하므로 기존 query view 테스트가 그대로 통과한다.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/scaffold/messageLabel.test.ts tests/scaffold/addQueryViewStacks.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/utils/scaffold/messageLabel.ts src/tools/egovAddQueryView.ts tests/scaffold/messageLabel.test.ts
git commit -m "feat(codegen): DDL 코멘트 라벨 규칙과 properties 값 이스케이프 유틸 추가"
```

---

### Task 2: 따옴표를 인식하는 SQL 토큰 분리 유틸과 정규화기 수정

**Files:**
- Create: `src/utils/sqlText.ts`
- Modify: `src/utils/ddlNormalizer.ts:247-267` (`splitTopLevelCommas` 를 새 유틸 호출로 교체), `normalizeColumnLine` (코멘트 리터럴 대소문자 보존 확인)
- Test: `tests/utils/sqlText.test.ts`, `tests/utils/ddlNormalizer.test.ts`

**Interfaces:**
- Produces:
  - `splitTopLevel(text: string, separator: "," | ";"): string[]` — 괄호 깊이 0 이고 따옴표(`'`, `"`, `` ` ``) 밖에 있는 구분자에서만 나눈다. `''` 는 따옴표 안의 이스케이프로 본다. 빈 조각은 버린다.
  - `findMatchingParen(text: string, openIndex: number): number` — 따옴표를 무시하며 `openIndex` 의 `(` 와 짝이 되는 `)` 의 인덱스. 없으면 `-1`.
  - `unquoteSqlString(literal: string): string` — `'a''b'` → `a'b`, `"x"` → `x`. 양끝 따옴표가 없으면 그대로 trim.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/utils/sqlText.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { splitTopLevel, findMatchingParen, unquoteSqlString } from "../../src/utils/sqlText.js";

describe("splitTopLevel", () => {
  it("따옴표 안의 콤마에서 나누지 않는다", () =>
    expect(splitTopLevel("A INT COMMENT '내용, 본문', B INT", ",")).toEqual(["A INT COMMENT '내용, 본문'", " B INT"]));
  it("괄호 안의 콤마에서 나누지 않는다", () =>
    expect(splitTopLevel("A DECIMAL(10,2), B INT", ",")).toEqual(["A DECIMAL(10,2)", " B INT"]));
  it("'' 이스케이프를 따옴표 종료로 보지 않는다", () =>
    expect(splitTopLevel("A INT COMMENT 'it''s, ok', B INT", ",")).toHaveLength(2));
  it("세미콜론으로 문장을 나눈다", () =>
    expect(splitTopLevel("CREATE TABLE t (a INT); COMMENT ON COLUMN t.a IS 'x;y';", ";")).toEqual(["CREATE TABLE t (a INT)", " COMMENT ON COLUMN t.a IS 'x;y'"]));
});
describe("findMatchingParen", () => {
  it("따옴표 안의 괄호를 무시한다", () => {
    const s = "(a INT COMMENT ')') COMMENT='공지(사항)'";
    expect(findMatchingParen(s, 0)).toBe(18);
  });
});
describe("unquoteSqlString", () => {
  it("'' 를 ' 로 복원한다", () => expect(unquoteSqlString("'it''s'")).toBe("it's"));
  it("큰따옴표도 벗긴다", () => expect(unquoteSqlString('"공지"')).toBe("공지"));
});
```

`tests/utils/ddlNormalizer.test.ts` 에 추가:

```ts
it("COMMENT 리터럴 안의 콤마에서 줄을 쪼개지 않는다", () => {
  const r = normalizeDdl(`CREATE TABLE T (A INT COMMENT '내용, 본문', B INT)`);
  expect(r.normalizedDdl).toMatch(/COMMENT '내용, 본문'/);
  expect(r.normalizedDdl.split("\n").filter((l) => /^\s*[AB] /.test(l))).toHaveLength(2);
});
it("COMMENT 리터럴의 영문 대소문자를 바꾸지 않는다", () => {
  const r = normalizeDdl(`CREATE TABLE t (a INT COMMENT 'Notice Title')`);
  expect(r.normalizedDdl).toMatch(/COMMENT 'Notice Title'/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/utils/sqlText.test.ts tests/utils/ddlNormalizer.test.ts`
Expected: FAIL — 모듈 없음, 그리고 콤마 분리 테스트 실패.

- [ ] **Step 3: `src/utils/sqlText.ts` 구현** — 단일 패스 스캐너. 상태: 괄호 깊이, 현재 따옴표 문자(없으면 null). 따옴표 안에서 같은 따옴표가 두 번 연속이면 이스케이프로 건너뛴다.

- [ ] **Step 4: `ddlNormalizer.ts` 수정** — `splitTopLevelCommas(body)` 본문을 `splitTopLevel(body, ",")` 호출로 교체(함수 자체는 호출부 호환을 위해 남겨도 됨). 대소문자 테스트가 실패하면 `normalizeColumnLine` 에서 `rest` 부분(타입 뒤)은 변환하지 않도록 고친다.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/utils`
Expected: PASS (기존 정규화 테스트 포함)

- [ ] **Step 6: 커밋**

```bash
git add src/utils/sqlText.ts src/utils/ddlNormalizer.ts tests/utils/sqlText.test.ts tests/utils/ddlNormalizer.test.ts
git commit -m "fix(codegen): DDL 정규화기가 COMMENT 리터럴 안의 콤마에서 줄을 쪼개는 문제 수정"
```

---

### Task 3: 파서 IR 에 컬럼/테이블 코멘트 추가 (AST + legacy)

**Files:**
- Modify: `src/utils/scaffold/ddlParser.ts:26-104` (`Column`), `:235-239` (`ParsedDDLCore`)
- Modify: `src/utils/scaffold/ddlParserAst.ts:49-63` (`AstColumnDefinition.comment` 타입), `:85-90` (`AstCreateTable.table_options`), `:186-229` (컬럼 매핑), `:268` (return)
- Modify: `src/utils/scaffold/ddlParserLegacy.ts` 전체 흐름
- Test: `tests/scaffold/ddlParser.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `splitTopLevel`, `findMatchingParen`, `unquoteSqlString`.
- Produces:
  - `Column.comment: string | null` — 원문 trim 만. 없거나 빈 문자열이면 `null`.
  - `ParsedDDLCore.tableComment: string | null`.
  - `ParsedDDL` 은 spread 로 자동 전파(`parseDDL` 수정 불필요).

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/scaffold/ddlParser.test.ts` 에 `describe("parseDDL — comments")` 추가

```ts
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
    expect(r.attributes.map((a) => a.comment)).toEqual([null, null]);
    expect(r.tableComment).toBeNull();
  });
  it("[legacy] 인라인 COMMENT 와 '' 복원", () => {
    const r = parseDDL(`CREATE TABLE T (ID NUMBER(10) PRIMARY KEY COMMENT 'it''s id', NM VARCHAR2(50) COMMENT "이름")`);
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
    expect(r.attributes.map((a) => a.columnName)).toEqual(["ID", "NM"]);
    expect(r.tableComment).toBe("공지(사항)");
  });
  it("[legacy] COMMENT 리터럴 안의 콤마를 컬럼 구분자로 보지 않는다", () => {
    const r = parseDDL(`CREATE TABLE T (ID NUMBER(10) PRIMARY KEY COMMENT 'a, b', NM VARCHAR2(50))`);
    expect(r.attributes).toHaveLength(2);
    expect(r.attributes[0].comment).toBe("a, b");
  });
  it("코멘트가 없으면 두 경로 모두 null", () => {
    expect(parseDDL(`CREATE TABLE T (A INT PRIMARY KEY)`).attributes[0].comment).toBeNull();
    expect(parseDDL(`CREATE TABLE T (A NUMBER(5) PRIMARY KEY)`).tableComment).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/scaffold/ddlParser.test.ts`
Expected: FAIL — `comment`/`tableComment` undefined.

- [ ] **Step 3: IR 타입 수정** — `Column` 에 `comment: string | null` (JSDoc: 원문 보존, 라벨 규칙은 컨텍스트에서), `ParsedDDLCore` 에 `tableComment: string | null`.

- [ ] **Step 4: AST 파서** — `AstColumnDefinition.comment` 를 `{ value?: { value?: unknown } } | null` 로 좁히고, `col.comment = normalizeComment(def.comment?.value?.value)` (문자열이면 trim, 빈 문자열이면 null). `AstCreateTable` 에 `table_options?: Array<{ keyword?: string; value?: unknown }>` 추가하고 `keyword === "comment"` 항목의 `value` 를 `unquoteSqlString` 으로 벗겨 `tableComment` 로 반환.

- [ ] **Step 5: legacy 파서 재구성** —
  1. 입력을 `splitTopLevel(ddl, ";")` 로 문장 분리. 첫 문장이 CREATE TABLE.
  2. CREATE 문장에서 첫 `(` 와 `findMatchingParen` 으로 본문을 잡고, 그 뒤 꼬리(tail) 에서 `/\bCOMMENT\s*=?\s*('(?:[^']|'')*'|"[^"]*")/i` 로 테이블 코멘트.
  3. 본문은 `splitTopLevel(body, ",")` 로 컬럼 분리 (기존 `split(/,(?![^(]*\))/)` 대체).
  4. 각 컬럼 정의에서 `/\bCOMMENT\s+('(?:[^']|'')*'|"[^"]*")/i` 로 인라인 코멘트.
  5. 나머지 문장 중 `COMMENT ON COLUMN <t>.<c> IS <lit>` / `COMMENT ON TABLE <t> IS <lit>` 를 정규식으로 읽어, 컬럼은 `columnName` 과 대소문자 무관 비교로 채운다(인라인 코멘트가 이미 있으면 유지).
  6. 파일 상단 "알려진 한계" 주석의 콤마 항목을 갱신한다.

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/scaffold/ddlParser.test.ts tests/scaffold/ddlParserDiagnostics.test.ts tests/scaffold/ddlParserFallbackNotice.test.ts tests/scaffold/decimalScale.test.ts`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add src/utils/scaffold/ddlParser.ts src/utils/scaffold/ddlParserAst.ts src/utils/scaffold/ddlParserLegacy.ts tests/scaffold/ddlParser.test.ts
git commit -m "feat(codegen): DDL 파서가 컬럼·테이블 COMMENT 를 IR 에 보존"
```

---

### Task 4: 생성 컨텍스트에 라벨 계산 추가

**Files:**
- Modify: `src/utils/scaffold/ddlParser.ts` (`Column.label?: string` 런타임 필드, `fkParent` 바로 아래)
- Modify: `src/utils/scaffold/scaffoldGenerator.ts:50-160` (`ScaffoldContext` 에 `entityLabel: string`, `hasTableLabel: boolean`), `:252-345` (`buildContext` 끝에서 `applyLabels` 호출)
- Modify: `src/tools/egovAddEntity.ts:652-664` (FK 해석 뒤 `applyLabels(ctx)` 재호출)
- Test: `tests/scaffold/commentLabelsContext.test.ts`

**Interfaces:**
- Consumes: Task 1 `deriveLabelFromComment`, Task 3 `Column.comment`, `ParsedDDLCore.tableComment`.
- Produces:
  - `applyLabels(ctx: ScaffoldContext): void` (scaffoldGenerator.ts 에서 export) — 모든 `ctx.attributes[i].label` 과 `ctx.entityLabel`, `ctx.hasTableLabel` 을 채운다. 멱등.
  - `ScaffoldContext.tableComment: string | null` (parsed 에서 전달), `entityLabel: string`, `hasTableLabel: boolean` (= 테이블 코멘트가 규칙을 통과했는지).

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/scaffold/commentLabelsContext.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildContext, applyLabels } from "../../src/utils/scaffold/scaffoldGenerator.js";

const base = { projectName: "p", packageName: "egovframework.example.notice", outputPath: "/tmp/x",
  entityName: "Notice", description: "", projectType: "boot" as const, stackVersion: "5.0" as const };

describe("applyLabels", () => {
  it("코멘트 → label, 규칙 폴백 → pcName, 테이블 코멘트 → entityLabel", () => {
    const ctx = buildContext({ ...base, ddl: `CREATE TABLE NOTICE (
      NTT_ID NUMERIC(20) NOT NULL COMMENT '공지사항ID',
      NTT_SJ VARCHAR(2000) COMMENT '공지사항제목',
      NTT_CN TEXT COMMENT '공지사항의 본문 내용을 저장하는 컬럼',
      USE_YN CHAR(1) COMMENT '사용여부(Y/N)',
      RGST_DT TIMESTAMP COMMENT '등록, 수정일',
      PRIMARY KEY (NTT_ID)) COMMENT='공지사항'` });
    expect(ctx.attributes.map((a) => a.label)).toEqual(["공지사항ID", "공지사항제목", "NttCn", "사용여부", "RgstDt"]);
    expect(ctx.entityLabel).toBe("공지사항");
    expect(ctx.hasTableLabel).toBe(true);
  });
  it("코멘트가 없으면 entityLabel=entityName, hasTableLabel=false, label=pcName", () => {
    const ctx = buildContext({ ...base, ddl: `CREATE TABLE NOTICE (NTT_ID VARCHAR(20) PRIMARY KEY, NTT_SJ VARCHAR(100))` });
    expect(ctx.entityLabel).toBe("Notice");
    expect(ctx.hasTableLabel).toBe(false);
    expect(ctx.attributes[1].label).toBe("NttSj");
  });
  it("fkParent 가 있고 코멘트가 없으면 부모 엔티티명, 코멘트가 있으면 코멘트가 우선", () => {
    const ctx = buildContext({ ...base, ddl: `CREATE TABLE NOTICE (NTT_ID VARCHAR(20) PRIMARY KEY,
      DEPT_ID VARCHAR(20) REFERENCES DEPARTMENT(DEPT_ID), WRTR_ID VARCHAR(20) COMMENT '작성자' REFERENCES MEMBER(ID))` });
    const parent = { entityName: "Department", entityNameLower: "department", packageName: "p", pkField: "deptId", pkColumn: "DEPT_ID", displayFields: [], displayColumns: [] };
    ctx.attributes[1].fkParent = parent;
    ctx.attributes[2].fkParent = { ...parent, entityName: "Member" };
    applyLabels(ctx);
    expect(ctx.attributes[1].label).toBe("Department");
    expect(ctx.attributes[2].label).toBe("작성자");
  });
});
```

(MySQL 문법상 `COMMENT` 는 `REFERENCES` 앞에 온다. node-sql-parser 가 이 순서를 거부하면 `parserUsed` 를 확인하고, legacy 경로로도 같은 기대값이 나와야 한다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/scaffold/commentLabelsContext.test.ts`
Expected: FAIL — `applyLabels` 가 export 되지 않음.

- [ ] **Step 3: 구현** — `Column.label?: string` 추가(JSDoc: 런타임 채움, 템플릿 전용). `ScaffoldContext` 에 세 필드 추가. `buildContext` 반환 객체에 `tableComment: parsed.tableComment`, `entityLabel: entityName`, `hasTableLabel: false` 를 넣은 뒤 `applyLabels(result)` 를 호출하고 반환. `applyLabels` 는 각 컬럼에 `deriveLabelFromComment(c.comment) ?? c.fkParent?.entityName ?? c.pcName`, 테이블은 `deriveLabelFromComment(ctx.tableComment)` 가 있으면 그 값과 `hasTableLabel=true`, 없으면 `entityName` 과 `false`.

- [ ] **Step 4: `egovAddEntity.ts`** — `ctx.hasFk = ...` 줄(약 664행) 바로 뒤에 `applyLabels(ctx);` 추가하고 import.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/scaffold/commentLabelsContext.test.ts tests/scaffold/golden.test.ts`
Expected: PASS (골든은 템플릿을 아직 안 바꿨으므로 그대로 통과해야 한다 — 컨텍스트 필드 추가가 출력에 영향이 없음을 확인)

- [ ] **Step 6: 커밋**

```bash
git add src/utils/scaffold/ddlParser.ts src/utils/scaffold/scaffoldGenerator.ts src/tools/egovAddEntity.ts tests/scaffold/commentLabelsContext.test.ts
git commit -m "feat(codegen): 생성 컨텍스트에 코멘트 기반 컬럼·엔티티 라벨 계산 추가"
```

---

### Task 5: `msg` 헬퍼와 메시지 번들 템플릿 반영 + 통합 테스트

**Files:**
- Modify: `src/utils/scaffold/scaffoldGenerator.ts:205-250` (`registerScaffoldHelpers` 에 `msg` 추가)
- Modify (기본/ko 템플릿 6개):
  - `templates/boot/message/message-common.properties.hbs`
  - `templates/boot50/message/message-common.properties.hbs`
  - `templates/war/message/message-common.properties.hbs`
  - `templates/boot/message/message-entity-keys.properties.hbs`
  - `templates/boot50/message/message-entity-keys.properties.hbs`
  - `templates/war/message/message-entity-keys.properties.hbs`
- Test: `tests/scaffold/commentLabelsBundle.test.ts`

**Interfaces:**
- Consumes: Task 1 `escapePropertiesValue`, Task 4 `label` / `entityLabel` / `hasTableLabel`.
- Produces: Handlebars 헬퍼 `{{msg value}}` — `options.data.root.stack.messageUnicodeEscape` 가 참이면 유니코드 이스케이프를 포함해 `escapePropertiesValue` 를 적용하고 `SafeString` 으로 반환(HTML 이스케이프 방지).

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/scaffold/commentLabelsBundle.test.ts`. 프로젝트를 임시 디렉터리에 실제 스캐폴드한다(`tests/scaffold/addQueryViewStacks.test.ts` 의 스택별 스캐폴드 방식을 따른다).

```ts
const NOTICE_DDL = `CREATE TABLE NOTICE (
  NTT_ID VARCHAR(20) NOT NULL COMMENT '공지사항ID',
  NTT_SJ VARCHAR(200) NOT NULL COMMENT '공지사항제목',
  NTT_CN TEXT COMMENT '공지사항의 본문 내용을 저장하는 컬럼',
  USE_YN CHAR(1) COMMENT '사용여부(Y/N)',
  TAGS VARCHAR(100) COMMENT '태그1, 태그2',
  PRIMARY KEY (NTT_ID)) COMMENT='공지사항'`;
const PLAIN_DDL = `CREATE TABLE MEMBER (ID VARCHAR(16) NOT NULL PRIMARY KEY, EMAIL VARCHAR(100))`;

describe("코멘트 라벨 — boot50 scaffold", () => {
  // message-common.properties 와 _ko:
  //   title.notice.nttSj=공지사항제목 / title.notice.nttCn=NttCn / title.notice.useYn=사용여부 / title.notice.tags=Tags
  //   title.notice.sample=공지사항 목록 / nav.notice=공지사항 / list.notice=공지사항 목록
  //   (common 템플릿의 기존 문구는 \u 이스케이프 상태 그대로이고 라벨만 원문 한글이다 — Boot 는 UTF-8 로 읽으므로 혼용 가능)
  //   confirm.required.notice.nttSj=공지사항제목은(는) ...
  // message-common_en.properties: title.notice.nttSj=NttSj, nav.notice=Notice (불변)
});
describe("코멘트 라벨 — war43 scaffold", () => {
  // message-common.properties: title.notice.nttSj=공지사항제목, nav.notice=공지사항,
  //   title.notice=공지사항, list.notice=공지사항 목록
  //   title.notice.nttCn=NttCn
  // 한글이 그대로 들어간 줄이 없어야 한다: expect(content).not.toMatch(/[가-힣]/)
});
describe("코멘트 라벨 — egov_add_entity (boot50 프로젝트에 NOTICE 추가)", () => {
  // 3개 번들 끝에 append 된 블록에서 def/ko 는 title.notice.nttSj=공지사항제목, nav.notice=공지사항,
  //   title.notice.sample=공지사항 목록, list.notice=공지사항 목록 (entity-keys 템플릿은 원문 한글 '목록' 을 쓴다)
  // en 은 title.notice.nttSj=NttSj
  // 결과 메시지에 "코멘트" 안내 줄 포함 (Task 6 에서 추가하므로 여기서는 미검증)
});
describe("코멘트 없는 DDL 은 현행과 동일", () => {
  // boot50 scaffold(PLAIN_DDL): list.member=List Member, title.member.sample=Member 목록, nav.member=Member, title.member.email=Email
  // war43 scaffold(PLAIN_DDL): list.member=Member List, title.member=Member, title.member.email=Email
});
```

각 블록을 실제 `it` 과 `expect(content).toMatch(/^title\.notice\.nttSj=공지사항제목$/m)` 형태의 단언으로 채운다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/scaffold/commentLabelsBundle.test.ts`
Expected: FAIL — 값이 `NttSj`, `Notice` 로 나옴.

- [ ] **Step 3: `msg` 헬퍼 등록** — `registerScaffoldHelpers` 에 추가. 시그니처 `function (value: unknown, options: Handlebars.HelperOptions)`.

- [ ] **Step 4: 템플릿 수정** — 여섯 파일에서 다음만 바꾼다.
  - `title.{{../entityNameLower}}.{{ccName}}=...` 의 값 → `{{msg label}}`
  - `confirm.required...={{pcName}}...` 의 `{{pcName}}` → `{{msg label}}` (뒤 문구는 그대로)
  - `nav.{{entityNameLower}}={{entityName}}` → `{{msg entityLabel}}`
  - Boot 두 스택: `title.{{entityNameLower}}.sample={{entityName}} 목록`(common) / `={{entityName}} 목록`(entity-keys) → `{{msg entityLabel}}` + 기존 접미사 유지. `list.{{entityNameLower}}=List {{entityName}}` → `{{#if hasTableLabel}}{{msg entityLabel}} 목록{{else}}List {{entityName}}{{/if}}` (common 은 ` 목록` 표기를 따라 `{{msg entityLabel}} 목록`).
  - WAR: `title.{{entityNameLower}}={{entityName}}` → `{{msg entityLabel}}`; `list.{{entityNameLower}}={{entityName}} List` → `{{#if hasTableLabel}}{{msg entityLabel}} 목록{{else}}{{entityName}} List{{/if}}`.
  - `_en` 템플릿은 건드리지 않는다.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/scaffold/commentLabelsBundle.test.ts tests/scaffold/addEntityAutoApply.test.ts tests/scaffold/boot43Attachment.test.ts tests/scaffold/scaffoldWithAttachment.test.ts tests/scaffold/securityConfig.test.ts`
Expected: PASS. (`golden.test.ts` 는 이 시점에도 통과해야 한다 — 픽스처에 코멘트가 없기 때문.)

- [ ] **Step 6: 커밋**

```bash
git add src/utils/scaffold/scaffoldGenerator.ts templates/boot/message templates/boot50/message templates/war/message tests/scaffold/commentLabelsBundle.test.ts
git commit -m "feat(codegen): 메시지 번들 라벨에 DDL 컬럼·테이블 COMMENT 반영"
```

---

### Task 6: 결과 메시지 안내, 입력 설명문, 문서, 골든 갱신

**Files:**
- Modify: `src/tools/egovAddEntity.ts:83-88` (`ddl` describe), `:870-885` 부근 결과 메시지 구성
- Modify: `src/tools/egovScaffoldProject.ts:60-65` (`ddl` describe)
- Modify: `README.md:41`, `:61` (`ddl` 파라미터 행), `templates/skills/original/egovframe-conventions.md` (DDL 작성 안내 절 — 없으면 "DDL 작성" 소절 신설)
- Modify: `tests/scaffold/golden.test.ts:43-50` (`SHARED_DDL`), `tests/scaffold/__golden__/*.json`
- Test: `tests/scaffold/commentLabelsBundle.test.ts` (결과 메시지 단언 추가), `tests/toolRegistration.test.ts` (describe 문구 포함 확인)

- [ ] **Step 1: 실패하는 테스트 추가**
  - `commentLabelsBundle.test.ts` 의 add_entity 블록에 `expect(out).toMatch(/코멘트 라벨 반영: 3개 컬럼/)` 와 `expect(out).toMatch(/규칙으로 제외된 컬럼: NTT_CN, TAGS/)` 를 추가. (NOTICE_DDL 기준 반영 3개: NTT_ID, NTT_SJ, USE_YN.)
  - `toolRegistration.test.ts` 에 두 도구의 `ddl` 설명문이 `COMMENT` 를 언급하는지 단언 추가(기존 tools/list 검사 패턴을 따른다).

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/scaffold/commentLabelsBundle.test.ts tests/toolRegistration.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**
  - `ddl` describe 양쪽에 문장 추가: "컬럼/테이블 COMMENT 가 화면 라벨(메시지 번들)로 사용됩니다. 콤마가 있거나, 괄호 앞이 비어 있거나, 괄호 앞부분이 10자를 넘으면 설명문으로 보고 컬럼명을 사용합니다."
  - `egovAddEntity` 결과 메시지: FK 안내 블록 뒤에 `🏷️ 코멘트 라벨 반영: N개 컬럼` 과, 코멘트는 있으나 폴백된 컬럼이 있으면 `   규칙으로 제외된 컬럼: A, B (콤마·괄호·10자 초과 규칙)` 줄을 추가. 테이블 코멘트가 반영되면 `   엔티티 표시명: 공지사항` 한 줄.
  - README 두 행과 skills 문서에 같은 취지의 한 줄.

- [ ] **Step 4: 골든 픽스처 갱신** — `SHARED_DDL` 의 `title` 에 `COMMENT '제목'`, `content` 에 `COMMENT '본문 내용을 저장하는 긴 설명 컬럼'`(폴백 확인용), 테이블에 `COMMENT='게시판'` 을 추가하고 실행:

```bash
npm run test:update
```

그 다음 `git diff --stat tests/scaffold/__golden__` 로 세 매니페스트에서 바뀐 항목이 `message-common.properties`, `message-common_ko.properties` 두 파일(각 시나리오) 뿐인지 확인한다. 다른 파일의 해시가 바뀌었다면 원인을 찾아 고친 뒤 다시 갱신한다.

- [ ] **Step 5: 전체 테스트**

Run: `npm test`
Expected: 빌드 성공, 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/tools/egovAddEntity.ts src/tools/egovScaffoldProject.ts README.md templates/skills/original/egovframe-conventions.md tests/scaffold/golden.test.ts tests/scaffold/__golden__ tests/scaffold/commentLabelsBundle.test.ts tests/toolRegistration.test.ts
git commit -m "docs(codegen): DDL COMMENT 라벨 반영 안내와 결과 메시지, 골든 픽스처 갱신"
```

---

### Task 7: WAR 4.3 산출물 실기동 확인 (수동 검증, 커밋 없음)

**Files:** 없음 (검증만). 절차는 레포 `CLAUDE.md` "WAR 산출물의 화면 확인" 을 따른다.

- [ ] **Step 1: WAR 프로젝트 생성** — `build/index.js` 를 빌드한 뒤 Inspector 또는 소스 import 스크립트로 `egov_scaffold_project` 를 `projectType=war`, `stackVersion=4.3`, Task 5 의 `NOTICE_DDL` 로 스크래치 디렉터리에 생성한다.

- [ ] **Step 2: 빌드와 기동** — JDK 8 로 `mvn -o -DskipTests package`, 임시 `CATALINA_BASE` 를 만들어 포트를 바꾸고 `references/apache-tomcat-8.5.90/bin/catalina.sh start`.

- [ ] **Step 3: 화면 확인**

Run: `curl -s http://localhost:<port>/<context>/notice/noticeList.do | grep -o '공지사항[^<]*' | head`
Expected: 목록 헤더에 `공지사항제목`, 메뉴에 `공지사항`, `NttCn` 과 `Tags` 는 컬럼명 그대로. 깨진 문자(`?` 나 `Ã`)가 없어야 한다.

- [ ] **Step 4: 정지와 정리** — `catalina.sh stop`, 임시 디렉터리 삭제. 결과(확인한 URL 과 보인 라벨)를 최종 보고에 적는다.
