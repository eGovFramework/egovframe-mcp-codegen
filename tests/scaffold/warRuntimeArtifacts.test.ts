/**
 * WAR 산출물 중 컴파일되지 않고 서블릿 컨테이너가 실행 시점에 해석하는 파일의 형식을 검증한다.
 *
 * 아래 결함은 mvn package 를 통과하고 Tomcat 에서 실행해야 드러나므로 렌더링 결과를 직접 검사한다.
 *   - nav.jsp: EL 의 `+` 는 산술 연산이어서 문자열에 쓰면 NumberFormatException 으로 목록 화면이 500 이 된다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const BOARD_DDL = "CREATE TABLE BOARD (ID VARCHAR(16) NOT NULL PRIMARY KEY, TITLE VARCHAR(200))";
const MEMBER_DDL = "CREATE TABLE MEMBER (ID VARCHAR(16) NOT NULL PRIMARY KEY, EMAIL VARCHAR(100))";

const NAV_JSP = "src/main/webapp/WEB-INF/jsp/_fragments/nav.jsp";

let tmpRoot: string;
let projectDir: string;

const read = (relPath: string): Promise<string> =>
  fs.readFile(path.join(projectDir, relPath), "utf-8");

/** JSP 본문에서 EL 표현식(`${...}`)만 추출한다. */
const elExpressions = (jsp: string): string[] => jsp.match(/\$\{[^}]*\}/g) ?? [];

/** 문자열 연결(`+=`)이 아닌 산술 `+` 를 쓰는 EL 표현식을 고른다. */
const withArithmeticPlus = (expressions: string[]): string[] =>
  expressions.filter((expression) => /\+(?!=)/.test(expression));

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-war-runtime-"));
  projectDir = path.join(tmpRoot, "board-app");
  await generateScaffoldProject({
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: BOARD_DDL,
    description: "",
    projectType: "war",
    stackVersion: "4.3",
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpRoot);
});

describe("4.3 WAR nav.jsp EL", () => {
  it("메뉴 경로를 산술 + 가 아닌 문자열 연결로 만든다", async () => {
    const nav = await read(NAV_JSP);
    expect(nav).toContain("pageContext.request.contextPath += '/egovBoardList'");
    expect(withArithmeticPlus(elExpressions(nav))).toEqual([]);
  });

  it("egov_add_entity 로 재생성한 nav 도 산술 + 를 쓰지 않는다", async () => {
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      withAttachment: false,
      autoApplyMenu: true,
    });

    const nav = await read(NAV_JSP);
    expect(nav).toContain("pageContext.request.contextPath += '/egovBoardList'");
    expect(nav).toContain("pageContext.request.contextPath += '/egovMemberList'");
    expect(withArithmeticPlus(elExpressions(nav))).toEqual([]);
  });
});
