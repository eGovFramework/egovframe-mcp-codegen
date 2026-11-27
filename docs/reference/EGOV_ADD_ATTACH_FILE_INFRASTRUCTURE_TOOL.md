# egov_add_attach_file_infrastructure

이미 생성된 Boot 프로젝트에 표준 첨부파일 인프라를 설치합니다. 인프라는 프로젝트에 한 번만 설치하는 공용 코드이며, 파일 메타데이터 테이블, 파일 관리 Service 와 Mapper, 다운로드 Controller, 업로드 오류 화면, 저장 경로와 용량과 확장자 정책의 설정으로 이루어집니다.

- 구현: `src/tools/egovAddAttachFileInfrastructure.ts`, `src/utils/scaffold/attachFileInstaller.ts`
- 대상 스택: 5.1 Boot, 4.3 Boot. 4.3 WAR 프로젝트에 호출하면 거부합니다.

산출물의 목록과 보안 동작의 상세한 내용은 [첨부파일 인프라와 엔티티 연결 구조](../architecture/ATTACH_FILE.md)에 있습니다.

## 이 도구가 필요한 경우

첨부파일이 있는 엔티티를 만들 때에는 대개 이 도구를 직접 호출할 필요가 없습니다. `egov_scaffold_project` 와 `egov_add_entity` 는 `withAttachment=true` 일 때 인프라가 없으면 기본 옵션으로 함께 설치하기 때문입니다.

이 도구는 다음 경우에 사용합니다.

- 저장 경로, 용량 한도, 허용 확장자를 기본값과 다르게 설치하려는 경우입니다. 이때에는 엔티티를 추가하기 전에 이 도구를 먼저 호출합니다.
- 엔티티 없이 인프라만 먼저 설치하려는 경우입니다.
- `egov_scaffold_project` 에서 인프라 설치가 실패한 프로젝트를 복구하는 경우입니다.

## 인자

| 인자 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `projectPath` | string | 필수 | | 기존 Boot 프로젝트의 루트 경로입니다. `pom.xml` 이 있어야 합니다. |
| `fileStorePath` | string | 선택 | 운영체제 임시 디렉터리 아래의 `egov-upload` | 업로드한 파일을 저장할 디렉터리입니다(`Globals.fileStorePath`). 절대 경로를 권장합니다. 기본값은 개발용이므로, 운영 환경에서는 외부 디스크나 NAS 의 경로를 지정합니다. |
| `maxFileSize` | string | 선택 | `10MB` | 파일 하나의 크기 한도입니다. 단위는 `B`, `KB`, `MB`, `GB` 입니다. Spring 의 multipart 한도와 `egov.attach.maxFileSize` 에 같은 값이 들어갑니다. |
| `maxRequestSize` | string | 선택 | `50MB` | 요청 하나의 전체 크기 한도입니다. 여러 파일과 폼 필드를 합친 크기에 적용됩니다. |
| `allowedExtensions` | string[] | 선택 | `[]` | 허용할 확장자의 목록입니다. 지정하면 목록에 없는 확장자를 모두 거부합니다. 비어 있으면 기본 차단 목록만 적용합니다. 예: `["pdf", "docx", "xlsx", "hwp"]` |
| `blockedExtensions` | string[] | 선택 | `[]` | 기본 차단 목록에 더할 확장자입니다. 예: `["zip", "rar", "iso"]` |
| `idGnrPrefix` | string | 선택 | `FILE_` | 첨부 그룹 키(`atchFileId`)의 접두어입니다. |
| `idGnrCipers` | number | 선택 | `15` | 첨부 그룹 키의 일련번호 자릿수입니다. 접두어의 길이와 이 값의 합이 정확히 20이어야 합니다. |
| `autoApplyProperties` | boolean | 선택 | `true` | 설정 키와 메시지 키를 기존 파일에 덧붙입니다. |
| `autoMergeHsqlSeed` | boolean | 선택 | `true` | 첨부파일 테이블의 DDL 을 내장 HSQLDB 의 시드 SQL 에 덧붙입니다. |
| `skipIfPresent` | boolean | 선택 | `true` | 같은 내용의 파일이 이미 있으면 건너뜁니다. `false` 이면 파일이 하나라도 이미 있을 때 거부합니다. |

확장자는 대소문자와 앞의 점을 가리지 않고 받으며, 대문자로 바꾸어 설정에 기록합니다.

`maxFileSize` 와 `maxRequestSize` 는 형식을 검사하지 않고 그대로 `application.properties` 에 기록합니다. 형식이 잘못된 값을 주면 생성은 성공하지만 프로젝트가 시작할 때 오류가 발생하므로, `50MB` 처럼 숫자와 단위를 붙여서 씁니다.

## 설치되는 내용

| 구분 | 내용 |
|------|------|
| Java 클래스 8개 | `EgovFileMngService`, `EgovFileMngServiceImpl`, `FileVO`, `EgovFileMngUtil`, `FileManageMapper`, `EgovFileDownloadController`, `EgovFileUploadExceptionAdvice`, `EgovConfigAttachFile` |
| MyBatis SQL | `EgovFileMng_SQL.xml` |
| 테이블 DDL | `COMTNFILE`, `COMTNFILEDETAIL`, `COMTECOPSEQ` 를 만드는 SQL 을 7개 DBMS 별로 `src/main/resources/db/migrations/<dialect>/attach-file.sql` 에 생성 |
| 화면 | 업로드 오류 화면 `cmm/uploadError.html`, 알림 메시지 fragment `_fragments/alertMessages.html` |
| 설정 (덧붙임) | `application.properties` 에 저장 경로, multipart 한도, Tomcat 요청 본문 처리, 확장자 정책의 8개 키. `globals.properties` 에 저장 경로 |
| 메시지 (덧붙임) | 메시지 번들 3개에 `fail.common.fileSize.exceeded`, `fail.common.fileType.blocked` |
| 내장 HSQLDB 시드 (덧붙임) | 프로젝트를 실행했을 때 첨부파일 테이블이 만들어지도록 시드 SQL 에 DDL 을 추가 |

