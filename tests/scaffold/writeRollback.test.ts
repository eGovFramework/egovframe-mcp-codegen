/**
 * 쓰기 롤백 저널 테스트
 *
 * - FileWriteJournal 단위: 신규 파일은 삭제, 기존 파일은 원본 복원 (역순).
 * - withWriteRollback 단위: 실패 시 [조치 후 재시도 가능] 에러로 변환 + 복구 수행.
 * - egov_add_entity 통합: 쓰기 도중 OS 레벨 실패(읽기 전용 디렉터리)를 유발하면
 *   이미 쓰인 파일이 전부 원상 복구되고, 원인 해결 후 같은 인자 재시도가 성공한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import {
  FileWriteJournal,
  formatRollbackNotice,
  withWriteRollback,
} from "../../src/utils/scaffold/writeRollback.js";
import { RETRY_AFTER_ACTION_PREFIX } from "../../src/utils/scaffold/toolMessages.js";
import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-write-rollback-"));
});

afterEach(async () => {
  await fs.remove(tmpRoot);
});

describe("FileWriteJournal", () => {
  it("신규 생성 파일은 롤백 시 삭제된다", async () => {
    const journal = new FileWriteJournal();
    const target = path.join(tmpRoot, "new-file.txt");

    await journal.recordBeforeWrite(target);
    await fs.writeFile(target, "생성된 내용", "utf-8");
    expect(await fs.pathExists(target)).toBe(true);

    const outcome = await journal.rollback();
    expect(outcome.restoredCount).toBe(1);
    expect(outcome.failedPaths).toEqual([]);
    expect(await fs.pathExists(target)).toBe(false);
  });

  it("기존 파일은 롤백 시 원본 내용으로 복원된다 (append 시나리오)", async () => {
    const journal = new FileWriteJournal();
    const target = path.join(tmpRoot, "existing.properties");
    await fs.writeFile(target, "key=original", "utf-8");

    await journal.recordBeforeWrite(target);
    await fs.appendFile(target, "\nadded=value");
    expect(await fs.readFile(target, "utf-8")).toContain("added=value");

    const outcome = await journal.rollback();
    expect(outcome.restoredCount).toBe(1);
    expect(await fs.readFile(target, "utf-8")).toBe("key=original");
  });

  it("여러 항목을 기록하면 전부 복원된다", async () => {
    const journal = new FileWriteJournal();
    const created = path.join(tmpRoot, "a.txt");
    const modified = path.join(tmpRoot, "b.txt");
    await fs.writeFile(modified, "원본", "utf-8");

    await journal.recordBeforeWrite(created);
    await fs.writeFile(created, "신규", "utf-8");
    await journal.recordBeforeWrite(modified);
    await fs.writeFile(modified, "변경", "utf-8");

    const outcome = await journal.rollback();
    expect(outcome.restoredCount).toBe(2);
    expect(await fs.pathExists(created)).toBe(false);
    expect(await fs.readFile(modified, "utf-8")).toBe("원본");
  });
});

describe("formatRollbackNotice", () => {
  it("복원 성공 시 개수를 안내한다", () => {
    expect(formatRollbackNotice(tmpRoot, { restoredCount: 3, failedPaths: [] })).toContain(
      "3개 파일은 쓰기 전 상태로 원상 복구",
    );
  });

  it("기록이 없으면 프로젝트 미변경을 안내한다", () => {
    expect(formatRollbackNotice(tmpRoot, { restoredCount: 0, failedPaths: [] })).toContain(
      "프로젝트는 변경되지 않았습니다",
    );
  });

  it("복원 실패 파일은 상대 경로로만 노출한다", () => {
    const failedAbs = path.join(tmpRoot, "src/main/failed.txt");
    const notice = formatRollbackNotice(tmpRoot, { restoredCount: 1, failedPaths: [failedAbs] });
    expect(notice).toContain("src/main/failed.txt");
    expect(notice).not.toContain(tmpRoot);
  });
});

describe("withWriteRollback", () => {
  it("성공 시 apply 의 반환값을 그대로 돌려주고 아무것도 복원하지 않는다", async () => {
    const journal = new FileWriteJournal();
    const target = path.join(tmpRoot, "ok.txt");
    const result = await withWriteRollback(tmpRoot, journal, async () => {
      await journal.recordBeforeWrite(target);
      await fs.writeFile(target, "내용", "utf-8");
      return "done";
    });
    expect(result).toBe("done");
    expect(await fs.pathExists(target)).toBe(true);
  });

  it("실패 시 롤백을 수행하고 [조치 후 재시도 가능] 에러로 변환한다", async () => {
    const journal = new FileWriteJournal();
    const target = path.join(tmpRoot, "will-rollback.txt");
    await expect(
      withWriteRollback(tmpRoot, journal, async () => {
        await journal.recordBeforeWrite(target);
        await fs.writeFile(target, "내용", "utf-8");
        throw new Error(`EACCES: permission denied, open '${path.join(tmpRoot, "x")}'`);
      }),
    ).rejects.toThrow(new RegExp(RETRY_AFTER_ACTION_PREFIX.replace(/[[\]]/g, "\\$&")));
    expect(await fs.pathExists(target)).toBe(false);
  });

  it("에러 원인 문구의 프로젝트 절대 경로를 가린다", async () => {
    const journal = new FileWriteJournal();
    const err = await withWriteRollback(tmpRoot, journal, async () => {
      throw new Error(`EACCES: permission denied, open '${path.join(tmpRoot, "sub/file")}'`);
    }).catch((e: unknown) => e as Error);
    expect(err.message).not.toContain(path.resolve(tmpRoot));
    expect(err.message).toContain("<projectDir>");
  });
});

describe("egov_add_entity — 쓰기 중간 실패 롤백 (통합)", () => {
  const BOARD_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;
  const MEMBER_DDL = `CREATE TABLE MEMBER (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  EMAIL VARCHAR(100)
)`;

  let projectDir: string;
  let thymeleafDir: string;

  /** projectDir 하위 모든 파일의 상대 경로 집합 (디렉터리 제외). */
  async function listFiles(root: string): Promise<Set<string>> {
    const out = new Set<string>();
    async function visit(dir: string): Promise<void> {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await visit(full);
        else out.add(path.relative(root, full));
      }
    }
    await visit(root);
    return out;
  }

  beforeEach(async () => {
    // 의도적 에러 경로 테스트 — 도구 catch-all 의 console.error 서버 로깅만 잠재운다.
    vi.spyOn(console, "error").mockImplementation(() => {});
    await generateScaffoldProject({
      projectName: "board-app",
      packageName: "egovframework.example.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: BOARD_DDL,
      description: "",
      projectType: "boot",
      stackVersion: "5.1",
    });
    projectDir = path.join(tmpRoot, "board-app");
    thymeleafDir = path.join(projectDir, "src/main/resources/templates/thymeleaf");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // 읽기 전용으로 바꾼 디렉터리를 복구해 tmpRoot 정리가 실패하지 않게 한다.
    if (await fs.pathExists(thymeleafDir)) {
      await fs.chmod(thymeleafDir, 0o755);
    }
  });

  it("쓰기 도중 실패하면 이미 쓰인 파일이 전부 원상 복구되고, 원인 해결 후 재시도가 성공한다", async () => {
    const before = await listFiles(projectDir);

    // thymeleaf 산출물은 매니페스트 순서상 마지막이다 — 그 부모 디렉터리를 읽기 전용으로
    // 만들면 앞선 java/xml/migrations 파일이 쓰인 뒤 중간 실패가 발생한다.
    await fs.chmod(thymeleafDir, 0o555);

    await expect(
      egovAddEntity({
        projectPath: projectDir,
        packageName: "egovframework.example.member",
        entityName: "Member",
        ddl: MEMBER_DDL,
      }),
    ).rejects.toThrow(/원상 복구/);

    // 롤백 후 파일 집합이 호출 전과 동일해야 한다 (부분 산출물 잔존 없음).
    const after = await listFiles(projectDir);
    expect([...after].sort()).toEqual([...before].sort());

    // 원인(권한) 해결 후 같은 인자로 재시도하면 성공해야 한다 — 롤백이 깨끗했다는 증거.
    await fs.chmod(thymeleafDir, 0o755);
    const result = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
    });
    expect(result).toContain("추가 완료");
  });
});
