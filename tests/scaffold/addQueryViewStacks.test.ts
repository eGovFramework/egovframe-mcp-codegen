/**
 * egov_add_query_view — Boot 4.3 / WAR 4.3 스택 지원 테스트.
 *
 * 산출물 경로·Mapper 어노테이션·Controller 관례·nav/메시지 자동 적용·타입별 렌더링·멱등/충돌·
 * Date format 검증을 스택별로 검증한다. Boot 5.1 은 addQueryView.test.ts / golden.test.ts 가 담당한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { egovAddQueryView, AddQueryViewInputSchema } from "../../src/tools/egovAddQueryView.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

type Stack = "boot43" | "war43";

const PKG = "egovframework.example.report";
const PKG_PATH = "egovframework/example/report";
const VIEW = "PayReport";
const MSG_DIR = "src/main/resources/egovframework/message";
const MSG_FILES = ["message-common_ko.properties", "message-common_en.properties", "message-common.properties"];

interface StackSpec {
  label: string;
  projectType: "boot" | "war";
  /** 8개 산출물 (프로젝트 루트 기준) */
  files: Record<"defaultVo" | "vo" | "mapper" | "service" | "serviceImpl" | "controller" | "sqlXml" | "view", string>;
  nav: string;
  mapperAnnotationImport: string;
}

const SPECS: Record<Stack, StackSpec> = {
  boot43: {
    label: "Boot 4.3",
    projectType: "boot",
    files: {
      defaultVo: `src/main/java/${PKG_PATH}/${VIEW}DefaultVO.java`,
      vo: `src/main/java/${PKG_PATH}/${VIEW}VO.java`,
      mapper: `src/main/java/${PKG_PATH}/impl/${VIEW}Mapper.java`,
      service: `src/main/java/${PKG_PATH}/Egov${VIEW}Service.java`,
      serviceImpl: `src/main/java/${PKG_PATH}/impl/Egov${VIEW}ServiceImpl.java`,
      controller: `src/main/java/egovframework/example/report/web/Egov${VIEW}Controller.java`,
      sqlXml: `src/main/resources/egovframework/sqlmap/report/mappers/Egov${VIEW}_${VIEW}_SQL.xml`,
      // Boot 4.3 는 모듈 하위 디렉터리 없이 templates/thymeleaf 바로 아래
      view: `src/main/resources/templates/thymeleaf/egov${VIEW}List.html`,
    },
    nav: "src/main/resources/templates/thymeleaf/_fragments/nav.html",
    mapperAnnotationImport: "import org.egovframe.rte.psl.dataaccess.mapper.Mapper;",
  },
  war43: {
    label: "WAR 4.3",
    projectType: "war",
    files: {
      defaultVo: `src/main/java/${PKG_PATH}/${VIEW}DefaultVO.java`,
      vo: `src/main/java/${PKG_PATH}/${VIEW}VO.java`,
      mapper: `src/main/java/${PKG_PATH}/impl/${VIEW}Mapper.java`,
      service: `src/main/java/${PKG_PATH}/Egov${VIEW}Service.java`,
      serviceImpl: `src/main/java/${PKG_PATH}/impl/Egov${VIEW}ServiceImpl.java`,
      controller: `src/main/java/egovframework/example/report/web/Egov${VIEW}Controller.java`,
      sqlXml: `src/main/resources/egovframework/sqlmap/report/mappers/Egov${VIEW}_${VIEW}_SQL.xml`,
      view: `src/main/webapp/WEB-INF/jsp/${PKG_PATH}/egov${VIEW}List.jsp`,
    },
    nav: "src/main/webapp/WEB-INF/jsp/_fragments/nav.jsp",
    mapperAnnotationImport: "import org.egovframe.rte.psl.dataaccess.mapper.Mapper;",
  },
};

let tmpRoot: string;
let projectDir: string;

const read = (rel: string) => fs.readFile(path.join(projectDir, rel), "utf-8");

/** 프로젝트 안에서 파일명으로 파일을 찾는다 (엔티티 Mapper 위치가 스택마다 달라 탐색). */
async function findFile(dir: string, name: string): Promise<string | undefined> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = await findFile(p, name);
      if (r) return r;
    } else if (e.name === name) {
      return p;
    }
  }
  return undefined;
}

