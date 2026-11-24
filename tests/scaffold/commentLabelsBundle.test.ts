/**
 * DDL COMMENT → 메시지 번들 라벨 통합 테스트
 *
 * 실제로 임시 디렉터리에 프로젝트를 스캐폴드(또는 엔티티 추가)한 뒤 생성된 메시지 번들을 읽어,
 *   - 기본/ko 번들에 컬럼·테이블 코멘트가 라벨로 들어가는지
 *   - 규칙(콤마·괄호·10자 초과)에 걸린 코멘트는 현행 PascalCase 로 폴백하는지
 *   - WAR 4.3 은 한글이 \uXXXX 로 이스케이프되는지
 *   - _en 번들과 코멘트 없는 DDL 의 출력은 현행과 같은지
 * 를 고정한다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const MSG_DIR = "src/main/resources/egovframework/message";

const NOTICE_DDL = `CREATE TABLE NOTICE (
  NTT_ID VARCHAR(20) NOT NULL COMMENT '공지사항ID',
  NTT_SJ VARCHAR(200) NOT NULL COMMENT '공지사항제목',
  NTT_CN TEXT COMMENT '공지사항의 본문 내용을 저장하는 컬럼',
  USE_YN CHAR(1) COMMENT '사용여부(Y/N)',
  TAGS VARCHAR(100) COMMENT '태그1, 태그2',
  PRIMARY KEY (NTT_ID)) COMMENT='공지사항'`;

const PLAIN_DDL = `CREATE TABLE MEMBER (ID VARCHAR(16) NOT NULL PRIMARY KEY, EMAIL VARCHAR(100))`;

let tmpRoot: string;

async function scaffold(opts: {
  projectType: "boot" | "war";
  stackVersion: "4.3" | "5.0";
  entityName: string;
  ddl: string;
  projectName: string;
}): Promise<string> {
  const out = await generateScaffoldProject({
    projectName: opts.projectName,
    packageName: `egovframework.example.${opts.entityName.toLowerCase()}`,
    outputPath: tmpRoot,
    entityName: opts.entityName,
    ddl: opts.ddl,
    description: "",
    projectType: opts.projectType,
    stackVersion: opts.stackVersion,
  });
  return JSON.parse(out).projectDir as string;
}

async function readBundles(projectDir: string) {
  const r = (f: string) => fs.readFile(path.join(projectDir, MSG_DIR, f), "utf-8");
  return {
    def: await r("message-common.properties"),
    ko: await r("message-common_ko.properties"),
    en: await r("message-common_en.properties"),
  };
}

/** 정확히 한 줄이 `key=value` 인지 (value 는 정규식 소스, 대소문자 무관 — \u 16진수 표기 차이 허용) */
function expectLine(content: string, key: string, valuePattern: string) {
  const re = new RegExp(`^${key.replace(/\./g, "\\.")}=${valuePattern}$`, "mi");
  expect(content, `${key} 줄이 기대값과 다릅니다`).toMatch(re);
}

const U = (s: string) =>
  s.replace(/[^\x20-\x7e]/g, (ch) => "\\\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-comment-labels-"));
});

afterAll(async () => {
  await fs.remove(tmpRoot);
});

describe("코멘트 라벨 — boot50 scaffold", () => {
  let b: Awaited<ReturnType<typeof readBundles>>;
  beforeAll(async () => {
    b = await readBundles(
      await scaffold({ projectType: "boot", stackVersion: "5.0", entityName: "Notice", ddl: NOTICE_DDL, projectName: "n-boot50" }),
    );
  });

  it("기본/ko 번들: 컬럼 코멘트가 라벨, 규칙 위반은 PascalCase 폴백", () => {
    for (const c of [b.def, b.ko]) {
      expectLine(c, "title.notice.nttId", "공지사항ID");
      expectLine(c, "title.notice.nttSj", "공지사항제목");
      expectLine(c, "title.notice.nttCn", "NttCn");
      expectLine(c, "title.notice.useYn", "사용여부");
      expectLine(c, "title.notice.tags", "Tags");
    }
  });

  it("기본/ko 번들: 테이블 코멘트가 제목·메뉴·목록 제목에 반영", () => {
    for (const c of [b.def, b.ko]) {
      expectLine(c, "nav.notice", "공지사항");
      expectLine(c, "title.notice.sample", `공지사항 ${U("목록")}`);
      expectLine(c, "list.notice", `공지사항 ${U("목록")}`);
    }
  });

  it("기본/ko 번들: 필수 입력 안내문의 라벨도 코멘트", () => {
    expectLine(b.def, "confirm.required.notice.nttSj", `공지사항제목${U("은(는) 필수 입력값입니다.").replace(/[()]/g, "\\$&")}`);
  });

  it("en 번들은 현행 그대로", () => {
    expectLine(b.en, "title.notice.nttSj", "NttSj");
    expectLine(b.en, "nav.notice", "Notice");
  });
});

