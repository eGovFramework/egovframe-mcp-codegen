/**
 * nav 메뉴 링크와 Controller 매핑의 정합성 회귀 테스트.
 *
 * nav fragment 는 각 메뉴를 `/egov{Name}List.do` 로 연결하므로, 생성된 프로젝트 안에
 * 같은 주소를 GET 으로 제공하는 Controller 가 반드시 있어야 한다 (없으면 메뉴 클릭 시 404).
 * Boot 4.3 엔티티 Controller 에 이 매핑이 빠져 있던 결함의 재발을 막는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { egovAddQueryView } from "../../src/tools/egovAddQueryView.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const STACKS = [
  { label: "Boot 4.3", projectType: "boot", stackVersion: "4.3", nav: "src/main/resources/templates/thymeleaf/_fragments/nav.html" },
  { label: "Boot 5.1", projectType: "boot", stackVersion: "5.1", nav: "src/main/resources/templates/thymeleaf/_fragments/nav.html" },
  { label: "WAR 4.3", projectType: "war", stackVersion: "4.3", nav: "src/main/webapp/WEB-INF/jsp/_fragments/nav.jsp" },
] as const;

let tmpRoot: string;

async function readJavaSources(dir: string): Promise<string> {
  let all = "";
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) all += await readJavaSources(p);
    else if (e.name.endsWith(".java")) all += await fs.readFile(p, "utf-8");
  }
  return all;
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-nav-link-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpRoot);
});

describe("nav 메뉴 링크 ↔ Controller GET 매핑", () => {
  for (const stack of STACKS) {
    it(`[${stack.label}] nav 의 모든 /egov{Name}List.do 링크를 GET 으로 제공하는 Controller 가 있다`, async () => {
      await generateScaffoldProject({
        projectName: "board-app",
        packageName: "egovframework.example.board",
        outputPath: tmpRoot,
        entityName: "Board",
        ddl: "CREATE TABLE BOARD (ID VARCHAR(16) NOT NULL PRIMARY KEY, TITLE VARCHAR(200))",
        description: "",
        projectType: stack.projectType,
        stackVersion: stack.stackVersion,
      });
      const projectDir = path.join(tmpRoot, "board-app");
      await egovAddEntity({
        projectPath: projectDir,
        packageName: "egovframework.example.member",
        entityName: "Member",
        ddl: "CREATE TABLE MEMBER (ID VARCHAR(16) NOT NULL PRIMARY KEY, EMAIL VARCHAR(100))",
        autoApplyMenu: true,
      });
      await egovAddQueryView({
        projectPath: projectDir,
        packageName: "egovframework.example.report",
        viewName: "MemberReport",
        sql: "SELECT m.ID AS id, m.EMAIL AS email FROM MEMBER m",
        columns: [
          { alias: "id", label: "아이디", type: "String" },
          { alias: "email", label: "이메일", type: "String" },
        ],
        searchable: ["email"],
        autoApplyMenu: true,
      });

      const nav = await fs.readFile(path.join(projectDir, stack.nav), "utf-8");
      const links = [...new Set([...nav.matchAll(/\/egov\w+List\.do/g)].map((m) => m[0]))];
      expect(links.sort()).toEqual(["/egovBoardList.do", "/egovMemberList.do", "/egovMemberReportList.do"]);

      const java = await readJavaSources(path.join(projectDir, "src/main/java"));
      for (const link of links) {
        expect(java, `${link} 의 GET 매핑 누락`).toContain(`@GetMapping("${link}")`);
      }
    });
  }
});
