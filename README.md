# eGovFrame MCP Codegen

> **DDL 한 줄로 전자정부 표준프레임워크(eGovFrame) 프로젝트와 엔티티 CRUD 를 자동 생성하는 MCP 서버**

[![eGovFrame](https://img.shields.io/badge/eGovFrame-5.1.0-134F8C?labelColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNzMuMjgyIDE3My4yODIiPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0xNzMuMjgyIDg2LjY1YzAgNDcuODQ0LTM4Ljc5NCA4Ni42MzItODYuNjQ2IDg2LjYzMkMzOC43OTkgMTczLjI4MiAwIDEzNC40OTQgMCA4Ni42NSAwIDM4Ljc4OCAzOC43OTkgMCA4Ni42MzYgMGM0Ny44NTIgMCA4Ni42NDYgMzguNzg4IDg2LjY0NiA4Ni42NSIvPjxwYXRoIGZpbGw9IiMwMDM3NjQiIGQ9Ik0xMjcuMzg5IDgwLjU5OGMtMTMuNzkxLTkuMzY1LTMxLjQzOS01LjU0Mi00MC43MTcgOC41MzMtNy43MiAxMS43NjctMTkuNDA1IDEzLjIzNS0yMy45MDYgMTMuMjM1LTE0Ljc1MSAwLTI0LjgyNC0xMC4zNjctMjcuODE4LTIxLjA5NWgtLjAxYy0uMDM5LS4xMDgtLjA1OS0uMi0uMDktLjMwNy0uMDI1LS4xMi0uMDU2LS4yMzMtLjA4OS0uMzY2LTEuMTc3LTQuNDY3LTEuNDY3LTYuNjA5LTEuNDY3LTExLjM2OCAwLTI1LjY1IDI2LjMyMS01NC4yMTMgNjQuMjE1LTU0LjIxMyAzOC44MjkgMCA2MS4wNSAyOS41NDUgNjYuNzggNDUuOTc5LS4xMDctLjI5NS0uMjA5LS41ODEtLjI5MS0uODc3LTExLjAxNS0zMi4xMjUtNDEuNDc0LTU1LjIxNi03Ny4zNTctNTUuMjE2LTQ1LjEzIDAtODEuNzI5IDM2LjU5LTgxLjcyOSA4MS43MzkgMCA0MC4zNTEgMjkuMTA4IDc0Ljg5MSA2OS40NzkgNzQuODkxIDMyLjE5NyAwIDUzLjg0Mi0xOC4wNTIgNjMuNzU3LTQyLjkzIDUuNDUtMTMuNjE0IDEuNTk1LTI5LjYwNS0xMC43NTctMzguMDA1Ii8%2BPHBhdGggZmlsbD0iI2U0MDMyZSIgZD0iTTE2NC43ODggNjIuNTg5Yy00Ljc3Ny0xNi4wMjYtMjcuMTUzLTQ3LjU3MS02Ny4yODItNDcuNTcxLTM3Ljg5NCAwLTY0LjIxNCAyOC41NjMtNjQuMjE0IDU0LjIxMiAwIDQuNzU5LjI5IDYuOTAxIDEuNDY2IDExLjM2OC0uNDg5LTEuOTUxLS43NC0zLjkwOC0uNzQtNS44MjMgMC0yNi43MjEgMjYuNzQxLTQ1LjIyNyA1NC4yNDgtNDUuMjI3IDM3LjIxOCAwIDY3LjM4OCAzMC4xNzQgNjcuMzg4IDY3LjM5IDAgMjkuMTczLTE2Ljc4NSA1NC40MzctNDEuMTc5IDY2LjU2NXYuMDIzYzMxLjQ1NS0xMS4zOTEgNTMuOTA4LTQxLjUxMiA1My45MDgtNzYuODg0IDAtOC4zNzgtMS4xMjctMTUuNzU5LTMuNTk1LTI0LjA1MyIvPjwvc3ZnPg%3D%3D)](https://www.egovframe.go.kr)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## 📖 MCP 개요

**MCP (Model Context Protocol)** 는 Anthropic 이 공개한 개방형 표준으로, LLM 클라이언트(Claude Desktop, Cursor, Claude Code 등) 와 외부 도구/데이터 소스를 안전하고 일관된 방식으로 연결합니다. MCP 서버는 stdio 또는 HTTP 위에 JSON-RPC 로 동작하며, LLM 에게 호출 가능한 **Tool** 목록과 각 Tool 의 입력 스키마를 노출합니다.

**eGovFrame MCP Codegen** 은 이 MCP 표준을 따르는 코드 생성 전용 서버입니다. LLM 이 사용자의 자연어 요청을 받으면 서버가 노출한 4개의 Tool 중 적절한 것을 호출하고, 서버는 DDL 파싱 → Handlebars 템플릿 렌더링 → 파일 시스템 출력까지를 결정적(deterministic)으로 수행합니다. LLM 은 코드를 한 줄도 직접 생성하지 않습니다 — 모든 산출물은 eGovFrame 표준 템플릿으로부터 나옵니다.

이 서버는 **eGovFrame 4.3 Boot / 4.3 WAR / 5.1 Boot** 세 스택의 표준 레이아웃(Controller/Service/ServiceImpl/Mapper/VO + Thymeleaf 또는 JSP 화면)을 알고 있으며, 충돌 시 거부(no force-overwrite), 공용 설정 파일은 건드리지 않는 안전 우선 동작을 기본으로 합니다.

## 🛠️ 제공 도구 (Tools)

네 개의 MCP Tool 을 제공합니다.

### 1. `egov_scaffold_project`

DDL 한 줄로부터 eGovFrame 프로젝트 전체 골격을 신규 생성합니다.

- `stackVersion: "5.1"` → eGovFrame 5.1 Boot (JDK 17 기준, Jakarta + Thymeleaf Spring6 + KRDS)
- `stackVersion: "4.3"` → eGovFrame 4.3 Boot (JDK 8 기준, javax + Thymeleaf Spring5)
- Boot 에서 `stackVersion` 을 생략하면 서버가 Elicitation 으로 사용자에게 버전을 직접 묻습니다 (기본값 없음). `withAttachment` 도 함께 생략되면 질문 하나로 두 항목을 같이 묻습니다. 구 명칭 `"5.0"` 은 더 이상 받지 않습니다
- `projectType: "war"` → 전통 WAR + JSP + Tomcat 배포 (stack 4.3 만 지원, WAR + 5.1 조합은 거부)
- CRUD, 페이징, 검색, 유효성 검증, 예외 처리, 서비스 계층, MyBatis 매퍼, 정적 리소스 포함
- 5.1 Boot 산출물은 공통컴포넌트(security 방식)를 참조한 Spring Security 보안 설정
  (`EgovConfigWebSecurity`)을 기본 포함 — 보안 응답 헤더, CSRF 보호(기본 활성,
  `egov.security.csrf` 로 토글), 명시적 StrictHttpFirewall, 프로퍼티 구동 CORS(기본 비활성).
  4.3 Boot / WAR 산출물에는 적용되지 않음 (Phase A — `docs/design/security-config-templates.md`)
- DDL 정규화(케이스/공백/인용부호) 기본 on — 의미를 바꾸지 않는 보수적 변환만 수행

| 파라미터        | 타입    | 필수 | 설명                                                              |
|---------------|--------|------|-------------------------------------------------------------------|
| projectName   | string | ✓    | Maven artifactId (예: `board-app`)                                |
| packageName   | string | ✓    | Base Java 패키지 (예: `egovframework.example.board`)              |
| outputPath    | string | ✓    | 프로젝트 폴더가 생성될 부모 디렉터리                                |
| entityName    | string | ✓    | PascalCase 엔티티 이름 (예: `Board`)                              |
| ddl           | string | ✓    | `CREATE TABLE …` DDL 문 (컬럼/테이블 COMMENT 는 화면 라벨로 사용. 괄호 밖 구분 문자(, / ; :) 포함·괄호 앞이 비어 있음·10자 초과 코멘트는 컬럼명 표기로 폴백) |
| projectType   | string |      | `boot` (기본) / `war`                                             |
| stackVersion  | string |      | `5.1` / `4.3`. Boot 에서 생략하면 Elicitation 으로 사용자에게 묻고, 미지원 클라이언트에서는 사용자에게 물은 뒤 지정해 재호출하라는 오류 반환. WAR 는 생략 시 `4.3` 으로 확정. `5.0` 은 거부 |
| normalizeDdl  | bool   |      | DDL 정규화 + 진단 보고서 첨부 (기본 true)                          |
| description   | string |      | 프로젝트 한 줄 설명                                                |
| withAttachment | bool  |      | 생략하면 Elicitation 으로 사용자에게 첨부파일 포함 여부를 묻고 (`stackVersion` 도 생략됐으면 같은 질문에 함께), 미지원 클라이언트에서는 사용자에게 물은 뒤 true/false 로 지정해 재호출하라는 오류를 반환. `true` 면 첨부파일 인프라를 설치하고 첫 엔티티에 연결, 사용자가 `decline` 하면 첨부 없이 생성 (Boot 전용: 5.1, 4.3. WAR 에서 `true` 는 거부, 생략하면 질문 없이 첨부 없이 생성) |

### 2. `egov_add_entity`

이미 생성된 eGovFrame 프로젝트에 새 엔티티의 CRUD 세트를 추가합니다.

- `projectType` / `stackVersion` 은 기존 `pom.xml` 에서 자동 감지 (지정 불필요)
- 생성될 파일 중 하나라도 충돌하면 **전체 거부** (덮어쓰기 옵션 없음)
- `pom.xml` / `application.properties` / `sql-mapper-config.xml` 같은 공용 설정은 건드리지 않음. 단 `withAttachment=true` 이고 첨부파일 인프라가 없으면 기본 옵션으로 함께 설치하므로 이 경우에 한해 `application.properties`, 메시지 번들, 시드 SQL 등도 수정됨 (Boot 만 지원: 5.1, 4.3)

| 파라미터              | 타입    | 필수 | 설명                                                                 |
|---------------------|--------|------|----------------------------------------------------------------------|
| projectPath         | string | ✓    | 기존 eGovFrame 프로젝트 루트 (`pom.xml` 존재 필수)                    |
| packageName         | string | ✓    | 새 엔티티의 풀 Java 패키지                                            |
| entityName          | string | ✓    | PascalCase 엔티티 이름                                                |
| ddl                 | string | ✓    | `CREATE TABLE …` DDL 문 (컬럼/테이블 COMMENT 는 화면 라벨로 사용. 괄호 밖 구분 문자(, / ; :) 포함·괄호 앞이 비어 있음·10자 초과 코멘트는 컬럼명 표기로 폴백) |
| autoApplyMigration  | bool   |      | 시드 SQL 파일에 마이그레이션 DDL append (기본 true)                  |
| autoApplyMessages   | bool   |      | 메시지 번들 3종에 키 자동 append (기본 true)                          |
| autoApplyMenu       | bool   |      | nav fragment 자동 재생성 + 기존 List 화면에 include 라인 삽입 (기본 false) |
| withAttachment      | bool   |      | 표준 첨부파일(`atchFileId`) 와이어드 엔티티로 생성. true 이고 인프라가 없으면 기본 옵션으로 함께 설치 (Boot 전용: 5.1, 4.3). 생략 시 Elicitation 으로 사용자에게 확인하며, 미지원 클라이언트에서는 사용자에게 물은 뒤 true/false 로 지정해 재호출하라는 오류 반환 |
| idGeneration        | string |      | `auto` (기본, EgovTableIdGnrServiceImpl) / `manual` (코드 마스터 테이블) |

### 3. `egov_add_query_view`

이미 생성된 eGovFrame 프로젝트(5.1 Boot / 4.3 Boot / 4.3 WAR)에 다중 JOIN 기반 read-only 조회 화면(리포트성 View) 을 추가합니다.

- 일반 CRUD 와 달리 등록/수정/삭제는 만들지 않고 **List + 페이징 + 검색**만 생성
- 사용자가 작성한 raw `SELECT` SQL 본문을 그대로 사용. 도구는 derived table 로 wrapping 해 페이징/검색을 외부에서 안전하게 적용
- 컬럼 메타(alias / label / type / format) 가 VO 필드와 화면 렌더링을 모두 결정
- 5.1 Boot / 4.3 Boot (Thymeleaf 화면), 4.3 WAR (JSP 화면) 지원. 스택은 `pom.xml` 에서 자동 감지

| 파라미터          | 타입     | 필수 | 설명                                                                |
|-----------------|---------|------|---------------------------------------------------------------------|
| projectPath     | string  | ✓    | 기존 eGovFrame 프로젝트(5.1 Boot / 4.3 Boot / 4.3 WAR) 루트          |
| packageName     | string  | ✓    | Query view 를 둘 Java 패키지                                         |
| viewName        | string  | ✓    | PascalCase view 이름 (예: `StudentEnrollmentReport`)                |
| sql             | string  | ✓    | 조회 본문 `SELECT` 문 (LIMIT/OFFSET 제외, alias 명시 필수)            |
| columns         | array   | ✓    | 컬럼 메타 (`alias`, `label`, `type`, `format`)                       |
| searchable      | array   |      | 검색 dropdown 에 노출될 alias 목록 (빈 배열 = 검색 UI 숨김)           |
| defaultOrderBy  | string  |      | 기본 `ORDER BY` 절                                                  |
| autoApplyMenu   | bool    |      | nav fragment 에 메뉴 자동 추가 (기본 true)                            |
| autoApplyMessages | bool  |      | 컬럼 라벨/메뉴 라벨을 메시지 번들에 자동 append (기본 true)           |

### 4. `egov_add_attach_file_infrastructure`

eGovFrame Boot(5.1, 4.3) 프로젝트에 표준 첨부파일 인프라를 1회 설치합니다 — **자체 보안 정책 + multipart 한도 + 업로드 에러 UX 까지 포함된 완성형**.

**구성 (자동 생성/등록되는 산출물 19종)**

- DB: `COMTNFILE` / `COMTNFILEDETAIL` 두 테이블 + 시퀀스 관리 테이블(`COMTECOPSEQ`) — dialect 별 7개 DDL
- Java: `EgovFileMngService` / `Impl`, `FileVO`, `EgovFileMngUtil`, `FileManageMapper`, `EgovFileDownloadController`, `EgovConfigAttachFile` Bean, `EgovFileUploadExceptionAdvice` (`@ControllerAdvice`)
- MyBatis: `EgovFileMng_SQL.xml`
- View: `cmm/uploadError.html` (inline 에러 페이지) + `_fragments/alertMessages.html`
- Properties: `Globals.fileStorePath` + multipart 한도 + 보안 정책 키 + 메시지 번들 키 3종 (ko/base/en) 자동 append

**핵심 동작**

- `atchFileId` 채번: `EgovTableIdGnrServiceImpl` (prefix=`FILE_`, cipers=15) — 정확히 `CHAR(20)` PK 와 길이 일치
- 충돌 시 거부 (force/overwrite 옵션 없음). `skipIfPresent=true` (기본) 면 동일 내용 존재 시 no-op
- 업로드 예외(크기 초과 / 실행파일 차단) 발생 시 `cmm/uploadError` view 가 한국어 안내 + "이전 화면" / "처음으로" 버튼 표시
- `egov_add_entity` / `egov_scaffold_project` 의 `withAttachment: true` 는 인프라가 없으면 기본 옵션으로 자동 설치하므로 사전 호출은 필수가 아닙니다. 화이트리스트·한도 등 세부 옵션이 필요할 때만 이 도구를 먼저 호출하세요

| 파라미터              | 타입       | 필수 | 설명                                                              |
|---------------------|-----------|------|-------------------------------------------------------------------|
| projectPath         | string    | ✓    | 기존 eGovFrame Boot(5.1, 4.3) 프로젝트 루트                              |
| fileStorePath       | string    |      | `Globals.fileStorePath` 절대경로. 비우면 OS 임시 디렉터리 fallback |
| idGnrPrefix         | string    |      | atchFileId 채번 prefix (기본 `FILE_`)                              |
| idGnrCipers         | number    |      | atchFileId 채번 자릿수 (기본 15, prefix+cipers=20 강제)            |
| **maxFileSize**     | string    |      | Spring multipart 단일 파일 한도. 단위 B/KB/MB/GB (기본 `10MB`). EgovFileMngUtil 의 도메인 정책 한도(`egov.attach.maxFileSize`) 도 같은 값으로 자동 설정 |
| **maxRequestSize**  | string    |      | Spring multipart 요청 전체 합산 한도 (기본 `50MB`)                 |
| **allowedExtensions** | string[] |      | 화이트리스트 (예: `["pdf","docx","xlsx","png","jpg"]`). 지정 시 이 목록에 없는 확장자는 모두 거부. 비어 있으면 화이트리스트 비활성화 (기본) |
| **blockedExtensions** | string[] |      | 추가 블랙리스트 (기본 P0 셋에 합산). 기본 셋이 이미 exe/bat/sh/jsp/php/svg/html 등 차단하므로 운영 정책으로 더 막을 경우에만 |
| autoApplyProperties | bool      |      | `application.properties` 에 `Globals.fileStorePath` + multipart + 보안 키 자동 append (기본 true) |
| skipIfPresent       | bool      |      | 모든 출력 파일이 동일 내용으로 존재 시 no-op (기본 true)            |

#### 🔐 자동 적용되는 보안 정책

본 도구가 설치하는 첨부파일 인프라는 다음 보안 방어선을 **기본으로** 제공합니다 — 추가 설정 없이 활성:

| 방어선 | 적용 위치 | 동작 |
|---|---|---|
| **Path traversal 차단** | `EgovFileMngUtil.safeChild` | `../etc/passwd` 같은 디렉터리 탈출 시 `SecurityException` |
| **저장 파일명 재생성** | `parseFileInf` | UUID — 사용자 입력 파일명이 디스크에 닿지 않음 |
| **인라인 실행 차단** | `EgovFileDownloadController.downFile` | `Content-Type: application/octet-stream` + `Content-Disposition: attachment` 강제. HTML/SVG/JS 가 첨부되어도 브라우저가 인라인 실행 안 함 |
| **CRLF 헤더 인젝션 차단** | `downFile` | 파일명에서 `\r\n` 제거 (response splitting 방어) |
| **실행 가능 확장자 차단 (P0)** | `EgovFileMngUtil.DEFAULT_BLOCKED_EXTENSIONS` | `EXE/BAT/SH/JSP/PHP/SVG/HTML/JAR` 등 30+ 확장자. 더블 확장자(`a.jpg.exe`) 도 마지막 기준으로 잡음 |
| **저장 경로 webroot 검증 (P0)** | `EgovFileMngUtil.@PostConstruct` | `Globals.fileStorePath` 가 `src/main/resources/static`, `src/main/webapp`, `classpath:` 등과 겹치면 **부팅 거부** |
| **운영 추가 블랙리스트 (P1)** | `egov.attach.blockedExtensions` | `blockedExtensions` 파라미터로 기본 셋에 추가 |
| **화이트리스트 모드 (P1)** | `egov.attach.allowedExtensions` | `allowedExtensions` 파라미터 지정 시 해당 목록 외 모두 거부 |
| **도메인 정책 파일 크기 (P1)** | `egov.attach.maxFileSize` | Spring multipart 한도와 별개로 컨트롤러 진입 시점에 한 번 더 검사 |
| **업로드 예외 UX** | `EgovFileUploadExceptionAdvice` | `MaxUploadSizeExceededException` / `SecurityException` 잡아서 `cmm/uploadError` view 로 한국어 안내. referer URL/method 매핑에 의존하지 않음 |

⚠️ **여전히 외부 조치가 필요한 부분** (이번 인프라가 자동으로 해주지 않는 것):

- **다운로드 URL 인증/인가** (`/cmm/fms/FileDown.do`) — 5.1 은 Spring Security 정책으로 보호 권장, 4.3 은 접근 제어가 없으므로 인증 체계 도입 시 보호. 기본은 열려 있어 `atchFileId`+`fileSn` 만 알면 누구나 다운로드 가능 (IDOR)
- **antivirus 스캔** — 자체 후크 없음. 운영 환경에서는 ClamAV 등 외부 스캔 권장
- **MIME 매직넘버 검증** — 확장자만 검사하며 실제 내용은 검증 안 함 (`.jpg` 로 리네임된 `.exe` 우회 가능. 다만 다운로드 시 `octet-stream` 강제라 인라인 실행은 막힘)

## 🚀 설치 (Installation)

### Prerequisites

- **Node.js**: v18.0.0 이상 (v22.x 권장)
- **npm**: v8.0.0 이상

### Build

```bash
npm install
npm run build
```

## 🔧 MCP 클라이언트 설정 (Configuration)

### Claude Desktop

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "egovframe-mcp-codegen": {
      "command": "node",
      "args": ["/path/to/egovframe-mcp-codegen/build/index.js"]
    }
  }
}
```

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json` (경로만 Windows 형식으로 치환)

