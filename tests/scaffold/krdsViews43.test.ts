/**
 * 4.3 Boot / 4.3 WAR 산출물 화면의 KRDS 전환 테스트.
 *
 * 설계: docs/superpowers/specs/2026-11-26-krds-views-43-design.md
 * 세 스택이 같은 KRDS 정적 자산(static50) 을 쓰고, 4.3 두 스택의 화면이 5.1 Boot 와 같은
 * 마크업·flatpickr 달력·KRDS 페이지네이션을 쓰는지 산출물 텍스트로 고정한다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

type Stack = "boot43" | "war43";

const PLAIN_DDL =
  "CREATE TABLE BOARD (ID VARCHAR(20) NOT NULL PRIMARY KEY, TITLE VARCHAR(200) NOT NULL, CONTENT VARCHAR(2000))";
const DATE_DDL =
  "CREATE TABLE BOARD (ID VARCHAR(20) NOT NULL PRIMARY KEY, TITLE VARCHAR(200) NOT NULL, PUB_DT DATE, REG_DT TIMESTAMP)";

const STATIC_ROOT: Record<Stack, string> = {
  boot43: "src/main/resources/static",
  war43: "src/main/webapp",
};
const VIEW: Record<Stack, { list: string; register: string }> = {
  boot43: {
    list: "src/main/resources/templates/thymeleaf/egovBoardList.html",
    register: "src/main/resources/templates/thymeleaf/egovBoardRegister.html",
  },
  war43: {
    list: "src/main/webapp/WEB-INF/jsp/egovframework/example/board/egovBoardList.jsp",
    register: "src/main/webapp/WEB-INF/jsp/egovframework/example/board/egovBoardRegister.jsp",
  },
};
const MSG_DIR = "src/main/resources/egovframework/message";

let tmpRoot: string;
beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "krds43-"));
});
afterEach(async () => {
  await fs.remove(tmpRoot);
});

/** 프로젝트를 생성하고 프로젝트 루트 경로를 돌려준다. */
async function scaffold(stack: Stack, ddl = PLAIN_DDL, projectName = "board-app"): Promise<string> {
  await generateScaffoldProject({
    projectName,
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl,
    description: "",
    projectType: stack === "war43" ? "war" : "boot",
    stackVersion: "4.3",
  });
  return path.join(tmpRoot, projectName);
}
const read = (dir: string, rel: string): Promise<string> => fs.readFile(path.join(dir, rel), "utf-8");

describe("Task1 정적 자산", () => {
  it.each<Stack>(["boot43", "war43"])("%s 산출물에 KRDS 자산이 있고 옛 자산이 없다", async (stack) => {
    const dir = await scaffold(stack);
    const root = path.join(dir, STATIC_ROOT[stack]);
    for (const f of [
      "css/component/output.css",
      "css/egovframe.css",
      "js/jquery.min.js",
      "js/component/ui-script.js",
      "js/egovframework/common.js",
      "fonts/PretendardGOV-Regular.subset.woff2",
    ]) {
      expect(await fs.pathExists(path.join(root, f)), f).toBe(true);
    }
    expect((await fs.readdir(path.join(root, "img/component/icon"))).length).toBeGreaterThan(50);
    expect(await fs.pathExists(path.join(root, "css/egovframework/sample.css"))).toBe(false);
    expect(await fs.pathExists(path.join(root, "js/egovframework/jquery-3.6.1.min.js"))).toBe(false);
  });

  it("boot43 EgovConfigWeb 이 img·fonts 리소스 핸들러를 등록한다", async () => {
    const src = await read(await scaffold("boot43"), "src/main/java/egovframework/example/config/EgovConfigWeb.java");
    expect(src).toContain('addResourceHandler("/img/**").addResourceLocations("classpath:/static/img/")');
    expect(src).toContain('addResourceHandler("/fonts/**").addResourceLocations("classpath:/static/fonts/")');
    expect(src).not.toContain('"/images/**"');
  });
});

