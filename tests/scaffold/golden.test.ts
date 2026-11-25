/**
 * Golden file tests for egov_scaffold_project
 *
 * 같은 DDL을 넣었을 때 생성되는 파일 목록과 각 파일의 SHA256 해시를 매니페스트로 고정한다.
 * 의도하지 않은 회귀가 발생하면 매니페스트 diff로 즉시 잡힌다.
 *
 * 의도적 변경이 있어 매니페스트를 갱신해야 할 때는:
 *   UPDATE_GOLDEN=1 npm test
 * 또는
 *   npm run test:update
 *
 * 매니페스트 위치: tests/scaffold/__golden__/<scenario>.json
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GOLDEN_DIR = path.join(__dirname, "__golden__");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

// 정적 리소스(static/static50)는 템플릿 그대로 복사되므로 변동이 없을 거라 매니페스트가 매우 큽니다.
// 시그널 대 노이즈를 높이기 위해 정적 리소스는 매니페스트에서 제외하고 "개수만" 기록합니다.
const STATIC_PREFIXES = ["src/main/resources/static", "src/main/webapp/static-files"];

interface ManifestEntry {
  path: string;
  sha256: string;
}

interface Manifest {
  scenario: string;
  fileCount: number;
  staticFileCount: number;
  files: ManifestEntry[];
}

// title 은 코멘트가 라벨로 반영되고, content 는 10자 초과 설명문이라 컬럼명 표기로 폴백한다.
// 테이블 COMMENT 는 메뉴·제목(nav/title/list) 에 반영된다. (DDL COMMENT 라벨 기능의 회귀 고정)
const SHARED_DDL = `CREATE TABLE board (
  board_id VARCHAR(36) NOT NULL,
  title VARCHAR(200) NOT NULL COMMENT '제목',
  content TEXT COMMENT '본문 내용을 저장하는 긴 설명 컬럼',
  author VARCHAR(50),
  created_at TIMESTAMP,
  PRIMARY KEY (board_id)
) COMMENT='게시판'`;

const SCENARIOS = [
  {
    name: "boot50",
    params: { projectType: "boot" as const, stackVersion: "5.1" as const },
  },
  {
    name: "boot43",
    params: { projectType: "boot" as const, stackVersion: "4.3" as const },
  },
  {
    name: "war",
    params: { projectType: "war" as const, stackVersion: "4.3" as const },
  },
];

function sha256(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function walk(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function buildManifest(scenario: string, projectRoot: string): Manifest {
  const allFiles = walk(projectRoot).map((f) => f.split(path.sep).join("/"));
  const dynamic: ManifestEntry[] = [];
  let staticCount = 0;

  for (const rel of allFiles) {
    if (STATIC_PREFIXES.some((p) => rel.startsWith(p))) {
      staticCount++;
      continue;
    }
    dynamic.push({
      path: rel,
      sha256: sha256(path.join(projectRoot, rel)),
    });
  }
  // 정렬해서 OS별 readdir 순서에 흔들리지 않게 한다.
  dynamic.sort((a, b) => a.path.localeCompare(b.path));

  return {
    scenario,
    fileCount: dynamic.length,
    staticFileCount: staticCount,
    files: dynamic,
  };
}

async function generate(scenario: (typeof SCENARIOS)[number]): Promise<Manifest> {
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), `scaffold-golden-${scenario.name}-`));
  try {
    const resultJson = await generateScaffoldProject({
      projectName: "golden-test",
      packageName: "egovframework.example.board",
      outputPath: tmpOut,
      entityName: "Board",
      ddl: SHARED_DDL,
      description: "golden",
      projectType: scenario.params.projectType,
      stackVersion: scenario.params.stackVersion,
    });
    const result = JSON.parse(resultJson);
    return buildManifest(scenario.name, result.projectDir);
  } finally {
    // 정리는 best-effort
    try {
      fs.rmSync(tmpOut, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

beforeAll(() => {
  if (!fs.existsSync(GOLDEN_DIR)) fs.mkdirSync(GOLDEN_DIR, { recursive: true });
});

describe("egov_scaffold_project — golden manifests", () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name} 시나리오의 생성 결과가 매니페스트와 일치한다`, async () => {
      const manifest = await generate(scenario);
      const goldenPath = path.join(GOLDEN_DIR, `${scenario.name}.json`);

      if (UPDATE || !fs.existsSync(goldenPath)) {
        fs.writeFileSync(goldenPath, JSON.stringify(manifest, null, 2) + "\n");
        // 갱신 모드면 검증 대신 그냥 패스.
        expect(manifest.files.length).toBeGreaterThan(0);
        return;
      }

      const expected: Manifest = JSON.parse(fs.readFileSync(goldenPath, "utf-8"));

      // 빠른 시그널: 파일 수가 다르면 가장 먼저 알린다.
      expect(manifest.fileCount, "동적 파일 개수가 다릅니다").toBe(expected.fileCount);
      expect(manifest.staticFileCount, "정적 파일 개수가 다릅니다").toBe(
        expected.staticFileCount,
      );

      // 상세 시그널: 각 파일의 경로/해시.
      // toEqual 사용 시 diff가 friendlier
      expect(manifest.files).toEqual(expected.files);
    });
  }
});
