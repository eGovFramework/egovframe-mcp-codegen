# 첨부파일 인프라와 엔티티 연결 구조

이 문서는 표준 첨부파일 기능이 생성되는 방식을 설명합니다. 대상은 인프라를 설치하는 `egov_add_attach_file_infrastructure` 도구와, `egov_scaffold_project` 와 `egov_add_entity` 의 `withAttachment` 인자입니다. 도구의 인자와 사용법은 [egov_add_attach_file_infrastructure 레퍼런스](../reference/EGOV_ADD_ATTACH_FILE_INFRASTRUCTURE_TOOL.md)에 있습니다.

## 지원 범위

| 스택 | 인프라 설치 | 엔티티의 첨부파일 연결 |
|------|-------------|------------------------|
| 5.1 Boot | 지원 | 지원 |
| 4.3 Boot | 지원 | 지원 |
| 4.3 WAR | 지원하지 않음 | 지원하지 않음 |

WAR 프로젝트에 인프라 설치를 요청하면 `manifestForStack`(`src/utils/scaffold/attachFileInstaller.ts`)이 "현재 eGovFrame Boot 만 지원합니다"라는 오류로 거부합니다. `egov_scaffold_project` 는 WAR 와 `withAttachment=true` 의 조합을 입력 검증 단계에서 거부합니다.

## 구성 요소

첨부파일 기능은 두 부분으로 이루어집니다.

- **인프라**: 프로젝트에 한 번만 설치하는 공용 코드입니다. 파일 메타데이터를 관리하는 Service 와 Mapper, 업로드와 다운로드를 처리하는 유틸리티와 Controller, 첨부파일 테이블 DDL, 설정 키로 이루어집니다.
- **엔티티 연결**: 엔티티마다 적용되는 부분입니다. 엔티티 테이블에 첨부 그룹 키 컬럼(`ATCH_FILE_ID CHAR(20)`)을 두고, Controller 와 등록 화면에서 인프라를 호출합니다.

설치 로직은 `src/utils/scaffold/attachFileInstaller.ts` 한 곳에 있고, 세 도구가 이 모듈을 함께 사용합니다. 모듈은 쓰기 없이 계획을 세우는 `planAttachFileInfra` 와 계획을 디스크에 반영하는 `applyAttachFileInfra` 로 나뉩니다.

## 인프라 산출물

산출물은 매니페스트 `templates/attach-file/manifests/boot.json` 에 정의되어 있습니다. 5.1 Boot 와 4.3 Boot 가 같은 매니페스트와 같은 템플릿(`templates/attach-file/boot/`)을 사용합니다. 매니페스트의 항목은 20개이며, 새로 만드는 파일 18개와 기존 파일 5개에 덧붙이는 조각 8개로 이루어집니다.

### 새로 만드는 파일

| 구분 | 출력 경로 (`src/main/` 기준) |
|------|------------------------------|
| Service 인터페이스 | `java/<기본 패키지>/cmm/service/EgovFileMngService.java` |
| 파일 메타데이터 VO | `java/<기본 패키지>/cmm/service/FileVO.java` |
| 업로드, 다운로드 유틸리티 | `java/<기본 패키지>/cmm/service/EgovFileMngUtil.java` |
| Service 구현 | `java/<기본 패키지>/cmm/service/impl/EgovFileMngServiceImpl.java` |
| Mapper 인터페이스 | `java/<기본 패키지>/cmm/service/impl/FileManageMapper.java` |
| 다운로드 Controller | `java/<기본 패키지>/cmm/web/EgovFileDownloadController.java` |
| 업로드 예외 처리 | `java/<기본 패키지>/cmm/web/EgovFileUploadExceptionAdvice.java` |
| ID 채번 설정 | `java/<기본 패키지>/config/EgovConfigAttachFile.java` |
| MyBatis SQL | `resources/egovframework/sqlmap/cmm/mappers/EgovFileMng_SQL.xml` |
| DBMS 별 DDL (7개) | `resources/db/migrations/<dialect>/attach-file.sql` |
| 알림 메시지 fragment | `resources/templates/thymeleaf/_fragments/alertMessages.html` |
| 업로드 오류 화면 | `resources/templates/thymeleaf/cmm/uploadError.html` |

