/**
 * egov_add_entity 멱등성 통합 테스트
 *
 * - 같은 인자로 2번 호출하면 2번째는 에러가 아니라 "변경 없음" 성공이어야 하고,
 *   산출 파일 내용은 첫 호출 결과와 완전히 동일해야 한다(어떤 파일도 재작성되지 않음).
 * - 산출 파일 중 하나를 수동으로 수정한 뒤 같은 인자로 다시 호출하면, 부분 상이로
 *   원자적 거부되어야 하고 에러 메시지에 [조치 후 재시도 가능] 프리픽스가 포함돼야 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";
import { RETRY_AFTER_ACTION_PREFIX } from "../../src/utils/scaffold/toolMessages.js";

const BOARD_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;

const MEMBER_DDL = `CREATE TABLE MEMBER (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  EMAIL VARCHAR(100)
)`;

let tmpRoot: string;
let projectDir: string;

const addMemberArgs = () => ({
  projectPath: projectDir,
  packageName: "egovframework.example.member",
  entityName: "Member",
  ddl: MEMBER_DDL,
});

const MEMBER_VO_REL = "src/main/java/egovframework/example/member/service/MemberVO.java";

/** projectDir 하위 모든 파일(상대경로 정렬)과 내용을 스냅샷으로 수집한다. */
async function snapshotFiles(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const SKIP = new Set(["target", "build", "node_modules", ".git", ".idea"]);

  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await visit(full);
      } else {
        out.set(path.relative(root, full), await fs.readFile(full, "utf-8"));
      }
    }
  }

  await visit(root);
  return out;
}

beforeEach(async () => {
  // 충돌 거부 케이스가 의도적으로 에러 경로를 밟아 도구 catch-all 의 console.error
  // 서버 로깅이 stderr 소음이 된다 — 검증 대상은 throw 되는 메시지이므로 로깅만 잠재운다.
  vi.spyOn(console, "error").mockImplementation(() => {});
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-add-entity-idem-"));
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
  projectDir = path.join(tmpRoot, "board-app");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpRoot);
});

describe("egov_add_entity — 멱등성", () => {
  it("같은 인자로 2회 호출하면 2회째는 '변경 없음' 성공이고 파일 내용은 불변이다", async () => {
    const out1 = await egovAddEntity(addMemberArgs());
    expect(out1).toMatch(/추가 완료/);

    const before = await snapshotFiles(projectDir);

    const out2 = await egovAddEntity(addMemberArgs());
    expect(out2).toMatch(/이미 동일한 내용으로 생성되어 있습니다/);
    expect(out2).toMatch(/변경 사항 없음/);
    expect(out2).not.toMatch(/추가가 충돌로 거부되었습니다/);

    const after = await snapshotFiles(projectDir);

    // 파일 집합과 각 파일의 내용이 완전히 동일해야 한다 (재작성/재append 없음).
    expect(after.size).toBe(before.size);
    for (const [rel, content] of before) {
      expect(after.get(rel), `${rel} 이 사라졌거나 변경되었습니다`).toBe(content);
    }
  });

  it("2회째 호출도 completionFooter 를 포함한 성공 메시지를 반환한다", async () => {
    await egovAddEntity(addMemberArgs());
    const out2 = await egovAddEntity(addMemberArgs());
    expect(out2).toMatch(/🏁 작업 완료/);
  });

  it("산출 파일 하나를 수정한 뒤 재호출하면 [조치 후 재시도 가능] 프리픽스와 함께 거부된다", async () => {
    await egovAddEntity(addMemberArgs());

    const voAbsPath = path.join(projectDir, MEMBER_VO_REL);
    const original = await fs.readFile(voAbsPath, "utf-8");
    await fs.writeFile(voAbsPath, original + "\n// tampered by test\n", "utf-8");

    await expect(egovAddEntity(addMemberArgs())).rejects.toThrow(
      new RegExp(RETRY_AFTER_ACTION_PREFIX.replace(/[[\]]/g, "\\$&")),
    );
    // 원자적 거부 — 손댄 파일은 도구가 되돌리거나 덮어쓰지 않고 그대로 남아 있어야 한다.
    expect(await fs.readFile(voAbsPath, "utf-8")).toBe(original + "\n// tampered by test\n");
  });

  it("충돌 거부 메시지는 상이/동일 파일을 구분해서 안내한다", async () => {
    await egovAddEntity(addMemberArgs());

    const voAbsPath = path.join(projectDir, MEMBER_VO_REL);
    const original = await fs.readFile(voAbsPath, "utf-8");
    await fs.writeFile(voAbsPath, original + "\n// tampered\n", "utf-8");

    try {
      await egovAddEntity(addMemberArgs());
      throw new Error("expected egovAddEntity to reject");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toMatch(/내용 상이 \(1개\)/);
      expect(msg).toMatch(/MemberVO\.java/);
      expect(msg).toMatch(/내용 동일 \(\d+개\)/);
    }
  });
});