const COLUMNS = [
  { alias: "id", label: "아이디", type: "String" },
  { alias: "name", label: "이름", type: "String" },
  { alias: "joinDate", label: "가입일", type: "Date", format: "yyyy/MM/dd" },
  { alias: "createdAt", label: "생성일시", type: "Timestamp", format: "yyyy-MM-dd HH:mm" },
  { alias: "amount", label: "금액", type: "Number", format: "#,##0.00" },
  { alias: "active", label: "사용여부", type: "Boolean" },
];

function args(overrides: Record<string, unknown> = {}) {
  return {
    projectPath: projectDir,
    packageName: PKG,
    viewName: VIEW,
    sql: "SELECT e.ID AS id, e.NAME AS name FROM EMPLOYEE e",
    columns: COLUMNS,
    searchable: ["name"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpRoot);
});

for (const stack of ["boot43", "war43"] as const) {
  const spec = SPECS[stack];
  const isWar = stack === "war43";

  describe(`egov_add_query_view — ${spec.label}`, () => {
    beforeEach(async () => {
      tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `egov-qv-${stack}-`));
      await generateScaffoldProject({
        projectName: "hr-app",
        packageName: "egovframework.example.employee",
        outputPath: tmpRoot,
        entityName: "Employee",
        ddl: "CREATE TABLE EMPLOYEE (ID VARCHAR(20) NOT NULL PRIMARY KEY, NAME VARCHAR(50))",
        description: "",
        projectType: spec.projectType,
        stackVersion: "4.3",
      });
      projectDir = path.join(tmpRoot, "hr-app");
      await egovAddEntity({
        projectPath: projectDir,
        packageName: "egovframework.example.dept",
        entityName: "Dept",
        ddl: "CREATE TABLE DEPT (DEPT_ID VARCHAR(20) NOT NULL PRIMARY KEY, DEPT_NAME VARCHAR(50))",
      });
    });

    it("산출물 8개를 스택 경로에 생성한다", async () => {
      const out = await egovAddQueryView(args());
      expect(out).toMatch(/Query view 'PayReport' 추가 완료/);
      expect(Object.keys(spec.files)).toHaveLength(8);
      for (const [k, rel] of Object.entries(spec.files)) {
        expect(await fs.pathExists(path.join(projectDir, rel)), `${k}: ${rel}`).toBe(true);
      }
      // 다른 스택의 화면 경로는 만들지 않는다
      const otherView = isWar
        ? "src/main/resources/templates/thymeleaf/report/egovPayReportList.html"
        : `src/main/webapp/WEB-INF/jsp/${PKG_PATH}/egovPayReportList.jsp`;
      expect(await fs.pathExists(path.join(projectDir, otherView))).toBe(false);
    });

    it("Java 산출물에 jakarta. 가 없고 Mapper 어노테이션이 엔티티 Mapper 와 같다", async () => {
      await egovAddQueryView(args());
      for (const key of ["defaultVo", "vo", "mapper", "service", "serviceImpl", "controller"] as const) {
        expect(await read(spec.files[key]), key).not.toContain("jakarta.");
      }
      const mapper = await read(spec.files.mapper);
      const entityMapperPath = await findFile(path.join(projectDir, "src/main/java"), "EmployeeMapper.java");
      expect(entityMapperPath, "EmployeeMapper.java").toBeDefined();
      const entityMapper = await fs.readFile(entityMapperPath!, "utf-8");
      const importOf = (src: string) => /^import\s+[\w.]*\.Mapper;$/m.exec(src)?.[0];
      expect(importOf(mapper)).toBeDefined();
      expect(importOf(mapper)).toBe(importOf(entityMapper));
      expect(importOf(mapper)).toBe(spec.mapperAnnotationImport);
      expect(mapper).toMatch(/^@Mapper$/m);
    });

    it("Controller 의 매핑 URL 과 반환 뷰 이름이 스택 관례를 따른다", async () => {
      await egovAddQueryView(args());
      const ctl = await read(spec.files.controller);
      expect(ctl).toContain('@GetMapping("/egovPayReportList.do")');
      expect(ctl).toMatch(/package egovframework\.example\.report\.web;/);
      // Boot 4.3: 템플릿 이름 egovPayReportList / WAR: ViewResolver 가 /WEB-INF/jsp/ + 이름 + .jsp 로 해석 → 모듈 접두
      expect(ctl).toContain(isWar ? 'return "report/egovPayReportList";' : 'return "egovPayReportList";');
      expect(ctl).not.toMatch(/insertPayReport|updatePayReport|deletePayReport/);
    });

    it("autoApplyMenu 로 nav fragment 에 새 view 가 추가되고 기존 엔티티 메뉴는 유지된다", async () => {
      const before = await read(spec.nav);
      expect(before).not.toContain("PayReport");
      await egovAddQueryView(args({ autoApplyMenu: true }));
      const nav = await read(spec.nav);
      expect(nav).toContain("egovPayReportList");
      expect(nav).toContain("nav.payReport");
      expect(nav).toContain("egovEmployeeList");
      expect(nav).toContain("egovDeptList");
    });

    it("autoApplyMessages 로 메시지 번들 3종에 키가 append 되고 label 인코딩이 스택에 맞는다", async () => {
      await egovAddQueryView(args({ autoApplyMessages: true }));
      for (const f of MSG_FILES) {
        const c = await read(`${MSG_DIR}/${f}`);
        expect(c, f).toContain("# === query view 'PayReport' keys");
        expect(c, f).toMatch(/^list\.payReport=PayReport$/m);
        expect(c, f).toMatch(/^nav\.payReport=PayReport$/m);
        if (isWar) {
          // 아이디 = 아이디, 이름 = 이름
          expect(c, f).toMatch(/^title\.payReport\.id=\\uC544\\uC774\\uB514$/m);
          expect(c, f).toMatch(/^title\.payReport\.name=\\uC774\\uB984$/m);
          expect(c, f).not.toContain("아이디");
        } else {
          expect(c, f).toMatch(/^title\.payReport\.id=아이디$/m);
          expect(c, f).toMatch(/^title\.payReport\.name=이름$/m);
          // Boot 는 라벨을 이스케이프하지 않는다 (템플릿 고정 문구의 \uXXXX 와 구분하기 위해 라벨 줄만 본다)
          expect(c, f).not.toMatch(/^title\.payReport\.id=\\u/m);
        }
      }
    });

    it("Date/Timestamp/Number/Boolean 이 화면에 올바르게 렌더링된다", async () => {
      await egovAddQueryView(args());
      const rawView = await read(spec.files.view);
      // Thymeleaf 는 속성값의 HTML 엔티티를 디코딩하므로 Boot 는 정규화 후 비교한다. (JSP 는 아래 별도 테스트에서 엔티티 자체를 금지)
      const view = isWar ? rawView : rawView.replace(/&#x3D;/g, "=");
      if (isWar) {
        expect(view).toContain('<fmt:formatDate value="${result.joinDate}" pattern="yyyy/MM/dd"/>');
        expect(view).toContain('<fmt:formatDate value="${result.createdAt}" pattern="yyyy-MM-dd HH:mm"/>');
        expect(view).toContain('<fmt:formatNumber value="${result.amount}" pattern="#,##0.00"/>');
        expect(view).toMatch(/\$\{result\.active (!=|!&#x3D;) null and result\.active\}/);
        expect(view).toContain('<spring:message code="input.yes" htmlEscape="true" />');
        expect(view).toContain('<spring:message code="input.no" htmlEscape="true" />');
        expect(view).toContain('<spring:message code="title.payReport.joinDate" htmlEscape="true" />');
        // KRDS 페이지네이션 (Task 4) 과 KRDS 표 (Task 6)
        expect(view).toContain('type="krds" jsFunction="fn_egov_link_page"');
      } else {
        expect(view).toContain("#dates.format(result.joinDate, 'yyyy/MM/dd')");
        expect(view).toContain("#dates.format(result.createdAt, 'yyyy-MM-dd HH:mm')");
        expect(view).toContain("#numbers.formatDecimal(result.amount, 1, 'COMMA', 2, 'POINT')");
        expect(view).toContain("${result.active != null and result.active} ? #{input.yes} : #{input.no}");
        // KRDS 페이지네이션 렌더러 (Task 3) 와 KRDS 표 (Task 5)
        expect(view).toContain("#egovKrdsPaginationRenderer.renderPagination(paginationInfo, 'payReportPagination')");
      }
      const vo = await read(spec.files.vo);
      expect(vo).toMatch(/private java\.sql\.Date joinDate;|private Date joinDate;/);
      expect(vo).toMatch(/private Timestamp createdAt;/);
      expect(vo).toMatch(/private BigDecimal amount;/);
      expect(vo).toMatch(/private Boolean active;/);
    });

    if (isWar) {
      it("JSP 의 EL(${...}) 안에 HTML 엔티티(&#x3D; 등)가 섞이지 않는다", async () => {
        await egovAddQueryView(args());
        const jsp = await read(spec.files.view);
        // JSP(non-XML 문법)는 EL 안의 HTML 엔티티를 디코딩하지 않으므로 `!&#x3D;` 는 EL 구문 오류가 된다.
        expect(jsp).not.toMatch(/\$\{[^}]*&#x?[0-9a-fA-F]+;[^}]*\}/);
      });
    }

    it("Number 컬럼에 format 이 없으면 포맷터 없이 값을 그대로 출력한다", async () => {
      await egovAddQueryView(args({ columns: [{ alias: "id", label: "ID" }, { alias: "amount", label: "금액", type: "Number" }], searchable: [] }));
      const view = await read(spec.files.view);
      expect(view).not.toMatch(/formatDecimal|formatNumber/);
      expect(view).toContain("${result.amount}");
    });

    it("searchable 이 비어 있으면 검색 UI 와 mapper XML 검색 조건이 생성되지 않는다", async () => {
      await egovAddQueryView(args({ searchable: [] }));
      const view = await read(spec.files.view);
      expect(view).not.toContain("searchKeyword");
      expect(view).not.toContain("searchCondition");
      const xml = await read(spec.files.sqlXml);
      expect(xml).not.toMatch(/LIKE/);
      expect(xml).not.toContain("searchKeyword");
    });

    it("searchable 이 있으면 검색 UI 와 LIKE 조건이 생성된다", async () => {
      await egovAddQueryView(args({ searchable: ["name"] }));
      const view = await read(spec.files.view);
      expect(view).toContain("searchKeyword");
      expect(view).toContain("searchCondition");
      expect(await read(spec.files.sqlXml)).toMatch(/AND v\.name LIKE/);
    });

    it("같은 인자로 다시 호출하면 '변경 없음' 으로 성공한다 (autoApplyMessages 포함)", async () => {
      const a = args({ autoApplyMessages: true });
      await egovAddQueryView(a);
      const out = await egovAddQueryView(a);
      expect(out).toMatch(/이미 동일한 내용으로 생성되어 있습니다/);
      expect(out).toMatch(/변경 사항 없음/);
      // 재호출이 메시지 블록을 중복 append 하지 않는다
      const ko = await read(`${MSG_DIR}/message-common_ko.properties`);
      expect(ko.split("# === query view 'PayReport' keys").length - 1).toBe(1);
    });

    it("label 만 바꿔 다시 호출하면 충돌로 거부된다", async () => {
      await egovAddQueryView(args({ autoApplyMessages: true }));
      const changed = COLUMNS.map((c) => (c.alias === "name" ? { ...c, label: "성명" } : c));
      await expect(egovAddQueryView(args({ autoApplyMessages: true, columns: changed }))).rejects.toThrow(/충돌로 거부/);
      // 기존 메시지는 그대로
      const ko = await read(`${MSG_DIR}/message-common_ko.properties`);
      expect(ko).not.toMatch(/성명|\\uC131\\uBA85/);
    });

    it("sql 에 < 가 있어도 mapper XML 이 CDATA 로 보호된다", async () => {
      await egovAddQueryView(args({ sql: "SELECT e.ID AS id, e.NAME AS name FROM EMPLOYEE e WHERE e.AGE < 19 AND e.LV <> 0" }));
      const xml = await read(spec.files.sqlXml);
      expect(xml).toMatch(/<!\[CDATA\[/);
      expect(xml).toContain("e.AGE < 19");
      expect(xml).toContain("e.LV <> 0");
    });
  });
}

describe("egov_add_query_view — 스택별 메시지 이스케이프 세부 동작 (WAR)", () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-qv-war-esc-"));
    await generateScaffoldProject({
      projectName: "hr-app",
      packageName: "egovframework.example.employee",
      outputPath: tmpRoot,
      entityName: "Employee",
      ddl: "CREATE TABLE EMPLOYEE (ID VARCHAR(20) NOT NULL PRIMARY KEY)",
      description: "",
      projectType: "war",
      stackVersion: "4.3",
    });
    projectDir = path.join(tmpRoot, "hr-app");
  });

  it("ASCII label 은 이스케이프하지 않고, 한글+ASCII 혼합 label 은 비 ASCII 부분만 이스케이프한다", async () => {
    await egovAddQueryView(
      args({
        columns: [
          { alias: "id", label: "ID" },
          { alias: "name", label: "이름(Name)" },
        ],
        searchable: [],
        autoApplyMessages: true,
      }),
    );
    const c = await read(`${MSG_DIR}/message-common_en.properties`);
    expect(c).toMatch(/^title\.payReport\.id=ID$/m);
    expect(c).toMatch(/^title\.payReport\.name=\\uC774\\uB984\(Name\)$/m);
  });

  it("WAR 이스케이프 후 동일 인자 재호출이 충돌 없이 변경 없음으로 처리된다", async () => {
    const a = args({ columns: [{ alias: "id", label: "아이디" }], searchable: [], autoApplyMessages: true });
    await egovAddQueryView(a);
    await expect(egovAddQueryView(a)).resolves.toMatch(/변경 사항 없음/);
  });
});

describe("egov_add_query_view — Date/Timestamp format 검증", () => {
  const base = {
    projectPath: "/unused",
    packageName: PKG,
    viewName: VIEW,
    sql: "SELECT 1 AS d FROM T",
  };
  const parse = (type: "Date" | "Timestamp", format: string) =>
    AddQueryViewInputSchema.safeParse({ ...base, columns: [{ alias: "d", label: "D", type, format }] });

  it.each(["yyyy/MM/dd", "yyyy년 MM월", "yyyy-MM-dd HH:mm:ss", "dd.MM.yyyy", "HH:mm, yyyy"])(
    "허용: %s",
    (format) => {
      expect(parse("Date", format).success).toBe(true);
      expect(parse("Timestamp", format).success).toBe(true);
    },
  );

  it.each(["${1+1}", "yyyy'MM", 'yyyy"MM', "yyyy#{x}", "a{b}", "yyyy\nMM", "yyyy;MM"])(
    "거부: %j",
    (format) => {
      for (const type of ["Date", "Timestamp"] as const) {
        const r = parse(type, format);
        expect(r.success, `${type} ${JSON.stringify(format)}`).toBe(false);
        if (!r.success) {
          expect(r.error.issues[0].path).toEqual(["columns", 0, "format"]);
          expect(r.error.issues[0].message).toMatch(/날짜 형식/);
        }
      }
    },
  );

  it("도구 진입점도 위험한 format 을 거부하고 어떤 파일도 쓰지 않는다 (Boot 4.3)", async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-qv-fmt-"));
    await generateScaffoldProject({
      projectName: "hr-app",
      packageName: "egovframework.example.employee",
      outputPath: tmpRoot,
      entityName: "Employee",
      ddl: "CREATE TABLE EMPLOYEE (ID VARCHAR(20) NOT NULL PRIMARY KEY)",
      description: "",
      projectType: "boot",
      stackVersion: "4.3",
    });
    projectDir = path.join(tmpRoot, "hr-app");
    await expect(
      egovAddQueryView(args({ columns: [{ alias: "d", label: "D", type: "Date", format: "${1+1}" }], searchable: [] })),
    ).rejects.toThrow(/날짜 형식/);
    expect(await fs.pathExists(path.join(projectDir, SPECS.boot43.files.view))).toBe(false);
  });

  it("Number 컬럼의 format 에는 날짜 format 제약이 적용되지 않는다", () => {
    const r = AddQueryViewInputSchema.safeParse({
      ...base,
      columns: [{ alias: "d", label: "D", type: "Number", format: "#,##0.00" }],
    });
    expect(r.success).toBe(true);
  });
});

describe("egov_add_query_view — columns[].label 검증", () => {
  const base = {
    projectPath: "/tmp/unused",
    packageName: "egovframework.example.report",
    viewName: "LabelReport",
    sql: "SELECT 1 AS id FROM DUAL",
  };

  it.each(["이름\nnav.other=x", "C:\\users", "탭\t문자"])(
    "제어문자·백슬래시가 포함된 label %j 은 거부한다",
    (label) => {
      const r = AddQueryViewInputSchema.safeParse({ ...base, columns: [{ alias: "id", label }] });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].path).toEqual(["columns", 0, "label"]);
    },
  );

  it.each(["학생 이름", "Name (EN)", "금액 <원>", "a=b:c #1"])("일반 label %j 은 허용한다", (label) => {
    expect(
      AddQueryViewInputSchema.safeParse({ ...base, columns: [{ alias: "id", label }] }).success,
    ).toBe(true);
  });
});
