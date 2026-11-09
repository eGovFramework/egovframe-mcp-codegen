/**
 * 첨부파일 매퍼 SQL 회귀 테스트.
 *
 * 레코드 삭제는 COMTNFILE.USE_AT 을 'N' 으로 바꾸는 논리 삭제이고, 다운로드 컨트롤러는
 * selectFileInf 결과가 없을 때만 404 를 반환한다. selectFileInf 가 USE_AT 을 확인하지 않으면
 * 삭제된 레코드의 첨부파일이 기존 URL 로 계속 다운로드된다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddAttachFileInfrastructure } from "../../src/tools/egovAddAttachFileInfrastructure.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const BOARD_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;

const MAPPER_RELATIVE_PATH = "src/main/resources/egovframework/sqlmap/cmm/mappers/EgovFileMng_SQL.xml";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-attach-mapper-"));
});

afterEach(async () => {
  await fs.remove(tmpRoot);
});

async function renderSelectFileInf(): Promise<string> {
  await generateScaffoldProject({
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: BOARD_DDL,
    description: "",
    projectType: "boot",
    stackVersion: "5.0",
  });
  const projectDir = path.join(tmpRoot, "board-app");
  await egovAddAttachFileInfrastructure({ projectPath: projectDir });

  const mapper = await fs.readFile(path.join(projectDir, MAPPER_RELATIVE_PATH), "utf-8");
  const block = /<select id="selectFileInf"[\s\S]*?<\/select>/.exec(mapper);
  expect(block).not.toBeNull();
  return block![0];
}

describe("EgovFileMng_SQL.xml — selectFileInf", () => {
  it("논리 삭제된 첨부파일 그룹은 조회하지 않는다", async () => {
    const sql = await renderSelectFileInf();

    expect(sql).toMatch(/FROM\s+COMTNFILE\s+a\s*,\s*COMTNFILEDETAIL\s+b/);
    expect(sql).toMatch(/a\.ATCH_FILE_ID\s*=\s*b\.ATCH_FILE_ID/);
    expect(sql).toMatch(/a\.USE_AT\s*=\s*'Y'/);
  });

  it("그룹 키와 파일 순번으로 한 건만 조회한다", async () => {
    const sql = await renderSelectFileInf();

    expect(sql).toMatch(/a\.ATCH_FILE_ID\s*=\s*#\{atchFileId\}/);
    expect(sql).toMatch(/b\.FILE_SN\s*=\s*#\{fileSn\}/);
  });
});