describe("Task2 메시지 번들", () => {
  it.each<Stack>(["boot43", "war43"])("%s 번들에 page.prev/page.next 가 있다", async (stack) => {
    const dir = await scaffold(stack);
    for (const f of ["message-common.properties", "message-common_ko.properties"]) {
      const c = await read(dir, `${MSG_DIR}/${f}`);
      expect(c).toMatch(/^page\.prev=\\uC774\\uC804$/m);
      expect(c).toMatch(/^page\.next=\\uB2E4\\uC74C$/m);
    }
    const en = await read(dir, `${MSG_DIR}/message-common_en.properties`);
    expect(en).toMatch(/^page\.prev=Prev$/m);
    expect(en).toMatch(/^page\.next=Next$/m);
  });

  it("war43 ko 번들의 공통 문구가 모두 한글이다", async () => {
    const dir = await scaffold("war43");
    const c = await read(dir, `${MSG_DIR}/message-common_ko.properties`);
    expect(c).toMatch(/^button\.search=\\uAC80\\uC0C9$/m);
    expect(c).toMatch(/^info\.nodata\.msg=\\u/m);
    expect(c).toMatch(/^errors\.required=\{0\}\\uC740/m);
    expect(c).toMatch(/^confirm\.required\.board\.title=.*\\uD544\\uC218/m);
    for (const english of ["=Search", "=Create", "No data found", "is required", "An error has occurred"]) {
      expect(c).not.toContain(english);
    }
    const en = await read(dir, `${MSG_DIR}/message-common_en.properties`);
    expect(en).toMatch(/^button\.search=Search$/m);
  });
});

describe("Task3 boot43 KRDS 페이지네이션", () => {
  it("렌더러·다이얼렉트·설정이 rte 4.3.2 API 만으로 생성된다", async () => {
    const dir = await scaffold("boot43");
    const r = await read(dir, "src/main/java/egovframework/example/pagination/EgovKrdsPaginationRenderer.java");
    expect(r).toContain("implements PaginationRenderer");
    expect(r).toContain("import org.egovframe.rte.ptl.mvc.tags.ui.pagination.PaginationRenderer;");
    expect(r).toContain('class=\\"page-navi prev\\"');
    expect(r).toContain('<div class=\\"page-links\\">');
    expect(r).toContain('"page.prev"');
    for (const bad of ["jakarta.", "AbstractKrdsPaginationRenderer", "MessageSourcePaginationRenderer", "@PostConstruct"]) {
      expect(r, bad).not.toContain(bad);
    }
    const d = await read(dir, "src/main/java/egovframework/example/pagination/EgovPaginationDialect.java");
    expect(d).toContain('Collections.singleton("egovKrdsPaginationRenderer")');
    const w = await read(dir, "src/main/java/egovframework/example/config/EgovConfigWeb.java");
    expect(w).toContain("new EgovPaginationDialect(egovKrdsPaginationRenderer)");
    expect(w).toContain("import org.thymeleaf.spring5.SpringTemplateEngine;");
    expect(await fs.pathExists(path.join(dir, "src/main/java/egovframework/example/pagination/EgovPaginationFormat.java"))).toBe(false);
  });

  it("목록 화면이 KRDS 렌더러 표현식을 쓴다", async () => {
    const list = await read(await scaffold("boot43"), VIEW.boot43.list);
    expect(list).toContain("#egovKrdsPaginationRenderer.renderPagination(paginationInfo, 'boardPagination')");
    expect(list).not.toContain("egovPaginationFormat");
  });
});