#### 환경변수 (선택 사항)

이 서버는 **환경변수 없이도 동작**합니다. 서버는 빌드 산출물(`build/index.js`) 기준 상대 경로(`../templates`) 에서 템플릿 디렉터리를 자동으로 찾습니다. 패키지를 그대로 사용한다면 별도 설정이 필요 없습니다.

템플릿 디렉터리를 다른 위치로 옮겨야 하는 경우에만 다음 환경변수를 지정하세요:

| 환경변수                              | 용도                                                                    | 기본값                                  |
|-----------------------------------|-----------------------------------------------------------------------|-----------------------------------------|
| `EGOVFRAME_SCAFFOLD_TEMPLATE_PATH` | `templates/` 디렉터리 절대 경로. 매니페스트(`templates/manifests/*.json`) 와 Handlebars 템플릿을 여기서 로드 | `build/index.js` 기준 `../../templates` |
| `EGOVFRAME_STACK_MATRIX_PATH`     | `stacks.json` 파일 경로 (단독 지정 시)                                          | `${EGOVFRAME_SCAFFOLD_TEMPLATE_PATH}/stacks.json` |

> ⚠️ 과거 문서에 `EGOVFRAME_TEMPLATE_PATH` 라는 이름이 적혀 있는 경우가 있는데, 실제 코드에서 사용하는 이름은 **`EGOVFRAME_SCAFFOLD_TEMPLATE_PATH`** 입니다.

