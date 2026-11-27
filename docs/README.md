# eGovFrame MCP Codegen 문서

`egovframe-mcp-codegen` 은 DDL 을 바탕으로 표준프레임워크 프로젝트와 CRUD 코드를 생성하는 MCP 서버입니다. 이 디렉터리의 문서는 서버의 설치, 도구의 사용법, 내부 구조, 배포와 개발에 필요한 내용을 주제별 폴더로 나누어 다룹니다. 서버의 개요와 빠른 시작 방법은 저장소 최상위의 [README](../README.md)에 있습니다.

## 폴더 구성

| 폴더 | 주제 | 주요 독자 |
|------|------|-----------|
| [setup/](./setup/) | 설치와 MCP 클라이언트 등록 | 사용자 |
| [reference/](./reference/) | 도구의 인자와 동작, DDL 입력 규칙, 생성되는 프로젝트 | 사용자, 도구를 호출하는 프롬프트의 작성자 |
| [architecture/](./architecture/) | 코드 생성 구조와 기능별 설계 | 개발자 |
| [operations/](./operations/) | 배포 패키지의 제작과 점검 | 유지보수자 |
| [development/](./development/) | 테스트, 동작 확인 절차, 알려진 문제 | 개발자 |
| [release-notes/](./release-notes/) | 버전별 릴리스 노트 | 모든 독자 |

## 사용자 문서

| 문서 | 설명 |
|------|------|
| [setup/MCP_SETUP_GUIDE.md](./setup/MCP_SETUP_GUIDE.md) | 배포 패키지(tgz)를 받아 AI 클라이언트(Claude Code, Codex, Cursor, VS Code, Cline, OpenCode, Claude Desktop)에 등록하는 방법, 다른 실행 형태, 환경 변수, 문제 해결 |
| [reference/TOOLS_OVERVIEW.md](./reference/TOOLS_OVERVIEW.md) | 도구 4개의 용도와 지원 스택, 일반적인 사용 순서, 네 도구에 공통된 동작 (입력 검증, 오류의 형태, 덮어쓰지 않는 원칙) |
| [reference/EGOV_SCAFFOLD_PROJECT_TOOL.md](./reference/EGOV_SCAFFOLD_PROJECT_TOOL.md) | `egov_scaffold_project` 의 인자, 생략한 인자의 처리, 생성되는 내용, 호출 예 |
| [reference/EGOV_ADD_ENTITY_TOOL.md](./reference/EGOV_ADD_ENTITY_TOOL.md) | `egov_add_entity` 의 인자, 기본 키 채번, 외래키 처리, 자동 반영 옵션, 호출 예 |
| [reference/EGOV_ADD_QUERY_VIEW_TOOL.md](./reference/EGOV_ADD_QUERY_VIEW_TOOL.md) | `egov_add_query_view` 의 인자, SQL 작성 규칙, 컬럼 타입과 표시 형식, 호출 예 |
| [reference/EGOV_ADD_ATTACH_FILE_INFRASTRUCTURE_TOOL.md](./reference/EGOV_ADD_ATTACH_FILE_INFRASTRUCTURE_TOOL.md) | `egov_add_attach_file_infrastructure` 의 인자, 설치되는 내용, 옵션의 동작, 설치한 뒤에 할 일 |
| [reference/DDL_INPUT.md](./reference/DDL_INPUT.md) | 받아들이는 DDL 문법, 컬럼 타입의 매핑, COMMENT 를 화면 라벨로 쓰는 규칙 |
| [reference/GENERATED_PROJECT.md](./reference/GENERATED_PROJECT.md) | 생성되는 프로젝트의 스택별 구조, 빌드와 실행, 화면의 URL, 운영 DB 로 전환하는 방법 |
| [release-notes/v5.1.0-beta.md](./release-notes/v5.1.0-beta.md) | 5.1.0 Beta 릴리스 노트와 배포 파일의 체크섬 |

## 개발자와 유지보수자 문서

| 문서 | 설명 |
|------|------|
| [architecture/GENERATION_PIPELINE.md](./architecture/GENERATION_PIPELINE.md) | 도구 호출부터 파일 쓰기까지의 처리 흐름, 모듈 구성, 스택 정의와 매니페스트, 출력 검증과 되돌리기 |
| [architecture/USER_CONFIRMATION.md](./architecture/USER_CONFIRMATION.md) | 생략된 인자를 MCP Elicitation 으로 사용자에게 묻는 흐름과 응답별 처리 |
| [architecture/ATTACH_FILE.md](./architecture/ATTACH_FILE.md) | 첨부파일 인프라의 산출물, 보안 동작, 엔티티 연결, 자동 설치, 충돌 처리 |
| [architecture/SECURITY_CONFIG.md](./architecture/SECURITY_CONFIG.md) | 5.1 Boot 산출물의 Spring Security 설정 (보안 헤더, CSRF, 방화벽, CORS)과 공통컴포넌트와의 차이 |
| [architecture/SCREEN_TEMPLATES.md](./architecture/SCREEN_TEMPLATES.md) | 세 스택의 화면 템플릿 구조, KRDS 정적 자산, 페이지네이션, 날짜 입력, 스택별 차이 |
| [operations/PACKAGING_GUIDE.md](./operations/PACKAGING_GUIDE.md) | 배포 tgz 의 구성, 제작 방법, 점검 방법, 릴리스 절차 |
| [development/TESTING_GUIDE.md](./development/TESTING_GUIDE.md) | 빌드와 테스트 명령, 테스트의 구성, 골든 테스트 |
| [development/GENERATED_PROJECT_VERIFICATION.md](./development/GENERATED_PROJECT_VERIFICATION.md) | 세 스택의 산출물을 실제로 빌드하고 실행해서 확인하는 절차 |
| [development/KNOWN_ISSUES.md](./development/KNOWN_ISSUES.md) | 확인했지만 고치지 않고 남긴 문제와 제약 사항 (증상, 원인, 피하는 방법, 고치는 방향) |
| [development/SDK_V2_MIGRATION.md](./development/SDK_V2_MIGRATION.md) | MCP SDK v2 로 전환할 때 고칠 코드 |

## 제공 도구

| 도구 | 용도 |
|------|------|
| `egov_scaffold_project` | DDL 로 표준프레임워크 프로젝트를 새로 생성 |
| `egov_add_entity` | 기존 프로젝트에 새 엔티티의 CRUD 코드를 추가 |
| `egov_add_query_view` | 다중 JOIN `SELECT` 문으로 조회 전용 화면을 추가 |
| `egov_add_attach_file_infrastructure` | Boot 프로젝트에 표준 첨부파일 인프라를 설치 |

이 서버는 코드 생성만 제공합니다. 가이드와 공통컴포넌트의 검색은 [egovframe-mcp-search](https://github.com/eGovFramework/egovframe-mcp-search) 서버가, 생성한 프로젝트의 아키텍처 준수 점검은 [egovframe-mcp-check](https://github.com/eGovFramework/egovframe-mcp-check) 서버가 제공하므로, 그 기능이 필요하면 해당 서버를 따로 등록합니다.
