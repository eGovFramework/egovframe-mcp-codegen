/**
 * 4.3 Boot / 4.3 WAR 산출물 화면의 KRDS 전환 테스트.
 *
 * 설계: docs/superpowers/specs/2026-11-26-krds-views-43-design.md
 * 세 스택이 같은 KRDS 정적 자산(static50) 을 쓰고, 4.3 두 스택의 화면이 5.1 Boot 와 같은
 * 마크업·flatpickr 달력·KRDS 페이지네이션을 쓰는지 산출물 텍스트로 고정한다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

type Stack = "boot43" | "war43";

const PLAIN_DDL =
  "CREATE TABLE BOARD (ID VARCHAR(20) NOT NULL PRIMARY KEY, TITLE VARCHAR(200) NOT NULL, CONTENT VARCHAR(2000))";
const DATE_DDL =
  "CREATE TABLE BOARD (ID VARCHAR(20) NOT NULL PRIMARY KEY, TITLE VARCHAR(200) NOT NULL, PUB_DT DATE, REG_DT TIMESTAMP)";

const STATIC_ROOT: Record<Stack, string> = {
  boot43: "src/main/resources/static",
  war43: "src/main/webapp",
};
const VIEW: Record<Stack, { list: string; register: string }> = {
  boot43: {
    list: "src/main/resources/templates/thymeleaf/egovBoardList.html",
    register: "src/main/resources/templates/thymeleaf/egovBoardRegister.html",
  },
  war43: {
    list: "src/main/webapp/WEB-INF/jsp/egovframework/example/board/egovBoardList.jsp",
    register: "src/main/webapp/WEB-INF/jsp/egovframework/example/board/egovBoardRegister.jsp",
  },
};
const MSG_DIR = "src/main/resources/egovframework/message";

let tmpRoot: string;
beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "krds43-"));
});
afterEach(async () => {
  await fs.remove(tmpRoot);
});

/** 프로젝트를 생성하고 프로젝트 루트 경로를 돌려준다. */
async function scaffold(stack: Stack, ddl = PLAIN_DDL): Promise<string> {
  await generateScaffoldProject({
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl,
    description: "",
    projectType: stack === "war43" ? "war" : "boot",
    stackVersion: "4.3",
  });
  return path.join(tmpRoot, "board-app");
}
const read = (dir: string, rel: string): Promise<string> => fs.readFile(path.join(dir, rel), "utf-8");

describe("Task1 정적 자산", () => {
  it.each<Stack>(["boot43", "war43"])("%s 산출물에 KRDS 자산이 있고 옛 자산이 없다", async (stack) => {
    const dir = await scaffold(stack);
    const root = path.join(dir, STATIC_ROOT[stack]);
    for (const f of [
      "css/component/output.css",
      "css/egovframe.css",
      "js/jquery.min.js",
      "js/component/ui-script.js",
      "js/egovframework/common.js",
      "fonts/PretendardGOV-Regular.subset.woff2",
    ]) {
      expect(await fs.pathExists(path.join(root, f)), f).toBe(true);
    }
    expect((await fs.readdir(path.join(root, "img/component/icon"))).length).toBeGreaterThan(50);
    expect(await fs.pathExists(path.join(root, "css/egovframework/sample.css"))).toBe(false);
    expect(await fs.pathExists(path.join(root, "js/egovframework/jquery-3.6.1.min.js"))).toBe(false);
  });

  it("boot43 EgovConfigWeb 이 img·fonts 리소스 핸들러를 등록한다", async () => {
    const src = await read(await scaffold("boot43"), "src/main/java/egovframework/example/config/EgovConfigWeb.java");
    expect(src).toContain('addResourceHandler("/img/**").addResourceLocations("classpath:/static/img/")');
    expect(src).toContain('addResourceHandler("/fonts/**").addResourceLocations("classpath:/static/fonts/")');
    expect(src).not.toContain('"/images/**"');
  });
});