환경변수까지 명시한 설정 예:

```json
{
  "mcpServers": {
    "egovframe-mcp-codegen": {
      "command": "node",
      "args": ["/path/to/egovframe-mcp-codegen/build/index.js"],
      "env": {
        "EGOVFRAME_SCAFFOLD_TEMPLATE_PATH": "/custom/path/to/templates"
      }
    }
  }
}
```

### Cursor

`.cursor/mcp.json` 또는 settings 에서 동일한 형식으로 등록.

## 💡 사용 예시 (Usage Examples)

### 예시 1. 새 프로젝트 생성 (eGovFrame 5.1 Boot)

```
User: "다음 DDL 로 eGovFrame 5.1 Boot 게시판 프로젝트를 /workspace 에 만들어줘.
       CREATE TABLE board (
         board_id   VARCHAR(36)  PRIMARY KEY,
         title      VARCHAR(200) NOT NULL,
         content    TEXT,
         writer     VARCHAR(50),
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       )"

Claude: (egov_scaffold_project 호출)
        → /workspace/board-app/ 아래에 전체 프로젝트 골격 생성
```

LLM 이 자동 구성하는 도구 입력 예:

```json
{
  "projectName": "board-app",
  "packageName": "egovframework.example.board",
  "outputPath": "/workspace",
  "entityName": "Board",
  "ddl": "CREATE TABLE board (board_id VARCHAR(36) PRIMARY KEY, ...)",
  "stackVersion": "5.1"
}
```

