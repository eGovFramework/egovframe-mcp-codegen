/**
 * HSQL 임베디드 시드 부팅 검증
 *
 * 생성 프로젝트의 hsql 프로파일은 Spring `EmbeddedDatabaseBuilder(HSQL)` —
 * 호환 플래그 없는 HSQLDB 기본 모드 — 로 시드 SQL 을 로드한다. 기본 모드는
 * TEXT/CLOB alias 계열과 MySQL 표시 폭(INT(11))을 거부하므로, 시드 템플릿은
 * `dialectType(..., "hsql")` 매핑을 거쳐야 부팅이 된다.
 *
 * 1) 렌더링 검증: TEXT/INT(11) 이 포함된 DDL 로 스캐폴드를 돌려 시드가
 *    LONGVARCHAR/INT 로 렌더링되는지 문자열 수준에서 확인한다. (항상 실행)
 * 2) 부팅 검증: 로컬에 JDK 와 HSQLDB jar (~/.m2/repository/org/hsqldb/...) 가
 *    있으면 렌더링된 시드를 실제 HSQLDB 기본 모드에서 실행해 본다. 없는 환경
 *    (CI 등) 에서는 skip 된다.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const NOTICE_DDL = `CREATE TABLE tb_notice (
  notice_id   VARCHAR(20) NOT NULL,
  title       VARCHAR(200) NOT NULL,
  content     TEXT,
  view_cnt    INT(11),
  use_yn      CHAR(1),
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notice_id)
)`;

/** ~/.m2 에서 HSQLDB 메인 jar 를 찾는다 (sources/javadoc 제외, 최신 버전 우선). */
function findHsqldbJar(): string | null {
  const base = path.join(os.homedir(), ".m2", "repository", "org", "hsqldb", "hsqldb");
  if (!fs.existsSync(base)) return null;
  const versions = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const v of versions) {
    const dir = path.join(base, v);
    const jar = fs
      .readdirSync(dir)
      .find((f) => /^hsqldb-.*\.jar$/.test(f) && !/sources|javadoc/.test(f));
    if (jar) return path.join(dir, jar);
  }
  return null;
}

/** JDK 존재 여부 (단일 파일 소스 실행에는 JRE 가 아닌 JDK 가 필요). */
function hasJdk(): boolean {
  const r = spawnSync("java", ["-version"], { encoding: "utf-8" });
  return r.status === 0;
}

/** 시드 SQL 파일을 HSQLDB 기본 모드에서 실행하는 1회용 러너 (JEP 330 소스 실행). */
const SEED_BOOT_RUNNER = `import java.sql.*;
import java.nio.file.*;

public class SeedBoot {
    public static void main(String[] args) throws Exception {
        String sql = new String(Files.readAllBytes(Paths.get(args[0])), "UTF-8");
        sql = sql.replaceAll("(?m)^--.*$", "");
        try (Connection c = DriverManager.getConnection("jdbc:hsqldb:mem:seedboot", "sa", "")) {
            for (String raw : sql.split(";")) {
                String stmt = raw.trim();
                if (stmt.isEmpty()) continue;
                try (Statement st = c.createStatement()) { st.execute(stmt); }
            }
            try (Statement st = c.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='PUBLIC'")) {
                rs.next();
                System.out.println("SEED_BOOT_OK tables=" + rs.getInt(1));
            }
            try (Statement st = c.createStatement()) { st.execute("SHUTDOWN"); }
        }
    }
}
`;

let projectDir = "";
let seedSql = "";

beforeAll(async () => {
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "hsql-seed-boot-"));
  const resultJson = await generateScaffoldProject({
    projectName: "hsql-seed-test",
    packageName: "egovframework.example.notice",
    outputPath: tmpOut,
    entityName: "Notice",
    ddl: NOTICE_DDL,
    description: "hsql seed boot test",
    projectType: "boot",
    stackVersion: "5.1",
  });
  projectDir = JSON.parse(resultJson).projectDir;
  seedSql = fs.readFileSync(
    path.join(projectDir, "src/main/resources/db/noticedb.sql"),
    "utf-8",
  );
});

describe("HSQL 임베디드 시드 — hsql 방언 렌더링", () => {
  it("TEXT 컬럼이 LONGVARCHAR 로 렌더링된다", () => {
    expect(seedSql).toMatch(/content LONGVARCHAR/);
    expect(seedSql).not.toMatch(/\bTEXT\b/);
  });

  it("MySQL 표시 폭 INT(11) 은 INT 로 렌더링된다", () => {
    expect(seedSql).toMatch(/view_cnt INT[,\s]/);
    expect(seedSql).not.toMatch(/INT\(11\)/);
  });

  it("길이 의미 있는 타입(VARCHAR/CHAR)의 길이는 보존된다", () => {
    expect(seedSql).toMatch(/notice_id VARCHAR\(20\)/);
    expect(seedSql).toMatch(/use_yn CHAR\(1\)/);
  });

  it("DEFAULT 절은 유지된다", () => {
    expect(seedSql).toMatch(/created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL/);
  });
});

describe("HSQL 임베디드 시드 — 실제 부팅 (JDK + HSQLDB jar 필요)", () => {
  const jar = findHsqldbJar();
  const runnable = jar !== null && hasJdk();

  it.skipIf(!runnable)(
    "렌더링된 시드가 HSQLDB 기본 모드에서 오류 없이 실행된다",
    () => {
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "hsql-seed-run-"));
      const runnerPath = path.join(workDir, "SeedBoot.java");
      fs.writeFileSync(runnerPath, SEED_BOOT_RUNNER);
      const seedPath = path.join(projectDir, "src/main/resources/db/noticedb.sql");

      // CLAUDE.md 보안 컨벤션: shell 미사용 + 인자 배열
      const r = spawnSync("java", ["-cp", jar as string, runnerPath, seedPath], {
        encoding: "utf-8",
        timeout: 60_000,
      });

      expect(r.error, "java 실행 실패").toBeUndefined();
      expect(
        r.status,
        `시드 실행 실패 — stderr:\n${r.stderr}\nstdout:\n${r.stdout}`,
      ).toBe(0);
      expect(r.stdout).toContain("SEED_BOOT_OK");
    },
    90_000,
  );
});
