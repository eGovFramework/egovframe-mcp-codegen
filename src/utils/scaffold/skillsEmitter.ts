/**
 * AI 코딩 에이전트 스킬 emitter
 *
 * 단일 정본(`templates/skills/original/*.md`)을 도구별 포맷으로 변환해 scaffold 산출물에 함께 내보낸다.
 * 본문은 5 도구가 동일하게 사용하고 frontmatter / 파일 위치만 바뀐다 — 따라서 한 곳에서 본문을
 * 수정하면 5 도구 변형이 자동 동기화된다.
 *
 * 지원 도구
 * ---------
 * - **Claude Code**: `.claude/skills/<name>/SKILL.md`
 *     원본 frontmatter (`name`, `description`) 를 그대로 보존.
 * - **Cursor**: `.cursor/skills/<name>/SKILL.md`
 *     Cursor 도 Skills 를 1급 기능으로 지원 (Rules `.cursor/rules/*.mdc` 와는 별개). Claude Code /
 *     OpenCode / Cline 과 동일한 폴더 + SKILL.md + YAML frontmatter 포맷. description 매칭으로
 *     자동 발동 또는 `/<name>` 슬래시 명령으로 명시 호출.
 * - **OpenCode (sst)**: `.opencode/skills/<name>/SKILL.md`
 *     OpenCode 는 Skills 를 1급 기능으로 지원하며 Claude Code 와 동일한 폴더·frontmatter 포맷이다.
 *     (OpenCode 는 fallback 으로 `.claude/skills/`, `.agents/skills/` 도 읽지만, 명시성을 위해
 *     canonical path 인 `.opencode/skills/` 로 emit 한다. 발동 방식은 description 매칭 후
 *     에이전트가 `skill` 도구로 explicit invoke.)
 * - **Cline**: `.cline/skills/<name>/SKILL.md`
 *     Cline 은 두 종류의 커스터마이즈를 제공한다:
 *       - `.clinerules/*.md` (Rules) — frontmatter 선택, 항상-ON / `paths:` 조건부. 코딩 표준용.
 *       - `.cline/skills/<name>/SKILL.md` (Skills) — frontmatter 필수, description 매칭으로
 *         auto-trigger. Claude Code Skills 와 동일 포맷.
 *     본 가이드들은 frontmatter 가 description 매칭 trigger 로 쓰여있고 분량이 커서 (88KB+)
 *     always-on Rules 보다는 on-demand Skills 가 맞다. → 후자로 emit.
 * - **Continue**: `.continue/rules/<name>.md`
 *     Continue 룰 frontmatter (`name`, `description`, `alwaysApply: false`).
 *
 * 가정 (틀리면 한 줄 수정으로 교정 가능)
 * --------
 * - 원본 파일들은 frontmatter 가 `---` 한 쌍으로 감싸여 있고 키는 `name`/`description` 2개.
 *   복수 값/배열/중첩 객체는 사용하지 않는다 — 따라서 정식 YAML 파서 의존성 없이 라인 단위 파싱.
 * - 모든 도구는 본문 마크다운을 그대로 인식한다고 가정.
 */

import * as path from "node:path";
import fs from "fs-extra";

/** 지원 도구 목록. 추가/제거 시 `TOOL_EMITTERS` 와 동기화. */
export const SUPPORTED_AI_TOOLS = [
  "claude",
  "cursor",
  "opencode",
  "cline",
  "continue",
] as const;
export type AITool = (typeof SUPPORTED_AI_TOOLS)[number];

interface ParsedSkill {
  /** frontmatter 의 `name` (slug) */
  name: string;
  /** frontmatter 의 `description` */
  description: string;
  /** frontmatter 를 제거한 본문 마크다운 */
  body: string;
}

interface EmittedFile {
  /** 프로젝트 루트 기준 상대경로 */
  relPath: string;
  content: string;
}