사용자가 버전을 말하지 않았다면 LLM 은 `stackVersion` 을 생략하고, 서버가 Elicitation 으로
"표준프레임워크 5.1 (Spring Boot 3, Java 17)" / "표준프레임워크 4.3 (Spring Boot 2.7, Java 8)" 중 하나를 고르게 합니다.

### 예시 2. 기존 프로젝트에 엔티티 추가

```
User: "/workspace/board-app 에 Article 엔티티를 추가해줘.
       DDL: CREATE TABLE article (article_id VARCHAR(20) PRIMARY KEY, ...)"

Claude: (egov_add_entity 호출 — pom.xml 에서 stack 자동 감지)
        → 새 Controller/Service/Mapper/View 생성
        → 기존 시드 SQL 파일 끝에 DDL append
        → 메시지 번들에 키 자동 추가
```

### 예시 3. 코드 마스터 테이블 (manual ID 채번)

```
User: "/workspace/board-app 에 배송상태 코드 테이블을 추가해줘.
       DDL: CREATE TABLE delivery_status (stts_cd VARCHAR(10) PRIMARY KEY, stts_nm VARCHAR(50))"

Claude: (egov_add_entity 호출, idGeneration: "manual")
        → Register 화면에 PK 입력란 + required 검증 포함
```

