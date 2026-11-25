/**
 * egov_add_entity — withAttachment=true 일 때 add-entity-tables.sql 흐름에 ATCH_FILE_ID 가 들어가는지 검증.
 *
 * 다른 산출물 (VO / Mapper XML / sampledb.sql / sampledb-migrations 7 dialect) 은 템플릿에
 * `{{#if withAttachment}}` 분기가 있어 컬럼이 보장되지만, 마이그레이션용
 * `add-entity-tables.sql.hbs` 는 분기가 빠져 있어 다음 두 흐름이 누락 위험이 있다:
 *
 *   1) autoApplyMigration=true + 시드 1개 → 시드에 append (입력 템플릿이 add-entity-tables.sql.hbs)
 *   2) autoApplyMigration=false → add-<entity>-tables.sql 별도 파일 (같은 템플릿)
 *
 * 본 테스트는 두 흐름 모두에서 ATCH_FILE_ID 가 결과 SQL 에 포함되는지 검증한다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { egovAddAttachFileInfrastructure } from "../../src/tools/egovAddAttachFileInfrastructure.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const BOARD_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;

const MEMBER_DDL = `CREATE TABLE MEMBER (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  EMAIL VARCHAR(100)
)`;

let tmpRoot: string;
let projectDir: string;

async function scaffoldAndInstallAttachFile() {
  await generateScaffoldProject({
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: BOARD_DDL,
    description: "",
    projectType: "boot",
    stackVersion: "5.1",
  });
  const pdir = path.join(tmpRoot, "board-app");
  await egovAddAttachFileInfrastructure({ projectPath: pdir, autoMergeHsqlSeed: false });
  return pdir;
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-attach-mig-"));
  projectDir = await scaffoldAndInstallAttachFile();
});

afterEach(async () => {
  await fs.remove(tmpRoot);
});

describe("egov_add_entity — withAttachment 등록 화면과 CSRF 공존", () => {
  it("multipart 폼에 CSRF hidden 필드와 fetch 헤더용 meta 배선이 함께 렌더링된다", async () => {
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMigration: false,
      withAttachment: true,
    });

    const register = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/templates/thymeleaf/member/egovMemberRegister.html",
      ),
      "utf-8",
    );
    // CSRF 토큰은 multipart 본문 파트로 전송된다 — 내장 Tomcat 이 CsrfFilter 시점에
    // 파트를 파싱해 주는 동작에 의존 (docs/design/security-config-templates.md 참조)
    expect(register).toContain('enctype="multipart/form-data"');
    expect(register).toContain('id="csrfField"');
    expect(register).toContain('meta[name="_csrf_header"]');
  });
});

describe("egov_add_entity — withAttachment 마이그레이션 SQL 분기", () => {
  it("[시드 append] autoApplyMigration=true + 시드 1개 → 시드에 append 된 Member 블록 안에 ATCH_FILE_ID 가 있어야 한다", async () => {
    const seedAbs = path.join(projectDir, "src/main/resources/db/boarddb.sql");

    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMigration: true,
      withAttachment: true,
    });

    const seedAfter = await fs.readFile(seedAbs, "utf-8");
    // 시드 마지막 Member 블록 추출 — CREATE MEMORY TABLE MEMBER( ... );
    const memberBlock = seedAfter.match(/CREATE\s+MEMORY\s+TABLE\s+MEMBER\s*\(([\s\S]*?)\);/i);
    expect(memberBlock, "시드에 Member 테이블 블록이 존재해야 한다").not.toBeNull();
    expect(memberBlock![1]).toMatch(/ATCH_FILE_ID\s+CHAR\(20\)/i);
  });

  it("[별도 파일] autoApplyMigration=false → add-member-tables.sql 안에 ATCH_FILE_ID CHAR(20) 가 있어야 한다", async () => {
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMigration: false,
      withAttachment: true,
    });

    const migAbs = path.join(projectDir, "src/main/resources/db/add-member-tables.sql");
    expect(await fs.pathExists(migAbs)).toBe(true);
    const content = await fs.readFile(migAbs, "utf-8");
    expect(content).toMatch(/CREATE\s+MEMORY\s+TABLE\s+MEMBER/i);
    expect(content).toMatch(/ATCH_FILE_ID\s+CHAR\(20\)/i);
  });
});