/**
 * 원본 스킬 파일을 읽어 frontmatter 와 본문을 분리한다.
 *
 * 파서는 매우 좁다 — 첫 줄이 `---` 로 시작하고 두 번째 `---` 까지의 라인을 frontmatter 로 본다.
 * 키는 `key: value` 한 줄짜리만 지원. 본문에 `\n` 만 사용되도록 정규화한다.
 */
export function parseSkill(raw: string): ParsedSkill {
  const normalized = raw.replace(/\r\n/g, "\n");
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error(
      "스킬 파일에 frontmatter 가 없습니다. '---' 로 둘러싼 name/description 블록이 필요합니다.",
    );
  }
  const fmBlock = fmMatch[1];
  const body = fmMatch[2];

  const fm: Record<string, string> = {};
  for (const line of fmBlock.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  const name = fm.name;
  const description = fm.description;
  if (!name || !description) {
    throw new Error(
      `스킬 frontmatter 에 name/description 이 모두 필요합니다 (현재 name=${JSON.stringify(name)}, description=${JSON.stringify(description)}).`,
    );
  }
  return { name, description, body };
}

/**
 * frontmatter description 을 안전하게 직렬화. 콜론/`#`/줄바꿈이 있으면 따옴표 인용.
 * 우리 원본에는 줄바꿈이 없지만 향후 안전 차원에서 처리한다.
 */
