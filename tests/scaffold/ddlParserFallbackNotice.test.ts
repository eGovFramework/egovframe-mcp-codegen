/**
 * DDL 파서 폴백 안내 문구 테스트
 *
 * `parseDDL` 이 AST(MySQL dialect) 파싱에 실패해 legacy 정규식 파서로 폴백하면,
 * 사용자는 자신의 DDL 이 비표준이라는 사실을 알아야 한다.
 * `egov_scaffold_project` / `egov_add_entity` 의 결과 메시지에 폴백 안내 블록이
 * 노출되는지 (그리고 정상 AST 경로에서는 노출되지 않는지) 를 고정한다.
 *
 * 폴백 트리거: HSQLDB 의 `CREATE MEMORY TABLE` — ddlNormalizer 가 헤더를 보존하므로
 * normalizeDdl 기본값(true) 경로에서도 AST 파싱이 반드시 실패한다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovScaffoldProject } from "../../src/tools/egovScaffoldProject.js";
import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const STANDARD_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;

const HSQLDB_MEMORY_DDL = `CREATE MEMORY TABLE MEMBER (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  EMAIL VARCHAR(100)
)`;

const STANDARD_MEMBER_DDL = `CREATE TABLE MEMBER (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  EMAIL VARCHAR(100)
)`;

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-ddl-fallback-"));
});

afterEach(async () => {
  await fs.remove(tmpRoot);
});

describe("egov_scaffold_project — DDL 파서 폴백 안내", () => {
  it("CREATE MEMORY TABLE (비표준) 이면 결과 메시지에 폴백 안내가 노출된다", async () => {
    const out = await egovScaffoldProject({
      projectName: "member-app",
      packageName: "egovframework.example.member",
      outputPath: tmpRoot,
      entityName: "Member",
      ddl: HSQLDB_MEMORY_DDL,
    });

    expect(out).toMatch(/DDL 파서 폴백/);
    expect(out).toMatch(/legacy 정규식 파서/);
  });

  it("표준 DDL 이면 폴백 안내가 노출되지 않는다", async () => {
    const out = await egovScaffoldProject({
      projectName: "board-app",
      packageName: "egovframework.example.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: STANDARD_DDL,
    });

    expect(out).toMatch(/프로젝트 생성 완료/);
    expect(out).not.toMatch(/DDL 파서 폴백/);
  });
});

describe("egov_add_entity — DDL 파서 폴백 안내", () => {
  let projectDir: string;

  beforeEach(async () => {
    await generateScaffoldProject({
      projectName: "board-app",
      packageName: "egovframework.example.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: STANDARD_DDL,
      description: "",
      projectType: "boot",
      stackVersion: "5.1",
    });
    projectDir = path.join(tmpRoot, "board-app");
  });

  it("CREATE MEMORY TABLE (비표준) 이면 결과 메시지에 폴백 안내가 노출된다", async () => {
    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: HSQLDB_MEMORY_DDL,
    });

    expect(out).toMatch(/DDL 파서 폴백/);
    expect(out).toMatch(/legacy 정규식 파서/);
  });

  it("표준 DDL 이면 폴백 안내가 노출되지 않는다", async () => {
    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: STANDARD_MEMBER_DDL,
    });

    expect(out).toMatch(/추가 완료/);
    expect(out).not.toMatch(/DDL 파서 폴백/);
  });
});
