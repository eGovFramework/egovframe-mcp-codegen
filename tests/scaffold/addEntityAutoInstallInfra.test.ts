/**
 * egov_add_entity — withAttachment=true 호출 시 첨부파일 인프라 자동 설치.
 *
 * 인프라 설치 계획(쓰기 없음)은 엔티티 사전 검사보다 먼저, 적용은 모든 사전 검사 통과 후
 * 엔티티 파일 쓰기와 같은 롤백 저널 안에서 수행된다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { egovAddAttachFileInfrastructure } from "../../src/tools/egovAddAttachFileInfrastructure.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";
import { detectAttachFileInfra } from "../../src/utils/scaffold/projectDetector.js";

const BOARD_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;

const MEMBER_DDL = `CREATE TABLE MEMBER (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  EMAIL VARCHAR(100)
)`;

// 자동 채번 형식 'MEMBER-NNNNN' (12자) 보다 짧은 PK
const SHORT_PK_DDL = `CREATE TABLE MEMBER (
  ID VARCHAR(8) NOT NULL PRIMARY KEY,
  EMAIL VARCHAR(100)
)`;

let tmpRoot: string;
let projectDir: string;
let seedPath: string;
let attachConfigPath: string;

async function scaffold(stackVersion: "5.0" | "4.3"): Promise<string> {
  await generateScaffoldProject({
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: BOARD_DDL,
    description: "",
    projectType: "boot",
    stackVersion,
  });
  return path.join(tmpRoot, "board-app");
}

function memberArgs(extra: Record<string, unknown> = {}) {
  return {
    projectPath: projectDir,
    packageName: "egovframework.example.member",
    entityName: "Member",
    ddl: MEMBER_DDL,
    ...extra,
  };
}

async function removeInfraFiles(dir: string): Promise<void> {
  await fs.remove(path.join(dir, "src/main/java/egovframework/example/config/EgovConfigAttachFile.java"));
  await fs.remove(path.join(dir, "src/main/java/egovframework/example/cmm/service/EgovFileMngService.java"));
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-auto-infra-"));
  projectDir = await scaffold("5.0");
  seedPath = path.join(projectDir, "src/main/resources/db/boarddb.sql");
  attachConfigPath = path.join(
    projectDir,
    "src/main/java/egovframework/example/config/EgovConfigAttachFile.java",
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpRoot);
});

describe("egov_add_entity — 첨부파일 인프라 자동 설치", () => {
  it("인프라가 없으면 자동 설치하고 엔티티를 연결한다", async () => {
    const out = await egovAddEntity(memberArgs({ withAttachment: true }));
    expect(detectAttachFileInfra(projectDir).present).toBe(true);
    expect(out).toMatch(/첨부파일 인프라 자동 설치/);
    expect(out).toMatch(/^ {2}- src\/main\/java\/.*\/EgovConfigAttachFile\.java$/m);
    const seed = await fs.readFile(seedPath, "utf-8");
    expect(seed).toMatch(/COMTNFILE/);
    expect(seed).toMatch(/CREATE MEMORY TABLE MEMBER/);
  });

  it("인프라가 있으면 재설치하지 않는다", async () => {
    await egovAddAttachFileInfrastructure({ projectPath: projectDir });
    const out = await egovAddEntity(memberArgs({ withAttachment: true }));
    expect(out).not.toMatch(/첨부파일 인프라 자동 설치/);
  });

  it("엔티티 충돌로 거부되면 인프라를 쓰지 않는다", async () => {
    await egovAddEntity(memberArgs({ withAttachment: false }));
    await expect(egovAddEntity(memberArgs({ withAttachment: true }))).rejects.toThrow(/충돌로 거부/);
    expect(detectAttachFileInfra(projectDir).present).toBe(false);
  });

  it("PK 길이 부족으로 거부되면 인프라를 쓰지 않는다", async () => {
    await expect(
      egovAddEntity(memberArgs({ withAttachment: true, ddl: SHORT_PK_DDL })),
    ).rejects.toThrow(/PK 컬럼 길이 부족/);
    expect(detectAttachFileInfra(projectDir).present).toBe(false);
  });

  it("엔티티 파일 쓰기가 실패하면 인프라도 복원한다", async () => {
    const seedBefore = await fs.readFile(seedPath, "utf-8");
    // Member 컨트롤러 출력(src/main/java/{{packagePath}}/web/…) 의 상위 디렉터리 자리에 일반 파일을 둬 ENOTDIR 유도
    const blockedParent = path.join(projectDir, "src/main/java/egovframework/example/member/web");
    await fs.outputFile(blockedParent, "");
    await expect(egovAddEntity(memberArgs({ withAttachment: true }))).rejects.toThrow(
      /조치 후 재시도 가능/,
    );
    expect(detectAttachFileInfra(projectDir).present).toBe(false);
    expect(await fs.readFile(seedPath, "utf-8")).toBe(seedBefore);
  });

  it("인프라가 없는 WAR 프로젝트는 거부한다", async () => {
    await fs.remove(path.join(tmpRoot, "board-app"));
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
    projectDir = path.join(tmpRoot, "board-app");
    await expect(egovAddEntity(memberArgs({ withAttachment: true }))).rejects.toThrow(
      /Boot 만 지원/,
    );
  });

  it("재호출해도 시드에 COMTNFILE 이 중복되지 않는다", async () => {
    await egovAddEntity(memberArgs({ withAttachment: true }));
    const out = await egovAddEntity(memberArgs({ withAttachment: true }));
    expect(out).toMatch(/변경 사항 없음/);
    const seed = await fs.readFile(seedPath, "utf-8");
    expect(seed.match(/CREATE MEMORY TABLE COMTNFILE\b/gi)).toHaveLength(1);
  });

  it("일부 인프라 파일이 동일 내용으로 있으면 나머지만 설치한다", async () => {
    await egovAddAttachFileInfrastructure({ projectPath: projectDir });
    await fs.remove(attachConfigPath);
    await egovAddEntity(memberArgs({ withAttachment: true }));
    expect(detectAttachFileInfra(projectDir).present).toBe(true);
  });

  it("엔티티 파일이 동일하고 인프라만 없으면 인프라를 설치한다", async () => {
    await egovAddEntity(memberArgs({ withAttachment: true }));
    await removeInfraFiles(projectDir);
    const out = await egovAddEntity(memberArgs({ withAttachment: true }));
    expect(detectAttachFileInfra(projectDir).present).toBe(true);
    expect(out).toMatch(/첨부파일 인프라 자동 설치/);
    expect(out).not.toMatch(/변경 사항 없음/);
    expect(out).toMatch(/엔티티 .*Member.* 은\(는\) 변경 없이.*인프라를 설치/s);
  });

  it("시드 후보가 2개이면 fallback 안내를 응답에 포함한다", async () => {
    await fs.outputFile(path.join(projectDir, "src/main/resources/db/extra.sql"), "");
    const out = await egovAddEntity(memberArgs({ withAttachment: true }));
    expect(out).toMatch(/HSQL 시드 \(fallback\)/);
  });
});