describe("Task4 war43 KRDS 페이지네이션·날짜 표시", () => {
  it("렌더러와 디스패처 설정이 krds 타입으로 생성된다", async () => {
    const dir = await scaffold("war43");
    const r = await read(dir, "src/main/java/egovframework/example/cmmn/web/EgovKrdsPaginationRenderer.java");
    expect(r).toContain("implements PaginationRenderer, MessageSourceAware");
    expect(r).toContain('<div class=\\"page-links\\">');
    for (const bad of ["jakarta.", "AbstractKrdsPaginationRenderer", "ServletContextAware"]) {
      expect(r, bad).not.toContain(bad);
    }
    const x = await read(dir, "src/main/webapp/WEB-INF/config/egovframework/springmvc/dispatcher-servlet.xml");
    expect(x).toContain('<bean id="krdsRenderer" class="egovframework.example.cmmn.web.EgovKrdsPaginationRenderer" />');
    expect(x).toContain('<entry key="krds" value-ref="krdsRenderer" />');
    expect(x).not.toContain("imageRenderer");
    expect(await fs.pathExists(path.join(dir, "src/main/java/egovframework/example/cmmn/web/EgovImgPaginationRenderer.java"))).toBe(false);
    const list = await read(dir, VIEW.war43.list);
    expect(list).toMatch(
      /<div id="paging" class="krds-pagination w-page">\s*<ui:pagination paginationInfo="\$\{paginationInfo\}" type="krds" jsFunction="fn_egov_link_page" \/>/,
    );
  });

  it("바인딩 초기화기가 날짜를 yyyy-MM-dd 로 표시한다", async () => {
    const src = await read(await scaffold("war43"), "src/main/java/egovframework/example/cmmn/web/EgovBindingInitializer.java");
    expect(src.match(/public String getAsText\(\)/g)).toHaveLength(2);
    expect(src).toContain('getValue() == null ? "" :');
    expect(src.match(/new SimpleDateFormat\("yyyy-MM-dd"\)/g)!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Task5 boot43 KRDS 뷰", () => {
  it("목록 화면: KRDS 자산·마크업, 페이지별 최소 스크립트, 4.3 URL 유지", async () => {
    const list = await read(await scaffold("boot43"), VIEW.boot43.list);
    for (const s of [
      'th:href="@{/css/component/output.css}"',
      'th:href="@{/css/egovframe.css}"',
      'th:src="@{/js/jquery.min.js}"',
      'th:src="@{/js/egovframework/common.js}"',
      'id="contextPathHolder"',
      '<div id="container" class="inner">',
      'class="heading-large"',
      '<div id="content_pop">',
      'class="krds-form-select medium"',
      'class="krds-input medium"',
      'class="krds-btn medium icon"',
      'class="svg-icon ico-sch"',
      'class="krds-table-wrap"',
      'class="tbl col data"',
      "#{info.nodata.msg}",
      "@egov:nav-include",
      "~{_fragments/nav :: links}",
      "contextPath + '/board/list'",
      "contextPath + '/board/detail'",
      "contextPath + '/board/add'",
    ]) {
      expect(list, s).toContain(s);
    }
    for (const s of ["ui-script.js", "sample.css", "jquery-3.6.1", "var contextPath", "function notNullCheck", "btn_blue_l", "title_dot.gif", "tbtd_"]) {
      expect(list, s).not.toContain(s);
    }
  });

  it("AJAX 핸들러가 #content_pop 만 교체하고 없으면 알림한다", async () => {
    const list = await read(await scaffold("boot43"), VIEW.boot43.list);
    expect(list).toContain("find('#content_pop')");
    expect(list).not.toContain("replaceWith(fragment)");
    expect(list).toMatch(/if \(!\w+\.length\) \{ alert\(\[\[#\{fail\.common\.msg\}\]\]\); return; \}/);
  });

  it("등록 화면: KRDS 폼 마크업, th:field 유지, 필수 표시, 서버 오류 표시", async () => {
    const r = await read(await scaffold("boot43"), VIEW.boot43.register);
    for (const s of [
      'th:src="@{/js/component/ui-script.js}" defer',
      'th:src="@{/js/egovframework/common.js}" defer',
      'id="contextPathHolder"',
      'class="fieldset input-form"',
      '<div class="form-group">',
      '<div class="form-tit">',
      '<div class="form-conts">',
      'th:field="*{title}"',
      'class="krds-input"',
      '<span class="required">*</span>',
      'class="form-hint-invalid"',
      "#fields.hasErrors('title')",
      'class="krds-btn medium secondary"',
      'class="krds-btn medium danger"',
      "contextPath + '/board/add'",
      "contextPath + '/board/update'",
      "contextPath + '/board/delete'",
      "event.keyCode === 13",
    ]) {
      expect(r, s).toContain(s);
    }
    for (const s of ["EgovValidation", "flatpickr", "var contextPath", "sample.css", "btn_blue_l", "tbtd_caption"]) {
      expect(r, s).not.toContain(s);
    }
  });

  it("날짜 컬럼이 있으면 flatpickr 를 넣고 값을 yyyy-MM-dd 로 표시한다", async () => {
    const r = await read(await scaffold("boot43", DATE_DDL), VIEW.boot43.register);
    for (const s of [
      'href="https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.css"',
      'src="https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js"',
      'src="https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/l10n/ko.js"',
      "flatpickr('.flatpickr-date', {",
      "id=\"pubDt\" name=\"pubDt\" class=\"krds-input flatpickr-date\" placeholder=\"yyyy-MM-dd\" th:value=\"${boardVO.pubDt != null ? #dates.format(boardVO.pubDt, 'yyyy-MM-dd') : ''}\"",
      'id="regDt" name="regDt" class="krds-input flatpickr-date"',
    ]) {
      expect(r, s).toContain(s);
    }
    expect(r).not.toContain('th:field="*{pubDt}"');
    expect(r).not.toContain('th:field="*{regDt}"');
  });

  it("조회뷰·nav·오류 화면이 5.1 과 같은 골격이다", async () => {
    const dir = await scaffold("boot43");
    const nav = await read(dir, "src/main/resources/templates/thymeleaf/_fragments/nav.html");
    expect(nav).toContain('<nav th:fragment="links" class="egov-entity-nav"');
    expect(nav).toContain("var(--krds-color-light-primary-50, #256ef4)");
    expect(nav).toContain("egovRequestUri.startsWith('/egovBoardList')");
    const err = await read(dir, "src/main/resources/templates/thymeleaf/egovSampleError.html");
    expect(err).not.toContain("sample.css");
    expect(err).toContain("#{fail.common.msg}");
  });
});

describe("Task6 war43 KRDS 뷰", () => {
  it("목록 JSP: HTML5 doctype, KRDS 자산·마크업, WAR 함수·URL 유지", async () => {
    const list = await read(await scaffold("war43"), VIEW.war43.list);
    for (const s of [
      "<!DOCTYPE html>",
      "<c:url value='/css/component/output.css'/>",
      "<c:url value='/css/egovframe.css'/>",
      "<c:url value='/js/jquery.min.js'/>",
      "<c:url value='/js/egovframework/common.js'/>",
      '<div id="container" class="inner">',
      'class="heading-large"',
      '<jsp:include page="/WEB-INF/jsp/_fragments/nav.jsp" />',
      'cssClass="krds-form-select medium"',
      'cssClass="krds-input medium"',
      'class="krds-btn medium icon" onclick="fn_egov_selectList()"',
      'class="krds-table-wrap"',
      'class="tbl col data"',
      '<spring:message code="info.nodata.msg" />',
      'onclick="fn_egov_addView()"',
      "<c:url value='/updateBoardView.do'/>",
    ]) {
      expect(list, s).toContain(s);
    }
    for (const s of ["XHTML 1.0 Transitional", "sample.css", "btn_blue_l", "title_dot.gif", 'cssClass="txt"', 'cssClass="use"', 'align="center"']) {
      expect(list, s).not.toContain(s);
    }
  });

  it("등록 JSP: KRDS 폼 마크업, form 태그·검증 유지, 날짜는 flatpickr", async () => {
    const r = await read(await scaffold("war43", DATE_DDL), VIEW.war43.register);
    for (const s of [
      "<!DOCTYPE html>",
      "<c:url value='/js/component/ui-script.js'/>",
      'class="fieldset input-form"',
      '<div class="form-tit">',
      '<div class="form-conts">',
      '<form:input path="title" maxlength="200" cssClass="krds-input" />',
      '<form:errors path="title" element="p" cssClass="form-hint-invalid" />',
      '<span class="required">*</span>',
      '<form:input path="pubDt" placeholder="yyyy-MM-dd" cssClass="krds-input flatpickr-date" />',
      '<form:input path="regDt" placeholder="yyyy-MM-dd" cssClass="krds-input flatpickr-date" />',
      "flatpickr@4.6.13/dist/l10n/ko.js",
      "flatpickr('.flatpickr-date', {",
      '<validator:javascript formName="boardVO"',
      'onclick="fn_egov_save()"',
      'onclick="fn_egov_delete()"',
      'class="krds-btn medium secondary"',
      'name="searchCondition"',
    ]) {
      expect(r, s).toContain(s);
    }
    for (const s of ["sample.css", "btn_blue_l", "tbtd_caption", 'cssClass="txt"']) {
      expect(r, s).not.toContain(s);
    }
    const plain = await read(await scaffold("war43", PLAIN_DDL, "board-plain"), VIEW.war43.register);
    expect(plain).not.toContain("flatpickr");
  });

  it("nav JSP 가 KRDS 스타일과 기존 활성 판별식을 쓴다", async () => {
    const nav = await read(await scaffold("war43"), "src/main/webapp/WEB-INF/jsp/_fragments/nav.jsp");
    expect(nav).toContain('<nav class="egov-entity-nav" aria-label="entity navigation">');
    expect(nav).toContain("var(--krds-color-light-primary-50, #256ef4)");
    expect(nav).toContain("pageContext.request.contextPath += '/egovBoardList'");
  });
});

describe("Task8 context-path 배포", () => {
  it.each(["4.3", "5.1"] as const)("Boot %s 의 EgovNavModelAdvice 가 요청 URI 에서 context-path 를 뗀다", async (stackVersion) => {
    await generateScaffoldProject({
      projectName: `nav-${stackVersion}`,
      packageName: "egovframework.example.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: PLAIN_DDL,
      description: "",
      projectType: "boot",
      stackVersion,
    });
    const src = await read(path.join(tmpRoot, `nav-${stackVersion}`), "src/main/java/egovframework/example/config/EgovNavModelAdvice.java");
    // server.servlet.context-path=/app 이면 getRequestURI() 는 /app/egovBoardList.do 라 nav 의 startsWith('/egovBoardList') 가 실패한다.
    expect(src).toContain("request.getRequestURI().substring(request.getContextPath().length())");
    expect(src).not.toMatch(/return request\.getRequestURI\(\);/);
  });
});