### 예시 4. 리포트성 조회 화면 추가

```
User: "/workspace/academic-app 에 학생 수강 리포트 화면을 추가해줘.
       SELECT s.student_id  AS studentId,
              s.name         AS studentName,
              c.course_name  AS courseName,
              e.grade        AS grade
       FROM student s
       JOIN enrollment e ON e.student_id = s.student_id
       JOIN course c     ON c.course_id  = e.course_id"

Claude: (egov_add_query_view 호출 — boot50 전용)
        → 페이징/검색 가능한 read-only List 화면 생성
```

### 예시 5. 첨부파일 인프라 + 첨부 게시판

```
User: "보드 앱에 첨부파일 달린 NoticeBoard 엔티티를 추가해줘."

Claude:
  1) egov_add_entity 호출 (withAttachment 생략)
     → Elicitation 지원 클라이언트: "엔티티 'NoticeBoard'에 표준 첨부파일 기능을 연결할까요?
       프로젝트에 첨부파일 인프라가 없어 함께 설치됩니다." 를 사용자에게 직접 묻는다
     → Elicitation 미지원 클라이언트: 파일을 만들지 않고 오류를 반환 —
       Claude 가 사용자에게 물은 뒤 withAttachment 를 true/false 로 지정해 나머지 인자는 그대로 재호출
  2) withAttachment: true 로 실행되면
     → 인프라가 없을 때 기본 옵션으로 자동 설치 (BLOCKED_EXTENSIONS + webroot 검증 + ControllerAdvice +
       uploadError view + multipart 한도 10MB/50MB + 메시지 번들 append)
     → VO 에 atchFileId 필드, Controller 에 MultipartHttpServletRequest 분기,
       등록 화면에 <input type="file" name="file_1" multiple> 추가
  (세부 옵션이 필요하면 먼저 egov_add_attach_file_infrastructure 를 호출. 사용자가 취소하면 아무 파일도 만들지 않는다)
```

