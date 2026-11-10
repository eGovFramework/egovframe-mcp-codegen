/**
 * 첨부파일 하드닝 회귀 테스트 (5.0 Boot).
 *
 * 요청으로 들어온 atchFileId 는 신뢰하지 않는다. 수정·삭제는 DB 에 저장된 값을 기준으로 처리한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovScaffoldProject } from "../../src/tools/egovScaffoldProject.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const BOARD_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(20) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;

const UTIL = "src/main/java/egovframework/example/cmm/service/EgovFileMngUtil.java";
const CONTROLLER = "src/main/java/egovframework/example/board/web/EgovBoardController.java";
const SERVICE = "src/main/java/egovframework/example/board/service/impl/EgovBoardServiceImpl.java";
const REGISTER = "src/main/resources/templates/thymeleaf/board/egovBoardRegister.html";

let tmpRoot: string;
let projectDir: string;

const read = (relPath: string): Promise<string> =>
  fs.readFile(path.join(projectDir, relPath), "utf-8");

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-attach-hardening-"));
  projectDir = path.join(tmpRoot, "board-app");
  await egovScaffoldProject({
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: BOARD_DDL,
    projectType: "boot",
    stackVersion: "5.0",
    withAttachment: true,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpRoot);
});

describe("요청 atchFileId 불신 (5.0 Boot)", () => {
  it("수정은 요청 값 대신 DB 의 atchFileId 를 사용한다", async () => {
    const c = await read(CONTROLLER);
    expect(c).toMatch(/BoardVO stored = boardService\.selectBoard\(boardVO\);/);
    expect(c).toMatch(/String atchFileId = stored\.getAtchFileId\(\);/);
    expect(c).not.toMatch(/String atchFileId = boardVO\.getAtchFileId\(\);/);
    expect(c).toMatch(/boardVO\.setAtchFileId\(atchFileId\);\s+boardService\.updateBoard\(boardVO\);/);
    // 첨부가 없는 레코드
    expect(c).toMatch(/atchFileId == null \|\| atchFileId\.isEmpty\(\)/);
  });

  it("레코드 삭제는 DB 에서 읽은 atchFileId 로 첨부를 정리한다", async () => {
    const s = await read(SERVICE);
    expect(s).toMatch(/BoardVO stored = boardMapper\.selectBoard\(vo\);/);
    expect(s).toMatch(/stored != null/);
    expect(s).not.toMatch(/= vo\.getAtchFileId\(\);/);
  });

  it("등록·수정 화면에 atchFileId hidden 필드가 없다", async () => {
    expect(await read(REGISTER)).not.toMatch(/name="atchFileId"/);
  });
});

describe("트랜잭션 포인트컷", () => {
  it.each(["5.0", "4.3"] as const)("%s 트랜잭션 포인트컷은 기본 패키지 전체를 포함한다", async (stackVersion) => {
    await generateScaffoldProject({
      projectName: "tx-app",
      packageName: "egovframework.example.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: BOARD_DDL,
      description: "",
      projectType: "boot",
      stackVersion,
    });
    const tx = await fs.readFile(
      path.join(tmpRoot, "tx-app/src/main/java/egovframework/example/config/EgovConfigTransaction.java"),
      "utf-8",
    );
    expect(tx).toContain("execution(* egovframework.example..impl.*Impl.*(..))");
  });
});

describe("첨부파일 유틸 하드닝 (5.0 Boot)", () => {
  it("다운로드 헤더를 ContentDisposition 으로 생성한다", async () => {
    const u = await read(UTIL);
    expect(u).toMatch(/ContentDisposition\.builder\("attachment"\)\s*\.filename\([^,]+,\s*StandardCharsets\.UTF_8\)/);
    expect(u).not.toContain("ISO-8859-1");
  });

  it("저장명은 UUID 로 생성하고 시각 기반 이름을 쓰지 않는다", async () => {
    const u = await read(UTIL);
    expect(u).toMatch(/keyStr \+ UUID\.randomUUID\(\)\.toString\(\)\.replace\("-", ""\)/);
    expect(u).not.toMatch(/getTimeStamp|SimpleDateFormat/);
  });

  it("확장자를 구하기 전에 끝의 점과 공백을 제거한다", async () => {
    const u = await read(UTIL);
    const body = /private static String getExtensionUpper[\s\S]*?\n\t}/.exec(u)![0];
    expect(body).toContain('replaceAll("[\\\\s.]+$", "")');
    expect(body.indexOf("replaceAll")).toBeLessThan(body.indexOf("lastIndexOf('.')"));
  });
});
