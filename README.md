# eGovFrame MCP Codegen

> DDL 을 바탕으로 전자정부 표준프레임워크(eGovFrame) 프로젝트와 CRUD 코드를 생성하는 MCP 서버

[![eGovFrame](https://img.shields.io/badge/eGovFrame-5.1.0-134F8C?labelColor=white&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNzMuMjgyIDE3My4yODIiPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0xNzMuMjgyIDg2LjY1YzAgNDcuODQ0LTM4Ljc5NCA4Ni42MzItODYuNjQ2IDg2LjYzMkMzOC43OTkgMTczLjI4MiAwIDEzNC40OTQgMCA4Ni42NSAwIDM4Ljc4OCAzOC43OTkgMCA4Ni42MzYgMGM0Ny44NTIgMCA4Ni42NDYgMzguNzg4IDg2LjY0NiA4Ni42NSIvPjxwYXRoIGZpbGw9IiMwMDM3NjQiIGQ9Ik0xMjcuMzg5IDgwLjU5OGMtMTMuNzkxLTkuMzY1LTMxLjQzOS01LjU0Mi00MC43MTcgOC41MzMtNy43MiAxMS43NjctMTkuNDA1IDEzLjIzNS0yMy45MDYgMTMuMjM1LTE0Ljc1MSAwLTI0LjgyNC0xMC4zNjctMjcuODE4LTIxLjA5NWgtLjAxYy0uMDM5LS4xMDgtLjA1OS0uMi0uMDktLjMwNy0uMDI1LS4xMi0uMDU2LS4yMzMtLjA4OS0uMzY2LTEuMTc3LTQuNDY3LTEuNDY3LTYuNjA5LTEuNDY3LTExLjM2OCAwLTI1LjY1IDI2LjMyMS01NC4yMTMgNjQuMjE1LTU0LjIxMyAzOC44MjkgMCA2MS4wNSAyOS41NDUgNjYuNzggNDUuOTc5LS4xMDctLjI5NS0uMjA5LS41ODEtLjI5MS0uODc3LTExLjAxNS0zMi4xMjUtNDEuNDc0LTU1LjIxNi03Ny4zNTctNTUuMjE2LTQ1LjEzIDAtODEuNzI5IDM2LjU5LTgxLjcyOSA4MS43MzkgMCA0MC4zNTEgMjkuMTA4IDc0Ljg5MSA2OS40NzkgNzQuODkxIDMyLjE5NyAwIDUzLjg0Mi0xOC4wNTIgNjMuNzU3LTQyLjkzIDUuNDUtMTMuNjE0IDEuNTk1LTI5LjYwNS0xMC43NTctMzguMDA1Ii8%2BPHBhdGggZmlsbD0iI2U0MDMyZSIgZD0iTTE2NC43ODggNjIuNTg5Yy00Ljc3Ny0xNi4wMjYtMjcuMTUzLTQ3LjU3MS02Ny4yODItNDcuNTcxLTM3Ljg5NCAwLTY0LjIxNCAyOC41NjMtNjQuMjE0IDU0LjIxMiAwIDQuNzU5LjI5IDYuOTAxIDEuNDY2IDExLjM2OC0uNDg5LTEuOTUxLS43NC0zLjkwOC0uNzQtNS44MjMgMC0yNi43MjEgMjYuNzQxLTQ1LjIyNyA1NC4yNDgtNDUuMjI3IDM3LjIxOCAwIDY3LjM4OCAzMC4xNzQgNjcuMzg4IDY3LjM5IDAgMjkuMTczLTE2Ljc4NSA1NC40MzctNDEuMTc5IDY2LjU2NXYuMDIzYzMxLjQ1NS0xMS4zOTEgNTMuOTA4LTQxLjUxMiA1My45MDgtNzYuODg0IDAtOC4zNzgtMS4xMjctMTUuNzU5LTMuNTk1LTI0LjA1MyIvPjwvc3ZnPg%3D%3D)](https://www.egovframe.go.kr)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## 개요

**MCP (Model Context Protocol)** 는 AI 클라이언트(Claude Desktop, Claude Code, Cursor 등)와 외부 도구를 일관된 방식으로 연결하는 개방형 표준입니다. MCP 서버는 AI 가 호출할 수 있는 도구(Tool)의 목록과 각 도구의 입력 형식을 클라이언트에 알려 줍니다.

**eGovFrame MCP Codegen (코드생성 MCP)** 은 이 표준을 따르는 코드 생성 서버입니다. 사용자가 AI 클라이언트에 DDL 과 함께 자연어로 생성을 요청하면, AI 가 4개의 도구 가운데 알맞은 도구를 호출합니다. DDL 해석, 템플릿 렌더링, 파일 생성은 모두 서버의 코드가 정해진 규칙에 따라 수행하며, 모든 산출물은 표준프레임워크 템플릿에서 만들어집니다. AI 는 코드를 직접 작성하지 않으므로, 같은 DDL 로 요청하면 항상 같은 코드가 생성됩니다.

## 주요 기능

| 기능 | 설명 |
|------|------|
| 3개 스택 지원 | 5.1 Boot, 4.3 Boot, 4.3 WAR 의 표준 구조로 생성합니다. |
| 바로 실행되는 프로젝트 | Controller, Service, MyBatis Mapper, VO, KRDS 화면과 페이징, 검색, 유효성 검증, 예외 처리가 들어 있고, 내장 HSQLDB 로 바로 실행할 수 있습니다. |
| 사용자 확인 | 스택이나 첨부파일 포함 여부를 지정하지 않으면 서버가 MCP Elicitation 으로 사용자에게 직접 묻습니다. |
| 화면 라벨 | 컬럼과 테이블의 COMMENT 를 화면 라벨로 사용합니다. |
| 운영 DB 용 SQL | 7개 DBMS(Oracle, Tibero, Altibase, CUBRID, Goldilocks, MySQL, PostgreSQL)용 SQL 을 함께 생성합니다. |
| 보안 설정 | 5.1 Boot 프로젝트에는 Spring Security 설정(보안 응답 헤더, CSRF, 방화벽, CORS)이 기본으로 들어갑니다. |

- **덮어쓰지 않음**: 기존 파일을 덮어쓰는 옵션이 없습니다. 엔티티나 조회 화면을 추가할 때 만들 파일 가운데 하나라도 이미 있으면 생성 전체를 거부합니다.
- **오프라인 동작**: 실행에 필요한 의존 패키지가 배포 파일에 함께 들어 있어서 폐쇄망에서도 설치하고 실행할 수 있습니다.

## 지원 스택

| 스택 | 실행환경 | Java | 기반 | 화면 |
|------|----------|------|------|------|
| 5.1 Boot | 5.1.0 | 17 | Spring Boot 3 | Thymeleaf |
| 4.3 Boot | 4.3.2 | 8 | Spring Boot 2.7 | Thymeleaf |
| 4.3 WAR | 4.3.2 | 8 | Spring 5.3 | JSP, Tomcat 에 배포 |

세 스택의 화면은 모두 KRDS(대한민국 정부 디자인 시스템)의 마크업과 정적 자산을 사용합니다.

## 제공 도구

이 MCP 서버는 도구 4개를 노출합니다.

| 도구 | 용도 | 대상 스택 |
|------|------|-----------|
| [`egov_scaffold_project`](docs/reference/EGOV_SCAFFOLD_PROJECT_TOOL.md) | DDL 하나로 프로젝트 전체를 새로 생성 | 세 스택 |
| [`egov_add_entity`](docs/reference/EGOV_ADD_ENTITY_TOOL.md) | 기존 프로젝트에 새 엔티티의 CRUD 코드를 추가 | 세 스택 |
| [`egov_add_query_view`](docs/reference/EGOV_ADD_QUERY_VIEW_TOOL.md) | 다중 JOIN `SELECT` 문으로 조회 전용 화면을 추가 | 세 스택 |
| [`egov_add_attach_file_infrastructure`](docs/reference/EGOV_ADD_ATTACH_FILE_INFRASTRUCTURE_TOOL.md) | 표준 첨부파일 인프라를 설치 | 5.1 Boot, 4.3 Boot |

아래에는 필수 인자와 자주 쓰는 인자만 적었습니다. 전체 인자와 세부 동작은 각 도구의 문서와 [`docs/reference/TOOLS_OVERVIEW.md`](docs/reference/TOOLS_OVERVIEW.md) 에 있습니다.

### `egov_scaffold_project`

DDL 로 표준프레임워크 프로젝트 전체를 새로 생성합니다.

| 인자 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `projectName` | string | 필수 | 프로젝트 폴더의 이름이자 Maven `artifactId` (예: `board-app`) |
| `packageName` | string | 필수 | 첫 엔티티의 Java 패키지 (예: `egovframework.example.board`) |
| `outputPath` | string | 필수 | 프로젝트 폴더를 만들 상위 디렉터리 |
| `entityName` | string | 필수 | PascalCase 엔티티 이름 (예: `Board`) |
| `ddl` | string | 필수 | `CREATE TABLE` 문 |
| `projectType` | `"boot"` \| `"war"` | 선택 | `boot` 또는 `war`. 생략하면 서버가 사용자에게 묻습니다. |
| `stackVersion` | `"5.1"` \| `"4.3"` | 선택 | `5.1` 또는 `4.3`. 생략하면 서버가 사용자에게 묻습니다. |
| `withAttachment` | boolean | 선택 | 첫 엔티티에 첨부파일을 연결할지 여부. 생략하면 서버가 사용자에게 묻습니다. Boot 에서만 지원합니다. |

`outputPath` 아래에 같은 이름의 비어 있지 않은 폴더가 있으면 거부합니다. WAR 와 5.1 의 조합은 지원하지 않습니다.

### `egov_add_entity`

기존 프로젝트에 새 엔티티의 CRUD 코드를 추가합니다. 스택은 `pom.xml` 에서 감지합니다.

| 인자 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `projectPath` | string | 필수 | 기존 프로젝트의 루트 경로 (`pom.xml` 필요) |
| `packageName` | string | 필수 | 새 엔티티의 Java 패키지 |
| `entityName` | string | 필수 | PascalCase 엔티티 이름 |
| `ddl` | string | 필수 | `CREATE TABLE` 문 |
| `idGeneration` | `"auto"` \| `"manual"` | 선택 | `auto`(기본값)는 `EgovTableIdGnrServiceImpl` 로 기본 키를 자동 채번하고, `manual` 은 사용자가 직접 입력합니다. |
| `withAttachment` | boolean | 선택 | 엔티티에 첨부파일을 연결할지 여부. 생략하면 서버가 사용자에게 묻습니다. Boot 에서만 지원합니다. |
| `autoApplyMigration` | boolean | 선택 | 새 테이블의 DDL 을 내장 HSQLDB 의 시드 SQL 에 덧붙입니다 (기본값 `true`). |
| `autoApplyMessages` | boolean | 선택 | 메시지 키를 메시지 번들에 덧붙입니다 (기본값 `true`). |
| `autoApplyMenu` | boolean | 선택 | 메뉴에 새 엔티티를 추가합니다 (기본값 `false`). |

DDL 의 외래키가 참조하는 엔티티가 프로젝트에 있으면, 등록 화면에 콤보 상자를 만들고 목록 화면에 참조 엔티티의 이름을 표시합니다.

### `egov_add_query_view`

여러 테이블을 JOIN 하는 `SELECT` 문으로 조회 전용 화면(리포트 화면)을 추가합니다. 목록, 페이징, 검색만 만들고 등록, 수정, 삭제는 만들지 않습니다.

| 인자 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `projectPath` | string | 필수 | 기존 프로젝트의 루트 경로 |
| `packageName` | string | 필수 | 조회 화면의 코드를 둘 Java 패키지 |
| `viewName` | string | 필수 | PascalCase 화면 이름 (예: `StudentEnrollmentReport`) |
| `sql` | string | 필수 | 조회에 사용할 `SELECT` 문. 컬럼마다 `AS` 로 별칭을 붙이고, `LIMIT` 과 `OFFSET` 은 넣지 않습니다. |
| `columns` | object[] | 필수 | 컬럼 정보의 목록 (`alias`, `label`, `type`, `format`) |
| `searchable` | string[] | 선택 | 검색 조건으로 쓸 컬럼의 별칭 목록 |
| `defaultOrderBy` | string | 선택 | 기본 정렬 (예: `studentId DESC`) |

### `egov_add_attach_file_infrastructure`

Boot 프로젝트에 표준 첨부파일 인프라를 설치합니다. 첨부파일 테이블 DDL, 파일 관리 Service 와 Mapper, 다운로드 Controller, 업로드 오류 화면, 저장 경로와 용량과 확장자 정책의 설정을 만듭니다.

| 인자 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `projectPath` | string | 필수 | 기존 Boot(5.1, 4.3) 프로젝트의 루트 경로 |
| `fileStorePath` | string | 선택 | 파일 저장 경로. 기본값은 운영체제 임시 디렉터리 아래의 `egov-upload` 입니다. |
| `maxFileSize`, `maxRequestSize` | string | 선택 | 파일 하나와 요청 전체의 크기 한도 (기본값 `10MB`, `50MB`) |
| `allowedExtensions` | string[] | 선택 | 허용할 확장자의 목록. 지정하면 목록에 없는 확장자를 모두 거부합니다. |
| `blockedExtensions` | string[] | 선택 | 기본 차단 목록에 더할 확장자 |

`egov_scaffold_project` 와 `egov_add_entity` 는 `withAttachment=true` 일 때 인프라가 없으면 기본 옵션으로 함께 설치합니다. 따라서 이 도구는 저장 경로나 정책을 기본값과 다르게 설치할 때만 먼저 호출합니다.

설치되는 인프라는 실행 가능한 확장자의 차단, 저장 파일명의 UUID 변환, 경로 탈출 방어, 다운로드 응답의 첨부 처리를 기본으로 제공합니다. 다운로드 URL 의 접근 제어, 악성코드 검사, 파일 내용 검사는 제공하지 않으므로 프로젝트에서 따로 갖추어야 합니다. 상세한 내용은 [`docs/architecture/ATTACH_FILE.md`](docs/architecture/ATTACH_FILE.md) 에 있습니다.

## 설치

### 요구 사항

- **Node.js**: 18 이상 (22 권장)
- **JDK 와 Maven**: 생성된 프로젝트를 빌드하고 실행하려면 JDK 와 Maven 이 필요합니다. 5.1 Boot 는 JDK 17, 4.3 Boot 와 4.3 WAR 는 JDK 8 을 기준으로 합니다.

### 1. 배포 파일(tgz) 내려받기

[표준프레임워크 포털](https://www.egovframe.go.kr/home/sub.do?menuNo=114)에서 `egovframe-mcp-codegen-5.1.0.tgz` 를 내려받습니다. 실행에 필요한 의존 패키지가 모두 들어 있으며, 하나의 파일을 Windows, macOS, Linux 에서 공통으로 사용합니다.

### 2. 서버 실행 명령

압축을 풀지 않고 `npx` 로 실행하도록 AI 클라이언트에 등록합니다. 아래에서 `<TGZ>` 는 tgz 파일의 절대 경로입니다.

```bash
npx -y --package=<TGZ> egovframe-mcp-codegen
```

Windows 에서는 `cmd /c` 로 감싸서 실행합니다.

```bat
cmd /c npx -y --package=<TGZ> egovframe-mcp-codegen
```

### 3. AI 클라이언트 등록

`mcpServers` 형식을 쓰는 AI 클라이언트에는 다음 항목을 등록합니다.

**macOS, Linux**

```json
{
  "mcpServers": {
    "egovframe-mcp-codegen": {
      "command": "npx",
      "args": ["-y", "--package=<TGZ>", "egovframe-mcp-codegen"]
    }
  }
}
```

**Windows**

```json
{
  "mcpServers": {
    "egovframe-mcp-codegen": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "--package=<TGZ>", "egovframe-mcp-codegen"]
    }
  }
}
```

Claude Code, Codex, Cursor, VS Code (GitHub Copilot), Cline, OpenCode, Claude Desktop 에 등록하는 방법(CLI 명령, 설정 파일의 위치와 형식)은 [`docs/setup/MCP_SETUP_GUIDE.md`](docs/setup/MCP_SETUP_GUIDE.md#ai-클라이언트별-등록) 에 있습니다. 환경 변수와 문제 해결도 같은 문서에서 다룹니다.

### 저장소를 클론해서 실행 (개발자)

```bash
git clone https://github.com/eGovFramework/egovframe-mcp-codegen.git
cd egovframe-mcp-codegen
npm install    # prepare 스크립트가 빌드까지 실행합니다
```

클라이언트에는 `build/index.js` 를 절대 경로로 등록합니다.

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

### 환경 변수

서버는 환경 변수 없이 동작합니다. 템플릿 디렉터리는 `build/index.js` 가 놓인 패키지의 `templates/` 에서 찾습니다. 템플릿을 다른 위치에 둘 때에만 다음 변수를 지정합니다.

| 환경 변수 | 용도 | 기본값 |
|-----------|------|--------|
| `EGOVFRAME_SCAFFOLD_TEMPLATE_PATH` | 템플릿 디렉터리의 절대 경로 | 패키지의 `templates/` |
| `EGOVFRAME_STACK_MATRIX_PATH` | 스택 정의 파일(`stacks.json`)의 경로 | `<템플릿 디렉터리>/stacks.json` |

## 사용 예시

AI 클라이언트에 자연어로 요청하면 AI 가 알맞은 도구를 호출합니다.

### 예시 1. 새 프로젝트 생성

```text
다음 DDL 로 표준프레임워크 5.1 Boot 게시판 프로젝트를 /workspace 에 만들어 줘. 첨부파일은 필요 없어.

CREATE TABLE BOARD (
  BOARD_ID   VARCHAR(20)  NOT NULL COMMENT '게시글ID',
  TITLE      VARCHAR(200) NOT NULL COMMENT '제목',
  CONTENT    TEXT                  COMMENT '내용',
  WRITER     VARCHAR(50)           COMMENT '작성자',
  CREATED_AT TIMESTAMP             COMMENT '등록일시',
  PRIMARY KEY (BOARD_ID)
) COMMENT='게시판'
```

AI 는 `egov_scaffold_project` 를 다음과 같은 입력으로 호출하고, `/workspace/board-app` 에 프로젝트가 생성됩니다.

```json
{
  "projectName": "board-app",
  "packageName": "egovframework.example.board",
  "outputPath": "/workspace",
  "entityName": "Board",
  "ddl": "CREATE TABLE BOARD ( ... ) COMMENT='게시판'",
  "projectType": "boot",
  "stackVersion": "5.1",
  "withAttachment": false
}
```

버전이나 첨부파일 포함 여부를 말하지 않으면 AI 는 해당 인자를 생략하고, 서버가 사용자에게 5.1 Boot, 4.3 Boot, 4.3 WAR 가운데 하나와 첨부파일 포함 여부를 묻습니다.

### 예시 2. 엔티티 추가

```text
/workspace/board-app 에 Article 엔티티를 추가하고 메뉴에도 넣어 줘. 첨부파일은 필요 없어.

CREATE TABLE ARTICLE (
  ARTICLE_ID VARCHAR(20)  NOT NULL COMMENT '기사ID',
  BOARD_ID   VARCHAR(20)           COMMENT '게시판',
  SUBJECT    VARCHAR(100) NOT NULL COMMENT '제목',
  PRIMARY KEY (ARTICLE_ID),
  CONSTRAINT FK_ARTICLE_BOARD FOREIGN KEY (BOARD_ID) REFERENCES BOARD(BOARD_ID)
) COMMENT='기사'
```

AI 는 `egov_add_entity` 를 호출합니다. 서버는 `pom.xml` 에서 스택을 감지하고, `BOARD_ID` 가 참조하는 Board 엔티티를 찾아서 등록 화면에 콤보 상자를 만듭니다. 새 테이블의 DDL 은 시드 SQL 에, 메시지 키는 메시지 번들에 덧붙습니다.

### 예시 3. 첨부파일이 있는 엔티티 추가

```text
/workspace/board-app 에 첨부파일을 올릴 수 있는 Notice 엔티티를 추가해 줘.
DDL: CREATE TABLE NOTICE (NOTICE_ID VARCHAR(20) PRIMARY KEY, TITLE VARCHAR(200) NOT NULL COMMENT '제목')
```

AI 는 `egov_add_entity` 를 `withAttachment: true` 로 호출합니다. 프로젝트에 첨부파일 인프라가 없으면 기본 옵션으로 함께 설치되고, 등록 화면에 파일 선택, 기존 파일 목록, 다운로드 링크가 추가됩니다.

### 예시 4. 조회 화면 추가

```text
/workspace/board-app 에 게시판별 기사 현황 화면을 추가해 줘.

SELECT b.BOARD_ID   AS boardId,
       b.TITLE      AS boardTitle,
       a.SUBJECT    AS articleSubject,
       b.CREATED_AT AS createdAt
FROM BOARD b
LEFT JOIN ARTICLE a ON a.BOARD_ID = b.BOARD_ID
```

AI 는 `egov_add_query_view` 를 호출합니다. 페이징과 검색이 되는 조회 전용 목록 화면이 `/egovBoardArticleReportList.do` 에 생성됩니다.

### 예시 5. 정책을 지정한 첨부파일 인프라 설치

```text
/workspace/board-app 에 첨부파일 인프라를 설치해 줘. PDF 와 오피스 문서만 허용하고,
파일은 50MB, 요청은 200MB 까지 받게 해 줘.
```

AI 는 `egov_add_attach_file_infrastructure` 를 다음과 같은 입력으로 호출합니다.

```json
{
  "projectPath": "/workspace/board-app",
  "maxFileSize": "50MB",
  "maxRequestSize": "200MB",
  "allowedExtensions": ["pdf", "docx", "xlsx", "pptx", "hwp"]
}
```

## 생성된 프로젝트의 실행

생성된 프로젝트는 내장 HSQLDB 를 사용하므로 DB 를 준비하지 않고 바로 실행할 수 있습니다.

```bash
cd /workspace/board-app
mvn clean package
mvn spring-boot:run    # Boot. http://localhost:8080/ 에 접속
```

WAR 프로젝트는 `mvn clean package` 가 만든 `target/board-app-1.0.0.war` 를 Tomcat 의 `webapps/` 에 복사해서 실행합니다. 스택별 구조, 화면의 URL, 운영 DB 로 전환하는 방법은 [`docs/reference/GENERATED_PROJECT.md`](docs/reference/GENERATED_PROJECT.md) 에 있습니다.

## 안전 정책

- **충돌하면 거부**: `egov_add_entity` 와 `egov_add_query_view` 는 만들 파일이 하나라도 이미 있으면 어떤 파일도 쓰지 않고, 충돌한 파일의 목록과 함께 거부합니다. 만들 파일이 모두 같은 내용으로 이미 있으면 변경 없이 성공으로 응답합니다. `egov_scaffold_project` 는 같은 이름의 비어 있지 않은 폴더가 있으면 거부합니다. `egov_add_attach_file_infrastructure` 는 같은 내용의 파일은 건너뛰고, 내용이 다른 파일이 있으면 거부합니다.
- **기존 파일의 수정은 한정된 범위에서만**: `pom.xml`, 설정 클래스, 다른 엔티티의 코드는 고치지 않습니다. 기존 파일에 내용을 덧붙이는 경우는 시드 SQL, 메시지 번들, 메뉴, 첨부파일 설정으로 한정되며, 각각 옵션으로 끌 수 있습니다. 4.3 WAR 의 `validator.xml` 에는 새 엔티티의 검증 규칙을 항상 삽입합니다.
- **쓰기 전 검증과 되돌리기**: 기존 프로젝트에 파일을 추가하는 세 도구는 렌더링 결과를 검사한 뒤에 파일을 쓰고, 쓰는 도중에 실패하면 이미 쓴 파일을 원래 상태로 되돌립니다. 새 폴더에 프로젝트를 만드는 `egov_scaffold_project` 는 파일을 쓴 뒤에 검사합니다.
- **프로젝트 폴더 밖에 쓰지 않음**: 모든 산출물의 경로는 대상 프로젝트 폴더 안에 있는지 확인한 뒤에 씁니다.
- **DDL 정리는 의미를 바꾸지 않는 범위에서만**: 대소문자, 공백, 따옴표를 정리하고 SQL 주석을 제거하며, 정리한 내용을 결과 메시지로 알립니다.

## 제약 사항

- 4.3 WAR 는 첨부파일을 지원하지 않습니다.
- Oracle, Tibero, Altibase 로 전환할 때에는 생성된 MyBatis SQL 의 페이징 구문과 검색 조건을 직접 고쳐야 합니다.
- 날짜 입력란의 달력(flatpickr)은 CDN 에서 불러오므로, 인터넷에 연결되지 않은 환경에서는 달력이 뜨지 않습니다.
- 생성되는 프로젝트에는 로그인과 권한 관리가 없습니다.

전체 목록과 피하는 방법은 [`docs/development/KNOWN_ISSUES.md`](docs/development/KNOWN_ISSUES.md) 에 있습니다.

## 기술 스택

| 구분 | 내용 |
|------|------|
| Protocol | MCP (Model Context Protocol), stdio 전송 |
| MCP SDK | `@modelcontextprotocol/sdk` v1.29.0 |
| Language | TypeScript v5.9.3 |
| Runtime | Node.js 18 이상 (Node.js 22 권장) |
| Template Engine | `handlebars` v4.7.9 |
| SQL Parser | `node-sql-parser` v5.4.0 |
| Schema Validation | `zod` v4.4.3 |
| Test | Vitest v1.6.1 |

## 폴더 구조

```text
egovframe-mcp-codegen/
├── src/
│   ├── index.ts                                 # MCP 서버의 진입점 (도구 4개 등록, 사용자 확인)
│   ├── tools/
│   │   ├── egovScaffoldProject.ts               # egov_scaffold_project
│   │   ├── egovAddEntity.ts                     # egov_add_entity
│   │   ├── egovAddQueryView.ts                  # egov_add_query_view
│   │   └── egovAddAttachFileInfrastructure.ts   # egov_add_attach_file_infrastructure
│   └── utils/
│       ├── ddlNormalizer.ts                     # DDL 정리
│       ├── sqlText.ts                           # SQL 문자열 유틸리티
│       ├── fsCopyFilter.ts                      # 정적 자산 복사 필터
│       └── scaffold/                            # 코드 생성 엔진
│           ├── ddlParser.ts, ddlParserAst.ts, ddlParserLegacy.ts    # DDL 파싱
│           ├── dataTypes.ts, dialectTypes.ts                        # 타입 매핑
│           ├── messageLabel.ts                                      # COMMENT 를 화면 라벨로 변환
│           ├── stackMatrix.ts, manifestLoader.ts                    # 스택 정의와 매니페스트
│           ├── scaffoldGenerator.ts                                 # 렌더링과 프로젝트 생성
│           ├── projectDetector.ts, entityDiscovery.ts               # 기존 프로젝트의 해석
│           ├── migrationStrategy.ts                                 # 시드 SQL 반영 방식의 결정
│           ├── attachFileInstaller.ts, attachmentContext.ts         # 첨부파일
│           ├── scaffoldDecision.ts, attachmentDecision.ts, elicitForm.ts    # 사용자 확인
│           ├── outputValidator.ts, pathGuard.ts, writeRollback.ts   # 검증, 경로 확인, 되돌리기
│           └── toolMessages.ts                                      # 오류 문구와 완료 표식
├── templates/
│   ├── stacks.json                              # 스택 정의
│   ├── manifests/                               # 스택별 매니페스트 (boot50, boot43, war43)
│   ├── boot50/                                  # 5.1 Boot 템플릿
│   ├── boot/                                    # 4.3 Boot 템플릿
│   ├── war/                                     # 4.3 WAR 템플릿
│   ├── static50/                                # KRDS 정적 자산 (세 스택 공용)
│   └── attach-file/                             # 첨부파일 인프라의 매니페스트와 템플릿 (두 Boot 스택 공용)
├── tests/                                       # Vitest 테스트
│   ├── scaffold/                                # 코드 생성의 단위 테스트와 통합 테스트
│   │   └── __golden__/                          # 골든 파일
│   └── utils/                                   # 유틸리티의 단위 테스트
├── scripts/
│   └── pack-bundle.sh                           # 배포 tgz 제작
├── docs/                                        # 상세 문서 (아래 "문서" 참조)
├── build/                                       # 컴파일 결과 (npm run build 로 생성)
├── package.json
├── tsconfig.json
└── vitest.config.mjs
```

## 빌드와 테스트

| 명령 | 동작 |
|------|------|
| `npm test` | 빌드한 뒤에 전체 테스트를 실행합니다. |
| `npm run test:unit` | 빌드하지 않고 테스트만 실행합니다. |
| `npm run test:watch` | 파일이 바뀔 때마다 테스트를 다시 실행합니다. |
| `npm run test:update` | 골든 파일을 현재 산출물로 갱신합니다. 의도한 변경일 때만 사용합니다. |
| `npm run inspector` | 빌드한 서버를 MCP Inspector 로 실행해서 도구를 직접 호출해 봅니다. |

테스트의 구성과 골든 테스트의 사용법은 [`docs/development/TESTING_GUIDE.md`](docs/development/TESTING_GUIDE.md) 에 있습니다.

## 문서

상세 문서는 [`docs/`](docs/README.md) 에 주제별 폴더로 나뉘어 있습니다.

| 문서 | 설명 |
|------|------|
| [`docs/setup/MCP_SETUP_GUIDE.md`](docs/setup/MCP_SETUP_GUIDE.md) | 설치와 클라이언트별 등록 방법, 환경 변수, 문제 해결 |
| [`docs/reference/TOOLS_OVERVIEW.md`](docs/reference/TOOLS_OVERVIEW.md) | 도구 4개의 용도와 공통 동작 |
| [`docs/reference/DDL_INPUT.md`](docs/reference/DDL_INPUT.md) | 받아들이는 DDL 문법, 타입 매핑, COMMENT 라벨 규칙 |
| [`docs/reference/GENERATED_PROJECT.md`](docs/reference/GENERATED_PROJECT.md) | 생성되는 프로젝트의 스택별 구조, 실행 방법, URL, 운영 DB 전환 |
| [`docs/architecture/GENERATION_PIPELINE.md`](docs/architecture/GENERATION_PIPELINE.md) | 코드 생성의 처리 흐름, 모듈 구성, 스택 정의와 매니페스트 |
| [`docs/architecture/USER_CONFIRMATION.md`](docs/architecture/USER_CONFIRMATION.md) | MCP Elicitation 으로 사용자에게 묻는 흐름 |
| [`docs/architecture/ATTACH_FILE.md`](docs/architecture/ATTACH_FILE.md) | 첨부파일 인프라의 산출물과 보안 동작, 엔티티 연결 구조 |
| [`docs/architecture/SECURITY_CONFIG.md`](docs/architecture/SECURITY_CONFIG.md) | 5.1 Boot 프로젝트의 Spring Security 설정 |
| [`docs/architecture/SCREEN_TEMPLATES.md`](docs/architecture/SCREEN_TEMPLATES.md) | 세 스택의 화면 템플릿 구성과 차이 |
| [`docs/operations/PACKAGING_GUIDE.md`](docs/operations/PACKAGING_GUIDE.md) | 배포 tgz 의 제작과 점검 |
| [`docs/development/TESTING_GUIDE.md`](docs/development/TESTING_GUIDE.md) | 빌드와 테스트 명령, 테스트 구성 |
| [`docs/development/GENERATED_PROJECT_VERIFICATION.md`](docs/development/GENERATED_PROJECT_VERIFICATION.md) | 생성된 프로젝트를 실제로 실행해서 확인하는 절차 |
| [`docs/development/KNOWN_ISSUES.md`](docs/development/KNOWN_ISSUES.md) | 남아 있는 문제와 제약 사항 |
| [`docs/release-notes/v5.1.0-beta.md`](docs/release-notes/v5.1.0-beta.md) | 5.1.0 Beta 릴리스 노트와 배포 파일의 체크섬 |

## 변경 이력

| 버전 | 배포일 | 내용 |
|------|--------|------|
| v5.1.0 Beta | 2026-11-27 | 최초 배포 버전 ([릴리스 노트](docs/release-notes/v5.1.0-beta.md)) |

이번 버전은 베타 버전입니다. 문제가 있으면 [GitHub Issues](https://github.com/eGovFramework/egovframe-mcp-codegen/issues) 에 알려 주세요.

## 함께 쓰는 MCP 서버

이 서버는 코드 생성만 제공합니다. 자료 검색과 아키텍처 준수 점검은 다음 서버가 제공합니다.

- **[egovframe-mcp-search](https://github.com/eGovFramework/egovframe-mcp-search)**: 공식 가이드, 개발자 지식, 공통컴포넌트, 호환 소프트웨어 통합 검색
- **[egovframe-mcp-check](https://github.com/eGovFramework/egovframe-mcp-check)**: eGovFrame 프로젝트의 레이어별 아키텍처 준수 점검 (정적 분석)

## 라이선스

Apache-2.0 라이선스를 따릅니다. 전문은 [`LICENSE`](LICENSE) 에 있습니다.

## Credits

[egovframe-vscode-initializr](https://github.com/eGovFramework/egovframe-vscode-initializr) 의 스캐폴드 로직을 기반으로 합니다.
