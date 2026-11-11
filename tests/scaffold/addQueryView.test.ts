/**
 * egov_add_query_view 단위 + 통합 시나리오 테스트.
 *
 * 시나리오: 학적 도메인 (Student + Department + Course + Enrollment) 4-table JOIN 으로
 * StudentEnrollmentReport read-only view 를 추가하고, 생성된 산출물의 핵심 속성을 검증한다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { egovAddQueryView } from "../../src/tools/egovAddQueryView.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

let tmpRoot: string;
let projectDir: string;

async function scaffoldAcademicApp() {
  // primary 엔티티: Department
  await generateScaffoldProject({
    projectName: "academic-app",
    packageName: "egovframework.example.academic.department",
    outputPath: tmpRoot,
    entityName: "Department",
    ddl: "CREATE TABLE DEPARTMENT (DEPT_ID VARCHAR(20) NOT NULL PRIMARY KEY, DEPT_NAME VARCHAR(100))",
    description: "",
    projectType: "boot",
    stackVersion: "5.0",
  });
  return path.join(tmpRoot, "academic-app");
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-query-view-"));
  projectDir = await scaffoldAcademicApp();

  // Student / Course / Enrollment 도 추가 (FK 관계 가짐)
  await egovAddEntity({
    projectPath: projectDir,
    packageName: "egovframework.example.academic.student",
    entityName: "Student",
    ddl: `CREATE TABLE STUDENT (
      STUDENT_ID VARCHAR(20) NOT NULL PRIMARY KEY,
      STUDENT_NAME VARCHAR(100),
      DEPT_ID VARCHAR(20),
      CONSTRAINT FK_STD_DEPT FOREIGN KEY (DEPT_ID) REFERENCES DEPARTMENT(DEPT_ID)
    )`,
  });
  await egovAddEntity({
    projectPath: projectDir,
    packageName: "egovframework.example.academic.course",
    entityName: "Course",
    ddl: `CREATE TABLE COURSE (
      COURSE_ID VARCHAR(20) NOT NULL PRIMARY KEY,
      COURSE_NAME VARCHAR(100),
      DEPT_ID VARCHAR(20),
      CONSTRAINT FK_CRS_DEPT FOREIGN KEY (DEPT_ID) REFERENCES DEPARTMENT(DEPT_ID)
    )`,
  });
  await egovAddEntity({
    projectPath: projectDir,
    packageName: "egovframework.example.academic.enrollment",
    entityName: "Enrollment",
    ddl: `CREATE TABLE ENROLLMENT (
      ENROLLMENT_ID VARCHAR(20) NOT NULL PRIMARY KEY,
      STUDENT_ID VARCHAR(20),
      COURSE_ID VARCHAR(20),
      SEMESTER_CD VARCHAR(20),
      GRADE_CD VARCHAR(10),
      CONSTRAINT FK_ENR_STD FOREIGN KEY (STUDENT_ID) REFERENCES STUDENT(STUDENT_ID),
      CONSTRAINT FK_ENR_CRS FOREIGN KEY (COURSE_ID) REFERENCES COURSE(COURSE_ID)
    )`,
  });
});

afterEach(async () => {
  await fs.remove(tmpRoot);
});

describe("egov_add_query_view — 학적 도메인 StudentEnrollmentReport", () => {
  it("4-table JOIN 시나리오의 모든 핵심 산출물을 생성한다", async () => {
    const out = await egovAddQueryView({
      projectPath: projectDir,
      packageName: "egovframework.example.academic.report",
      viewName: "StudentEnrollmentReport",
      sql: `SELECT s.student_id AS studentId,
                   s.student_name AS studentName,
                   d.dept_name AS deptName,
                   c.course_name AS courseName,
                   e.semester_cd AS semesterCd,
                   e.grade_cd AS gradeCd
            FROM ENROLLMENT e
            LEFT JOIN STUDENT s ON e.student_id = s.student_id
            LEFT JOIN DEPARTMENT d ON s.dept_id = d.dept_id
            LEFT JOIN COURSE c ON e.course_id = c.course_id`,
      columns: [
        { alias: "studentId", label: "학번", type: "String" },
        { alias: "studentName", label: "학생", type: "String" },
        { alias: "deptName", label: "학과", type: "String" },
        { alias: "courseName", label: "과목", type: "String" },
        { alias: "semesterCd", label: "학기", type: "String" },
        { alias: "gradeCd", label: "성적", type: "String" },
      ],
      searchable: ["studentName", "courseName"],
      defaultOrderBy: "studentId DESC",
    });

    expect(out).toMatch(/Query view 'StudentEnrollmentReport' 추가 완료/);

    // 8개 핵심 산출물 모두 존재 확인
    const expected = [
      "src/main/java/egovframework/example/academic/report/StudentEnrollmentReportDefaultVO.java",
      "src/main/java/egovframework/example/academic/report/StudentEnrollmentReportVO.java",
      "src/main/java/egovframework/example/academic/report/impl/StudentEnrollmentReportMapper.java",
      "src/main/java/egovframework/example/academic/report/EgovStudentEnrollmentReportService.java",
      "src/main/java/egovframework/example/academic/report/impl/EgovStudentEnrollmentReportServiceImpl.java",
      "src/main/java/egovframework/example/academic/report/web/EgovStudentEnrollmentReportController.java",
      "src/main/resources/egovframework/sqlmap/report/mappers/EgovStudentEnrollmentReport_StudentEnrollmentReport_SQL.xml",
      "src/main/resources/templates/thymeleaf/report/egovStudentEnrollmentReportList.html",
    ];
    for (const p of expected) {
      expect(
        await fs.pathExists(path.join(projectDir, p)),
        `${p} 가 생성되지 않았습니다`,
      ).toBe(true);
    }

    // VO 에 컬럼들이 정상 매핑됨
    const vo = await fs.readFile(
      path.join(projectDir, expected[1]),
      "utf-8",
    );
    expect(vo).toMatch(/private String studentId;/);
    expect(vo).toMatch(/private String studentName;/);
    expect(vo).toMatch(/private String courseName;/);

    // Mapper.xml: SQL wrapping + alias 기준 검색
    const xml = await fs.readFile(
      path.join(projectDir, expected[6]),
      "utf-8",
    );
    expect(xml).toMatch(/SELECT \* FROM \(/);
    expect(xml).toMatch(/AND v\.studentName LIKE/);
    expect(xml).toMatch(/AND v\.courseName LIKE/);
    expect(xml).toMatch(/ORDER BY studentId DESC/);

    // Controller: CRUD 핸들러 없음 (add/update/delete 메서드 없음)
    const ctl = await fs.readFile(
      path.join(projectDir, expected[5]),
      "utf-8",
    );
    expect(ctl).toMatch(/@GetMapping\("\/egovStudentEnrollmentReportList\.do"\)/);
    expect(ctl).not.toMatch(/insertStudentEnrollmentReport/);
    expect(ctl).not.toMatch(/updateStudentEnrollmentReport/);
    expect(ctl).not.toMatch(/deleteStudentEnrollmentReport/);
  });

  it("CRUD 와 다르게 Register view 산출물이 생성되지 않는다", async () => {
    await egovAddQueryView({
      projectPath: projectDir,
      packageName: "egovframework.example.academic.report",
      viewName: "StudentEnrollmentReport",
      sql: "SELECT s.student_id AS studentId FROM STUDENT s",
      columns: [{ alias: "studentId", label: "학번" }],
    });

    // Register view 가 만들어지면 안 됨
    expect(
      await fs.pathExists(
        path.join(
          projectDir,
          "src/main/resources/templates/thymeleaf/report/egovStudentEnrollmentReportRegister.html",
        ),
      ),
    ).toBe(false);
    // ID 생성기도 없음
    expect(
      await fs.pathExists(
        path.join(
          projectDir,
          "src/main/java/egovframework/example/academic/config/EgovConfigStudentEnrollmentReportIdGeneration.java",
        ),
      ),
    ).toBe(false);
  });

  it("autoApplyMenu=true 면 nav fragment 에 새 view 가 추가된다", async () => {
    await egovAddQueryView({
      projectPath: projectDir,
      packageName: "egovframework.example.academic.report",
      viewName: "StudentEnrollmentReport",
      sql: "SELECT s.student_id AS studentId FROM STUDENT s",
      columns: [{ alias: "studentId", label: "학번" }],
      autoApplyMenu: true,
    });

    const nav = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/templates/thymeleaf/_fragments/nav.html",
      ),
      "utf-8",
    );
    expect(nav).toMatch(/egovStudentEnrollmentReportList\.do/);
  });

  // 회귀 테스트: 'Student' 가 'StudentEnrollmentReport' 의 URL 접두사라서
  // is-active 비교가 `/egov{Entity}` 까지만이면 두 메뉴가 동시에 활성화된다.
  // 비교는 반드시 `/egov{Entity}List` 까지 확장되어야 한다 (List 접미사 포함).
  it("nav: 동일 접두사 엔티티(Student vs StudentEnrollmentReport)의 활성 비교가 충돌하지 않는다", async () => {
    await egovAddQueryView({
      projectPath: projectDir,
      packageName: "egovframework.example.academic.report",
      viewName: "StudentEnrollmentReport",
      sql: "SELECT s.student_id AS studentId FROM STUDENT s",
      columns: [{ alias: "studentId", label: "학번" }],
      autoApplyMenu: true,
    });

    const nav = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/templates/thymeleaf/_fragments/nav.html",
      ),
      "utf-8",
    );
    // 두 엔티티가 모두 정확한 List 접미사 비교를 사용해야 함
    expect(nav).toMatch(/startsWith\('\/egovStudentList'\)/);
    expect(nav).toMatch(/startsWith\('\/egovStudentEnrollmentReportList'\)/);
    // 부정 단언: 단순히 `/egovStudent'` 로 끝나는 비교가 남아 있으면 안 됨
    expect(nav).not.toMatch(/startsWith\('\/egovStudent'\)/);
  });

  it("KRDS 검색 박스 마크업: form-group > search-wrap > krds-btn icon 구조 적용", async () => {
    await egovAddQueryView({
      projectPath: projectDir,
      packageName: "egovframework.example.academic.report",
      viewName: "StudentEnrollmentReport",
      sql: "SELECT s.student_id AS studentId, s.student_name AS studentName FROM STUDENT s",
      columns: [
        { alias: "studentId", label: "학번" },
        { alias: "studentName", label: "학생" },
      ],
      searchable: ["studentName"],
    });

    const html = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/templates/thymeleaf/report/egovStudentEnrollmentReportList.html",
      ),
      "utf-8",
    );
    // KRDS 표준: form-group > search-wrap > search-body 구조
    expect(html).toMatch(/<div class="form-group">/);
    expect(html).toMatch(/<div class="search-wrap">/);
    expect(html).toMatch(/<div class="search-body">/);
    // 입력 박스 + 검색 버튼이 KRDS 클래스 사용
    expect(html).toMatch(/<input[^>]*class="krds-input medium"/);
    expect(html).toMatch(/<button[^>]*class="krds-btn medium icon"/);
    expect(html).toMatch(/<i class="svg-icon ico-sch">/);
    // 비-KRDS 잔재가 없어야 함
    expect(html).not.toMatch(/class="btn-search"/);
    expect(html).not.toMatch(/<div class="search-area">/);
  });

  it("autoApplyMessages=true 면 메시지 번들에 title.{view}.{alias} 키가 append 된다", async () => {
    await egovAddQueryView({
      projectPath: projectDir,
      packageName: "egovframework.example.academic.report",
      viewName: "StudentEnrollmentReport",
      sql: "SELECT s.student_id AS studentId, s.student_name AS studentName FROM STUDENT s",
      columns: [
        { alias: "studentId", label: "학번" },
        { alias: "studentName", label: "학생" },
      ],
      autoApplyMessages: true,
    });

    const ko = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/egovframework/message/message-common_ko.properties",
      ),
      "utf-8",
    );
    expect(ko).toMatch(/^title\.studentEnrollmentReport\.studentId=학번$/m);
    expect(ko).toMatch(/^title\.studentEnrollmentReport\.studentName=학생$/m);
    expect(ko).toMatch(/^nav\.studentEnrollmentReport=/m);
  });

  it("Date/Timestamp/Number/Boolean 타입 모두 VO 와 View 에 정상 매핑된다", async () => {
    await egovAddQueryView({
      projectPath: projectDir,
      packageName: "egovframework.example.academic.report",
      viewName: "DataTypesReport",
      sql: "SELECT 1 AS id, CURRENT_TIMESTAMP AS createdAt FROM STUDENT s",
      columns: [
        { alias: "id", label: "ID", type: "Number" },
        { alias: "name", label: "Name", type: "String" },
        { alias: "birthDate", label: "Birth", type: "Date", format: "yyyy/MM/dd" },
        { alias: "createdAt", label: "Created", type: "Timestamp" },
        { alias: "active", label: "Active", type: "Boolean" },
      ],
    });

    const vo = await fs.readFile(
      path.join(
        projectDir,
        "src/main/java/egovframework/example/academic/report/DataTypesReportVO.java",
      ),
      "utf-8",
    );
    expect(vo).toMatch(/private BigDecimal id;/);
    expect(vo).toMatch(/private String name;/);
    expect(vo).toMatch(/import java\.sql\.Date;/);
    expect(vo).toMatch(/import java\.sql\.Timestamp;/);
    expect(vo).toMatch(/@DateTimeFormat\(pattern="yyyy\/MM\/dd"\)/);
    expect(vo).toMatch(/@DateTimeFormat\(pattern="yyyy-MM-dd HH:mm:ss"\)/);
    expect(vo).toMatch(/private Boolean active;/);
  });

  it("sql 에 < 비교 연산자가 있어도 mapper XML 이 CDATA 로 보호된다", async () => {
    await egovAddQueryView({
      projectPath: projectDir,
      packageName: "egovframework.example.academic.report",
      viewName: "MinorStudentReport",
      sql: "SELECT s.student_id AS studentId FROM STUDENT s WHERE s.age < 19 AND s.credits <> 0",
      columns: [{ alias: "studentId", label: "학번" }],
    });

    const xml = await fs.readFile(
      path.join(
        projectDir,
        "src/main/resources/egovframework/sqlmap/report/mappers/EgovMinorStudentReport_MinorStudentReport_SQL.xml",
      ),
      "utf-8",
    );
    expect(xml).toMatch(/<!\[CDATA\[/);
    expect(xml).toMatch(/s\.age < 19/);
    expect(xml).toMatch(/s\.credits <> 0/);
  });

  it("sql 에 ']]>' 시퀀스가 있으면 입력 검증에서 거부된다", async () => {
    await expect(
      egovAddQueryView({
        projectPath: projectDir,
        packageName: "egovframework.example.academic.report",
        viewName: "BrokenReport",
        sql: "SELECT 1 AS id FROM STUDENT WHERE note = ']]>'",
        columns: [{ alias: "id", label: "ID" }],
      }),
    ).rejects.toThrow(/\]\]>/);
  });

  it("defaultOrderBy 에 alias 목록 형식이 아닌 값이 오면 거부된다", async () => {
    await expect(
      egovAddQueryView({
        projectPath: projectDir,
        packageName: "egovframework.example.academic.report",
        viewName: "InjectionReport",
        sql: "SELECT 1 AS id FROM STUDENT",
        columns: [{ alias: "id", label: "ID" }],
        defaultOrderBy: "id; DROP TABLE STUDENT",
      }),
    ).rejects.toThrow(/defaultOrderBy/);
  });

  it("defaultOrderBy 가 columns 에 없는 alias 를 참조하면 거부된다", async () => {
    await expect(
      egovAddQueryView({
        projectPath: projectDir,
        packageName: "egovframework.example.academic.report",
        viewName: "UnknownAliasReport",
        sql: "SELECT 1 AS id FROM STUDENT",
        columns: [{ alias: "id", label: "ID" }],
        defaultOrderBy: "unknownCol DESC",
      }),
    ).rejects.toThrow(/unknownCol/);
  });

  it("defaultOrderBy 는 복수 alias + ASC/DESC 조합을 허용한다", async () => {
    const out = await egovAddQueryView({
      projectPath: projectDir,
      packageName: "egovframework.example.academic.report",
      viewName: "MultiOrderReport",
      sql: "SELECT 1 AS id, 'x' AS name FROM STUDENT",
      columns: [
        { alias: "id", label: "ID" },
        { alias: "name", label: "이름" },
      ],
      defaultOrderBy: "name ASC, id DESC",
    });
    expect(out).toMatch(/추가 완료/);
  });

  it("searchable 에 columns 에 없는 alias 가 있으면 조용히 무시하지 않고 거부한다", async () => {
    await expect(
      egovAddQueryView({
        projectPath: projectDir,
        packageName: "egovframework.example.academic.report",
        viewName: "TypoSearchReport",
        sql: "SELECT 1 AS id FROM STUDENT",
        columns: [{ alias: "id", label: "ID" }],
        searchable: ["idd"],
      }),
    ).rejects.toThrow(/idd/);
  });

  it("같은 인자로 다시 호출하면(렌더 결과 동일) 멱등 성공 — 변경 없음", async () => {
    const args = {
      projectPath: projectDir,
      packageName: "egovframework.example.academic.report",
      viewName: "StudentEnrollmentReport",
      sql: "SELECT 1 AS id FROM STUDENT",
      columns: [{ alias: "id", label: "ID" }],
    };
    await egovAddQueryView(args);

    const out = await egovAddQueryView(args);
    expect(out).toMatch(/이미 동일한 내용으로 생성되어 있습니다/);
    expect(out).toMatch(/변경 사항 없음/);
    expect(out).toMatch(/후속 단계는 건너뛰었습니다/);
  });

  it("같은 viewName 인데 산출물 내용이 다르면(변경된 컬럼) 충돌로 거부된다", async () => {
    await egovAddQueryView({
      projectPath: projectDir,
      packageName: "egovframework.example.academic.report",
      viewName: "StudentEnrollmentReport",
      sql: "SELECT 1 AS id FROM STUDENT",
      columns: [{ alias: "id", label: "ID" }],
    });

    await expect(
      egovAddQueryView({
        projectPath: projectDir,
        packageName: "egovframework.example.academic.report",
        viewName: "StudentEnrollmentReport",
        sql: "SELECT 1 AS id FROM STUDENT",
        // 컬럼 라벨이 달라 렌더 결과가 달라짐 — 부분/전체 내용 상이로 원자적 거부
        columns: [{ alias: "id", label: "학번" }],
      }),
    ).rejects.toThrow(/충돌로 거부/);
  });

  it("WAR 4.3 프로젝트도 거부하지 않고 JSP 화면을 포함한 산출물을 생성한다", async () => {
    await generateScaffoldProject({
      projectName: "war-app",
      packageName: "egovframework.example.war.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: "CREATE TABLE BOARD (ID VARCHAR(20) NOT NULL PRIMARY KEY)",
      description: "",
      projectType: "war",
      stackVersion: "4.3",
    });
    const warDir = path.join(tmpRoot, "war-app");

    const out = await egovAddQueryView({
      projectPath: warDir,
      packageName: "egovframework.example.war.report",
      viewName: "Report",
      sql: "SELECT 1 AS id FROM BOARD",
      columns: [{ alias: "id", label: "ID" }],
    });

    expect(out).toMatch(/Query view 'Report' 추가 완료/);
    expect(
      await fs.pathExists(
        path.join(warDir, "src/main/webapp/WEB-INF/jsp/egovframework/example/war/report/egovReportList.jsp"),
      ),
    ).toBe(true);
  });
});
