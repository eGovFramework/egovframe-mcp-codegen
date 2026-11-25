/**
 * egov_scaffold_project — withAttachment=true 시 첫 엔티티 연결 + 첨부파일 인프라 설치.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovScaffoldProject } from "../../src/tools/egovScaffoldProject.js";
import { detectAttachFileInfra } from "../../src/utils/scaffold/projectDetector.js";

const BOARD_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(20) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;

const DDL_WITH_ATCH_FILE_ID = `CREATE TABLE BOARD (
  ID VARCHAR(20) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200),
  ATCH_FILE_ID CHAR(20)
)`;

const COMPOSITE_PK_DDL = `CREATE TABLE BOARD (
  BOARD_ID VARCHAR(20) NOT NULL,
  SEQ_NO INT NOT NULL,
  TITLE VARCHAR(200),
  PRIMARY KEY (BOARD_ID, SEQ_NO)
)`;

const FK_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(20) NOT NULL PRIMARY KEY,
  DEPT_ID VARCHAR(20) NOT NULL,
  TITLE VARCHAR(200),
  CONSTRAINT FK_BOARD_DEPT FOREIGN KEY (DEPT_ID) REFERENCES DEPARTMENT(DEPT_ID)
)`;

let tmpRoot: string;
let projectDir: string;
let attachConfigPath: string;

function boardArgs(extra: Record<string, unknown> = {}) {
  return {
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: BOARD_DDL,
    projectType: "boot",
    stackVersion: "5.1",
    ...extra,
  };
}

const readController = () =>
  fs.readFile(
    path.join(projectDir, "src/main/java/egovframework/example/board/web/EgovBoardController.java"),
    "utf-8",
  );
const readRegisterView = () =>
  fs.readFile(
    path.join(projectDir, "src/main/resources/templates/thymeleaf/board/egovBoardRegister.html"),
    "utf-8",
  );
const readSeed = () =>
  fs.readFile(path.join(projectDir, "src/main/resources/db/boarddb.sql"), "utf-8");

/** `CREATE MEMORY TABLE <table>` 부터 닫는 `);` 까지의 블록. */
function tableBlock(seed: string, table: string): string {
  const start = seed.indexOf(`CREATE MEMORY TABLE ${table}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = seed.indexOf(");", start);
  return seed.slice(start, end + 2);
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-scaffold-attach-"));
  projectDir = path.join(tmpRoot, "board-app");
  attachConfigPath = path.join(
    projectDir,
    "src/main/java/egovframework/example/config/EgovConfigAttachFile.java",
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpRoot);
});

describe("egov_scaffold_project — withAttachment", () => {
  it("true 이면 인프라를 설치하고 첫 엔티티를 연결한다", async () => {
    const out = await egovScaffoldProject(boardArgs({ withAttachment: true }));
    expect(detectAttachFileInfra(projectDir).present).toBe(true);
    expect(await readController()).toMatch(/MultipartHttpServletRequest/);
    expect(await readRegisterView()).toMatch(/name="file_1"/);
    const seed = await readSeed();
    expect(seed).toMatch(/COMTNFILE/);
    expect(tableBlock(seed, "BOARD")).toMatch(/ATCH_FILE_ID\s+CHAR\(20\)/);
    expect(out).toMatch(/첨부파일 인프라/);
    expect(out).toMatch(/^ {2}- src\/main\/java\/.*\/EgovConfigAttachFile\.java$/m);
  });

  it("true 이면 모든 메시지 번들에 첨부 화면 키가 있다", async () => {
    await egovScaffoldProject(boardArgs({ withAttachment: true }));
    const dir = path.join(projectDir, "src/main/resources/egovframework/message");
    for (const f of ["message-common.properties", "message-common_ko.properties", "message-common_en.properties"]) {
      const text = await fs.readFile(path.join(dir, f), "utf-8");
      expect(text, f).toMatch(/^title\.board\.attachment=/m);
      expect(text, f).toMatch(/^info\.board\.attachment\.existing=/m);
    }
  });

  it("false 이면 메시지 번들에 첨부 키가 없다", async () => {
    await egovScaffoldProject(boardArgs());
    const text = await fs.readFile(
      path.join(projectDir, "src/main/resources/egovframework/message/message-common.properties"),
      "utf-8",
    );
    expect(text).not.toMatch(/attachment/);
  });

  it("false(기본)이면 인프라를 설치하지 않는다", async () => {
    await egovScaffoldProject(boardArgs());
    expect(detectAttachFileInfra(projectDir).present).toBe(false);
  });

  it.each([["war", "4.3"]])("%s %s + true 는 거부한다", async (projectType, stackVersion) => {
    await expect(
      egovScaffoldProject(boardArgs({ withAttachment: true, projectType, stackVersion })),
    ).rejects.toThrow(/Boot/);
  });

  it("DDL 의 ATCH_FILE_ID 는 입력 필드와 중복 컬럼을 만들지 않는다", async () => {
    await egovScaffoldProject(boardArgs({ withAttachment: true, ddl: DDL_WITH_ATCH_FILE_ID }));
    expect(await readRegisterView()).not.toMatch(/th:field="\*\{atchFileId\}"/);
    expect(tableBlock(await readSeed(), "BOARD").match(/ATCH_FILE_ID/g)).toHaveLength(1);
  });

  it.each([
    ["복합 PK", COMPOSITE_PK_DDL],
    ["FK", FK_DDL],
  ])("%s 엔티티의 시드 DDL 이 유효하다", async (_n, ddl) => {
    await egovScaffoldProject(boardArgs({ withAttachment: true, ddl }));
    const block = tableBlock(await readSeed(), "BOARD");
    expect(block).not.toMatch(/,\s*\)/);
    expect(block).toMatch(/,\s*\n\s*ATCH_FILE_ID/);
  });

  it("설치 실패 메시지는 프로젝트 절대 경로를 노출하지 않고 프리픽스를 중첩하지 않는다", async () => {
    await fs.outputFile(attachConfigPath, "// different");
    const err = await egovScaffoldProject(boardArgs({ withAttachment: true })).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(projectDir);
    expect((err as Error).message.match(/\[조치 후 재시도 가능\]/g)).toHaveLength(1);
  });

  it("프로젝트 폴더에 기존 파일이 있으면 생성 전에 거부하고 기존 프로젝트용 도구를 안내한다", async () => {
    // 예전에는 여기서 첨부 설정 파일 충돌로 '설치 실패 → 복구 안내' 경로를 검증했지만,
    // 비어 있지 않은 폴더는 이제 scaffold 진입 시점에 거부되어 그 경로에 닿지 않는다.
    await fs.outputFile(attachConfigPath, "// different");
    await expect(egovScaffoldProject(boardArgs({ withAttachment: true }))).rejects.toThrow(
      /^\[조치 후 재시도 가능\].*이미 존재.*egov_add_attach_file_infrastructure/s,
    );
    expect(await fs.pathExists(path.join(projectDir, "pom.xml"))).toBe(false);
    expect(await fs.readFile(attachConfigPath, "utf-8")).toBe("// different");
  });
});
