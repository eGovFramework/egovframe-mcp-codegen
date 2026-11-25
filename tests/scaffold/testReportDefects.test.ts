/**
 * 2026-11-25 외부 테스트 결과 보고(codegen-테스트결과보고.md)에서 보고된 결함의 회귀 테스트.
 * 항목 번호(I6, I10, …)는 보고서의 번호를 그대로 쓴다. I17(WAR 날짜 바인딩)은 warDateBinding.test.ts 가 다룬다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";
import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { egovAddQueryView } from "../../src/tools/egovAddQueryView.js";
import { egovAddAttachFileInfrastructure } from "../../src/tools/egovAddAttachFileInfrastructure.js";
import { egovScaffoldProject, projectFolderName } from "../../src/tools/egovScaffoldProject.js";

const BOARD_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(20) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200) NOT NULL,
  CONTENT VARCHAR(4000),
  WRITER VARCHAR(50),
  REG_DT TIMESTAMP
)`;
const ARTICLE_DDL = `CREATE TABLE ARTICLE (
  ARTICLE_ID VARCHAR(20) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200) NOT NULL,
  REG_DT TIMESTAMP
)`;

let tmpRoot: string;
const dirs: Record<"boot51" | "boot43" | "war43", string> = { boot51: "", boot43: "", war43: "" };

async function scaffold(name: string, projectType: "boot" | "war", stackVersion: "5.1" | "4.3") {
  await generateScaffoldProject({
    projectName: name,
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: BOARD_DDL,
    description: "",
    projectType,
    stackVersion,
  });
  return path.join(tmpRoot, name);
}
const read = (p: string) => fs.readFile(p, "utf8");

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "report-defects-"));
  dirs.boot51 = await scaffold("app51", "boot", "5.1");
  dirs.boot43 = await scaffold("app43", "boot", "4.3");
  dirs.war43 = await scaffold("web43", "war", "4.3");
}, 120_000);
afterAll(async () => {
  await fs.remove(tmpRoot);
});

describe("I16 — WAR 안내 문구의 프로젝트 폴더명", () => {
  it("Windows 경로(역슬래시)에서도 마지막 폴더명만 돌려준다", () => {
    expect(projectFolderName("C:\\Users\\yongf\\work\\t5-war43-app")).toBe("t5-war43-app");
    expect(projectFolderName("/Users/psw/work/t5-war43-app")).toBe("t5-war43-app");
  });

  it("WAR 생성 응답의 다음 단계에 프로젝트명이 들어간다", async () => {
    const out = await egovScaffoldProject({
      projectName: "web-msg",
      packageName: "egovframework.example.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: BOARD_DDL,
      projectType: "war",
      stackVersion: "4.3",
    });
    expect(out).toContain("target/web-msg.war");
    expect(out).toContain("http://localhost:8080/web-msg/");
  });
});

describe("I10 — 첨부 저장 경로의 역슬래시", () => {
  it("properties 에 기록되는 Globals.fileStorePath 는 슬래시로 정규화된다", async () => {
    const dir = dirs.boot51;
    const out = await egovAddAttachFileInfrastructure({
      projectPath: dir,
      fileStorePath: "C:\\Users\\yongf\\AppData\\Local\\Temp\\egov-upload",
    });
    const props = await read(path.join(dir, "src/main/resources/application.properties"));
    expect(props).toContain("Globals.fileStorePath=C:/Users/yongf/AppData/Local/Temp/egov-upload");
    expect(props).not.toMatch(/Globals\.fileStorePath=.*\\/);
    const globals = await read(path.join(dir, "src/main/resources/egovframework/egovProps/globals.properties"));
    expect(globals).toContain("Globals.fileStorePath=C:/Users/yongf/AppData/Local/Temp/egov-upload");
    // 도구 응답의 안내 경로도 실제로 기록된 값과 같아야 한다.
    expect(out).toContain("C:/Users/yongf/AppData/Local/Temp/egov-upload");
  }, 60_000);
});

describe("I11 — Thymeleaf 템플릿 리졸버 인코딩", () => {
  it.each([
    ["5.1", () => dirs.boot51],
    ["4.3", () => dirs.boot43],
  ])("%s Boot 의 EgovConfigWeb 이 templateResolver 에 UTF-8 을 지정한다", async (_v, d) => {
    const src = await read(path.join(d(), "src/main/java/egovframework/example/config/EgovConfigWeb.java"));
    expect(src).toContain('templateResolver.setCharacterEncoding("UTF-8");');
  });
});

describe("I6 — NULL 허용 문자열 컬럼은 필수가 아니다", () => {
  it("5.1 Boot VO: NOT NULL 컬럼에만 @EgovNullCheck", async () => {
    const vo = await read(path.join(dirs.boot51, "src/main/java/egovframework/example/board/service/BoardVO.java"));
    expect(vo).toMatch(/@EgovNullCheck\([^)]*\)\s*\n\s*private String title;/);
    expect(vo).toMatch(/\n\s*private String writer;/);
    expect(vo).not.toMatch(/@EgovNullCheck\([^)]*\)\s*\n\s*private String writer;/);
    expect(vo).not.toMatch(/@EgovNullCheck\([^)]*\)\s*\n\s*private String content;/);
  });

  it("5.1 Boot 등록 화면: NOT NULL 컬럼에만 필수 표시와 required 규칙", async () => {
    const html = await read(
      path.join(dirs.boot51, "src/main/resources/templates/thymeleaf/board/egovBoardRegister.html"),
    );
    const labelOf = (f: string) => html.split("\n").find((l) => l.includes(`<label for="${f}"`)) ?? "";
    expect(labelOf("title")).toContain('class="required"');
    expect(labelOf("writer")).not.toContain('class="required"');
    expect(labelOf("content")).not.toContain('class="required"');
    expect(html).toMatch(/\btitle: \{[\s\S]*?required: true/);
    expect(html).not.toMatch(/\bwriter: \{[\s\S]*?required: true/);
    expect(html).not.toMatch(/\bcontent: \{[\s\S]*?required: true/);
  });

  it("4.3 Boot VO: NOT NULL 컬럼에만 @EgovNotNull", async () => {
    const vo = await read(path.join(dirs.boot43, "src/main/java/egovframework/example/board/service/BoardVO.java"));
    expect(vo).toMatch(/@EgovNotNull\([^)]*\)\s*\n\s*private String title;/);
    expect(vo).not.toMatch(/@EgovNotNull\([^)]*\)\s*\n\s*private String writer;/);
  });

  it("4.3 WAR validator.xml: NOT NULL 컬럼에만 required 규칙", async () => {
    const xml = await read(path.join(dirs.war43, "src/main/webapp/WEB-INF/config/egovframework/validator/validator.xml"));
    expect(xml).toContain('<field property="title" depends="required">');
    expect(xml).not.toContain('<field property="writer"');
    expect(xml).not.toContain('<field property="content"');
  });
});

describe("I15 / I14 — 4.3 Boot 추가 엔티티 화면 흐름과 날짜 오류 표시", () => {
  beforeAll(async () => {
    await egovAddEntity({
      projectPath: dirs.boot43,
      packageName: "egovframework.example.article",
      entityName: "Article",
      ddl: ARTICLE_DDL,
      withAttachment: false,
    });
  }, 60_000);

  it("I15: 등록·수정·삭제 후 자기 목록(/egovArticleList.do)으로 돌아간다", async () => {
    const ctl = await read(path.join(dirs.boot43, "src/main/java/egovframework/example/article/web/EgovArticleController.java"));
    expect(ctl).not.toContain('"redirect:/"');
    expect(ctl.match(/"redirect:\/egovArticleList\.do"/g)?.length).toBe(3);
  });

  it("I15: 등록 화면의 목록 버튼이 자기 목록으로 이동한다", async () => {
    const html = await read(path.join(dirs.boot43, "src/main/resources/templates/thymeleaf/egovArticleRegister.html"));
    expect(html).toContain("contextPath + '/egovArticleList.do'");
    expect(html).not.toContain("contextPath + '/'");
  });

  it("I14: 날짜 필드에도 바인딩 오류 표시가 있다", async () => {
    const html = await read(path.join(dirs.boot43, "src/main/resources/templates/thymeleaf/egovBoardRegister.html"));
    expect(html).toContain("#fields.hasErrors('regDt')");
  });
});

describe("I13 — 기존 프로젝트 폴더 덮어쓰기 거부", () => {
  it("비어 있지 않은 같은 이름의 폴더가 있으면 어떤 파일도 쓰지 않고 거부한다", async () => {
    const dir = dirs.boot51;
    const marker = path.join(dir, "USER_EDITED.txt");
    await fs.writeFile(marker, "사용자 파일");
    const pom = path.join(dir, "pom.xml");
    const before = await read(pom);
    await fs.writeFile(pom, before + "\n<!-- user edit -->\n");
    await expect(
      generateScaffoldProject({
        projectName: "app51",
        packageName: "egovframework.example.other",
        outputPath: tmpRoot,
        entityName: "Other",
        ddl: "CREATE TABLE OTHER (ID VARCHAR(20) NOT NULL PRIMARY KEY, NM VARCHAR(50))",
        description: "",
        projectType: "boot",
        stackVersion: "5.1",
      }),
    ).rejects.toThrow(/이미 존재|비어 있지/);
    expect(await read(pom)).toContain("<!-- user edit -->");
    expect(await fs.pathExists(marker)).toBe(true);
    expect(await fs.pathExists(path.join(dir, "src/main/java/egovframework/example/other"))).toBe(false);
  });

  it("비어 있는 폴더는 그대로 사용한다", async () => {
    const empty = path.join(tmpRoot, "pre-made");
    await fs.ensureDir(empty);
    await generateScaffoldProject({
      projectName: "pre-made",
      packageName: "egovframework.example.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: BOARD_DDL,
      description: "",
      projectType: "boot",
      stackVersion: "5.1",
    });
    expect(await fs.pathExists(path.join(empty, "pom.xml"))).toBe(true);
  });
});

describe("I18 — WAR 조회뷰의 뷰 이름과 JSP 위치", () => {
  it("깊은 패키지(<base>.<module>.report)로 만들어도 컨트롤러 뷰 이름이 실제 JSP 를 가리킨다", async () => {
    const dir = dirs.war43;
    await egovAddQueryView({
      projectPath: dir,
      packageName: "egovframework.example.w43.report",
      viewName: "BoardReport",
      sql: "SELECT b.ID AS boardId, b.TITLE AS boardTitle FROM BOARD b",
      columns: [
        { alias: "boardId", label: "ID" },
        { alias: "boardTitle", label: "제목" },
      ],
    });
    const servlet = await read(path.join(dir, "src/main/webapp/WEB-INF/config/egovframework/springmvc/dispatcher-servlet.xml"));
    const prefix = servlet.match(/name="prefix" value="([^"]+)"/)?.[1];
    expect(prefix).toBeDefined();

    const ctlFiles = await fs
      .readdir(path.join(dir, "src/main/java"), { recursive: true })
      .then((list) => (list as string[]).filter((f) => f.endsWith("EgovBoardReportController.java")));
    expect(ctlFiles).toHaveLength(1);
    const ctl = await read(path.join(dir, "src/main/java", ctlFiles[0]));
    const viewName = ctl.match(/return "([^"]+)";/)?.[1];
    expect(viewName).toBeDefined();

    const jsp = path.join(dir, "src/main/webapp", prefix!, viewName! + ".jsp");
    expect(await fs.pathExists(jsp), `뷰 리졸버가 찾는 JSP: ${jsp}`).toBe(true);
    // 컨트롤러 파일의 위치와 package 선언이 일치해야 컴파일된다.
    const pkg = ctl.match(/^package ([\w.]+);/m)?.[1];
    expect(path.dirname(ctlFiles[0]).split(path.sep).join(".")).toBe(pkg);
  }, 60_000);
});
