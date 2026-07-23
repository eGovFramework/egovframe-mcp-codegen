/**
 * DDL 파서 실패 진단 강화 테스트
 *
 * AST(MySQL) / Legacy 두 경로가 모두 실패했을 때, 사용자가 재시도 루프에 빠지지 않도록
 * (1) 구문 에러의 행/열 위치와 문제 라인 원문, (2) 재호출이 무의미하다는 안내 문장,
 * (3) 타 DBMS 방언으로 보이는 토큰이 있으면 변환 힌트를 결과 메시지에 포함하는지 검증한다.
 */
import { describe, expect, it } from "vitest";

import { parseDDL } from "../../src/utils/scaffold/ddlParser.js";
import { NON_RETRYABLE_PREFIX } from "../../src/utils/scaffold/toolMessages.js";

// 테이블명이 없고 컬럼 정의도 온전히 깨져 있어 AST/Legacy 두 경로 모두 실패하는 DDL.
const DOUBLY_BROKEN_DDL = `CREATE TABLE (
  ,,, GARBAGE ??? ***
)`;

// NVARCHAR2(Oracle 방언) 를 포함하면서도 두 파서 모두 실패하도록 고의로 깨뜨린 DDL.
const NVARCHAR2_BROKEN_DDL = `CREATE TABLE FOO (
  ID NVARCHAR2(20) NOT NULL PRIMARY KEY,
  ,,, ***
)`;

describe("parseDDL — 파싱 완전 실패 진단", () => {
  it("[재시도 불가] 프리픽스가 붙고, 재호출이 무의미하다는 안내를 포함한다", () => {
    expect(() => parseDDL(DOUBLY_BROKEN_DDL)).toThrow(
      new RegExp(
        `${NON_RETRYABLE_PREFIX.replace(/[[\]]/g, "\\$&")}.*같은 인자로 재호출하면 동일하게 실패합니다\\.`,
        "s",
      ),
    );
  });

  it("AST 구문 에러의 행/열 위치를 포함한다", () => {
    expect(() => parseDDL(DOUBLY_BROKEN_DDL)).toThrow(/\d+행 \d+열/);
  });

  it("문제가 된 라인의 원문을 함께 보여준다", () => {
    // AST 파서는 첫 줄(테이블명이 빠진 'CREATE TABLE (') 에서 실패한다.
    expect(() => parseDDL(DOUBLY_BROKEN_DDL)).toThrow(/CREATE TABLE \(/);
  });

  it("AST 경로와 Legacy 경로 실패 사유를 모두 노출한다", () => {
    expect(() => parseDDL(DOUBLY_BROKEN_DDL)).toThrow(/AST\(MySQL\) 경로:/);
    expect(() => parseDDL(DOUBLY_BROKEN_DDL)).toThrow(/Legacy 경로:/);
  });

  it("NVARCHAR2 를 포함한 DDL 이 파싱에 실패하면 Oracle 등 타 DBMS 방언 힌트를 포함한다", () => {
    expect(() => parseDDL(NVARCHAR2_BROKEN_DDL)).toThrow(/Oracle 등 타 DBMS 방언으로 보입니다/);
    expect(() => parseDDL(NVARCHAR2_BROKEN_DDL)).toThrow(/NVARCHAR2 → VARCHAR/);
  });

  it("방언 힌트에도 재호출 무의미 안내가 함께 붙는다", () => {
    expect(() => parseDDL(NVARCHAR2_BROKEN_DDL)).toThrow(/같은 인자로 재호출하면 동일하게 실패합니다\./);
  });

  it("정상 DDL 은 방언 힌트나 위치 정보 없이 성공한다 (오탐 없음)", () => {
    const r = parseDDL(
      `CREATE TABLE board (board_id VARCHAR(36) PRIMARY KEY, title VARCHAR(200))`,
    );
    expect(r.tableName).toBe("Board");
    expect(r.parserUsed).toBe("ast");
  });
});