DDL 은 `oracle`, `tibero`, `altibase`, `cubrid`, `goldilocks`, `mysql`, `postgres` 의 7개 DBMS 용으로 생성되며, MariaDB 는 `mysql` 용 파일을 사용합니다. 각 파일은 `COMTNFILE`, `COMTNFILEDETAIL` 두 테이블과 채번 테이블 `COMTECOPSEQ` 를 만듭니다.

`EgovConfigAttachFile` 은 `@Configuration` 클래스이며 `@SpringBootApplication` 의 컴포넌트 스캔으로 등록됩니다. 따라서 설치 과정에서 기존 설정 클래스(`EgovConfigWeb` 등)를 수정하지 않습니다.

### 기존 파일에 덧붙이는 내용

| 대상 파일 | 추가되는 키 | 기본값 |
|-----------|-------------|--------|
| `application.properties` | `Globals.fileStorePath` | 운영체제 임시 디렉터리 아래의 `egov-upload` |
| | `spring.servlet.multipart.max-file-size` | `10MB` |
| | `spring.servlet.multipart.max-request-size` | `50MB` |
| | `server.tomcat.max-swallow-size` | `-1` |
| | `server.tomcat.max-http-form-post-size` | `-1` |
| | `egov.attach.maxFileSize` | `10MB` (`maxFileSize` 인자와 같은 값) |
| | `egov.attach.allowedExtensions` | 빈 값 |
| | `egov.attach.blockedExtensions` | 빈 값 |
| `egovframework/egovProps/globals.properties` | `Globals.fileStorePath` | 위와 같은 값 |
| `egovframework/message/message-common.properties`, `message-common_ko.properties`, `message-common_en.properties` | `fail.common.fileSize.exceeded`, `fail.common.fileType.blocked` | 한국어 문구(기본, `_ko`)와 영어 문구(`_en`) |

`server.tomcat.max-swallow-size` 와 `max-http-form-post-size` 를 `-1` 로 두는 이유는 다음과 같습니다. multipart 한도를 넘는 요청에서 Spring 이 예외를 던진 뒤에도, Tomcat 이 요청 본문의 나머지를 끝까지 읽어야 오류 화면을 응답으로 보낼 수 있습니다. Tomcat 의 기본 한도(2MB)에 걸리면 연결이 끊어져 브라우저에는 연결 재설정 오류만 보입니다.

`autoApplyProperties=false` 로 호출하면 위의 덧붙이기를 메시지 번들까지 포함해서 모두 건너뜁니다. 결과 메시지에는 건너뛴 파일만 나오고 추가할 키의 목록은 나오지 않으므로, 위 표의 키를 직접 추가해야 합니다. `Globals.fileStorePath` 가 없으면 업로드할 때 저장 경로가 비어 있다는 오류가 발생합니다.

### 내장 HSQLDB 시드

생성된 프로젝트는 기본 프로파일에서 내장 HSQLDB 를 쓰고, 시드 SQL 파일 하나(`src/main/resources/db/<엔티티>db.sql`)만 읽어서 테이블을 만듭니다. 그래서 첨부파일 테이블 DDL 도 이 시드 파일에 들어 있어야 프로젝트를 실행했을 때 테이블이 생성됩니다. 이 처리는 매니페스트와 별도로 `planHsqlSeedMerge` 가 담당하며, `autoMergeHsqlSeed` 인자(기본 `true`)로 제어합니다.

| 상황 | 동작 |
|------|------|
| 시드 후보가 정확히 1개 | 그 파일의 끝에 HSQLDB 용 DDL 을 덧붙입니다. 파일에 `COMTNFILE` 이 이미 있으면 건너뜁니다. |
| 시드 후보가 0개이거나 2개 이상 | 덧붙이지 않고 `src/main/resources/db/attach-file.sql` 을 따로 만든 뒤, 결과 메시지에 그 이유를 알립니다. |
| `autoMergeHsqlSeed=false` | 시드 파일을 건드리지 않고 별도 파일도 만들지 않습니다. 필요한 DDL 의 위치만 안내합니다. |

