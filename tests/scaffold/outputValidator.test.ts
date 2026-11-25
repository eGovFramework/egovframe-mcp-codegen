/**
 * outputValidator 단위 테스트
 *
 * - checkPlaceholderResidue: Handlebars 잔존 토큰 검출/정상 통과 (오탐 없는 경계 포함)
 * - checkXmlStructure: XML 태그 균형 검사 기본 케이스
 * - validateRenderedFiles: tests/scaffold/__golden__ 3개 시나리오(boot50/boot43/war)의
 *   실제 매니페스트 렌더 결과 *전체*에 대해 오탐이 0건이어야 한다 — 생성기가 정상일 때
 *   자체 검증이 정상 산출물을 거부해 재시도 루프를 유발하면 안 되기 때문이다.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as path from "node:path";
import Handlebars from "handlebars";

import {
  checkPlaceholderResidue,
  checkXmlStructure,
  validateRenderedFiles,
} from "../../src/utils/scaffold/outputValidator.js";
import {
  buildContext,
  getScaffoldTemplatePath,
  registerScaffoldHelpers,
  type ScaffoldParams,
} from "../../src/utils/scaffold/scaffoldGenerator.js";
import { resolveManifest } from "../../src/utils/scaffold/manifestLoader.js";

describe("checkPlaceholderResidue", () => {
  it("잔존 Handlebars 토큰을 파일:라인 형식으로 검출한다", () => {
    const issues = checkPlaceholderResidue([
      {
        relPath: "src/main/java/Foo.java",
        content: "public class Foo {\n  private String {{fieldName}};\n}",
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/Foo\.java:2/);
    expect(issues[0]).toMatch(/\{\{fieldName\}\}/);
  });

  it("완전히 렌더링된(플레이스홀더 없는) 파일은 통과한다", () => {
    const issues = checkPlaceholderResidue([
      {
        relPath: "src/main/java/Board.java",
        content: "public class Board {\n  private String title;\n}",
      },
    ]);
    expect(issues).toEqual([]);
  });

  it("섹션(#if/#each)·역슬래시(/)·파샬(>)·주석(!) 형태의 잔존도 감지한다", () => {
    const issues = checkPlaceholderResidue([
      { relPath: "a.html", content: "{{#if x}}" },
      { relPath: "b.html", content: "{{/if}}" },
      { relPath: "c.html", content: "{{> partial}}" },
      { relPath: "d.html", content: "{{! comment}}" },
      { relPath: "e.html", content: "{{{unescaped}}}" },
      { relPath: "f.html", content: "{{@index}}" },
      { relPath: "g.html", content: "{{this.foo}}" },
    ]);
    // 파일 7개 각각에서 1건씩 검출되어야 한다.
    expect(issues).toHaveLength(7);
  });

  it("단일 중괄호(JSON 스니펫)는 오탐하지 않는다", () => {
    const issues = checkPlaceholderResidue([
      { relPath: "config.json", content: '{"key": "value"}' },
    ]);
    expect(issues).toEqual([]);
  });

  it("빈 이중 중괄호({{}})는 오탐하지 않는다", () => {
    const issues = checkPlaceholderResidue([{ relPath: "empty.txt", content: "{{}}" }]);
    expect(issues).toEqual([]);
  });

  it("CSS 블록(단일 중괄호)은 오탐하지 않는다", () => {
    const issues = checkPlaceholderResidue([
      { relPath: "style.css", content: ".title { color: red; }" },
    ]);
    expect(issues).toEqual([]);
  });
});

describe("checkXmlStructure", () => {
  it("균형 잡힌 XML은 통과한다", () => {
    const issues = checkXmlStructure(
      "a.xml",
      `<?xml version="1.0"?>\n<root>\n  <child attr="1">text</child>\n</root>`,
    );
    expect(issues).toEqual([]);
  });

  it("자기닫힘 태그는 스택에 남기지 않는다", () => {
    const issues = checkXmlStructure("a.xml", `<root>\n  <child/>\n  <child2 />\n</root>`);
    expect(issues).toEqual([]);
  });

  it("주석/CDATA 안의 가짜 태그는 무시한다", () => {
    const issues = checkXmlStructure(
      "a.xml",
      `<root>\n  <!-- <fake> -->\n  <![CDATA[<also-fake>]]>\n</root>`,
    );
    expect(issues).toEqual([]);
  });

  it("파일 끝까지 닫히지 않은 태그를 검출한다", () => {
    const issues = checkXmlStructure("a.xml", `<root>\n  <child>text\n`);
    const joined = issues.join("\n");
    expect(joined).toMatch(/닫히지 않은 태그: <root>/);
    expect(joined).toMatch(/닫히지 않은 태그: <child>/);
  });

  it("대응하는 여는 태그 없이 닫는 태그가 나오면 검출한다", () => {
    const issues = checkXmlStructure("a.xml", `<root>\n  </child>\n</root>`);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("\n")).toMatch(/대응하는 여는 태그 없이 <\/child>/);
  });
});

/**
 * scaffoldGenerator.ts 내부의 매니페스트 렌더링 루프(getFileManifest → Handlebars 컴파일)를
 * 공개 API 만으로 재현해, 실제 디스크에 쓰지 않고 렌더 결과만 메모리에서 수집한다.
 * scaffoldGenerator 가 파일을 쓰기 전에 넘기는 `renderedManifestFiles` 와 동일한 범위(scope 필터
 * 없음 = 해당 stack 의 전체 매니페스트)를 재현한다.
 */