### 예시 6. 화이트리스트 + 큰 파일 허용 첨부 인프라

```
User: "/workspace/app 에 첨부파일 인프라 설치하되, PDF/Office 파일만 허용하고
       파일은 50MB, 요청은 200MB 까지 받아줘."

Claude: (egov_add_attach_file_infrastructure 호출)
```

```json
{
  "projectPath": "/workspace/app",
  "fileStorePath": "/opt/app/uploads",
  "maxFileSize": "50MB",
  "maxRequestSize": "200MB",
  "allowedExtensions": ["pdf", "docx", "xlsx", "pptx", "hwp"]
}
```

`EgovFileMngUtil` 진입 시점에 화이트리스트 외 확장자는 거절되고, 도메인 정책 한도(50MB) 도 Spring multipart 와 별개로 한 번 더 검증됩니다.

## 🗂️ 폴더 구조 (Project Structure)

```
egovframe-mcp-codegen/
├── src/
│   ├── index.ts                                # MCP 서버 진입점 (4 tool 등록)
│   ├── tools/
│   │   ├── egovScaffoldProject.ts              # 신규 프로젝트 생성
│   │   ├── egovAddEntity.ts                    # 엔티티 CRUD 추가
│   │   ├── egovAddQueryView.ts                 # 조회 화면 추가
│   │   └── egovAddAttachFileInfrastructure.ts  # 첨부파일 인프라 설치
│   └── utils/
│       ├── ddlNormalizer.ts                    # DDL 케이스/공백/타입 정규화
│       └── scaffold/                           # 스캐폴드 엔진
│           ├── ddlParser.ts                    # node-sql-parser 기반 진입
│           ├── ddlParserAst.ts                 # AST 변환
│           ├── ddlParserLegacy.ts              # legacy regex 폴백 파서
│           ├── dataTypes.ts                    # SQL → Java/TS 타입 매핑
│           ├── dialectTypes.ts                 # MySQL/Oracle/H2 dialect
│           ├── entityDiscovery.ts              # 기존 엔티티 스캔
│           ├── manifestLoader.ts               # templates/manifests/*.json 로더
│           ├── projectDetector.ts              # pom.xml 기반 stack 자동 감지
│           ├── scaffoldGenerator.ts            # 메인 렌더링 엔진
│           ├── skillsEmitter.ts                # Claude Skill 출력
│           └── stackMatrix.ts                  # stack × projectType 호환 매트릭스
│
├── templates/                                  # Handlebars 템플릿
│   ├── boot/                                   # eGovFrame 4.3 Boot
│   ├── boot50/                                 # eGovFrame 5.1 Boot
│   ├── war/                                    # eGovFrame 4.3 WAR
│   ├── static/                                 # 4.3 정적 리소스
│   ├── static50/                               # 5.1 정적 리소스
│   ├── attach-file/                            # 첨부파일 인프라 템플릿
│   │   ├── manifests/   # boot.json (5.1/4.3 공용)
│   │   └── boot/        # 5.1/4.3 공용 (stack 차이는 렌더 컨텍스트로 분기)
│   │       ├── java/        # 8개 Java 클래스 (Service/Util/Mapper/Controller/Config/ExceptionAdvice)
│   │       ├── thymeleaf/   # cmm/uploadError.html + _fragments/alertMessages.html
│   │       ├── messages/    # 메시지 번들 append fragment (ko/base/en)
│   │       ├── properties/  # application.properties append fragment (Globals/multipart/security/globals)
│   │       ├── mapper/      # EgovFileMng_SQL.xml
│   │       ├── ddl/         # 7 dialect 별 attach-file.sql
│   │       └── ...
│   ├── manifests/                              # 출력 파일 매니페스트
│   │   ├── boot43.json
│   │   ├── boot50.json
│   │   └── war43.json
│   ├── docs/                                   # 산출물 동봉 문서
│   ├── skills/                                 # 산출물 동봉 Claude Skill
│   └── stacks.json                             # 스택 정의
│
├── tests/                                      # Vitest 단위/통합 테스트
│   ├── scaffold/                               # 스캐폴드 golden 테스트
│   └── utils/                                  # 유틸 단위 테스트
│
├── docs/
│   └── design/                                 # 설계 문서
│
├── build/                                      # tsc 산출물 (npm run build 후 생성)
├── package.json
├── tsconfig.json
└── vitest.config.mjs
```