function quoteYamlIfNeeded(value: string): string {
  const needsQuote = /[:#\n"]|^[!&*?|<>%@`]/.test(value);
  if (!needsQuote) return value;
  // 큰따옴표로 감싸고 내부 큰따옴표/백슬래시를 이스케이프
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-tool emitters
// ─────────────────────────────────────────────────────────────────────────────

function emitClaude(skill: ParsedSkill): EmittedFile {
  // 원본 frontmatter 형식을 그대로 재구성. 본문은 손대지 않음.
  const fm = [
    "---",
    `name: ${skill.name}`,
    `description: ${quoteYamlIfNeeded(skill.description)}`,
    "---",
    "",
  ].join("\n");
  return {
    relPath: `.claude/skills/${skill.name}/SKILL.md`,
    content: fm + skill.body,
  };
}

function emitCursor(skill: ParsedSkill): EmittedFile {
  // Cursor Skills 는 Claude Code Skills 와 동일한 포맷(폴더 + SKILL.md + YAML frontmatter).
  // 경로 prefix 만 `.cursor/skills/` 로 다르다. (Rules `.cursor/rules/*.mdc` 와는 별개 기능.)
  const fm = [
    "---",
    `name: ${skill.name}`,
    `description: ${quoteYamlIfNeeded(skill.description)}`,
    "---",
    "",
  ].join("\n");
  return {
    relPath: `.cursor/skills/${skill.name}/SKILL.md`,
    content: fm + skill.body,
  };
}

function emitCline(skill: ParsedSkill): EmittedFile {
  // Cline Skills 는 Claude Code Skills 와 동일한 포맷(폴더 + SKILL.md + YAML frontmatter).
  // 경로 prefix `.cline/` 만 다르고 `name: ` 은 디렉터리명과 정확히 일치해야 한다.
  const fm = [
    "---",
    `name: ${skill.name}`,
    `description: ${quoteYamlIfNeeded(skill.description)}`,
    "---",
    "",
  ].join("\n");
  return {
    relPath: `.cline/skills/${skill.name}/SKILL.md`,
    content: fm + skill.body,
  };
}

function emitContinue(skill: ParsedSkill): EmittedFile {
  // Continue 룰: 명시적 name + description + alwaysApply
  const fm = [
    "---",
    `name: ${skill.name}`,
    `description: ${quoteYamlIfNeeded(skill.description)}`,
    "alwaysApply: false",
    "---",
    "",
  ].join("\n");
  return {
    relPath: `.continue/rules/${skill.name}.md`,
    content: fm + skill.body,
  };
}

function emitOpenCode(skill: ParsedSkill): EmittedFile {
  // OpenCode Skills 는 Claude Code Skills 와 동일한 포맷(폴더 + SKILL.md + YAML frontmatter).
  // 경로 prefix 만 `.opencode/skills/` 로 다르다.
  const fm = [
    "---",
    `name: ${skill.name}`,
    `description: ${quoteYamlIfNeeded(skill.description)}`,
    "---",
    "",
  ].join("\n");
  return {
    relPath: `.opencode/skills/${skill.name}/SKILL.md`,
    content: fm + skill.body,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `templates/skills/original/*.md` 를 읽어 각 도구별 산출물을 생성한다.
 *
 * @param sourceDir templates/skills/original 절대 경로
 * @returns 각 산출물의 `{ relPath, content }` 배열. 도구별로 그룹화된 순서.
 */
export async function buildSkillFiles(sourceDir: string): Promise<EmittedFile[]> {
  if (!(await fs.pathExists(sourceDir))) return [];
  const entries = await fs.readdir(sourceDir);
  const mdFiles = entries.filter((f) => f.toLowerCase().endsWith(".md"));
  if (mdFiles.length === 0) return [];

  const skills: ParsedSkill[] = [];
  for (const file of mdFiles.sort()) {
    const raw = await fs.readFile(path.join(sourceDir, file), "utf-8");
    skills.push(parseSkill(raw));
  }

  const out: EmittedFile[] = [];
  for (const skill of skills) {
    out.push(emitClaude(skill));
    out.push(emitCursor(skill));
    out.push(emitOpenCode(skill));
    out.push(emitCline(skill));
    out.push(emitContinue(skill));
  }
  return out;
}

/**
 * 스킬 emitter 의 진입점 — 변환 결과를 프로젝트 디렉터리에 실제로 쓴다.
 *
 * @param sourceDir templates/skills/original 절대 경로
 * @param projectDir 산출물이 쓰여질 프로젝트 디렉터리 절대 경로
 * @returns 쓰여진 파일들의 프로젝트 상대경로 배열
 */
export async function emitSkillFiles(
  sourceDir: string,
  projectDir: string,
): Promise<string[]> {
  const files = await buildSkillFiles(sourceDir);
  const written: string[] = [];
  for (const f of files) {
    const abs = path.join(projectDir, f.relPath);
    await fs.ensureDir(path.dirname(abs));
    await fs.writeFile(abs, f.content, "utf-8");
    written.push(f.relPath);
  }
  return written;
}

/**
 * 사람-친화 레퍼런스 문서를 스캐폴드 산출물의 `docs/` 폴더에 그대로 복사한다.
 *
 * 스킬과 달리 변환·frontmatter 조작이 없다 — 단순 1:1 복사. AI 에이전트가 description-trigger 로
 * 끌어가는 대상이 아니라 개발자가 직접 읽는 온보딩 자료이므로, frontmatter 가 있으면 markdown
 * 렌더러에서 깨질 수 있어 본 emitter 는 frontmatter 가 없는 마크다운만 전제로 한다.
 *
 * @param sourceDir templates/docs 절대 경로
 * @param projectDir 산출물이 쓰여질 프로젝트 디렉터리 절대 경로
 * @returns 쓰여진 파일들의 프로젝트 상대경로 배열 (예: `docs/egovframe-architecture.md`)
 */
export async function emitDocFiles(
  sourceDir: string,
  projectDir: string,
): Promise<string[]> {
  if (!(await fs.pathExists(sourceDir))) return [];
  const entries = await fs.readdir(sourceDir);
  const mdFiles = entries.filter((f) => f.toLowerCase().endsWith(".md")).sort();
  if (mdFiles.length === 0) return [];

  const written: string[] = [];
  for (const file of mdFiles) {
    const src = path.join(sourceDir, file);
    const relPath = `docs/${file}`;
    const abs = path.join(projectDir, relPath);
    await fs.ensureDir(path.dirname(abs));
    await fs.copyFile(src, abs);
    written.push(relPath);
  }
  return written;
}