function renderManifestFilesInMemory(
  params: ScaffoldParams,
): { relPath: string; content: string }[] {
  registerScaffoldHelpers();
  const ctx = buildContext(params);
  const templateBasePath = getScaffoldTemplatePath();
  const manifest = resolveManifest(ctx.stack.manifest, ctx as unknown as Record<string, unknown>);

  const files: { relPath: string; content: string }[] = [];
  for (const mapping of manifest) {
    const templatePath = path.join(templateBasePath, mapping.template);
    if (!fs.pathExistsSync(templatePath)) continue; // 템플릿 누락은 별도 관심사 — golden.test.ts 가 커버
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    const compiled = Handlebars.compile(templateContent);
    const renderCtx = mapping.dialect ? { ...ctx, dialect: mapping.dialect } : ctx;
    files.push({ relPath: mapping.output, content: compiled(renderCtx) });
  }
  return files;
}

const GOLDEN_SHARED_DDL = `CREATE TABLE board (
  board_id VARCHAR(36) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  author VARCHAR(50),
  created_at TIMESTAMP,
  PRIMARY KEY (board_id)
)`;

const GOLDEN_SCENARIOS: {
  name: string;
  projectType: "boot" | "war";
  stackVersion: "4.3" | "5.1";
}[] = [
  { name: "boot50", projectType: "boot", stackVersion: "5.1" },
  { name: "boot43", projectType: "boot", stackVersion: "4.3" },
  { name: "war", projectType: "war", stackVersion: "4.3" },
];

describe("validateRenderedFiles — golden 시나리오 전체 산출물 오탐 0 검증", () => {
  for (const scenario of GOLDEN_SCENARIOS) {
    it(`${scenario.name} 시나리오의 전체 매니페스트 렌더 결과에 검증 위반이 없다`, () => {
      const files = renderManifestFilesInMemory({
        projectName: "golden-test",
        packageName: "egovframework.example.board",
        outputPath: "/unused",
        entityName: "Board",
        ddl: GOLDEN_SHARED_DDL,
        description: "golden",
        projectType: scenario.projectType,
        stackVersion: scenario.stackVersion,
      });

      // 최소한의 신뢰도 확보 — 매니페스트가 비어 있는 채로 "0 오탐"을 주장하지 않도록.
      expect(files.length).toBeGreaterThan(10);

      const issues = validateRenderedFiles(files);
      expect(issues).toEqual([]);
    });
  }
});
