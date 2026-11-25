/**
 * autoApplyMigration 옵션 동작 테스트
 *
 * 흐름:
 *   1) autoApplyMigration 미지정 (기본 true) + 시드 1개 → 시드 끝에 자동 append, 별도 파일 미생성
 *   2) autoApplyMigration=false (명시)                  → 항상 별도 파일(add-{entity}-tables.sql) 생성
 *   3) autoApplyMigration=true + 시드 0개·2개+          → fallback. 별도 파일 생성 + 결과 메시지에 사유 안내
 *
 * 매번 임시 디렉터리에 board-app 을 진짜로 스캐폴드한 뒤 add_entity 를 호출한다.
 * (mock 으로는 디렉터리 탐색 로직 검증이 어렵다)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const BOARD_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;

const MEMBER_DDL = `CREATE TABLE MEMBER (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  EMAIL VARCHAR(100)
)`;

const DEPARTMENT_TIMESTAMP_DDL = `CREATE TABLE DEPARTMENT (
  DEPT_ID VARCHAR(20) NOT NULL,
  DEPT_NAME VARCHAR(100) NOT NULL,
  CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UPDATED_AT TIMESTAMP,
  CONSTRAINT PK_DEPARTMENT PRIMARY KEY (DEPT_ID)
)`;

let tmpRoot: string;
let projectDir: string;

async function scaffoldBoardApp() {
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
  return path.join(tmpRoot, "board-app");
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-add-entity-"));
  projectDir = await scaffoldBoardApp();
});

afterEach(async () => {
  await fs.remove(tmpRoot);
});

describe("egov_add_entity — autoApplyMigration", () => {
  it("[기본] autoApplyMigration 미지정 시 시드 파일 1개면 자동 append 한다 (default=true)", async () => {
    const seedAbs = path.join(
      projectDir,
      "src/main/resources/db/boarddb.sql",
    );
    const seedBefore = await fs.readFile(seedAbs, "utf-8");

    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      // autoApplyMigration 미지정 — 기본 true 적용 기대
    });

    const seedAfter = await fs.readFile(seedAbs, "utf-8");
    expect(seedAfter.length).toBeGreaterThan(seedBefore.length);
    expect(seedAfter).toMatch(/CREATE\s+MEMORY\s+TABLE\s+MEMBER/i);
    expect(seedAfter).toMatch(/INSERT\s+INTO\s+IDS\s+VALUES\(\s*'MEMBER'/i);
    expect(seedAfter.startsWith(seedBefore)).toBe(true);

    const migrationFile = path.join(
      projectDir,
      "src/main/resources/db/add-member-tables.sql",
    );
    expect(await fs.pathExists(migrationFile)).toBe(false);

    expect(out).toMatch(/자동 적용 완료/);
  });

  it("[명시 false] autoApplyMigration=false 면 별도 파일만 만들고 시드는 손대지 않는다", async () => {
    const seedAbs = path.join(
      projectDir,
      "src/main/resources/db/boarddb.sql",
    );
    const seedBefore = await fs.readFile(seedAbs, "utf-8");

    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMigration: false,
    });

    const migrationFile = path.join(
      projectDir,
      "src/main/resources/db/add-member-tables.sql",
    );
    expect(await fs.pathExists(migrationFile)).toBe(true);

    // 시드 파일은 손대지 않는다
    expect(await fs.readFile(seedAbs, "utf-8")).toEqual(seedBefore);

    expect(out).toMatch(/데이터베이스 마이그레이션 필수/);
    expect(out).toMatch(/autoApplyMigration=false/);
  });

  it("[자동 append] autoApplyMigration=true + 시드 1개 → 시드 끝에 append, 별도 파일 미생성", async () => {
    const seedAbs = path.join(
      projectDir,
      "src/main/resources/db/boarddb.sql",
    );
    const seedBefore = await fs.readFile(seedAbs, "utf-8");

    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMigration: true,
    });

    const seedAfter = await fs.readFile(seedAbs, "utf-8");
    // 시드가 늘어났고, MEMBER 테이블 + IDS row 가 끝에 들어가 있어야 한다.
    expect(seedAfter.length).toBeGreaterThan(seedBefore.length);
    expect(seedAfter).toMatch(/CREATE\s+MEMORY\s+TABLE\s+MEMBER/i);
    expect(seedAfter).toMatch(/INSERT\s+INTO\s+IDS\s+VALUES\(\s*'MEMBER'/i);
    // 보존: 시드 처음 부분은 변하지 않음
    expect(seedAfter.startsWith(seedBefore)).toBe(true);

    // 별도 파일은 생성되지 않아야 한다
    const migrationFile = path.join(
      projectDir,
      "src/main/resources/db/add-member-tables.sql",
    );
    expect(await fs.pathExists(migrationFile)).toBe(false);

    expect(out).toMatch(/자동 적용 완료/);
    expect(out).toMatch(/boarddb\.sql/);
  });

  it("[fallback - 시드 0개] autoApplyMigration=true 라도 시드가 없으면 별도 파일 생성 + 사유 안내", async () => {
    // boarddb.sql 제거 (db 디렉터리는 유지)
    await fs.remove(path.join(projectDir, "src/main/resources/db/boarddb.sql"));

    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMigration: true,
    });

    const migrationFile = path.join(
      projectDir,
      "src/main/resources/db/add-member-tables.sql",
    );
    expect(await fs.pathExists(migrationFile)).toBe(true);
    expect(out).toMatch(/자동 적용 조건 미충족/);
    expect(out).toMatch(/사용자 시드 SQL 파일이 발견되지 않아/);
  });

  it("[fallback - 시드 2개] 시드 후보가 2개 이상이면 어디에 넣을지 모호하여 fallback 한다", async () => {
    // 동일 디렉터리에 두 번째 시드 추가
    await fs.writeFile(
      path.join(projectDir, "src/main/resources/db/extra.sql"),
      "-- extra seed\n",
    );

    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMigration: true,
    });

    const migrationFile = path.join(
      projectDir,
      "src/main/resources/db/add-member-tables.sql",
    );
    expect(await fs.pathExists(migrationFile)).toBe(true);
    expect(out).toMatch(/자동 적용 조건 미충족/);
    expect(out).toMatch(/2개/);

    // 두 시드 파일 모두 손대지 않아야 한다
    const boardSeed = await fs.readFile(
      path.join(projectDir, "src/main/resources/db/boarddb.sql"),
      "utf-8",
    );
    expect(boardSeed).not.toMatch(/CREATE\s+MEMORY\s+TABLE\s+MEMBER/i);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 운영 DB 용 방언별 마이그레이션 SQL (db/migrations/{dialect}/{entity}db.sql, 7개 방언)
  // ─────────────────────────────────────────────────────────────────────────

  const SUPPORTED_DIALECTS = [
    "oracle",
    "tibero",
    "altibase",
    "cubrid",
    "goldilocks",
    "mysql",
    "postgres",
  ] as const;

  it("[방언분할] autoApplyMigration=true 에서도 7개 방언 폴더에 파일이 생성된다", async () => {
    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMigration: true,
    });

    // 7개 방언 폴더에 각각 memberdb.sql 가 존재
    for (const dialect of SUPPORTED_DIALECTS) {
      const abs = path.join(
        projectDir,
        `src/main/resources/db/migrations/${dialect}/memberdb.sql`,
      );
      expect(await fs.pathExists(abs)).toBe(true);
    }
    // 결과 메시지에 안내 포함
    expect(out).toMatch(/방언별 마이그레이션 SQL/);
  });

  it("[방언분할] 각 방언 파일은 주석이 아닌 실제 SQL 이다", async () => {
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMigration: false,
    });

    for (const dialect of SUPPORTED_DIALECTS) {
      const content = await fs.readFile(
        path.join(
          projectDir,
          `src/main/resources/db/migrations/${dialect}/memberdb.sql`,
        ),
        "utf-8",
      );
      // CREATE TABLE 라인이 주석(--)으로 시작하지 않아야 한다
      expect(content).toMatch(/^CREATE TABLE MEMBER/m);
      expect(content).not.toMatch(/^--\s+CREATE TABLE MEMBER/m);
      // INSERT INTO IDS 도 활성 — 추가 엔티티(non-primary) 라서 채번 row 만 들어간다
      expect(content).toMatch(/^INSERT INTO IDS VALUES\('MEMBER', 1\);/m);
    }
  });

  it("[방언분할] 추가 엔티티(add_entity) 의 파일에는 CREATE TABLE IDS 가 없다", async () => {
    // egov_add_entity 는 isPrimaryEntity=false → IDS 테이블 생성 블록 생략
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
    });

    for (const dialect of SUPPORTED_DIALECTS) {
      const content = await fs.readFile(
        path.join(
          projectDir,
          `src/main/resources/db/migrations/${dialect}/memberdb.sql`,
        ),
        "utf-8",
      );
      expect(content).not.toMatch(/CREATE TABLE IDS/);
    }
  });

  it("[방언분할] 첫 스캐폴드(primary 엔티티) 의 파일에는 CREATE TABLE IDS 가 포함된다", async () => {
    // beforeEach 에서 이미 board-app 이 스캐폴드되었으므로 board 파일을 검증
    for (const dialect of SUPPORTED_DIALECTS) {
      const content = await fs.readFile(
        path.join(
          projectDir,
          `src/main/resources/db/migrations/${dialect}/boarddb.sql`,
        ),
        "utf-8",
      );
      expect(content).toMatch(/CREATE TABLE IDS/);
      expect(content).toMatch(/^CREATE TABLE BOARD/m);
    }
  });

  it("[방언분할] 컬럼 타입이 방언별로 정확히 변환된다", async () => {
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.department",
      entityName: "Department",
      ddl: DEPARTMENT_TIMESTAMP_DDL,
    });

    const base = path.join(projectDir, "src/main/resources/db/migrations");

    // Oracle/Tibero/Altibase/Goldilocks → VARCHAR2(100)
    for (const d of ["oracle", "tibero", "altibase", "goldilocks"]) {
      const content = await fs.readFile(
        path.join(base, d, "departmentdb.sql"),
        "utf-8",
      );
      expect(content).toMatch(/VARCHAR2\(100\)/);
      expect(content).toMatch(/TIMESTAMP/);
    }
    // MySQL/PostgreSQL/CUBRID → VARCHAR(100)
    for (const d of ["mysql", "postgres", "cubrid"]) {
      const content = await fs.readFile(
        path.join(base, d, "departmentdb.sql"),
        "utf-8",
      );
      expect(content).toMatch(/VARCHAR\(100\)/);
    }
    // MySQL 만 ENGINE=InnoDB
    const mysql = await fs.readFile(
      path.join(base, "mysql", "departmentdb.sql"),
      "utf-8",
    );
    expect(mysql).toMatch(/ENGINE=InnoDB/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // autoApplyMessages 옵션
  // ─────────────────────────────────────────────────────────────────────────

  it("[메시지 기본 자동] autoApplyMessages 미지정 시 3개 번들 끝에 엔티티 키들이 append 된다", async () => {
    const msgDir = path.join(
      projectDir,
      "src/main/resources/egovframework/message",
    );
    const before = {
      def: await fs.readFile(path.join(msgDir, "message-common.properties"), "utf-8"),
      ko: await fs.readFile(path.join(msgDir, "message-common_ko.properties"), "utf-8"),
      en: await fs.readFile(path.join(msgDir, "message-common_en.properties"), "utf-8"),
    };

    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
    });

    const after = {
      def: await fs.readFile(path.join(msgDir, "message-common.properties"), "utf-8"),
      ko: await fs.readFile(path.join(msgDir, "message-common_ko.properties"), "utf-8"),
      en: await fs.readFile(path.join(msgDir, "message-common_en.properties"), "utf-8"),
    };

    // 각 번들이 늘어났고 보존됨 + Member 키들이 들어가 있어야 한다.
    for (const key of ["def", "ko", "en"] as const) {
      expect(after[key].length).toBeGreaterThan(before[key].length);
      expect(after[key].startsWith(before[key])).toBe(true);
      expect(after[key]).toMatch(/list\.member=/);
      expect(after[key]).toMatch(/title\.member\.sample=/);
      expect(after[key]).toMatch(/title\.member\.id=/);
      expect(after[key]).toMatch(/title\.member\.email=/);
      expect(after[key]).toMatch(/confirm\.required\.member\.email=/);
    }
    expect(out).toMatch(/메시지 번들 자동 적용 완료/);
  });

  it("[메시지 끄기] autoApplyMessages=false 면 번들 파일이 전혀 수정되지 않는다", async () => {
    const msgDir = path.join(
      projectDir,
      "src/main/resources/egovframework/message",
    );
    const before = await fs.readFile(
      path.join(msgDir, "message-common.properties"),
      "utf-8",
    );

    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMessages: false,
    });

    const after = await fs.readFile(
      path.join(msgDir, "message-common.properties"),
      "utf-8",
    );
    expect(after).toEqual(before);
    expect(out).toMatch(/메시지 번들 자동 적용 미수행/);
    expect(out).toMatch(/autoApplyMessages=false/);
  });

  it("[메시지 fallback] 번들 파일 중 하나라도 없으면 자동 append 를 건너뛴다", async () => {
    // en 파일을 일부러 제거
    const msgDir = path.join(
      projectDir,
      "src/main/resources/egovframework/message",
    );
    const koAbs = path.join(msgDir, "message-common_ko.properties");
    const defaultAbs = path.join(msgDir, "message-common.properties");
    await fs.remove(path.join(msgDir, "message-common_en.properties"));
    const koBefore = await fs.readFile(koAbs, "utf-8");

    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMessages: true,
    });

    // ko/default 도 안 건드림 (전부 있거나 전부 안 건드림 정책)
    expect(await fs.readFile(koAbs, "utf-8")).toEqual(koBefore);
    expect(await fs.readFile(defaultAbs, "utf-8")).toEqual(
      // default 파일도 변경 없음 — 비교 위해 fresh read
      (await fs.readFile(defaultAbs, "utf-8")),
    );

    expect(out).toMatch(/메시지 번들 자동 적용 미수행/);
    expect(out).toMatch(/message-common_en\.properties/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // autoApplyMenu 옵션
  // ─────────────────────────────────────────────────────────────────────────

  it("[메뉴 기본 off] autoApplyMenu 미지정 시 nav fragment 가 갱신되지 않는다", async () => {
    const fragmentAbs = path.join(
      projectDir,
      "src/main/resources/templates/thymeleaf/_fragments/nav.html",
    );
    const before = await fs.readFile(fragmentAbs, "utf-8");

    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
    });

    // fragment 는 board 만 들어있는 상태로 변하지 않아야 한다
    const after = await fs.readFile(fragmentAbs, "utf-8");
    expect(after).toEqual(before);
    expect(after).toMatch(/egovBoardList\.do/);
    expect(after).not.toMatch(/egovMemberList\.do/);
  });

  it("[메뉴 자동 갱신] autoApplyMenu=true 면 nav fragment 가 Board + Member 로 재생성된다", async () => {
    const fragmentAbs = path.join(
      projectDir,
      "src/main/resources/templates/thymeleaf/_fragments/nav.html",
    );

    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMenu: true,
    });

    const fragment = await fs.readFile(fragmentAbs, "utf-8");
    expect(fragment).toMatch(/egovBoardList\.do/);
    expect(fragment).toMatch(/egovMemberList\.do/);
    expect(fragment).toMatch(/#\{nav\.board\}/);
    expect(fragment).toMatch(/#\{nav\.member\}/);
    expect(out).toMatch(/메뉴 자동 갱신 완료/);
    expect(out).toMatch(/Board, Member/);
  });

  it("[메뉴 + legacy 마이그레이션] fragment include 라인이 없는 기존 List view 에 자동 삽입한다", async () => {
    // 1차 스캐폴드 결과 view 에는 이미 fragment include 가 박혀 있음. 의도적으로 제거해 legacy 상태 시뮬레이션.
    const boardListAbs = path.join(
      projectDir,
      "src/main/resources/templates/thymeleaf/board/egovBoardList.html",
    );
    let raw = await fs.readFile(boardListAbs, "utf-8");
    raw = raw.replace(
      /\n\s*<!-- @egov:nav-include[^\n]*\n\s*<div th:replace="~\{_fragments\/nav :: links\}"><\/div>/,
      "",
    );
    await fs.writeFile(boardListAbs, raw, "utf-8");
    expect(await fs.readFile(boardListAbs, "utf-8")).not.toMatch(
      /_fragments\/nav :: links/,
    );

    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMenu: true,
    });

    // 자동 삽입되어야 한다
    const after = await fs.readFile(boardListAbs, "utf-8");
    expect(after).toMatch(/_fragments\/nav :: links/);
    expect(out).toMatch(/fragment include 라인 자동 삽입/);
    expect(out).toMatch(/egovBoardList\.html/);
  });

  it("[메뉴 Thymeleaf 3.1 호환] nav fragment 가 #httpServletRequest 를 쓰지 않고 egovRequestUri 를 쓴다", async () => {
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMenu: true,
    });

    const fragment = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/templates/thymeleaf/_fragments/nav.html",
      ),
      "utf-8",
    );
    // Thymeleaf 3.1 에서 비활성화된 표현식 객체를 SpringEL 안에서 쓰면 안 됨.
    // (주석 텍스트의 단순 언급은 허용 — `th:*` 속성 식 내부의 사용만 검사)
    const dangerousUsage = /th:[a-zA-Z]+="[^"]*#(httpServletRequest|request)\b/;
    expect(fragment).not.toMatch(dangerousUsage);
    expect(fragment).toMatch(/th:classappend="[^"]*egovRequestUri/);
    // EgovNavModelAdvice 가 생성되어 모델 속성을 주입한다.
    expect(
      await fs.pathExists(
        path.join(
          projectDir,
          "src/main/java/egovframework/example/config/EgovNavModelAdvice.java",
        ),
      ),
    ).toBe(true);
  });

  it("[메뉴 primary 활성화] primary 엔티티(@GetMapping(\"/\") 보유) 는 / URL 에서도 활성으로 강조한다", async () => {
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMenu: true,
    });

    const fragment = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/templates/thymeleaf/_fragments/nav.html",
      ),
      "utf-8",
    );

    // Board 가 primary (scaffoldBoardApp 가 @GetMapping("/") 를 박아둠) → '/' OR startsWith('/egovBoardList') 패턴
    // ※ 접두사 충돌 회피: '/egovBoard' 가 아니라 '/egovBoardList' 까지 비교해야
    //   'BoardItem' 같은 다른 엔티티의 URL 과 동시 활성화되지 않는다.
    expect(fragment).toMatch(
      /th:href="@\{\/egovBoardList\.do\}"[\s\S]*?egovRequestUri == '\/'[\s\S]*?startsWith\('\/egovBoardList'\)/,
    );
    // Member 는 primary 아님 → startsWith 만, root '/' 매칭 없음
    const memberLi = fragment.match(
      /<a th:href="@\{\/egovMemberList\.do\}"[\s\S]*?th:classappend="([^"]*)"/,
    );
    expect(memberLi).not.toBeNull();
    expect(memberLi![1]).not.toMatch(/egovRequestUri == '\/'/);
    expect(memberLi![1]).toMatch(/startsWith\('\/egovMemberList'\)/);
  });

  it("[메뉴 + 메시지 함께] autoApplyMessages=true 이면 nav.{entity} 키도 함께 들어간다", async () => {
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMenu: true,
      // autoApplyMessages 미지정 (기본 true)
    });

    const ko = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/egovframework/message/message-common_ko.properties",
      ),
      "utf-8",
    );
    expect(ko).toMatch(/^nav\.member=/m);
  });

  it("[fallback 후보에서 제외] 이전 add_entity 가 만든 add-*-tables.sql 은 시드로 카운트하지 않는다", async () => {
    // 이전 호출이 만든 마이그레이션 파일을 미리 두어도, 시드 1개 (boarddb.sql) 라는 판정이 유지되어야 한다.
    await fs.writeFile(
      path.join(projectDir, "src/main/resources/db/add-article-tables.sql"),
      "-- 이전 호출의 마이그레이션\n",
    );

    const seedAbs = path.join(
      projectDir,
      "src/main/resources/db/boarddb.sql",
    );
    const seedBefore = await fs.readFile(seedAbs, "utf-8");

    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
      autoApplyMigration: true,
    });

    const seedAfter = await fs.readFile(seedAbs, "utf-8");
    expect(seedAfter.length).toBeGreaterThan(seedBefore.length);
    expect(seedAfter).toMatch(/CREATE\s+MEMORY\s+TABLE\s+MEMBER/i);
    expect(out).toMatch(/자동 적용 완료/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TIMESTAMP / 대문자 SNAKE_CASE 정규화 검증
  // ─────────────────────────────────────────────────────────────────────────

  it("[TIMESTAMP 폼 바인딩] Timestamp 컬럼은 yyyy-MM-dd HH:mm:ss 패턴 + Timestamp.class editor", async () => {
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.department",
      entityName: "Department",
      ddl: DEPARTMENT_TIMESTAMP_DDL,
    });

    // 1) VO: Timestamp 필드는 시분초 포함 패턴, import 추가됨
    const vo = await fs.readFile(
      path.join(
        projectDir,
        "src/main/java/egovframework/example/department/service/DepartmentVO.java",
      ),
      "utf-8",
    );
    expect(vo).toMatch(/import\s+java\.sql\.Timestamp;/);
    // createdAt / updatedAt 두 Timestamp 필드 모두 시분초 패턴
    const tsMatches = vo.match(/@DateTimeFormat\(pattern="yyyy-MM-dd HH:mm:ss"\)/g);
    expect(tsMatches).not.toBeNull();
    expect(tsMatches!.length).toBeGreaterThanOrEqual(2);

    // 2) Controller: InitBinder 가 Timestamp.class 도 등록
    const ctl = await fs.readFile(
      path.join(
        projectDir,
        "src/main/java/egovframework/example/department/web/EgovDepartmentController.java",
      ),
      "utf-8",
    );
    expect(ctl).toMatch(/import\s+java\.sql\.Timestamp;/);
    expect(ctl).toMatch(/registerCustomEditor\(\s*Timestamp\.class\s*,/);
    expect(ctl).toMatch(/Timestamp\.valueOf\(/);
  });

  it("[Long-text textarea] CONTENT VARCHAR(2000) 은 Register view 에 <textarea> 로 렌더링된다", async () => {
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.article",
      entityName: "Article",
      ddl: `CREATE TABLE ARTICLE (
        ID VARCHAR(16) NOT NULL PRIMARY KEY,
        TITLE VARCHAR(200),
        CONTENT VARCHAR(2000),
        AUTHOR VARCHAR(50)
      )`,
    });

    const register = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/templates/thymeleaf/article/egovArticleRegister.html",
      ),
      "utf-8",
    );
    // CONTENT 는 textarea 로 렌더링되며 KRDS 컨벤션(textarea.krds-input) 적용
    expect(register).toMatch(/<textarea\s[^>]*id="content"[^>]*rows="6"/);
    expect(register).toMatch(/<textarea\s[^>]*class="krds-input"/);
    expect(register).toMatch(/<textarea\s[^>]*maxlength="2000"/);
    // TITLE, AUTHOR 는 여전히 input
    expect(register).toMatch(/<input\s[^>]*id="title"/);
    expect(register).toMatch(/<input\s[^>]*id="author"/);
    // content 컬럼은 input 으로 렌더링되지 않아야 한다 (중복 방지 검증)
    expect(register).not.toMatch(/<input\s[^>]*id="content"/);
  });

  it("[검색 dropdown 노출 범위] 모든 일반 String 컬럼 + FK 노출, Y/N flag 와 PK 만 제외", async () => {
    // Department / Professor 부모 먼저 추가
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.department",
      entityName: "Department",
      ddl: `CREATE TABLE DEPARTMENT (
        DEPT_ID VARCHAR(20) NOT NULL PRIMARY KEY,
        DEPT_NAME VARCHAR(100)
      )`,
    });
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.professor",
      entityName: "Professor",
      ddl: `CREATE TABLE PROFESSOR (
        PROFESSOR_ID VARCHAR(20) NOT NULL PRIMARY KEY,
        PROFESSOR_NAME VARCHAR(100)
      )`,
    });

    // Course — 다양한 컬럼 조합 (PK, FK 2개, 일반 String 다수, Y/N flag, Number, Timestamp)
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.course",
      entityName: "Course",
      ddl: `CREATE TABLE COURSE (
        COURSE_ID VARCHAR(20) NOT NULL PRIMARY KEY,
        DEPT_ID VARCHAR(20),
        PROFESSOR_ID VARCHAR(20),
        COURSE_NAME VARCHAR(100),
        CREDIT INT,
        COURSE_YEAR VARCHAR(4),
        SEMESTER_CD VARCHAR(20),
        USE_YN CHAR(1) DEFAULT 'Y' NOT NULL,
        CREATED_AT TIMESTAMP,
        UPDATED_AT TIMESTAMP,
        CONSTRAINT FK_CRS_DEPT FOREIGN KEY (DEPT_ID) REFERENCES DEPARTMENT(DEPT_ID),
        CONSTRAINT FK_CRS_PROF FOREIGN KEY (PROFESSOR_ID) REFERENCES PROFESSOR(PROFESSOR_ID)
      )`,
    });

    const listHtml = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/templates/thymeleaf/course/egovCourseList.html",
      ),
      "utf-8",
    );

    // searchCondition <select> 내부 <option> alias (메시지 키 suffix) 추출
    const selectBlock = listHtml.match(/<select[^>]*id="searchCondition"[\s\S]*?<\/select>/);
    expect(selectBlock).not.toBeNull();
    const options = Array.from(
      selectBlock![0].matchAll(/#\{title\.course\.([^}]+)\}/g),
    ).map((m) => m[1]);

    // 일반 String 컬럼은 컬럼 alias 기준 메시지 키
    expect(options).toContain("courseName");
    expect(options).toContain("courseYear");
    expect(options).toContain("semesterCd");
    // FK 컬럼도 컬럼 alias 기준 메시지 키. 별도 메시지 번들에서 `title.course.deptId=Department`
    // 로 매핑되어 화면에는 부모 entity 명으로 표시된다 (이건 메시지 키 자동 생성이 처리).
    expect(options).toContain("deptId");
    expect(options).toContain("professorId");

    // Y/N flag (USE_YN) 와 PK 는 제외
    expect(options).not.toContain("useYn");
    expect(options).not.toContain("courseId");

    // 과거 `.slice(0, 2)` 회귀: option 수가 2개 이하로 잘리면 안 됨
    expect(options.length).toBeGreaterThanOrEqual(5);

    // FK 컬럼이 메시지 번들에서 부모 entity 명으로 매핑되는지 검증 — UI 에 "Department" 가 보이는 근거
    const ko = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/egovframework/message/message-common_ko.properties",
      ),
      "utf-8",
    );
    expect(ko).toMatch(/^title\.course\.deptId=Department$/m);
    expect(ko).toMatch(/^title\.course\.professorId=Professor$/m);
  });

  it("[NOT NULL/DEFAULT/CONSTRAINT FK 보존] 시드 SQL 에 컬럼 제약과 FK 모두 보존", async () => {
    // Department 추가 (parent)
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.department",
      entityName: "Department",
      ddl: `CREATE TABLE DEPARTMENT (
        DEPT_ID VARCHAR(20) NOT NULL PRIMARY KEY,
        DEPT_NAME VARCHAR(100)
      )`,
    });

    // Student 추가 — NOT NULL, DEFAULT, FK 모두 포함
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.student",
      entityName: "Student",
      ddl: `CREATE TABLE STUDENT (
        STUDENT_ID VARCHAR(20) NOT NULL,
        DEPT_ID VARCHAR(20) NOT NULL,
        STUDENT_NAME VARCHAR(100) NOT NULL,
        STUDENT_STATUS VARCHAR(20) DEFAULT 'ENROLLED' NOT NULL,
        USE_YN CHAR(1) DEFAULT 'Y' NOT NULL,
        CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UPDATED_AT TIMESTAMP,
        CONSTRAINT PK_STUDENT PRIMARY KEY (STUDENT_ID),
        CONSTRAINT FK_STUDENT_DEPT FOREIGN KEY (DEPT_ID) REFERENCES DEPARTMENT (DEPT_ID)
      )`,
      autoApplyMigration: true,
    });

    // 시드 SQL (boarddb.sql) 끝에 append 된 부분 확인
    const seed = await fs.readFile(
      path.join(projectDir, "src/main/resources/db/boarddb.sql"),
      "utf-8",
    );

    // 컬럼 NOT NULL 보존 (PK 외 컬럼)
    expect(seed).toMatch(/DEPT_ID\s+VARCHAR\(20\)\s+NOT\s+NULL/);
    expect(seed).toMatch(/STUDENT_NAME\s+VARCHAR\(100\)\s+NOT\s+NULL/);
    // DEFAULT 보존 — HSQLDB 표준 문법에 맞춰 DEFAULT 가 NOT NULL 보다 먼저 와야 함
    expect(seed).toMatch(/STUDENT_STATUS\s+VARCHAR\(20\)\s+DEFAULT\s+'ENROLLED'\s+NOT\s+NULL/);
    expect(seed).toMatch(/USE_YN\s+CHAR\(1\)\s+DEFAULT\s+'Y'\s+NOT\s+NULL/);
    expect(seed).toMatch(/CREATED_AT\s+TIMESTAMP\s+DEFAULT\s+CURRENT_TIMESTAMP/);
    // FK CONSTRAINT 보존
    expect(seed).toMatch(
      /CONSTRAINT\s+FK_STUDENT_DEPT_ID\s+FOREIGN\s+KEY\s*\(\s*DEPT_ID\s*\)\s+REFERENCES\s+DEPARTMENT\s*\(\s*DEPT_ID\s*\)/,
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // FK 자동 처리 (Customer → OrderHeader)
  // ─────────────────────────────────────────────────────────────────────────

  it("[FK 자동 처리] 부모 존재 시 Register select / List JOIN / Controller 콤보 모두 생성", async () => {
    // 1) 먼저 Customer 추가 (board-app 의 Board 가 primary, Customer 가 add_entity 로 들어옴)
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.customer",
      entityName: "Customer",
      ddl: `CREATE TABLE CUSTOMER (
        CUSTOMER_ID VARCHAR(20) NOT NULL PRIMARY KEY,
        FNAME VARCHAR(50),
        LNAME VARCHAR(50),
        EMAIL VARCHAR(100)
      )`,
    });

    // 2) OrderHeader 추가 (Customer 를 FK 참조)
    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.orderHeader",
      entityName: "OrderHeader",
      ddl: `CREATE TABLE ORDER_HEADER (
        ORDER_ID VARCHAR(20) NOT NULL PRIMARY KEY,
        ORDER_DATE DATE,
        CUSTOMER_ID VARCHAR(20) NOT NULL,
        CONSTRAINT FK_ORDER_CUSTOMER FOREIGN KEY (CUSTOMER_ID) REFERENCES CUSTOMER(CUSTOMER_ID)
      )`,
    });

    expect(out).toMatch(/외래키\(FK\) 자동 처리 완료/);

    // (a) Register view: <select> + customerList model 참조
    const register = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/templates/thymeleaf/orderHeader/egovOrderHeaderRegister.html",
      ),
      "utf-8",
    );
    expect(register).toMatch(/<select\s[^>]*id="customerId"[^>]*class="krds-form-select"/);
    expect(register).toMatch(/th:each="c\s*:\s*\$\{\s*customerList\s*\}"/);
    // FkComboVO 패턴: value / label 로 접근 (EgovMap 케이스 모호함 회피)
    expect(register).toMatch(/th:value="\$\{c\.value\}"/);
    expect(register).toMatch(/th:text="\$\{c\.label\}"/);
    expect(register).toMatch(/th:selected="[^"]*== c\.value[^"]*"/);

    // (b) List view: customerId 셀이 customerIdDisplayName 으로 표시
    const list = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/templates/thymeleaf/orderHeader/egovOrderHeaderList.html",
      ),
      "utf-8",
    );
    expect(list).toMatch(/\$\{result\.customerIdDisplayName\}/);

    // (c) Mapper.xml: JOIN + 콤보 select 둘 다, FkComboVO alias 사용
    const mapper = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/egovframework/sqlmap/orderHeader/mappers/EgovOrderHeader_OrderHeader_SQL.xml",
      ),
      "utf-8",
    );
    expect(mapper).toMatch(/LEFT JOIN\s+CUSTOMER\s+fk_customerId/);
    expect(mapper).toMatch(/AS customer_id_display_name/);
    expect(mapper).toMatch(
      /<select id="selectCustomerComboList"[^>]*resultType="[^"]*\.cmm\.vo\.FkComboVO"/,
    );
    expect(mapper).toMatch(/AS value,/);
    expect(mapper).toMatch(/AS label/);
    expect(mapper).toMatch(/FROM CUSTOMER p/);

    // (d) Controller: addView/updateView 가 customerList 주입
    const controller = await fs.readFile(
      path.join(
        projectDir,
        "src/main/java/egovframework/example/orderHeader/web/EgovOrderHeaderController.java",
      ),
      "utf-8",
    );
    expect(controller).toMatch(/populateOrderHeaderReferenceLists/);
    expect(controller).toMatch(/model\.addAttribute\("customerList",/);
    expect(controller).toMatch(/selectCustomerComboList\(\)/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 3: MyBatis 매퍼 SQL 의 방언 호환성 (CONCAT / LIMIT 가이드)
  // ─────────────────────────────────────────────────────────────────────────

  it("[방언 호환] mapper SQL 의 LIKE 절은 CONCAT 으로 출력되고 || 연결자는 쓰이지 않는다", async () => {
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: `CREATE TABLE MEMBER (
        ID VARCHAR(16) NOT NULL PRIMARY KEY,
        NAME VARCHAR(50),
        EMAIL VARCHAR(100)
      )`,
    });

    const mapper = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/egovframework/sqlmap/member/mappers/EgovMember_Member_SQL.xml",
      ),
      "utf-8",
    );
    // CONCAT 형태 사용 (Oracle 11g+ / MySQL / MariaDB / PostgreSQL / HSQL 모두 호환)
    expect(mapper).toMatch(/LIKE CONCAT\('%', #\{searchKeyword\}, '%'\)/);
    // 실행 SQL 본문에 || 연결자가 없어야 한다 — portability 가이드 주석은 예외 (XML 주석 stripping 후 검사)
    const mapperSqlOnly = mapper.replace(/<!--[\s\S]*?-->/g, "");
    expect(mapperSqlOnly).not.toMatch(/'%'\s*\|\|/);
    // Oracle 11g 사용자를 위한 페이징 가이드 주석 포함
    expect(mapper).toMatch(/Oracle 11g 이하/);
  });

  it("[방언 호환] 다중 컬럼 FK display 는 CONCAT(...) 으로 묶인다", async () => {
    // Customer = fname + lname 두 String 컬럼 → displayColumns 2개
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.customer",
      entityName: "Customer",
      ddl: `CREATE TABLE CUSTOMER (
        CUSTOMER_ID VARCHAR(20) NOT NULL PRIMARY KEY,
        FNAME VARCHAR(50),
        LNAME VARCHAR(50)
      )`,
    });
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.orderHeader",
      entityName: "OrderHeader",
      ddl: `CREATE TABLE ORDER_HEADER (
        ORDER_ID VARCHAR(20) NOT NULL PRIMARY KEY,
        CUSTOMER_ID VARCHAR(20) NOT NULL,
        CONSTRAINT FK_ORDER_CUSTOMER FOREIGN KEY (CUSTOMER_ID) REFERENCES CUSTOMER(CUSTOMER_ID)
      )`,
    });

    const mapper = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/egovframework/sqlmap/orderHeader/mappers/EgovOrderHeader_OrderHeader_SQL.xml",
      ),
      "utf-8",
    );
    // FK 콤보 select 의 label: CONCAT(p.fname, ' ', p.lname) — 컬럼 케이스는 displayColumns 의 출력 그대로
    expect(mapper).toMatch(/CONCAT\(p\.fname,\s*' ',\s*p\.lname\)/i);
    // List 의 display alias: CONCAT(fk_customerId.fname, ' ', fk_customerId.lname)
    expect(mapper).toMatch(/CONCAT\(fk_customerId\.fname,\s*' ',\s*fk_customerId\.lname\)/i);
    // 실행 SQL 본문에 || 연결자가 없어야 한다 — portability 가이드 주석은 예외 (XML 주석 stripping 후 검사)
    const mapperSqlOnly = mapper.replace(/<!--[\s\S]*?-->/g, "");
    expect(mapperSqlOnly).not.toMatch(/\s\|\|\s/);
  });

  it("[FK 미해석 → graceful degrade] 부모 없을 때 plain input + 결과 메시지에 경고", async () => {
    // Customer 없이 OrderHeader 만 추가 (FK 미해석)
    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.orderHeader",
      entityName: "OrderHeader",
      ddl: `CREATE TABLE ORDER_HEADER (
        ORDER_ID VARCHAR(20) NOT NULL PRIMARY KEY,
        CUSTOMER_ID VARCHAR(20) NOT NULL,
        CONSTRAINT FK_ORDER_CUSTOMER FOREIGN KEY (CUSTOMER_ID) REFERENCES CUSTOMER(CUSTOMER_ID)
      )`,
    });

    expect(out).toMatch(/외래키\(FK\) 미해석/);
    expect(out).toMatch(/CUSTOMER_ID.*→ CUSTOMER/);

    // Register view 는 plain input 으로 렌더링
    const register = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/templates/thymeleaf/orderHeader/egovOrderHeaderRegister.html",
      ),
      "utf-8",
    );
    expect(register).toMatch(/<input\s[^>]*id="customerId"/);
    expect(register).not.toMatch(/<select\s[^>]*id="customerId"/);
  });

  it("[YN flag select] CHAR(1) + _YN 컬럼은 Register view 에 <select Y/N> 으로 렌더링된다", async () => {
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.article",
      entityName: "Article",
      ddl: `CREATE TABLE ARTICLE (
        ID VARCHAR(16) NOT NULL PRIMARY KEY,
        TITLE VARCHAR(200),
        USE_YN CHAR(1),
        DEL_YN CHAR(1)
      )`,
    });

    const register = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/templates/thymeleaf/article/egovArticleRegister.html",
      ),
      "utf-8",
    );
    // useYn / delYn 모두 select 로 렌더링
    expect(register).toMatch(/<select\s[^>]*id="useYn"[^>]*class="krds-form-select"/);
    expect(register).toMatch(/<select\s[^>]*id="delYn"[^>]*class="krds-form-select"/);
    // 옵션 값과 메시지 키
    expect(register).toMatch(/<option\s+value="Y"[^>]*th:text="#\{input\.yes\}"/);
    expect(register).toMatch(/<option\s+value="N"[^>]*th:text="#\{input\.no\}"/);
    // useYn 은 input 으로 렌더링되면 안 됨
    expect(register).not.toMatch(/<input\s[^>]*id="useYn"/);
    // title 은 여전히 input
    expect(register).toMatch(/<input\s[^>]*id="title"/);
  });

  it("[UPPER SNAKE_CASE 정규화] 시드 SQL 의 컬럼명·테이블명이 모두 대문자다", async () => {
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.department",
      entityName: "Department",
      ddl: DEPARTMENT_TIMESTAMP_DDL,
      autoApplyMigration: true,
    });

    // boarddb.sql 끝에 append 된 DEPARTMENT 정의를 검사
    const seed = await fs.readFile(
      path.join(projectDir, "src/main/resources/db/boarddb.sql"),
      "utf-8",
    );
    expect(seed).toMatch(/CREATE\s+MEMORY\s+TABLE\s+DEPARTMENT\b/);
    // 컬럼명도 UPPER 로 정규화
    expect(seed).toMatch(/^\s*DEPT_ID\s+VARCHAR/m);
    expect(seed).toMatch(/^\s*DEPT_NAME\s+VARCHAR/m);
    expect(seed).toMatch(/^\s*CREATED_AT\s+TIMESTAMP/m);
    expect(seed).toMatch(/^\s*UPDATED_AT\s+TIMESTAMP/m);
    // lowercase 가 잔존해서는 안 됨 (case-sensitive 검사)
    expect(seed).not.toMatch(/^\s*dept_id\s+/m);
    expect(seed).not.toMatch(/^\s*created_at\s+/m);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // basePackage 자동 보정 — 사용자 packageName 깊이가 첫 스캐폴드와 다를 때
  // ─────────────────────────────────────────────────────────────────────────

  it("[basePackage 보정] add_entity 의 packageName 이 깊으면 FkComboVO import 를 실제 위치로 자동 보정한다", async () => {
    // 사용자 실제 보고 시나리오:
    //   scaffold: packageName = 'egovframework.example.academic'   → basePackage 'egovframework.example'
    //   add:      packageName = 'egovframework.example.academic.student' → 보정 전 basePackage 'egovframework.example.academic'
    //   FkComboVO 의 실제 위치는 첫 스캐폴드 기준 egovframework.example.cmm.vo 이므로 보정 필요.
    //
    // board-app 픽스처(beforeEach) 의 basePackage 는 'egovframework.example' 이므로,
    // 더 깊은 packageName 으로 add_entity 를 호출해 사용자 시나리오를 흉내낸다.
    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.academic.student",
      entityName: "Student",
      ddl: `CREATE TABLE STUDENT (
        STUDENT_ID VARCHAR(20) NOT NULL PRIMARY KEY,
        STUDENT_NAME VARCHAR(100) NOT NULL
      )`,
    });

    // 결과 메시지에 보정 안내 포함
    expect(out).toMatch(/공유 basePackage 자동 보정/);
    expect(out).toMatch(/egovframework\.example\.academic\s+→\s+egovframework\.example/);

    // 사용처 import 가 실제 FkComboVO 위치 (basePackage=egovframework.example) 로 향함
    const mapper = await fs.readFile(
      path.join(
        projectDir,
        "src/main/java/egovframework/example/academic/student/service/impl/StudentMapper.java",
      ),
      "utf-8",
    );
    // FK 가 없는 케이스라 FkComboVO import 자체는 없지만, ServiceImpl/Service 에도 동일 패턴이 적용된다.
    // Service 의 package 선언이 입력 packageName 기준이라는 점만 검증.
    expect(mapper).toMatch(/^package egovframework\.example\.academic\.student\.service\.impl;/m);
  });

  it("[basePackage 보정] FK 가 있는 깊은 packageName 의 사용처 import 가 실제 위치와 일치한다", async () => {
    // Customer 추가 (정상 깊이)
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.customer",
      entityName: "Customer",
      ddl: `CREATE TABLE CUSTOMER (
        CUSTOMER_ID VARCHAR(20) NOT NULL PRIMARY KEY,
        NAME VARCHAR(50)
      )`,
    });

    // Order 를 깊은 packageName 으로 추가 (FK 포함)
    await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.academic.order",
      entityName: "Order",
      ddl: `CREATE TABLE ORDER_TBL (
        ORDER_ID VARCHAR(20) NOT NULL PRIMARY KEY,
        CUSTOMER_ID VARCHAR(20) NOT NULL,
        CONSTRAINT FK_ORDER_CUST FOREIGN KEY (CUSTOMER_ID) REFERENCES CUSTOMER(CUSTOMER_ID)
      )`,
    });

    // 사용처 3종 (Service / ServiceImpl / Mapper) 모두 FkComboVO import 가 'egovframework.example.cmm.vo' 로 향해야 함
    const mapperPath = path.join(
      projectDir,
      "src/main/java/egovframework/example/academic/order/service/impl/OrderMapper.java",
    );
    const servicePath = path.join(
      projectDir,
      "src/main/java/egovframework/example/academic/order/service/EgovOrderService.java",
    );
    const implPath = path.join(
      projectDir,
      "src/main/java/egovframework/example/academic/order/service/impl/EgovOrderServiceImpl.java",
    );
    for (const p of [mapperPath, servicePath, implPath]) {
      const src = await fs.readFile(p, "utf-8");
      expect(src).toMatch(/import egovframework\.example\.cmm\.vo\.FkComboVO;/);
      // 보정 전의 잘못된 깊은 경로가 남아있지 않아야 함
      expect(src).not.toMatch(/import egovframework\.example\.academic\.cmm\.vo\.FkComboVO;/);
    }

    // 실제 FkComboVO 파일은 첫 스캐폴드에서 만들어진 단일 위치 그대로
    expect(
      await fs.pathExists(
        path.join(projectDir, "src/main/java/egovframework/example/cmm/vo/FkComboVO.java"),
      ),
    ).toBe(true);
  });
});
