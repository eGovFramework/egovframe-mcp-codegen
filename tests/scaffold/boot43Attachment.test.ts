/**
 * 4.3 Boot 엔티티 템플릿 첨부파일 연결 테스트.
 *
 * 엔티티 템플릿은 generateScaffoldProject 를 직접 호출하고, 도구 경로는 egov_scaffold_project /
 * egov_add_entity 로 검증한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { egovScaffoldProject } from "../../src/tools/egovScaffoldProject.js";
import { detectAttachFileInfra } from "../../src/utils/scaffold/projectDetector.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const SINGLE_DDL = "CREATE TABLE BOARD (ID VARCHAR(20) NOT NULL PRIMARY KEY, TITLE VARCHAR(200))";
const COMPOSITE_DDL = "CREATE TABLE BOARD (A VARCHAR(20) NOT NULL, B INT NOT NULL, PRIMARY KEY (A, B))";

const CONTROLLER = "src/main/java/egovframework/example/board/web/EgovBoardController.java";
const SERVICE = "src/main/java/egovframework/example/board/service/impl/EgovBoardServiceImpl.java";
const VO = "src/main/java/egovframework/example/board/service/BoardVO.java";
const MAPPER = "src/main/resources/egovframework/sqlmap/board/mappers/EgovBoard_Board_SQL.xml";
const REGISTER = "src/main/resources/templates/thymeleaf/egovBoardRegister.html";

let tmpRoot: string;
let projectDir: string;

const read = (relPath: string): Promise<string> =>
  fs.readFile(path.join(projectDir, relPath), "utf-8");

async function generate(ddl: string, withAttachment = true): Promise<void> {
  await generateScaffoldProject({
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl,
    description: "",
    projectType: "boot",
    stackVersion: "4.3",
    withAttachment,
  });
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-boot43-attach-"));
  projectDir = path.join(tmpRoot, "board-app");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpRoot);
});

describe("4.3 Boot 첨부파일 연결", () => {
  beforeEach(async () => {
    await generate(SINGLE_DDL);
  });

  it("컨트롤러가 첨부 업로드와 DB 기준 수정을 수행한다", async () => {
    const c = await read(CONTROLLER);
    expect(c).toMatch(/public String add\(final MultipartHttpServletRequest multiRequest,/);
    expect(c).toMatch(/public String update\(final MultipartHttpServletRequest multiRequest,/);
    expect(c).toMatch(/model\.addAttribute\("attachList"/);
    expect(c).toMatch(/BoardVO stored = this\.boardService\.selectBoard\(boardVO\);/);
    expect(c).not.toMatch(/String atchFileId = boardVO\.getAtchFileId/);
    expect(c).toContain('@PostMapping("/board/deleteAttachFile")');
    expect(c).toContain("import javax.annotation.Resource;");
    // CHAR(20) 컬럼은 빈 값이 공백으로 채워져 읽히므로 isEmpty() 가 아니라 isBlank() 로 검사한다.
    expect(c).toMatch(/atchFileId == null \|\| atchFileId\.isBlank\(\)/);
    expect(c).not.toMatch(/atchFileId\.isEmpty\(\)\) \{\s*\/\/ \(A\)/);
    expect(c).toMatch(/boardVO\.setAtchFileId\(atchFileId\);\s+this\.boardService\.updateBoard\(boardVO\);/);
  });

  it("서비스 삭제는 DB 값으로 첨부 그룹을 정리한다", async () => {
    const s = await read(SERVICE);
    expect(s).toMatch(/BoardVO stored = boardDAO\.selectBoard\(vo\);/);
    expect(s).toMatch(/stored != null/);
    expect(s).toContain("deleteAllFileInf");
  });

  it("VO 와 매퍼에 첨부 컬럼을 추가한다", async () => {
    expect(await read(VO)).toMatch(/private String atchFileId;/);
    const m = await read(MAPPER);
    expect(m).toContain('<result property="atchFileId" column="ATCH_FILE_ID"/>');
    expect(m).toMatch(/ATCH_FILE_ID=#\{atchFileId\}/);
    expect(m).toMatch(/t\.ATCH_FILE_ID/);
  });

  it("화면에 파일 선택과 기존 목록이 있고 hidden 필드는 없다", async () => {
    const r = await read(REGISTER);
    expect(r).toContain('enctype="multipart/form-data"');
    expect(r).toContain('name="file_1"');
    expect(r).toContain("/cmm/fms/FileDown.do");
    expect(r).toContain("/board/deleteAttachFile");
    expect(r).not.toMatch(/name="atchFileId"/);
    expect(r).not.toContain("krds-");
  });

  it("메시지 키가 모든 번들에 있다", async () => {
    for (const f of ["message-common.properties", "message-common_ko.properties", "message-common_en.properties"]) {
      expect(await read(`src/main/resources/egovframework/message/${f}`)).toMatch(/title\.board\.attachment=/);
    }
  });
});

describe("4.3 Boot 첨부 시드", () => {
  it.each([
    ["단일 PK", SINGLE_DDL],
    ["복합 PK", COMPOSITE_DDL],
  ])("%s 시드에 첨부 컬럼이 올바른 쉼표로 추가된다", async (_n, ddl) => {
    await generate(ddl);
    const seed = await read("src/main/resources/db/boarddb.sql");
    expect(seed).toMatch(/,\s*ATCH_FILE_ID CHAR\(20\)\s*\);/);
  });
});

describe("4.3 Boot withAttachment=false", () => {
  it("첨부 관련 코드가 출력되지 않는다", async () => {
    await generate(SINGLE_DDL, false);
    expect(await read(CONTROLLER)).not.toContain("deleteAttachFile");
    expect(await read(SERVICE)).toContain("@Override public void deleteBoard(BoardVO vo) throws Exception { boardDAO.deleteBoard(vo); }");
    expect(await read(MAPPER)).not.toContain("ATCH_FILE_ID");
  });
});

describe("4.3 Boot 도구 경로", () => {
  it("egov_scaffold_project 로 4.3 프로젝트를 첨부파일과 함께 생성한다", async () => {
    const out = await egovScaffoldProject({
      projectName: "board-app",
      packageName: "egovframework.example.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: SINGLE_DDL,
      projectType: "boot",
      stackVersion: "4.3",
      withAttachment: true,
    });
    expect(out).toContain("접근 제어가 없습니다");
    expect(out).not.toContain("Spring Security 정책으로 보호");
    const u = await read("src/main/java/egovframework/example/cmm/service/EgovFileMngUtil.java");
    expect(u).toContain("import javax.annotation.Resource;");
    expect(u).not.toContain("jakarta");
    const m = await read("src/main/java/egovframework/example/cmm/service/impl/FileManageMapper.java");
    expect(m).toContain("import org.apache.ibatis.annotations.Mapper;");
    // 설명 주석에 @EgovMapper 문구가 있으므로 import 와 애너테이션 줄로 검사한다.
    expect(m).not.toContain("import org.egovframe.rte.psl.dataaccess.mapper.EgovMapper;");
    expect(m).not.toMatch(/^@EgovMapper/m);
  });

  it("4.3 프로젝트의 egov_add_entity 가 인프라를 자동 설치한다", async () => {
    await generate(SINGLE_DDL, false);
    expect(detectAttachFileInfra(projectDir).present).toBe(false);
    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: "CREATE TABLE MEMBER (ID VARCHAR(16) NOT NULL PRIMARY KEY, EMAIL VARCHAR(100))",
      withAttachment: true,
    });
    expect(out).toMatch(/첨부파일 인프라 자동 설치/);
    expect(detectAttachFileInfra(projectDir).present).toBe(true);
  });

  it("FK 부모가 있는 엔티티의 Service 는 FkComboVO 를 기본 패키지로 참조한다", async () => {
    await generate(SINGLE_DDL, false);
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.comment",
      entityName: "Comment",
      ddl: "CREATE TABLE COMMENT_TB (ID VARCHAR(16) NOT NULL PRIMARY KEY, BOARD_ID VARCHAR(20), BODY VARCHAR(200), CONSTRAINT FK_CMT_BOARD FOREIGN KEY (BOARD_ID) REFERENCES BOARD(ID))",
      withAttachment: true,
    });
    const base = "src/main/java/egovframework/example/comment/service";
    const svc = await read(`${base}/EgovCommentService.java`);
    const impl = await read(`${base}/impl/EgovCommentServiceImpl.java`);
    for (const src of [svc, impl]) {
      expect(src).toContain("java.util.List<egovframework.example.cmm.vo.FkComboVO>");
      expect(src).not.toContain("List<.cmm");
    }
  });
});