다운로드 URL 은 `GET /cmm/fms/FileDown.do?atchFileId=<그룹 키>&fileSn=<파일 순번>` 입니다.

## 옵션의 동작

### autoApplyProperties

`true` 이면 설정 키와 메시지 키를 대상 파일의 끝에 덧붙입니다. 같은 키가 같은 값으로 이미 있으면 건너뛰고, 다른 값으로 있으면 설치 전체를 거부합니다.

`false` 이면 `application.properties`, `globals.properties`, 메시지 번들을 건드리지 않습니다. 이 경우에는 [첨부파일 인프라와 엔티티 연결 구조](../architecture/ATTACH_FILE.md)의 "기존 파일에 덧붙이는 내용"에 있는 키를 직접 추가해야 합니다. `Globals.fileStorePath` 가 없으면 업로드가 동작하지 않습니다.

### autoMergeHsqlSeed

`true` 이면 `src/main/resources/db/` 의 시드 SQL 이 정확히 1개일 때 그 파일의 끝에 첨부파일 테이블의 DDL 을 덧붙입니다. 시드 SQL 이 없거나 2개 이상이면 `src/main/resources/db/attach-file.sql` 을 따로 만들고 결과 메시지에 그 이유를 알립니다. 이 경우에는 내장 HSQLDB 에 테이블이 자동으로 만들어지지 않으므로, 별도 파일의 내용을 시드 SQL 에 직접 옮겨야 합니다.

`false` 이면 시드 SQL 을 건드리지 않고 별도 파일도 만들지 않습니다.

### skipIfPresent

같은 인자로 도구를 다시 호출하면 이미 있는 파일을 건너뛰므로, 변경 없이 성공으로 응답합니다. 일부 파일만 있는 프로젝트에서는 없는 파일만 만듭니다.

내용이 다른 파일이 이미 있으면 이 옵션과 관계없이 설치 전체를 거부하고, 충돌한 파일의 목록을 돌려줍니다. 그래서 기본값으로 설치한 프로젝트에 다른 값으로 다시 호출하면 충돌로 거부됩니다. 설치한 뒤에 정책을 바꾸려면 `application.properties` 의 값을 직접 고칩니다. `egov.attach.*` 와 multipart 한도는 값을 고치고 애플리케이션을 다시 시작하면 적용됩니다.

## 거부되는 경우

| 상황 | 오류의 요지 |
|------|-------------|
| WAR 프로젝트 | 현재 eGovFrame Boot 만 지원합니다. |
| `idGnrPrefix` 의 길이와 `idGnrCipers` 의 합이 20이 아님 | 합이 정확히 20이어야 합니다. `COMTNFILE.ATCH_FILE_ID` 가 `CHAR(20)` 이기 때문입니다. |
| 프로젝트의 기본 패키지를 찾지 못함 | 표준 구조로 생성된 프로젝트가 아닙니다. |
| 내용이 다른 파일이나 값이 다른 설정 키가 이미 있음 | 충돌로 거부하며 아무 파일도 쓰지 않습니다. |

## 결과 메시지

성공하면 다음 내용을 담은 텍스트를 돌려줍니다.

- 프로젝트 경로, 감지한 스택, 기본 패키지, 채번 형식, 파일 저장 경로
- 생성한 파일, 덧붙인 키, 건너뛴 파일의 목록
- 내장 HSQLDB 시드의 처리 결과
- 다음에 할 일: 저장 경로의 쓰기 권한 확인, 운영 DB 에 DDL 적용, 다운로드 URL 보호
- 적용된 보안 정책의 요약

## 설치한 뒤에 할 일

- 운영 환경에서는 `Globals.fileStorePath` 를 외부 경로로 바꿉니다. 이 경로를 `src/main/resources/static` 이나 `src/main/webapp` 처럼 웹으로 공개되는 디렉터리 아래로 지정하면 애플리케이션이 시작되지 않습니다.
- 운영 DB 에는 `src/main/resources/db/migrations/<dialect>/attach-file.sql` 을 적용합니다.
- 다운로드 URL 에는 접근 제어가 없습니다. 5.1 Boot 는 Spring Security 정책으로 보호하고, 4.3 Boot 는 인증 체계를 도입할 때 함께 보호합니다.

## 호출 예

사용자의 요청:

```text
/workspace/board-app 에 첨부파일 인프라를 설치해 줘. PDF 와 오피스 문서만 허용하고,
파일은 50MB, 요청은 200MB 까지 받게 해 줘. 저장 경로는 /opt/app/uploads 로 해 줘.
```

AI 가 구성하는 도구 입력:

```json
{
  "projectPath": "/workspace/board-app",
  "fileStorePath": "/opt/app/uploads",
  "maxFileSize": "50MB",
  "maxRequestSize": "200MB",
  "allowedExtensions": ["pdf", "docx", "xlsx", "pptx", "hwp"]
}
```