## 🧪 테스트 (Testing)

자동화 테스트는 [Vitest](https://vitest.dev/) 로 작성되어 `tests/**/*.test.ts` 에 위치합니다.

| 명령어                | 동작                                                       |
|----------------------|------------------------------------------------------------|
| `npm test`           | `npm run build` 후 `vitest run` (전체 테스트)              |
| `npm run test:unit`  | `vitest run` (build 생략)                                  |
| `npm run test:watch` | watch 모드                                                 |
| `npm run test:update`| `UPDATE_GOLDEN=1` 로 scaffold golden JSON 갱신             |

### MCP Inspector (수동 디버깅)

```bash
npm run inspector
```

빌드된 `build/index.js` 를 MCP Inspector 에 띄워 tool 을 인터랙티브하게 호출할 수 있습니다 — 신규 사용자 데모와 디버깅에 유용합니다.

## ⚠️ 안전 정책 (Safety Defaults)

이 서버는 결정적이고 보수적인 동작을 우선시합니다:

- **충돌 시 거부**: 출력 파일이 하나라도 이미 존재하면 어떤 파일도 작성하지 않고 충돌 목록과 함께 거부합니다. `egov_scaffold_project` 도 `outputPath` 아래에 같은 이름의 비어 있지 않은 폴더가 있으면 거부합니다. 강제 덮어쓰기 옵션은 의도적으로 제공하지 않습니다.
- **공용 설정 불간섭**: `pom.xml`, `application.properties`, `sql-mapper-config.xml` 같은 프로젝트 공용 설정은 신규 엔티티 추가 시 건드리지 않습니다.
- **DDL 정규화는 보수적**: 의미를 바꾸지 않는 케이스/공백/인용부호 변환만 수행하며, 변경 항목은 진단 보고서로 사용자에게 반드시 통지합니다.
- **스택 호환성 검증**: WAR + 5.1 같은 미지원 조합은 진입 시점에 명확한 에러로 거부합니다.

## 🔗 함께 쓰는 자매 MCP

- **[egovframe-mcp-search](../egovframe-mcp-search)** — eGovFrame 가이드 / 표준 용어 / 공통컴포넌트 / 호환성 통합 검색
- **[egovframe-mcp-check](../egovframe-mcp-check)** — 생성된 프로젝트의 아키텍처 컴플라이언스 검증

## 📄 라이선스

Apache-2.0

## 🙏 Credits

[egovframe-vscode-initializr](https://github.com/egovframework/egovframe-vscode-initializr) 의 스캐폴드 로직을 기반으로 합니다.