describe("코멘트 라벨 — war43 scaffold", () => {
  let b: Awaited<ReturnType<typeof readBundles>>;
  beforeAll(async () => {
    b = await readBundles(
      await scaffold({ projectType: "war", stackVersion: "4.3", entityName: "Notice", ddl: NOTICE_DDL, projectName: "n-war43" }),
    );
  });

  it("기본/ko 번들: 라벨이 \\uXXXX 로 이스케이프된다", () => {
    for (const c of [b.def, b.ko]) {
      expectLine(c, "title.notice.nttSj", U("공지사항제목"));
      expectLine(c, "title.notice.nttCn", "NttCn");
      expectLine(c, "nav.notice", U("공지사항"));
      expectLine(c, "title.notice", U("공지사항"));
      expectLine(c, "list.notice", `${U("공지사항")} ${U("목록")}`);
      expect(c).not.toMatch(/[가-힣]/);
    }
  });

  it("en 번들은 현행 그대로", () => {
    expectLine(b.en, "title.notice.nttSj", "NttSj");
    expectLine(b.en, "title.notice", "Notice");
  });
});

describe("코멘트 라벨 — egov_add_entity (boot50 프로젝트에 NOTICE 추가)", () => {
  let b: Awaited<ReturnType<typeof readBundles>>;
  let out: string;
  beforeAll(async () => {
    const projectDir = await scaffold({ projectType: "boot", stackVersion: "5.0", entityName: "Member", ddl: PLAIN_DDL, projectName: "m-add" });
    out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.notice",
      entityName: "Notice",
      ddl: NOTICE_DDL,
    });
    b = await readBundles(projectDir);
  });

  it("append 된 기본/ko 블록에 코멘트 라벨이 들어간다", () => {
    expect(out).toMatch(/추가 완료/);
    for (const c of [b.def, b.ko]) {
      expectLine(c, "title.notice.nttSj", "공지사항제목");
      expectLine(c, "title.notice.nttCn", "NttCn");
      expectLine(c, "nav.notice", "공지사항");
      expectLine(c, "title.notice.sample", "공지사항 목록");
      expectLine(c, "list.notice", "공지사항 목록");
    }
  });

  it("en 블록은 현행 그대로", () => {
    expectLine(b.en, "title.notice.nttSj", "NttSj");
    expectLine(b.en, "nav.notice", "Notice");
  });
});

describe("코멘트 없는 DDL 은 현행과 동일", () => {
  it("boot50", async () => {
    const b = await readBundles(
      await scaffold({ projectType: "boot", stackVersion: "5.0", entityName: "Member", ddl: PLAIN_DDL, projectName: "m-boot50" }),
    );
    expectLine(b.def, "list.member", "List Member");
    expectLine(b.def, "title.member.sample", `Member ${U("목록")}`);
    expectLine(b.def, "nav.member", "Member");
    expectLine(b.def, "title.member.email", "Email");
  });

  it("war43", async () => {
    const b = await readBundles(
      await scaffold({ projectType: "war", stackVersion: "4.3", entityName: "Member", ddl: PLAIN_DDL, projectName: "m-war43" }),
    );
    expectLine(b.def, "list.member", "Member List");
    expectLine(b.def, "title.member", "Member");
    expectLine(b.def, "title.member.email", "Email");
  });
});
