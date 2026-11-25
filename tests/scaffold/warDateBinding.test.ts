/**
 * WAR 산출물의 날짜 필드 폼 바인딩 회귀 테스트.
 *
 * 결함: EgovBindingInitializer 가 java.util.Date 용 CustomDateEditor(allowEmpty=false) 만 등록해,
 * VO 의 java.sql.Timestamp 필드는 값이 있으면 타입 불일치로, 수정 폼이 보내는 빈 값은 빈 값 거부로
 * 바인딩이 실패했다 (TIMESTAMP 컬럼이 있는 엔티티는 수정이 항상 실패). 등록 JSP 도 날짜 입력란을
 * maxlength="0" 으로 내보내 값을 넣을 수 없었다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const DDL = `CREATE TABLE BOARD (
  ID VARCHAR(20) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200) NOT NULL,
  PUB_DT DATE,
  REG_DT TIMESTAMP
)`;

describe("WAR 날짜 필드 폼 바인딩", () => {
  let tmpRoot: string;
  let dir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "war-date-"));
    await generateScaffoldProject({
      projectName: "board-web",
      packageName: "egovframework.example.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: DDL,
      description: "",
      projectType: "war",
      stackVersion: "4.3",
    });
    dir = path.join(tmpRoot, "board-web");
  });
  afterEach(async () => {
    await fs.remove(tmpRoot);
  });

  it("바인딩 초기화기가 java.sql.Date 와 Timestamp 편집기를 빈 값 허용으로 등록한다", async () => {
    const src = await fs.readFile(
      path.join(dir, "src/main/java/egovframework/example/cmmn/web/EgovBindingInitializer.java"),
      "utf8",
    );
    expect(src).toContain("registerCustomEditor(java.sql.Date.class");
    expect(src).toContain("registerCustomEditor(Timestamp.class");
    expect(src).toContain("import java.sql.Timestamp;");
    // 빈 문자열은 null 로 — 수정 폼이 빈 날짜 입력란을 그대로 제출하기 때문.
    expect(src).toMatch(/isEmpty\(\)\)\s*\{\s*setValue\(null\)/);
    // 'yyyy-MM-dd' 만 들어온 Timestamp 는 시각을 보강한다 (Boot 컨트롤러와 동일 규칙).
    expect(src).toContain('" 00:00:00"');
    // 빈 값을 거부하던 기존 등록은 사라져야 한다.
    expect(src).not.toContain("new CustomDateEditor(dateFormat, false)");
  });

  it("등록 JSP 의 날짜 입력란은 maxlength=0 이 아니고 yyyy-MM-dd 안내를 가진다", async () => {
    const jsp = await fs.readFile(
      path.join(dir, "src/main/webapp/WEB-INF/jsp/egovframework/example/board/egovBoardRegister.jsp"),
      "utf8",
    );
    for (const field of ["pubDt", "regDt"]) {
      const line = jsp.split("\n").find((l) => l.includes(`path="${field}"`));
      expect(line, `${field} 입력란`).toBeDefined();
      expect(line).not.toContain('maxlength="0"');
      expect(line).toContain('placeholder="yyyy-MM-dd"');
    }
    // 일반 문자열 필드는 그대로 maxlength 를 가진다.
    expect(jsp).toContain('path="title" maxlength="200"');
  });
});