시드 후보는 `src/main/resources/db/*.sql` 가운데 `add-*-tables.sql` 과 `attach-file.sql` 을 뺀 파일입니다(`src/utils/scaffold/migrationStrategy.ts`). 이 규칙은 `egov_add_entity` 의 `autoApplyMigration` 과 같습니다.

### 스택별 차이

두 Boot 스택은 템플릿을 공유하고, 차이는 렌더링할 때 넣는 변수로 처리합니다.

| 변수 | 5.1 Boot | 4.3 Boot | 영향을 받는 코드 |
|------|----------|----------|------------------|
| `eeNamespace` | `jakarta` | `javax` | 서블릿 API 의 import |
| `useEgovMapper` | `true` | `false` | `FileManageMapper` 의 어노테이션. 5.1 은 `@EgovMapper("fileManageMapper")`, 4.3 은 실행환경의 `@Mapper` 를 사용합니다. |
| `useApacheMapper` | 해당 없음 | 프로젝트의 `EgovConfigMapper` 가 MyBatis 의 `@Mapper` 로 스캔하면 `true` | MyBatis 의 `@Mapper` 를 사용합니다. |

## 채번

첨부 그룹 키(`atchFileId`)는 `EgovConfigAttachFile` 이 등록하는 `egovFileIdGnrService` 빈(`EgovTableIdGnrServiceImpl`)이 만듭니다. 채번 테이블은 `COMTECOPSEQ`, 테이블 이름 키는 `FILE_ID` 입니다.

키의 형식은 접두어와 자릿수로 정해지며, 기본값은 접두어 `FILE_` 와 15자리입니다. `COMTNFILE.ATCH_FILE_ID` 가 `CHAR(20)` 이므로 접두어 길이와 자릿수의 합이 정확히 20이어야 하고, 도구는 합이 20이 아닌 입력을 거부합니다.

## 보안 동작

인프라는 별도의 설정 없이 다음 방어를 제공합니다. 구현은 `EgovFileMngUtil` 과 `EgovFileDownloadController` 템플릿에 있습니다.

| 방어 | 동작 |
|------|------|
| 실행 가능한 확장자 차단 | 코드 상수 `DEFAULT_BLOCKED_EXTENSIONS` 의 58개 확장자를 거부합니다. `egov.attach.blockedExtensions` 에 적은 확장자가 여기에 더해집니다. |
| 확장자 판정 | 파일 이름의 끝에 붙은 점과 공백을 제거한 뒤 마지막 점 이후를 확장자로 봅니다. 따라서 `a.jsp.` 와 `a.jpg.exe` 가 차단됩니다. |
| 허용 목록 | `egov.attach.allowedExtensions` 가 비어 있지 않으면 목록에 없는 확장자를 모두 거부합니다. 차단 목록 검사가 먼저 적용됩니다. |
| 파일 크기 | Spring 의 multipart 한도와 별개로, `egov.attach.maxFileSize` 를 넘는 파일을 거부합니다. |
| 저장 파일명 | 디스크에는 UUID 로 만든 이름으로 저장합니다. 사용자가 보낸 파일명은 메타데이터로만 남습니다. |
| 경로 탈출 방어 | 저장, 다운로드, 삭제에서 `safeChild` 가 저장 디렉터리 밖의 경로를 거부합니다. |
| 저장 경로 검사 | `Globals.fileStorePath` 가 `src/main/resources/static`, `src/main/webapp`, `BOOT-INF/classes/static` 등 웹으로 공개되는 디렉터리와 겹치면 애플리케이션이 시작되지 않습니다. |
| 다운로드 응답 | `Content-Type: application/octet-stream` 과 `Content-Disposition: attachment` 로 응답하므로 브라우저가 파일을 화면에 렌더링하지 않습니다. 파일명은 Spring 의 `ContentDisposition` 으로 UTF-8 인코딩해서 넣습니다. |
| 요청 값 불신 | 레코드의 수정과 삭제에서는 요청에 실려 온 `atchFileId` 를 쓰지 않고, DB 에서 조회한 레코드의 값을 사용합니다. 화면에도 이 값을 hidden 필드로 두지 않습니다. 첨부파일 1건을 삭제하는 요청은 이 방어의 대상이 아니며, 아래의 "인프라가 제공하지 않는 것"에 설명이 있습니다. |
| 삭제된 레코드의 파일 | 다운로드는 `USE_AT='Y'` 인 첨부 그룹만 찾습니다. 레코드를 삭제하면 첨부 그룹이 논리 삭제되어 다운로드가 404 로 응답합니다. |

