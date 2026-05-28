/**
 * AI 코딩 에이전트 스킬 emitter 동작 검증.
 *
 * 본문 SHA 가 아니라 "각 도구별 출력 shape" (경로/frontmatter 형식/헤딩 강등) 만 검증한다.
 * 본문 자체는 원본 마크다운이 그대로 흐르므로 원본을 수정해도 테스트가 깨지지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSkillFiles,
  emitDocFiles,
  emitSkillFiles,
  parseSkill,
} from "../../src/utils/scaffold/skillsEmitter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const SOURCE_DIR = path.join(REPO_ROOT, "templates/skills/original");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "egov-skills-"));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe("parseSkill", () => {
  it("name/description 을 추출하고 본문은 frontmatter 가 제거된 상태로 반환한다", () => {
    const raw = `---
name: my-skill
description: short desc
---

# Body Heading

Some content.`;
    const parsed = parseSkill(raw);
    expect(parsed.name).toBe("my-skill");
    expect(parsed.description).toBe("short desc");
    expect(parsed.body).toMatch(/^\n# Body Heading/);
  });

  it("frontmatter 가 없으면 throw", () => {
    expect(() => parseSkill("no frontmatter here")).toThrow(/frontmatter/);
  });

  it("name 또는 description 누락 시 throw", () => {
    expect(() => parseSkill("---\nname: x\n---\n")).toThrow(/name\/description/);
  });
});

describe("buildSkillFiles — 원본 3개 스킬에 대한 출력", () => {
  it("원본 폴더가 없으면 빈 배열 반환 (호환 안전)", async () => {
    const out = await buildSkillFiles(path.join(tmpDir, "missing"));
    expect(out).toEqual([]);
  });

  it("3 스킬 × 5 도구 = 15 산출물", async () => {
    const files = await buildSkillFiles(SOURCE_DIR);
    expect(files).toHaveLength(15);
  });

  it("Claude Code: .claude/skills/<name>/SKILL.md 에 원본 frontmatter 가 보존된다", async () => {
    const files = await buildSkillFiles(SOURCE_DIR);
    const claude = files.filter((f) => f.relPath.startsWith(".claude/"));
    expect(claude).toHaveLength(3);
    for (const f of claude) {
      expect(f.relPath).toMatch(
        /^\.claude\/skills\/[a-z0-9-]+\/SKILL\.md$/,
      );
      expect(f.content).toMatch(/^---\nname: /);
      expect(f.content).toMatch(/\ndescription: /);
    }
  });

  it("Cursor: .cursor/skills/<name>/SKILL.md + frontmatter 보존 (Claude 와 동일 포맷)", async () => {
    const files = await buildSkillFiles(SOURCE_DIR);
    const cursor = files.filter((f) => f.relPath.startsWith(".cursor/"));
    expect(cursor).toHaveLength(3);
    for (const f of cursor) {
      expect(f.relPath).toMatch(
        /^\.cursor\/skills\/[a-z0-9-]+\/SKILL\.md$/,
      );
      // Cursor Skills 는 frontmatter 필수 — name 은 디렉터리명과 일치해야 한다.
      expect(f.content).toMatch(/^---\nname: egovframe-/);
      expect(f.content).toMatch(/\ndescription: /);
      const dirName = f.relPath.split("/")[2];
      expect(f.content).toMatch(new RegExp(`^---\\nname: ${dirName}\\n`));
    }
  });

  it("Cline: .cline/skills/<name>/SKILL.md + frontmatter 보존 (Claude 와 동일 포맷)", async () => {
    const files = await buildSkillFiles(SOURCE_DIR);
    const cline = files.filter((f) => f.relPath.startsWith(".cline/"));
    expect(cline).toHaveLength(3);
    for (const f of cline) {
      expect(f.relPath).toMatch(
        /^\.cline\/skills\/[a-z0-9-]+\/SKILL\.md$/,
      );
      // Cline Skills 는 frontmatter 필수 — name 은 디렉터리명과 일치해야 한다.
      expect(f.content).toMatch(/^---\nname: egovframe-/);
      expect(f.content).toMatch(/\ndescription: /);
      // 디렉터리명과 frontmatter `name:` 값이 정확히 일치
      const dirName = f.relPath.split("/")[2];
      expect(f.content).toMatch(new RegExp(`^---\\nname: ${dirName}\\n`));
    }
  });

  it("Continue: .continue/rules/<name>.md + name/description/alwaysApply frontmatter", async () => {
    const files = await buildSkillFiles(SOURCE_DIR);
    const cont = files.filter((f) => f.relPath.startsWith(".continue/"));
    expect(cont).toHaveLength(3);
    for (const f of cont) {
      expect(f.relPath).toMatch(/^\.continue\/rules\/[a-z0-9-]+\.md$/);
      expect(f.content).toMatch(/^---\nname: egovframe-/);
      expect(f.content).toMatch(/\ndescription: /);
      expect(f.content).toMatch(/\nalwaysApply: false\n---/);
    }
  });

  it("OpenCode: .opencode/skills/<name>/SKILL.md + frontmatter 보존 (Claude 와 동일 포맷)", async () => {
    const files = await buildSkillFiles(SOURCE_DIR);
    const opencode = files.filter((f) => f.relPath.startsWith(".opencode/"));
    expect(opencode).toHaveLength(3);
    for (const f of opencode) {
      expect(f.relPath).toMatch(
        /^\.opencode\/skills\/[a-z0-9-]+\/SKILL\.md$/,
      );
      // OpenCode Skills 는 frontmatter 필수 — name 은 디렉터리명과 일치해야 한다.
      expect(f.content).toMatch(/^---\nname: egovframe-/);
      expect(f.content).toMatch(/\ndescription: /);
      const dirName = f.relPath.split("/")[2];
      expect(f.content).toMatch(new RegExp(`^---\\nname: ${dirName}\\n`));
    }
  });
});

describe("emitSkillFiles — 실제 디스크 쓰기", () => {
  it("프로젝트 디렉터리에 5 도구 폴더 구조가 모두 생긴다", async () => {
    await emitSkillFiles(SOURCE_DIR, tmpDir);

    expect(
      await fs.pathExists(
        path.join(tmpDir, ".claude/skills/egovframe-conventions/SKILL.md"),
      ),
    ).toBe(true);
    expect(
      await fs.pathExists(
        path.join(tmpDir, ".cursor/skills/egovframe-conventions/SKILL.md"),
      ),
    ).toBe(true);
    expect(
      await fs.pathExists(
        path.join(tmpDir, ".cline/skills/egovframe-conventions/SKILL.md"),
      ),
    ).toBe(true);
    expect(
      await fs.pathExists(
        path.join(tmpDir, ".continue/rules/egovframe-conventions.md"),
      ),
    ).toBe(true);
    expect(
      await fs.pathExists(
        path.join(tmpDir, ".opencode/skills/egovframe-conventions/SKILL.md"),
      ),
    ).toBe(true);
  });

  it("원본 폴더가 없으면 아무 파일도 쓰지 않고 빈 배열 반환", async () => {
    const written = await emitSkillFiles(
      path.join(tmpDir, "no-source"),
      tmpDir,
    );
    expect(written).toEqual([]);
    // 도구별 폴더가 만들어지지 않아야 한다
    expect(await fs.pathExists(path.join(tmpDir, ".claude"))).toBe(false);
    expect(await fs.pathExists(path.join(tmpDir, ".cursor"))).toBe(false);
    expect(await fs.pathExists(path.join(tmpDir, ".cline"))).toBe(false);
  });
});

describe("emitDocFiles — 사람-친화 레퍼런스 1:1 복사", () => {
  const DOCS_SOURCE_DIR = path.join(REPO_ROOT, "templates/docs");

  it("templates/docs/*.md 를 프로젝트의 docs/ 로 그대로 복사한다", async () => {
    const written = await emitDocFiles(DOCS_SOURCE_DIR, tmpDir);
    expect(written.length).toBeGreaterThan(0);
    expect(written).toContain("docs/egovframe-architecture.md");

    const abs = path.join(tmpDir, "docs/egovframe-architecture.md");
    expect(await fs.pathExists(abs)).toBe(true);
    const content = await fs.readFile(abs, "utf-8");
    // 본문 한 줄(헤더) 가 그대로 복사되는지 sanity check
    expect(content).toMatch(/^# eGovFrame Architecture Patterns/);
    // frontmatter 가 없어야 한다 (사람용 reference 문서이므로)
    expect(content).not.toMatch(/^---\n/);
  });

  it("원본 폴더가 없으면 빈 배열 반환 + docs/ 디렉터리 생성하지 않음", async () => {
    const written = await emitDocFiles(path.join(tmpDir, "no-docs"), tmpDir);
    expect(written).toEqual([]);
    expect(await fs.pathExists(path.join(tmpDir, "docs"))).toBe(false);
  });
});
