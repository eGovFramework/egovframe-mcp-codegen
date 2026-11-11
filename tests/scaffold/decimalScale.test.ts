/**
 * DECIMAL/NUMERIC/NUMBER 의 소수 자릿수(scale) 보존.
 *
 * scale 이 빠지면 `DECIMAL(12,2)` 컬럼이 `DECIMAL(12)` 로 만들어져 소수점 이하 값이 저장되지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { parseDDL } from "../../src/utils/scaffold/ddlParser.js";
import { dialectFullType } from "../../src/utils/scaffold/dialectTypes.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

describe("dialectFullType 의 scale", () => {
  it.each([
    ["hsql", "DECIMAL(12,2)"],
    ["mysql", "DECIMAL(12,2)"],
    ["postgres", "DECIMAL(12,2)"],
    ["cubrid", "NUMERIC(12,2)"],
    ["oracle", "NUMBER(12,2)"],
    ["tibero", "NUMBER(12,2)"],
  ] as const)("%s 는 precision 과 scale 을 함께 출력한다", (dialect, expected) => {
    expect(dialectFullType("DECIMAL", 12, dialect, 2)).toBe(expected);
  });

  it("scale 이 없으면 기존처럼 precision 만 출력한다", () => {
    expect(dialectFullType("DECIMAL", 12, "hsql")).toBe("DECIMAL(12)");
    expect(dialectFullType("DECIMAL", 12, "hsql", 0)).toBe("DECIMAL(12)");
  });

  it("문자열 타입에는 scale 을 붙이지 않는다", () => {
    expect(dialectFullType("VARCHAR", 20, "oracle", 2)).toBe("VARCHAR2(20)");
  });
});

describe("DDL 파서의 scale", () => {
  it("AST 파서가 DECIMAL(10,2) 의 scale 을 추출한다", () => {
    const r = parseDDL("CREATE TABLE t (id INT PRIMARY KEY, price DECIMAL(10,2) NOT NULL)");
    const price = r.attributes.find((a) => a.columnName === "price")!;
    expect(price.maxLength).toBe(10);
    expect(price.scale).toBe(2);
  });

  it("레거시 파서도 NUMBER(10,2) 의 scale 을 추출한다", () => {
    const r = parseDDL("CREATE TABLE t (ID VARCHAR2(20) NOT NULL PRIMARY KEY, PRICE NUMBER(10,2))");
    expect(r.parserUsed).toBe("legacy");
    const price = r.attributes.find((a) => a.columnName === "PRICE")!;
    expect(price.maxLength).toBe(10);
    expect(price.scale).toBe(2);
  });
});

describe("생성된 DDL 의 scale", () => {
  let tmpRoot: string;
  let projectDir: string;
  const read = (rel: string) => fs.readFile(path.join(projectDir, rel), "utf-8");
  const DDL = "CREATE TABLE EMPLOYEE (ID VARCHAR(20) NOT NULL PRIMARY KEY, SALARY DECIMAL(12,2))";

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-decimal-scale-"));
    projectDir = path.join(tmpRoot, "hr-app");
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(tmpRoot);
  });

  it.each([
    ["boot", "5.0"],
    ["boot", "4.3"],
    ["war", "4.3"],
  ] as const)("%s %s 스캐폴드의 시드와 마이그레이션에 scale 이 남는다", async (projectType, stackVersion) => {
    await generateScaffoldProject({
      projectName: "hr-app",
      packageName: "egovframework.example.employee",
      outputPath: tmpRoot,
      entityName: "Employee",
      ddl: DDL,
      description: "",
      projectType,
      stackVersion,
    });
    expect(await read("src/main/resources/db/employeedb.sql")).toMatch(/SALARY\s+DECIMAL\(12,2\)/);
    expect(await read("src/main/resources/db/migrations/oracle/employeedb.sql")).toMatch(/SALARY\s+NUMBER\(12,2\)/);
    expect(await read("src/main/resources/db/migrations/postgres/employeedb.sql")).toMatch(/SALARY\s+DECIMAL\(12,2\)/);
    expect(await read("src/main/resources/db/migrations/cubrid/employeedb.sql")).toMatch(/SALARY\s+NUMERIC\(12,2\)/);
  });

  it("egov_add_entity 의 테이블 추가 SQL 에도 scale 이 남는다", async () => {
    await generateScaffoldProject({
      projectName: "hr-app",
      packageName: "egovframework.example.department",
      outputPath: tmpRoot,
      entityName: "Department",
      ddl: "CREATE TABLE DEPARTMENT (ID VARCHAR(20) NOT NULL PRIMARY KEY, NAME VARCHAR(100))",
      description: "",
      projectType: "boot",
      stackVersion: "5.0",
    });
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.employee",
      entityName: "Employee",
      ddl: DDL,
    });
    expect(await read("src/main/resources/db/departmentdb.sql")).toMatch(/SALARY\s+DECIMAL\(12,2\)/);
  });
});