기본 차단 확장자는 다음과 같습니다.

| 분류 | 확장자 |
|------|--------|
| 운영체제 실행 파일 | `EXE`, `BAT`, `CMD`, `COM`, `SCR`, `MSI`, `DLL`, `APP`, `DMG`, `PKG`, `DEB`, `RPM` |
| 셸, 매크로 스크립트 | `SH`, `BASH`, `ZSH`, `PS1`, `PSM1`, `VBS`, `WSF`, `VBE`, `JS`, `MJS` |
| 서버 측 스크립트 | `JSP`, `JSPX`, `JSPF`, `PHP`, `PHTML`, `PHP3`, `PHP4`, `PHP5`, `PHP7`, `PHP8`, `ASP`, `ASPX`, `CER`, `ASA`, `CGI`, `PL`, `PY`, `RB` |
| Java 아카이브, 클래스 | `JAR`, `WAR`, `EAR`, `CLASS` |
| Apache 설정 | `HTACCESS`, `HTPASSWD` |
| 브라우저가 렌더링하는 형식 | `HTML`, `HTM`, `SHTML`, `XHTML`, `SVG`, `MHT`, `MHTML` |
| 바로가기, 시스템 설정 | `LNK`, `URL`, `DESKTOP`, `INF`, `REG` |

### 업로드 오류 화면

`EgovFileUploadExceptionAdvice` 는 `MaxUploadSizeExceededException` 과 `SecurityException` 을 처리해서 `cmm/uploadError` 화면에 안내 문구를 표시합니다. Spring 의 multipart 한도 초과(`MaxUploadSizeExceededException`)는 `fail.common.fileSize.exceeded`, 그 밖의 거부(`SecurityException`)는 `fail.common.fileType.blocked` 메시지를 사용합니다. `egov.attach.maxFileSize` 의 초과도 `SecurityException` 으로 처리되므로, 이 값만 multipart 한도보다 낮게 고치면 크기 초과인데도 파일 형식의 안내 문구가 표시됩니다.

5.1 Boot 에서는 Spring Security 의 CSRF 검사가 먼저 실행되므로, multipart 한도를 넘는 업로드가 이 화면 대신 CSRF 접근 거부 화면으로 이어질 수 있습니다. 이 내용은 [5.1 Boot 보안 설정](./SECURITY_CONFIG.md)의 "multipart 업로드와 CSRF" 절에 있습니다.

### 인프라가 제공하지 않는 것

다음 항목은 프로젝트에서 따로 갖추어야 합니다.

- **첨부파일 1건 삭제의 소유 확인**: 첨부파일 1건을 삭제하는 요청은 요청에 실려 온 `atchFileId` 와 `fileSn` 을 그대로 사용하고, 그 파일이 해당 레코드의 것인지 확인하지 않습니다. 두 값을 아는 사용자는 다른 레코드의 첨부파일을 삭제할 수 있으며, 이때 디스크의 파일도 삭제됩니다. 생성되는 프로젝트에 로그인과 작성자 정보가 없어서 소유를 확인할 기준이 없기 때문이며, 인증을 도입할 때 함께 보완해야 합니다. 4.3 Boot 에는 CSRF 보호도 없습니다.
- **다운로드 URL 의 접근 제어**: `/cmm/fms/FileDown.do` 에는 인증과 인가가 없어서, `atchFileId` 와 `fileSn` 을 아는 사용자는 누구나 파일을 받을 수 있습니다. 5.1 Boot 는 Spring Security 정책으로 보호하고, 4.3 Boot 는 인증 체계를 도입할 때 함께 보호합니다.
- **악성코드 검사**: 백신 연동 지점이 없습니다.
- **파일 내용 검사**: 확장자만 검사하며 파일의 실제 형식(매직 넘버)은 확인하지 않습니다.
- **파일 저장과 도메인 저장의 원자성**: 두 작업을 하나의 트랜잭션으로 묶지 않습니다.
- **로컬 디스크 이외의 저장소**: `Globals.fileStorePath` 의 로컬 경로(또는 마운트된 경로)에만 저장합니다.

