#!/usr/bin/env node

/**
 * eGovFrame MCP Codegen
 *
 * Tools:
 * - egov_scaffold_project: DDL 한 줄에서 eGovFrame 프로젝트 전체 골격을 생성
 * - egov_add_entity: 기존 프로젝트에 엔티티 CRUD 세트 추가
 * - egov_add_query_view: 기존 프로젝트에 다중 JOIN 기반 read-only 조회 화면 추가
 * - egov_add_attach_file_infrastructure: 표준 첨부파일 인프라(COMTNFILE/EgovFileMngService 등) 설치
 *
 * 각 도구의 입력은 두 단계로 검증됩니다:
 * 1) 여기 정의된 raw zod shape — MCP SDK 가 tools/list 의 JSON Schema 생성과 호출 시 1차 검증에 사용
 * 2) src/tools/<name>.ts 의 정제된 zod 스키마 — refine/superRefine 으로 도메인 규칙 (WAR+5.0 금지 등) 재검증
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { egovScaffoldProject } from "./tools/egovScaffoldProject.js";
import { egovAddEntity } from "./tools/egovAddEntity.js";
import { egovAddQueryView } from "./tools/egovAddQueryView.js";
import { egovAddAttachFileInfrastructure } from "./tools/egovAddAttachFileInfrastructure.js";

const server = new McpServer({
  name: "egovframe-mcp-codegen",
  version: "1.0.0",
});

// ─── egov_scaffold_project ──────────────────────────────────────────────────
server.registerTool(
  "egov_scaffold_project",
  {
    title: "Scaffold eGovFrame Project",
    description:
      "전자정부 표준프레임워크(eGovFrame) 프로젝트를 DDL문으로부터 자동 생성합니다. 기본은 eGovFrame 5.0 Boot(Jakarta+Thymeleaf Spring6+KRDS). stackVersion='4.3'이면 eGovFrame 4.3 Boot(javax+Thymeleaf Spring5). projectType='war'이면 전통 WAR+JSP+Tomcat 배포용. CRUD, 페이징, 검색, 유효성 검증, 예외 처리, 서비스 계층, MyBatis 매퍼, 정적 리소스를 모두 포함합니다.",
    inputSchema: {
      projectName: z
        .string()
        .describe("Project name and Maven artifactId (e.g., 'board-app')"),
      packageName: z
        .string()
        .describe("Base Java package (e.g., 'egovframework.example.board')"),
      outputPath: z
        .string()
        .describe("Parent directory where the project folder will be created"),
      entityName: z
        .string()
        .describe("Entity name in PascalCase (e.g., 'Board', 'Article')"),
      ddl: z.string().describe("CREATE TABLE DDL statement for the entity"),
      description: z
        .string()
        .optional()
        .describe("Optional project description"),
      projectType: z
        .enum(["boot", "war"])
        .optional()
        .describe(
          "Project type. 'boot' (default) = Spring Boot JAR, 'war' = traditional WAR + JSP + Tomcat",
        ),
      stackVersion: z
        .enum(["4.3", "5.0"])
        .optional()
        .describe(
          "eGovFrame stack version. '5.0' (default) for Boot only. WAR + '5.0' is rejected (WAR only supports '4.3').",
        ),
      normalizeDdl: z
        .boolean()
        .optional()
        .describe(
          "Scaffold 진입 전 DDL 을 케이스/공백/인용부호 기준으로 정규화하고, 표준 미준수 항목을 진단 보고서로 첨부합니다. 의미를 바꾸지 않는 보수적 변환만 수행. 기본 true.",
        ),
    },
  },
  async (args) => {
    try {
      const result = await egovScaffoldProject(args);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[egovframe-mcp-codegen] egov_scaffold_project failed:`, error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  },
);

// ─── egov_add_entity ────────────────────────────────────────────────────────
server.registerTool(
  "egov_add_entity",
  {
    title: "Add Entity to eGovFrame Project",
    description:
      "이미 생성된 eGovFrame 프로젝트에 새 엔티티의 CRUD 코드(Controller/Service/ServiceImpl/Mapper.java/Mapper.xml/VO/View)를 DDL 한 줄로 추가합니다. projectType(boot/war) 과 stackVersion(4.3/5.0) 은 기존 pom.xml 에서 자동 감지하므로 지정할 필요가 없습니다. 표준 eGovFrame scaffold 구조가 아니면 명확한 에러로 거부합니다. 생성될 파일 중 하나라도 이미 존재하면 어떤 파일도 작성하지 않고 충돌 목록과 함께 거부합니다 (덮어쓰기 옵션 없음). pom.xml/application.properties/sql-mapper-config.xml 같은 프로젝트 공용 설정은 건드리지 않습니다.",
    inputSchema: {
      projectPath: z
        .string()
        .describe("기존 eGovFrame 프로젝트 루트 경로 (pom.xml 이 있어야 함)"),
      packageName: z
        .string()
        .describe(
          "새 엔티티의 풀 Java 패키지 (예: 'egovframework.example.article'). 한 프로젝트 안에서 엔티티마다 다른 모듈 패키지를 사용할 수 있습니다.",
        ),
      entityName: z
        .string()
        .describe("엔티티 이름 (PascalCase, 예: 'Article')"),
      ddl: z.string().describe("엔티티에 해당하는 CREATE TABLE DDL 문"),
      description: z.string().optional().describe("엔티티 설명 (선택)"),
      normalizeDdl: z
        .boolean()
        .optional()
        .describe(
          "엔티티 추가 진입 전 DDL 을 케이스/공백/인용부호 기준으로 정규화하고, 표준 미준수 항목을 진단 보고서로 첨부합니다. 의미를 바꾸지 않는 보수적 변환만 수행. 기본 true.",
        ),
      autoApplyMigration: z
        .boolean()
        .optional()
        .describe(
          "true (기본) 면 생성된 엔티티 마이그레이션 DDL(CREATE TABLE + INSERT INTO IDS) 을 기존 시드 SQL 파일 끝에 자동으로 append 하여, 사용자가 별도로 복사·붙여넣기 할 필요가 없게 합니다. 안전 조건: src/main/resources/db/ 디렉터리에 사용자 시드 *.sql 파일이 정확히 1개 있을 때만 동작합니다 (add-{entity}-tables.sql 같은 이전 마이그레이션 파일은 자동 제외). 0개 또는 2개 이상이면 안전을 위해 자동 append 를 포기하고 별도 파일(add-{entity}-tables.sql) 생성으로 fallback 하며 결과 메시지에 사유를 알립니다. 사용자가 'DB 시드는 내가 직접 적용할게', '시드 SQL 자동 머지 끄고', '마이그레이션 파일만 따로 만들어줘' 같은 표현을 쓰면 false 로 설정하세요. 주의: 시드 파일에 동일 엔티티의 DDL/IDS row 가 이미 있는 경우에도 그대로 append 되므로 H2 init 시 'already exists' 가 날 수 있습니다 — 첫 호출에만 사용하거나 사용자가 시드 파일 상태를 인지하고 켜야 합니다.",
        ),
      autoApplyMessages: z
        .boolean()
        .optional()
        .describe(
          "true (기본) 면 새 엔티티의 메시지 키들 (list.{entity}, title.{entity}.sample, title.{entity}.{column}, confirm.required.{entity}.{column}, nav.{entity}) 을 기존 메시지 번들 파일 3개 (message-common.properties, message-common_ko.properties, message-common_en.properties) 끝에 자동으로 append 합니다. 이게 꺼져 있으면 새 엔티티 화면에 '??title.member.id_ko_KR??' 같은 미해석 키가 그대로 노출되므로 기본값을 true 로 둡니다 (메시지 키 추가는 SQL 보다 위험이 낮음). 안전 조건: 위 3개 파일이 모두 존재할 때만 동작. 하나라도 빠지면 fallback (결과 메시지에 추가해야 할 키 목록만 출력). 사용자가 '메시지는 직접 관리', '메시지 자동 append 끄고', 'i18n 은 손대지 마' 같은 표현을 쓰면 false 로 설정하세요.",
        ),
      autoApplyMenu: z
        .boolean()
        .optional()
        .describe(
          "true 면 엔티티 간 메뉴 네비게이션 fragment 를 기존 컨트롤러들에서 탐색한 전체 엔티티 목록으로 자동 재생성합니다 — 결과적으로 모든 List 화면에 신규 엔티티 메뉴 링크가 자동으로 나타납니다. 동작: (1) src/main/java 하위의 Egov*Controller.java 파일들을 스캔해 기존 엔티티 목록을 추출 (2) 새 엔티티 포함 목록으로 nav fragment 파일(_fragments/nav.html 또는 _fragments/nav.jsp) 을 덮어씀 (3) 기존 List 화면들에 fragment include 라인이 없으면 자동 마이그레이션 (한 줄 삽입). 기본 false (보수적): 메뉴는 프로젝트마다 정책이 달라(위치/스타일/순서), 자동화하면 사용자 커스텀 메뉴와 충돌할 수 있어 명시적으로 켜야 합니다. 사용자가 '메뉴도 달아줘', '엔티티 간 메뉴 자동', '게시판↔회원 메뉴 연결', '네비게이션 자동 갱신' 같은 표현을 쓰면 true 로 설정하세요.",
        ),
      withAttachment: z
        .boolean()
        .optional()
        .describe(
          "true 면 생성되는 엔티티가 eGov 표준 첨부파일(atchFileId) 와이어드 형태로 emit 됩니다. VO 에 atchFileId 필드 + getter/setter, DDL/마이그레이션 SQL 에 ATCH_FILE_ID CHAR(20) 컬럼, Mapper SQL 의 INSERT/UPDATE/SELECT 에 컬럼 포함, Controller 가 MultipartHttpServletRequest 핸들러로 분기 (parseFileInf → insertFileInfs → 도메인 INSERT, update 시 getMaxFileSN/updateFileInfs, delete 시 EgovFileMngService.deleteAllFileInf 호출), 등록 화면에 `<input type=\"file\" name=\"file_1\" multiple>` 추가. 사전조건: 프로젝트에 첨부파일 인프라가 설치되어 있어야 합니다 (EgovFileMngService.java + EgovConfigAttachFile.java 또는 context-idgn-File.xml). 미설치 시 명확한 가이드로 거부됩니다 — 먼저 `egov_add_attach_file_infrastructure` 도구를 호출하세요. 사용자가 '첨부파일 달린 엔티티', '파일 업로드 게시판', 'with attachments', '게시판에 파일' 같은 표현을 쓰면 true 로 설정하세요.",
        ),
      attachmentFieldName: z
        .string()
        .optional()
        .describe(
          "첨부파일 그룹 키 필드의 이름. 표준은 'atchFileId' — 공통컴포넌트 fragment 와 다운로드 컨트롤러가 이 이름을 가정하므로 변경 비추천. 한 프로젝트에서 둘 이상의 엔티티가 별도 첨부 그룹을 가지면서 동시에 다른 이름이 필요한 드문 경우에만 변경.",
        ),
      maxAttachmentCount: z
        .number()
        .optional()
        .describe(
          "등록/수정 화면의 client-side 첨부 개수 상한. 0 = 무제한 (기본). 서버측 강제 검증은 별도 정책으로 — v1 에서는 클라이언트 hint 만 반영.",
        ),
      idGeneration: z
        .enum(["auto", "manual"])
        .optional()
        .describe(
          "PK 채번 방식. 'auto' (기본): EgovTableIdGnrServiceImpl 로 자동 채번. PK 형식 '<TABLE_NAME>-NNNNN' (예: TB_ORDER-00001). Customer/Order/Article 같은 surrogate-ID 데이터 도메인에 적합. 화면에 PK 입력란이 보이지 않음 (readonly). 'manual': 자동 채번 빈/IDS row/Service 채번 호출 모두 생략. PK 는 사용자가 직접 입력. 코드 마스터 테이블(배송상태/권한코드/분류코드/우편번호 등 짧은 자연 코드 PK — RCPT/SHIP/DONE 같은) 에 적합. Register 화면에 PK 입력란 + required 검증. 사용자 명령에 '배송상태', '권한', '분류코드', '코드 마스터', '코드 테이블', '룩업 테이블' 같은 표현이 있거나 PK 컬럼 길이가 20자 미만의 짧은 코드 (예: STTS_CD VARCHAR(10)) 면 'manual' 을 권장. 주의: 'auto' 일 때 PK 길이가 자동 채번 형식(tableName + 6자) 미만이면 도구가 거부합니다 — 런타임 truncation 에러를 컴파일 전에 잡기 위함. 거부 시 'manual' 로 재호출 또는 PK 길이를 늘리세요.",
        ),
    },
  },
  async (args) => {
    try {
      const result = await egovAddEntity(args);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[egovframe-mcp-codegen] egov_add_entity failed:`, error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  },
);

// ─── egov_add_query_view ────────────────────────────────────────────────────
server.registerTool(
  "egov_add_query_view",
  {
    title: "Add Read-only Query View",
    description:
      "이미 생성된 eGovFrame 5.0 Boot 프로젝트에 다중 테이블 JOIN/컬럼 프로젝션 기반 read-only 조회 화면 (리포트성 View) 을 추가합니다. 일반 CRUD 와 달리 등록/수정/삭제는 만들지 않고 List 화면 + 페이징 + 검색만 갖춥니다. 사용자가 작성한 SELECT SQL 본문을 그대로 사용하면서, 컬럼 메타(alias/label/type/format) 를 별도로 받아 화면 렌더링에 적용합니다. SQL 은 derived table 로 wrapping 되어 페이징/검색이 외부에서 안전하게 적용됩니다. 단계 1 에서는 boot50 (eGovFrame 5.0 Boot) 만 지원합니다. boot43/war 는 향후 작업으로 분리되어 있습니다.",
    inputSchema: {
      projectPath: z
        .string()
        .describe("기존 eGovFrame 5.0 Boot 프로젝트 루트 경로"),
      packageName: z
        .string()
        .describe(
          "Query view 를 둘 Java 패키지 — 예: 'egovframework.example.academic.report'. 마지막 segment 가 sqlmap/template 디렉터리 이름(entityModule) 으로 사용됩니다.",
        ),
      viewName: z
        .string()
        .describe(
          "View 이름 (PascalCase). 예: 'StudentEnrollmentReport', 'CustomerOrderSummary'. Controller/Mapper/VO 클래스 이름과 URL 의 prefix 에 사용됩니다.",
        ),
      sql: z
        .string()
        .describe(
          "조회 본문 SELECT 문 — 다중 JOIN, 표현식, WHERE 조건 모두 허용. LIMIT/OFFSET 은 포함하지 마세요 (도구가 paging wrapping 으로 추가). 컬럼은 AS alias 로 명시할 것 — alias 가 VO 필드명이자 검색/정렬 key 가 됩니다.",
        ),
      columns: z
        .array(
          z.object({
            alias: z
              .string()
              .describe("SELECT 의 alias (camelCase 영문/숫자)"),
            label: z.string().describe("컬럼 헤더에 표시될 라벨"),
            type: z
              .enum(["String", "Date", "Timestamp", "Number", "Boolean"])
              .optional()
              .describe("Java 필드 타입 + 화면 렌더링 분기. 기본 String."),
            format: z
              .string()
              .optional()
              .describe(
                "Date/Timestamp/Number 의 화면 포맷 (예: 'yyyy-MM-dd', '#,##0.00'). 미지정 시 타입별 기본값 사용.",
              ),
          }),
        )
        .min(1)
        .describe(
          "View 컬럼 메타. 각 항목은 SELECT alias 와 동일한 'alias', 화면 라벨 'label', 그리고 선택적 'type'(String/Date/Timestamp/Number/Boolean) 과 'format'(yyyy-MM-dd 등) 을 포함합니다.",
        ),
      searchable: z
        .array(z.string())
        .optional()
        .describe(
          "검색 dropdown 옵션으로 노출될 컬럼 alias 들. 빈 배열이면 검색 UI 자체를 숨깁니다.",
        ),
      defaultOrderBy: z
        .string()
        .optional()
        .describe(
          "기본 ORDER BY 절 — 출력 컬럼 alias 기준으로 작성 (예: 'studentId DESC, courseName ASC'). 미지정 시 첫 컬럼 DESC.",
        ),
      description: z.string().optional().describe("View 의 한 줄 설명 (선택)"),
      autoApplyMenu: z
        .boolean()
        .optional()
        .describe(
          "true (기본) 면 nav fragment 에 query view 메뉴를 자동 추가합니다. 사용자가 '메뉴는 직접 관리' 같은 의도를 명시하면 false.",
        ),
      autoApplyMessages: z
        .boolean()
        .optional()
        .describe(
          "true (기본) 면 컬럼 label / 메뉴 라벨을 메시지 번들에 자동 append 합니다. 화면에 미해석 메시지 키가 노출되는 것을 막습니다.",
        ),
    },
  },
  async (args) => {
    try {
      const result = await egovAddQueryView(args);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[egovframe-mcp-codegen] egov_add_query_view failed:`, error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  },
);

// ─── egov_add_attach_file_infrastructure ────────────────────────────────────
server.registerTool(
  "egov_add_attach_file_infrastructure",
  {
    title: "Install Standard Attach-File Infrastructure",
    description:
      "이미 생성된 eGovFrame 5.0 Boot 프로젝트에 표준 첨부파일 인프라를 1회 설치합니다. 구성: COMTNFILE/COMTNFILEDETAIL 두 테이블 + 시퀀스 관리 테이블(COMTECOPSEQ) + EgovFileMngService/Impl, FileVO, EgovFileMngUtil, FileManageMapper, EgovFileDownloadController, EgovConfigAttachFile Bean. atchFileId 채번은 EgovTableIdGnrServiceImpl(prefix='FILE_', cipers=15) — 정확히 CHAR(20) PK 와 길이 일치. projectType/stackVersion 은 pom.xml 에서 자동 감지. Phase A 는 5.0 Boot 만 지원, 4.3 Boot / 4.3 WAR 은 다음 페이즈. 충돌 시 거부 (force/overwrite 옵션 없음). skipIfPresent=true(기본) 면 모든 출력이 내용까지 동일하게 이미 존재할 때 no-op + 성공. 사용자가 '첨부파일 기능 넣어줘', 'eGov 표준 파일 업로드 인프라 설치', '게시판에 첨부파일 달기 전에 베이스 만들어' 같은 표현을 쓰면 본 도구를 먼저 호출하세요.",
    inputSchema: {
      projectPath: z
        .string()
        .describe(
          "기존 eGovFrame 5.0 Boot 프로젝트 루트 경로 (pom.xml 이 있어야 함)",
        ),
      fileStorePath: z
        .string()
        .optional()
        .describe(
          "Globals.fileStorePath 값. 절대경로 권장. 비워두면 OS 임시 디렉터리 하위 'egov-upload' 로 대체 — 개발 편의용이며 운영은 사용자가 명시적으로 외부 마운트 또는 NAS 경로로 설정하세요.",
        ),
      idGnrPrefix: z
        .string()
        .optional()
        .describe(
          "atchFileId 채번 prefix. 기본 'FILE_' (공통컴포넌트 표준). len(idGnrPrefix) + idGnrCipers 가 정확히 20이어야 — COMTNFILE.ATCH_FILE_ID CHAR(20) PK 와 길이 일치 보장. 변경 시 cipers 도 같이 조정.",
        ),
      idGnrCipers: z
        .number()
        .optional()
        .describe(
          "atchFileId 채번 자릿수. 기본 15 ('FILE_' 5자 + 15자 = 20자). idGnrPrefix 와 합이 정확히 20이 아니면 거부.",
        ),
      autoApplyProperties: z
        .boolean()
        .optional()
        .describe(
          "true (기본) 면 application.properties / globals.properties 끝에 'Globals.fileStorePath=…' 키를 자동 append. 같은 키가 같은 값으로 이미 있으면 skip (멱등), 다른 값으로 있으면 거부. 사용자가 '속성은 직접 설정', '프로퍼티 자동 추가 끄고' 같은 의도를 명시하면 false. false 면 결과 메시지에 추가해야 할 키만 안내.",
        ),
      maxFileSize: z
        .string()
        .optional()
        .describe(
          "Spring multipart 단일 파일 한도 (`spring.servlet.multipart.max-file-size`). 단위: B/KB/MB/GB. 기본 '10MB' (Spring Boot 기본값 1MB 에서 상향). EgovFileMngUtil 의 P1 도메인 정책 한도(`egov.attach.maxFileSize`) 도 동일 값으로 자동 설정되어, Spring 한도와 컨트롤러 정책이 한 번 더 검증된다. 사용자가 '10MB 이상도 받아', '100MB 까지 허용' 같은 표현을 쓰면 그 값으로.",
        ),
      maxRequestSize: z
        .string()
        .optional()
        .describe(
          "Spring multipart 요청 전체 합산 한도 (`spring.servlet.multipart.max-request-size`). 여러 파일 + 폼 필드 합산. 단위: B/KB/MB/GB. 기본 '50MB'. 보통 maxFileSize × 동시 첨부 가능 개수 정도로 잡는다.",
        ),
      allowedExtensions: z
        .array(z.string())
        .optional()
        .describe(
          "화이트리스트 확장자 (소/대문자 무관, 도트 유무 무관). 지정하면 화이트리스트 모드 활성화 — 이 목록에 없는 확장자는 거부된다. 비어 있거나 미지정이면 기본 블랙리스트만 적용 (현재 동작 유지). 예) ['pdf', 'docx', 'xlsx', 'png', 'jpg', 'jpeg', 'gif', 'hwp']. 사용자가 '문서 파일만 허용', 'office 파일만', 'pdf 만' 같은 표현을 쓰면 적절히 설정.",
        ),
      blockedExtensions: z
        .array(z.string())
        .optional()
        .describe(
          "추가 블랙리스트 확장자. EgovFileMngUtil.DEFAULT_BLOCKED_EXTENSIONS (P0 기본 셋: exe/bat/sh/jsp/php/svg/html 등) 에 합쳐서 적용. 기본 셋은 코드 상수라 운영 정책으로 더 막아야 할 확장자만 추가 (예: ['zip', 'rar', 'iso']).",
        ),
      skipIfPresent: z
        .boolean()
        .optional()
        .describe(
          "true (기본) 면 모든 출력 파일이 *내용까지 동일하게* 이미 존재할 때 no-op + 성공으로 처리 (멱등). false 면 한 파일이라도 존재할 시 거부 — 강제 신규 설치 의도일 때만 사용. 내용이 다른 파일이 있으면 본 옵션과 무관하게 항상 거부.",
        ),
      autoMergeHsqlSeed: z
        .boolean()
        .optional()
        .describe(
          "true (기본) 면 HSQL 임베디드 부트 시드(src/main/resources/db/*.sql)에 COMTNFILE/COMTNFILEDETAIL/COMTECOPSEQ DDL 을 자동 append — EgovConfigDatasource 의 hsql 분기는 단일 시드 파일만 .addScript() 로 로드하므로 그 안에 머지해야 부팅 시 첨부 테이블이 생성됩니다. 안전 조건: 시드 후보가 정확히 1개일 때만 append 하고, 0개 또는 2개 이상이면 별도 파일(src/main/resources/db/attach-file.sql) 생성으로 fallback 하며 결과 메시지에 사유를 알립니다 (egov_add_entity 의 autoApplyMigration 과 대칭). 사용자가 '시드 SQL 은 내가 직접 머지할게', '시드 자동 머지 끄고' 같은 표현을 쓰면 false — 이때는 시드를 손대지 않고 별도 파일도 만들지 않으며 필요한 DDL 안내만 합니다.",
        ),
    },
  },
  async (args) => {
    try {
      const result = await egovAddAttachFileInfrastructure(args);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[egovframe-mcp-codegen] egov_add_attach_file_infrastructure failed:`,
        error,
      );
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  },
);

// ─── transport ──────────────────────────────────────────────────────────────
async function main() {
  try {
    console.error("[egovframe-mcp-codegen] Creating transport...");
    const transport = new StdioServerTransport();

    console.error("[egovframe-mcp-codegen] Connecting server...");
    await server.connect(transport);

    console.error("[egovframe-mcp-codegen] ✓ Server started successfully");
  } catch (error) {
    console.error("[egovframe-mcp-codegen] ✗ Failed to start:", error);
    throw error;
  }
}

main().catch((error) => {
  console.error("[egovframe-mcp-codegen] Fatal error:", error);
  process.exit(1);
});
