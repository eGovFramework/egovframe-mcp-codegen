/**
 * Unit tests for `src/utils/scaffold/manifestLoader.ts`
 *
 * 매니페스트 로더가 다음을 보장하는지 검증한다:
 *   - templates/manifests/*.json 을 그대로 읽고 항목 수가 코드와 일치
 *   - 실제 stack 의 ScaffoldContext 와 같은 변수로 output 이 정확히 렌더링됨
 *   - 잘못된 매니페스트는 명확한 오류로 거부
 *   - 캐싱과 환경변수 오버라이드가 stackMatrix 와 동일한 패턴으로 동작
 *
 * 캐시는 모듈 전역이므로 각 테스트 전에 `clearManifestCache()` 로 초기화한다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  clearManifestCache,
  loadManifest,
  resolveManifest,
  resolveManifestPath,
} from "../../src/utils/scaffold/manifestLoader.js";

const SAMPLE_CONTEXT = {
  basePackagePath: "egovframework/example/sample",
  packagePath: "egovframework/example/sample/board",
  entityModule: "board",
  entityName: "Board",
  entityNameLower: "board",
};

describe("manifestLoader — 표준 매니페스트 로드", () => {
  beforeEach(() => clearManifestCache());

  it.each([
    ["manifests/boot43.json", "boot43", 39],
    ["manifests/boot50.json", "boot50", 43],
    ["manifests/war43.json", "war43", 41],
  ])(
    "%s 의 name=%s, files=%i 를 그대로 읽는다",
    (manifestPath, name, count) => {
      const m = loadManifest(manifestPath);
      expect(m.name).toBe(name);
      expect(m.files).toHaveLength(count);
      // 모든 항목이 template/output 두 문자열을 가진다.
      for (const f of m.files) {
        expect(typeof f.template).toBe("string");
        expect(f.template.length).toBeGreaterThan(0);
        expect(typeof f.output).toBe("string");
        expect(f.output.length).toBeGreaterThan(0);
      }
    },
  );

  it("동일 경로를 두 번 호출하면 같은 객체 인스턴스를 돌려준다 (캐시)", () => {
    const a = loadManifest("manifests/boot50.json");
    const b = loadManifest("manifests/boot50.json");
    expect(a).toBe(b);
  });
});

describe("manifestLoader — output 렌더링", () => {
  beforeEach(() => clearManifestCache());

  it("Handlebars 변수가 없는 경로는 그대로 통과", () => {
    const out = resolveManifest("manifests/boot43.json", SAMPLE_CONTEXT);
    const pom = out.find((e) => e.template === "boot/pom.xml.hbs");
    expect(pom?.output).toBe("pom.xml");
  });

  it("basePackagePath/entityName 등 컨텍스트 변수를 정확히 치환한다", () => {
    const out = resolveManifest("manifests/boot43.json", SAMPLE_CONTEXT);
    const excep = out.find(
      (e) => e.template === "boot/java/exception/EgovExcepHndlr.hbs",
    );
    expect(excep?.output).toBe(
      "src/main/java/egovframework/example/sample/exception/EgovBoardExcepHndlr.java",
    );

    const mapper = out.find((e) => e.template === "boot/java/mapper/EntityMapper.hbs");
    expect(mapper?.output).toBe(
      "src/main/java/egovframework/example/sample/board/service/impl/BoardMapper.java",
    );

    const sql = out.find((e) => e.template === "boot/resources/mapper-sql.xml.hbs");
    expect(sql?.output).toBe(
      "src/main/resources/egovframework/sqlmap/board/mappers/EgovBoard_Board_SQL.xml",
    );

    const samplesql = out.find((e) => e.template === "boot/resources/sampledb.sql.hbs");
    expect(samplesql?.output).toBe("src/main/resources/db/boarddb.sql");
  });

  it("WAR 매니페스트의 JSP 경로도 동일한 변수로 정확히 렌더링된다", () => {
    const out = resolveManifest("manifests/war43.json", SAMPLE_CONTEXT);
    const list = out.find(
      (e) => e.template === "war/webapp/jsp/entity/egovEntityList.jsp.hbs",
    );
    expect(list?.output).toBe(
      "src/main/webapp/WEB-INF/jsp/egovframework/example/sample/board/egovBoardList.jsp",
    );
  });

  it("Boot 5.1 thymeleaf 경로는 entityModule 디렉터리를 포함한다", () => {
    const out = resolveManifest("manifests/boot50.json", SAMPLE_CONTEXT);
    const thList = out.find(
      (e) => e.template === "boot50/thymeleaf/entityList.html.hbs",
    );
    expect(thList?.output).toBe(
      "src/main/resources/templates/thymeleaf/board/egovBoardList.html",
    );
  });

  it("HTML escape 가 일어나지 않는다 (noEscape: true)", () => {
    // entityName 에 안전하지 않은 문자가 들어와도 (실전에선 zod 가 막지만)
    // path 에서 &amp; 등으로 escape 되면 파일 시스템 경로가 깨진다.
    const ctx = { ...SAMPLE_CONTEXT, entityName: "A&B" };
    const out = resolveManifest("manifests/boot43.json", ctx);
    const excep = out.find(
      (e) => e.template === "boot/java/exception/EgovExcepHndlr.hbs",
    );
    expect(excep?.output).toContain("EgovA&BExcepHndlr.java");
    expect(excep?.output).not.toContain("&amp;");
  });
});

describe("manifestLoader — 경로 해석 / 환경변수 오버라이드", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    clearManifestCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "egov-manifest-"));
    originalEnv = process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH;
    } else {
      process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH = originalEnv;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    clearManifestCache();
  });

  it("절대경로가 들어오면 그대로 사용한다", () => {
    const abs = path.join(tmpDir, "manifests", "x.json");
    expect(resolveManifestPath(abs)).toBe(abs);
  });

  it("EGOVFRAME_SCAFFOLD_TEMPLATE_PATH 가 설정되면 그 디렉터리를 기준으로 해석한다", () => {
    process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH = tmpDir;
    expect(resolveManifestPath("manifests/x.json")).toBe(
      path.join(tmpDir, "manifests", "x.json"),
    );
  });

  it("환경변수 오버라이드를 통해 외부 매니페스트를 로드할 수 있다", () => {
    process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH = tmpDir;
    const manifestDir = path.join(tmpDir, "manifests");
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(
      path.join(manifestDir, "tiny.json"),
      JSON.stringify({
        name: "tiny",
        files: [
          { template: "x.hbs", output: "out/{{entityName}}.txt" },
        ],
      }),
    );
    const out = resolveManifest("manifests/tiny.json", SAMPLE_CONTEXT);
    expect(out).toEqual([
      { template: "x.hbs", output: "out/Board.txt", scope: "framework", mode: "create" },
    ]);
  });
});

describe("manifestLoader — scope 분류 / 필터", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    clearManifestCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "egov-manifest-scope-"));
    originalEnv = process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH;
    process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH = tmpDir;
    fs.mkdirSync(path.join(tmpDir, "manifests"), { recursive: true });
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH;
    } else {
      process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH = originalEnv;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    clearManifestCache();
  });

  it("scope 미지정 항목은 'framework' 로 정규화된다", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/mixed.json"),
      JSON.stringify({
        name: "mixed",
        files: [
          { template: "f.hbs", output: "framework.txt" },
          { template: "e.hbs", output: "{{entityName}}.txt", scope: "entity" },
        ],
      }),
    );
    const out = resolveManifest("manifests/mixed.json", SAMPLE_CONTEXT);
    expect(out).toEqual([
      { template: "f.hbs", output: "framework.txt", scope: "framework", mode: "create" },
      { template: "e.hbs", output: "Board.txt", scope: "entity", mode: "create" },
    ]);
  });

  it("scopeFilter='entity' 는 엔티티 항목만 반환한다", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/mixed.json"),
      JSON.stringify({
        name: "mixed",
        files: [
          { template: "f.hbs", output: "framework.txt" },
          { template: "e.hbs", output: "{{entityName}}.txt", scope: "entity" },
        ],
      }),
    );
    const out = resolveManifest("manifests/mixed.json", SAMPLE_CONTEXT, "entity");
    expect(out).toHaveLength(1);
    expect(out[0].scope).toBe("entity");
    expect(out[0].output).toBe("Board.txt");
  });

  it("expandDialects=true 항목은 7개 방언으로 fan-out 된다", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/dialects.json"),
      JSON.stringify({
        name: "dialects",
        files: [
          {
            template: "mig.hbs",
            output: "db/migrations/{{dialect}}/{{entityName}}.sql",
            scope: "entity",
            expandDialects: true,
          },
        ],
      }),
    );
    const out = resolveManifest(
      "manifests/dialects.json",
      SAMPLE_CONTEXT,
      "entity",
    );
    expect(out).toHaveLength(7);
    const dialects = out.map((e) => e.dialect);
    expect(dialects).toEqual([
      "oracle",
      "tibero",
      "altibase",
      "cubrid",
      "goldilocks",
      "mysql",
      "postgres",
    ]);
    // 각 출력 경로에 방언명이 반영됨
    expect(out[0].output).toBe("db/migrations/oracle/Board.sql");
    expect(out[5].output).toBe("db/migrations/mysql/Board.sql");
    // 모두 같은 템플릿을 가리킨다
    for (const e of out) expect(e.template).toBe("mig.hbs");
  });

  it("expandDialects 가 boolean 이 아니면 검증 오류", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/bad.json"),
      JSON.stringify({
        name: "bad",
        files: [
          {
            template: "x.hbs",
            output: "x.sql",
            expandDialects: "yes",
          },
        ],
      }),
    );
    expect(() =>
      resolveManifest("manifests/bad.json", SAMPLE_CONTEXT),
    ).toThrow(/expandDialects 는 boolean/);
  });

  it("scopeFilter='framework' 는 미지정 + framework 항목을 모두 반환한다", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/mixed.json"),
      JSON.stringify({
        name: "mixed",
        files: [
          { template: "a.hbs", output: "a.txt" },
          { template: "b.hbs", output: "b.txt", scope: "framework" },
          { template: "c.hbs", output: "c.txt", scope: "entity" },
        ],
      }),
    );
    const out = resolveManifest("manifests/mixed.json", SAMPLE_CONTEXT, "framework");
    expect(out.map((e) => e.template).sort()).toEqual(["a.hbs", "b.hbs"]);
  });

  it("mode 미지정 항목은 'create' 로 정규화된다", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/modes.json"),
      JSON.stringify({
        name: "modes",
        files: [{ template: "x.hbs", output: "x.txt" }],
      }),
    );
    const out = resolveManifest("manifests/modes.json", SAMPLE_CONTEXT);
    expect(out[0].mode).toBe("create");
  });

  it("mode='append-idempotent' 항목은 appendTarget 과 함께 resolve 된다", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/modes.json"),
      JSON.stringify({
        name: "modes",
        files: [
          {
            template: "props.hbs",
            output: "application.properties",
            mode: "append-idempotent",
            appendTarget: { glob: "src/main/resources/application.properties" },
          },
        ],
      }),
    );
    const out = resolveManifest("manifests/modes.json", SAMPLE_CONTEXT);
    expect(out[0].mode).toBe("append-idempotent");
    expect(out[0].appendTarget).toEqual({
      glob: "src/main/resources/application.properties",
      matchCount: 1,
    });
  });

  it("appendTarget.glob 도 Handlebars 변수가 치환된다", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/modes.json"),
      JSON.stringify({
        name: "modes",
        files: [
          {
            template: "x.hbs",
            output: "out/x.txt",
            mode: "append-fallback",
            appendTarget: { glob: "src/main/java/{{basePackagePath}}/seed.sql", matchCount: 1 },
          },
        ],
      }),
    );
    const out = resolveManifest("manifests/modes.json", SAMPLE_CONTEXT);
    expect(out[0].appendTarget?.glob).toBe(
      "src/main/java/egovframework/example/sample/seed.sql",
    );
  });

  it("잘못된 mode 값은 거부한다", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/modes.json"),
      JSON.stringify({
        name: "bad",
        files: [{ template: "x.hbs", output: "x.txt", mode: "bogus" }],
      }),
    );
    expect(() => loadManifest("manifests/modes.json")).toThrow(
      /'create'\|'append-idempotent'\|'append-fallback'/,
    );
  });

  it("mode='append-*' 인데 appendTarget 이 없으면 거부한다", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/modes.json"),
      JSON.stringify({
        name: "bad",
        files: [{ template: "x.hbs", output: "x.txt", mode: "append-idempotent" }],
      }),
    );
    expect(() => loadManifest("manifests/modes.json")).toThrow(
      /appendTarget 이 필수/,
    );
  });

  it("잘못된 scope 값은 거부한다", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/badscope.json"),
      JSON.stringify({
        name: "bad",
        files: [{ template: "x.hbs", output: "x.txt", scope: "bogus" }],
      }),
    );
    expect(() => loadManifest("manifests/badscope.json")).toThrow(
      /'framework' 또는 'entity'/,
    );
  });

  it("표준 매니페스트(boot50) 에는 entity-scope 항목이 17개 있다", () => {
    // 9 CRUD 산출물 + EgovConfigIdGeneration.java + sampledb-migrations.sql(방언 7개 fan-out) = 10 + 7 = 17
    // (sql-mapper-config.xml 은 setTypeAliasesPackage 로 대체되어 제거)
    delete process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH;
    clearManifestCache();
    const out = resolveManifest("manifests/boot50.json", SAMPLE_CONTEXT, "entity");
    expect(out).toHaveLength(17);
    for (const e of out) expect(e.scope).toBe("entity");
  });

  it("표준 매니페스트(boot43) 에는 entity-scope 항목이 17개 있다", () => {
    delete process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH;
    clearManifestCache();
    const out = resolveManifest("manifests/boot43.json", SAMPLE_CONTEXT, "entity");
    expect(out).toHaveLength(17);
    for (const e of out) expect(e.scope).toBe("entity");
  });

  it("표준 매니페스트(war43) 에는 entity-scope 항목이 17개 있다", () => {
    // 9 CRUD 산출물 + context-{entity}-idgen.xml + sampledb-migrations.sql(방언 7개 fan-out) = 10 + 7 = 17
    delete process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH;
    clearManifestCache();
    const out = resolveManifest("manifests/war43.json", SAMPLE_CONTEXT, "entity");
    expect(out).toHaveLength(17);
    for (const e of out) expect(e.scope).toBe("entity");
  });
});

describe("manifestLoader — 검증 오류", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    clearManifestCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "egov-manifest-bad-"));
    originalEnv = process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH;
    process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH = tmpDir;
    fs.mkdirSync(path.join(tmpDir, "manifests"), { recursive: true });
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH;
    } else {
      process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH = originalEnv;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    clearManifestCache();
  });

  it("파일이 없으면 명확한 오류를 던진다", () => {
    expect(() => loadManifest("manifests/missing.json")).toThrow(
      /매니페스트를 읽을 수 없습니다/,
    );
  });

  it("JSON 파싱이 실패하면 위치를 알려주는 오류를 던진다", () => {
    fs.writeFileSync(path.join(tmpDir, "manifests/broken.json"), "{ not json");
    expect(() => loadManifest("manifests/broken.json")).toThrow(
      /매니페스트 파싱 실패/,
    );
  });

  it("name 필드가 없으면 거부한다", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/noname.json"),
      JSON.stringify({ files: [] }),
    );
    expect(() => loadManifest("manifests/noname.json")).toThrow(/'name' 필드/);
  });

  it("files 가 배열이 아니면 거부한다", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/badfiles.json"),
      JSON.stringify({ name: "x", files: "nope" }),
    );
    expect(() => loadManifest("manifests/badfiles.json")).toThrow(/'files' 는 배열/);
  });

  it("개별 항목에 template/output 이 빠지면 인덱스를 알려준다", () => {
    fs.writeFileSync(
      path.join(tmpDir, "manifests/missingfields.json"),
      JSON.stringify({
        name: "x",
        files: [
          { template: "ok.hbs", output: "ok.txt" },
          { template: "no-output.hbs" },
        ],
      }),
    );
    expect(() => loadManifest("manifests/missingfields.json")).toThrow(/files\[1\]/);
  });
});
