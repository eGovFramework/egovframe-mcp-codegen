/**
 * 도구 계층 통합 테스트 — 에러 분류 프리픽스 / completionFooter
 *
 * toolMessages.test.ts 가 헬퍼 함수 자체를 단위 테스트한다면, 이 파일은 실제 도구
 * 핸들러(egov_add_entity / egov_scaffold_project) 가 그 헬퍼를 올바른 상황에 실제로
 * 사용하는지를 end-to-end 로 확인한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { egovScaffoldProject } from "../../src/tools/egovScaffoldProject.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";
import { NON_RETRYABLE_PREFIX } from "../../src/utils/scaffold/toolMessages.js";

const BOARD_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;

const MEMBER_DDL = `CREATE TABLE MEMBER (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  EMAIL VARCHAR(100)
)`;

let tmpRoot: string;

beforeEach(async () => {
  // 의도적으로 에러 경로를 밟는 테스트라 도구 catch-all 의 console.error 서버 로깅이
  // stderr 소음이 된다 — 검증 대상은 throw 되는 메시지이므로 로깅만 잠재운다.
  vi.spyOn(console, "error").mockImplementation(() => {});
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-error-classify-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpRoot);
});

describe("egov_add_entity — withAttachment 사전조건 에러 분류", () => {
  it("첨부파일 인프라가 없는 4.3 Boot 프로젝트에서 withAttachment=true 로 호출하면 [재시도 불가] 프리픽스로 거부된다", async () => {
    await generateScaffoldProject({
      projectName: "board-app",
      packageName: "egovframework.example.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: BOARD_DDL,
      description: "",
      projectType: "boot",
      stackVersion: "4.3",
    });
    const projectDir = path.join(tmpRoot, "board-app");

    const call = () =>
      egovAddEntity({
        projectPath: projectDir,
        packageName: "egovframework.example.member",
        entityName: "Member",
        ddl: MEMBER_DDL,
        withAttachment: true,
      });

    await expect(call()).rejects.toThrow(
      new RegExp(NON_RETRYABLE_PREFIX.replace(/[[\]]/g, "\\$&")),
    );
    await expect(call()).rejects.toThrow(/5\.0 Boot 만 지원/);
  });
});

describe("성공 결과의 completionFooter", () => {
  it("egov_scaffold_project 성공 메시지 끝에 completionFooter 가 붙는다", async () => {
    const out = await egovScaffoldProject({
      projectName: "footer-app",
      packageName: "egovframework.example.footer",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: BOARD_DDL,
    });
    expect(out).toMatch(/🏁 작업 완료 — 이 요청에 대한 추가 도구 호출은 필요하지 않습니다\.\s*$/);
  });

  it("egov_add_entity 성공 메시지 끝에 completionFooter 가 붙는다", async () => {
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

    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
    });
    expect(out).toMatch(/🏁 작업 완료 — 이 요청에 대한 추가 도구 호출은 필요하지 않습니다\.\s*$/);
  });
});