## 엔티티 연결

`withAttachment=true` 로 엔티티를 생성하면 매니페스트의 항목은 늘어나지 않고, 엔티티 템플릿의 `{{#if withAttachment}}` 분기가 렌더링 결과를 바꿉니다. 렌더링 변수는 `src/utils/scaffold/attachmentContext.ts` 의 `applyAttachmentContext` 가 넣습니다.

| 산출물 | 달라지는 내용 |
|--------|---------------|
| VO | `atchFileId` 필드가 추가됩니다. |
| 테이블 DDL (시드, 마이그레이션) | `ATCH_FILE_ID CHAR(20)` 컬럼이 추가됩니다. |
| Mapper SQL XML | resultMap, INSERT, UPDATE, SELECT 에 첨부 컬럼이 포함됩니다. |
| Controller | 등록과 수정이 `MultipartHttpServletRequest` 를 받아 파일을 저장합니다. 수정 화면 진입 시 기존 파일 목록을 모델에 넣고, 첨부파일 1건을 삭제하는 요청을 처리합니다. |
| ServiceImpl | 레코드를 삭제할 때 첨부 그룹을 논리 삭제합니다. |
| 등록(수정) 화면 | 폼이 `multipart/form-data` 가 되고, 파일 선택 입력(`name="file_1"`, `multiple`), 기존 파일 목록, 다운로드 링크, 개별 삭제 버튼이 추가됩니다. |
| 메시지 번들 | 첨부파일 라벨 키가 추가됩니다. |

사용자가 보낸 DDL 에 `ATCH_FILE_ID` 컬럼이 이미 있으면, 그 컬럼은 일반 속성 목록에서 제외되고 첨부 그룹 키로만 쓰입니다.

첨부파일 1건을 삭제하는 요청의 URL 과 화면 처리 방식은 스택의 관례를 따릅니다.

| 스택 | URL | 화면 처리 |
|------|-----|-----------|
| 5.1 Boot | `POST /delete<엔티티>AttachFile.do` | `fetch` 로 요청하고 CSRF 토큰을 헤더에 실은 뒤, 화면을 다시 읽습니다. |
| 4.3 Boot | `POST /<첫 글자를 소문자로 바꾼 엔티티 이름>/deleteAttachFile` (예: `/orderItem/deleteAttachFile`) | jQuery `$.ajax` 로 요청하고, 목록에서 해당 항목만 제거합니다. |

개별 삭제는 DB 의 행을 지운 다음 디스크의 파일도 삭제합니다. 파일 삭제가 실패하면 경고 로그만 남기고 요청은 성공으로 처리합니다. 레코드 단위의 삭제는 첨부 그룹을 논리 삭제할 뿐이며 디스크의 파일은 남습니다.

`maxAttachmentCount` 인자의 값은 1 이상일 때 파일 선택 입력의 `data-max-count` 속성으로만 출력됩니다. 이 값을 읽어서 개수를 제한하는 스크립트와 서버 측 검사는 생성되지 않습니다.

## 인프라의 자동 설치

`egov_scaffold_project` 와 `egov_add_entity` 는 `withAttachment=true` 일 때 인프라가 없으면 기본 옵션으로 함께 설치합니다. 저장 경로, 용량 한도, 확장자 정책을 기본값과 다르게 하려면, 엔티티를 추가하기 전에 `egov_add_attach_file_infrastructure` 를 먼저 호출합니다. 이 방법은 이미 있는 프로젝트에만 쓸 수 있습니다. `egov_scaffold_project` 에서 `withAttachment=true` 로 생성한 프로젝트는 기본 옵션으로 설치되므로, 정책을 바꾸려면 생성한 뒤에 `application.properties` 의 값을 직접 고칩니다.

