/**
 * egov_add_attach_file_infrastructure 응답 문구 — 이미 설치된 프로젝트에 다시 호출하면
 * 변경한 파일이 없다는 사실을 그대로 알려야 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddAttachFileInfrastructure } from "../../src/tools/egovAddAttachFileInfrastructure.js";
import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { egovScaffoldProject } from "../../src/tools/egovScaffoldProject.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const BOARD_DDL = "CREATE TABLE BOARD (ID VARCHAR(16) NOT NULL PRIMARY KEY, TITLE VARCHAR(200))";

let tmpRoot: string;
let projectDir: string;

async function scaffold(stackVersion: "5.1" | "4.3", withAttachment: boolean): Promise<void> {
  await generateScaffoldProject({
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: BOARD_DDL,
    description: "",
    projectType: "boot",
    stackVersion,
    withAttachment,
  });
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-attach-reinstall-"));
  projectDir = path.join(tmpRoot, "board-app");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpRoot);
});

describe.each(["5.1", "4.3"] as const)("%s Boot 인프라 도구 응답", (stackVersion) => {
  it("처음 설치하면 설치 완료와 자체 검증 결과를 알린다", async () => {
    await scaffold(stackVersion, false);
    const out = await egovAddAttachFileInfrastructure({ projectPath: projectDir });
    expect(out).toContain("첨부파일 인프라 설치 완료!");
    expect(out).toMatch(/자체 검증 통과 \(검사한 파일 [1-9]\d*개\)/);
  });

  it.each([
    [
      "egov_scaffold_project",
      () =>
        egovScaffoldProject({
          projectName: "board-app",
          packageName: "egovframework.example.board",
          outputPath: tmpRoot,
          entityName: "Board",
          ddl: BOARD_DDL,
          projectType: "boot",
          stackVersion,
          withAttachment: true,
        }),
    ],
    [
      "egov_add_entity",
      async () => {
        await scaffold(stackVersion, false);
        return egovAddEntity({
          projectPath: projectDir,
          packageName: "egovframework.example.member",
          entityName: "Member",
          ddl: "CREATE TABLE MEMBER (ID VARCHAR(16) NOT NULL PRIMARY KEY, EMAIL VARCHAR(100))",
          withAttachment: true,
        });
      },
    ],
  ])("%s 로 설치한 프로젝트에 다시 호출하면 변경한 파일이 없다고 알린다", async (_tool, install) => {
    await install();
    const out = await egovAddAttachFileInfrastructure({ projectPath: projectDir });
    expect(out).toContain("첨부파일 인프라가 이미 설치되어 있어 변경한 파일이 없습니다.");
    expect(out).not.toContain("설치 완료!");
    expect(out).not.toContain("자동 append 되었습니다");
    expect(out).not.toContain("검사한 파일 0개");
  });

  it("업로드 오류 처리 안내가 실제 동작과 같다", async () => {
    await scaffold(stackVersion, false);
    const out = await egovAddAttachFileInfrastructure({ projectPath: projectDir });
    expect(out).not.toContain("referer 로 redirect");
    expect(out).toContain("cmm/uploadError");
  });
});
