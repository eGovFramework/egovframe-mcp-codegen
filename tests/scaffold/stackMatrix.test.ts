/**
 * Unit tests for `src/utils/scaffold/stackMatrix.ts`
 *
 * 매트릭스 로더의 캐싱, 경로 오버라이드, 무결성 검사를 검증한다.
 * 캐시는 모듈 전역이므로 각 테스트 전에 `clearStackMatrixCache()` 로 초기화한다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  clearStackMatrixCache,
  loadStackMatrix,
  resolveStack,
  resolveStackMatrixPath,
} from "../../src/utils/scaffold/stackMatrix.js";

describe("stackMatrix — 기본 매트릭스 로드", () => {
  beforeEach(() => clearStackMatrixCache());

  it("templates/stacks.json 을 읽고 boot50 항목이 존재한다", () => {
    const matrix = loadStackMatrix();
    expect(matrix.version).toBeGreaterThanOrEqual(1);
    expect(matrix.stacks.boot50).toBeDefined();
    expect(matrix.stacks.boot50.egovframe).toBe("5.1.0");
    expect(matrix.stacks.boot50.jakarta).toBe(true);
  });

  it("boot/5.0 → boot50 항목을 돌려준다", () => {
    const s = resolveStack("boot", "5.0");
    expect(s.frameworkLabel).toBe("eGovFrame Boot 5.1.0");
    expect(s.springBoot).toBe("3.5.16");
    expect(s.staticAssets).toBe("static50");
  });

  it("boot/4.3 → boot43 항목을 돌려준다", () => {
    const s = resolveStack("boot", "4.3");
    expect(s.frameworkLabel).toBe("eGovFrame Boot 4.3.2");
    expect(s.springBoot).toBe("2.7.18");
    // 공식 eGovFrame Boot 부모 (spring-boot-starter-parent 2.7.18 을 상속하고 실행환경 루트 BOM 을 import)
    expect(s.starterParentGroupId).toBe("org.egovframe.boot");
    expect(s.starterParentArtifactId).toBe("org.egovframe.boot.starter.parent");
    expect(s.starterParentVersion).toBe("4.3.2");
    expect(s.rteVersion).toBe("4.3.2");
  });

  it("war/4.3 → war43 항목을 돌려준다", () => {
    const s = resolveStack("war", "4.3");
    expect(s.frameworkLabel).toBe("Spring 5.3.39-egov.2");
    expect(s.spring).toBe("5.3.39-egov.2");
    expect(s.jakarta).toBe(false);
  });
});

describe("stackMatrix — 환경변수 오버라이드", () => {
  let tmpDir: string;
  const ENV_KEY = "EGOVFRAME_STACK_MATRIX_PATH";
  const originalEnv = process.env[ENV_KEY];

  beforeEach(() => {
    clearStackMatrixCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-matrix-"));
  });

  afterEach(() => {
    clearStackMatrixCache();
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("EGOVFRAME_STACK_MATRIX_PATH 로 다른 매트릭스를 로드할 수 있다", () => {
    const custom = path.join(tmpDir, "stacks.json");
    fs.writeFileSync(
      custom,
      JSON.stringify({
        version: 1,
        stacks: {
          custom: {
            projectType: "boot",
            stackVersion: "5.0",
            egovframe: "5.0.0",
            springBoot: "3.9.9-CUSTOM",
            spring: null,
            java: "21",
            jakarta: true,
            rteVersion: null,
            starterParentGroupId: "org.example",
            starterParentArtifactId: "custom-parent",
            starterParentVersion: "9.9.9",
            frameworkLabel: "Custom 9.9.9",
            staticAssets: "static50",
          },
        },
        selection: [{ projectType: "boot", stackVersion: "5.0", stack: "custom" }],
      }),
    );
    process.env[ENV_KEY] = custom;

    expect(resolveStackMatrixPath()).toBe(custom);
    const s = resolveStack("boot", "5.0");
    expect(s.springBoot).toBe("3.9.9-CUSTOM");
    expect(s.java).toBe("21");
    expect(s.frameworkLabel).toBe("Custom 9.9.9");
  });
});

describe("stackMatrix — 에러 처리", () => {
  let tmpDir: string;
  const ENV_KEY = "EGOVFRAME_STACK_MATRIX_PATH";
  const originalEnv = process.env[ENV_KEY];

  beforeEach(() => {
    clearStackMatrixCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-matrix-err-"));
  });

  afterEach(() => {
    clearStackMatrixCache();
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("등재되지 않은 조합(war + 5.0)은 명확한 에러를 던진다", () => {
    expect(() => resolveStack("war", "5.0")).toThrow(/지원하지 않는 스택 조합/);
  });

  it("파일이 없으면 에러 메시지에 경로가 포함된다", () => {
    process.env[ENV_KEY] = path.join(tmpDir, "missing.json");
    expect(() => resolveStack("boot", "5.0")).toThrow(/Stack matrix 를 읽을 수 없습니다/);
  });

  it("JSON 파싱 실패는 명확한 에러를 던진다", () => {
    const bad = path.join(tmpDir, "stacks.json");
    fs.writeFileSync(bad, "{ not json ");
    process.env[ENV_KEY] = bad;
    expect(() => resolveStack("boot", "5.0")).toThrow(/Stack matrix 파싱 실패/);
  });

  it("selection 이 stacks 에 없는 키를 참조하면 에러를 던진다", () => {
    const bad = path.join(tmpDir, "stacks.json");
    fs.writeFileSync(
      bad,
      JSON.stringify({
        version: 1,
        stacks: {},
        selection: [{ projectType: "boot", stackVersion: "5.0", stack: "ghost" }],
      }),
    );
    process.env[ENV_KEY] = bad;
    expect(() => loadStackMatrix()).toThrow(/'ghost'/);
  });

  it("stacks 항목의 키와 projectType/stackVersion 이 어긋나면 무결성 위반", () => {
    const bad = path.join(tmpDir, "stacks.json");
    fs.writeFileSync(
      bad,
      JSON.stringify({
        version: 1,
        stacks: {
          mismatch: {
            projectType: "war",
            stackVersion: "4.3",
            egovframe: "x",
            springBoot: null,
            spring: "x",
            java: "x",
            jakarta: false,
            rteVersion: "x",
            starterParentGroupId: null,
            starterParentArtifactId: null,
            starterParentVersion: null,
            frameworkLabel: "x",
            staticAssets: "static",
          },
        },
        // selection 이 boot/5.0 으로 'mismatch' 항목을 가리키지만, 그 항목 자체는 war/4.3 이다.
        selection: [{ projectType: "boot", stackVersion: "5.0", stack: "mismatch" }],
      }),
    );
    process.env[ENV_KEY] = bad;
    expect(() => resolveStack("boot", "5.0")).toThrow(/무결성 위반/);
  });
});