인프라가 설치되어 있는지는 `detectAttachFileInfra`(`src/utils/scaffold/projectDetector.ts`)가 파일의 존재로 판정합니다. `src/main/java` 아래에 `cmm/service/EgovFileMngService.java` 가 있고, `config/EgovConfigAttachFile.java` 또는 `src/main/resources` 아래의 `context-idgn-File.xml` 이 있으면 설치된 것으로 봅니다. 뒤의 XML 파일은 현재 어느 템플릿도 만들지 않으며, 직접 구성한 프로젝트를 인식하기 위한 조건입니다.

| 도구 | 설치 시점과 실패 시의 동작 |
|------|----------------------------|
| `egov_add_entity` | 엔티티 파일의 충돌 검사를 통과한 뒤, 인프라와 엔티티 파일을 하나의 쓰기 저널로 기록합니다. 도중에 실패하면 인프라까지 함께 원래대로 되돌립니다. 그 뒤에 수행하는 시드 SQL 과 메시지 번들의 덧붙이기는 저널에 포함되지 않습니다. |
| `egov_scaffold_project` | 프로젝트를 생성한 직후에 설치합니다. 설치가 실패하면 인프라의 변경만 되돌리고 프로젝트는 남깁니다. 이때 첫 엔티티가 인프라 클래스를 참조해서 컴파일되지 않는 상태가 되므로, `egov_add_attach_file_infrastructure` 를 호출해서 복구하라는 안내를 돌려줍니다. |

## 충돌과 멱등성

설치는 계획 단계에서 모든 충돌을 모은 다음, 충돌이 하나라도 있으면 아무 파일도 쓰지 않고 거부합니다.

| 상황 | 동작 |
|------|------|
| 새로 만들 파일이 없음 | 생성합니다. |
| 같은 내용의 파일이 이미 있음 | `skipIfPresent=true`(기본)이면 건너뛰고, `false` 이면 거부합니다. |
| 다른 내용의 파일이 이미 있음 | 항상 거부하고 충돌한 파일의 목록을 돌려줍니다. |
| 덧붙일 조각의 키가 모두 같은 값으로 이미 있음 | 그 조각을 건너뜁니다. 판정은 조각 단위이므로, 한 조각의 키 가운데 일부만 있으면 조각 전체를 덧붙입니다. |
| 덧붙일 키가 다른 값으로 이미 있음 | 거부하고 충돌한 키를 알립니다. |

따라서 같은 인자로 도구를 다시 호출하면 변경 없이 성공하고, 이미 설치한 프로젝트에 다른 값으로 다시 호출하면 충돌로 거부됩니다. 설치한 뒤에 정책을 바꾸려면 `application.properties` 의 값을 직접 고칩니다.

쓰기 단계에서는 파일을 쓰기 직전마다 원래 상태를 저널(`src/utils/scaffold/writeRollback.ts`)에 기록하고, 도중에 실패하면 기록의 역순으로 복원합니다.

## 관련 테스트

| 테스트 파일 | 검증 대상 |
|-------------|-----------|
| `tests/scaffold/attachFileInstaller.test.ts` | 설치 계획과 적용 |
| `tests/scaffold/attachFileInfraReinstall.test.ts` | 재설치의 멱등성 |
| `tests/scaffold/attachFileMapperSql.test.ts` | Mapper SQL |
| `tests/scaffold/addAttachFileHsqlSeed.test.ts` | HSQLDB 시드 병합과 별도 파일 생성 |
| `tests/scaffold/attachmentHardening.test.ts` | 요청 값 불신, UUID 저장명, 확장자 판정 등 보안 동작 |
| `tests/scaffold/boot43Attachment.test.ts` | 4.3 Boot 의 인프라와 엔티티 연결 |
| `tests/scaffold/addEntityAutoInstallInfra.test.ts` | `egov_add_entity` 의 자동 설치와 롤백 |
| `tests/scaffold/scaffoldWithAttachment.test.ts` | `egov_scaffold_project` 의 `withAttachment` |
| `tests/scaffold/addEntityWithAttachmentMigration.test.ts` | 첨부 컬럼이 포함된 마이그레이션 SQL 과 화면 |
