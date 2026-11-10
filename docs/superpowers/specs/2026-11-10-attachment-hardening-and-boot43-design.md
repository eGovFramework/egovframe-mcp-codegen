# 첨부파일 결함 수정과 eGovFrame 4.3 Boot 지원 설계

- 작성일: 2026-11-10
- 기준 커밋: `e4a5331` (`develop`). 이 문서의 행 번호는 이 커밋을 기준으로 합니다.
- 선행 설계: `docs/superpowers/specs/2026-11-09-attachment-elicitation-design.md`
- 참고 소스: `references/egovframe-template-common-components-v4.3.1/` (공통컴포넌트 4.3.1, git 미추적)

## 1. 의도

현재 첨부파일 기능은 eGovFrame 5.0 Boot에서만 사용할 수 있습니다. 4.3 Boot 프로젝트도 5.0 Boot와 비슷한 상황에서 첨부파일을 사용하므로, 같은 도구와 같은 규칙으로 첨부파일을 제공하려고 합니다.

5.0 템플릿을 대조한 결과 실제 결함이 6건 확인되었습니다. 이 상태로 4.3에 옮기면 결함도 함께 복제되므로, 5.0을 먼저 고친 뒤 고쳐진 코드를 4.3으로 옮깁니다.

## 2. 목표와 범위

### 목표

- 5.0 Boot 첨부파일 템플릿의 결함 6건을 수정합니다 (4장).
- 5.0과 4.3 Boot가 첨부파일 인프라 템플릿을 공유하게 하여, 이후 수정을 한 곳에서 할 수 있게 합니다 (5장).
- `egov_scaffold_project`, `egov_add_entity`, `egov_add_attach_file_infrastructure`가 4.3 Boot에서 5.0 Boot와 같은 규칙으로 동작하게 합니다 (6장). 인자를 생략하면 사용자에게 질문하고, `withAttachment=true`인데 인프라가 없으면 먼저 설치합니다.
- 생성 직후 내장 HSQL로 실행했을 때 4.3 Boot에서 다음이 동작해야 합니다: 테이블 생성, 등록·수정 화면의 파일 선택, 기존 파일 목록, 다운로드 링크, 업로드·수정·삭제 처리, 삭제된 레코드의 파일 다운로드 차단.

### 비목표

- WAR 지원은 하지 않습니다. WAR 템플릿의 같은 트랜잭션 포인트컷 결함(`templates/war/resources/spring/context-transaction.xml.hbs:21`)도 이번에는 수정하지 않습니다.
- 4.3 Boot에 Spring Security와 CSRF 방어를 도입하지 않습니다. 이는 별도 작업입니다.
- 로그인 확인, 작성자 검사, 세션에 묶인 파일 ID는 도입하지 않습니다. 생성되는 프로젝트에 로그인과 작성자 정보가 없기 때문입니다.
- 첨부파일 개별 삭제 엔드포인트와 다운로드 엔드포인트가 레코드 소속을 확인하도록 바꾸지 않습니다. 이 확인은 로그인을 도입하는 작업에서 함께 결정해야 합니다.
- 업로드 전 전체 사전검증은 하지 않습니다. 보안 영향이 없고, 남는 파일은 DB 기록이 없어 다운로드할 수 없습니다.
- 서버 측 전역 파일 개수 제한을 추가하지 않고, `maxAttachmentCount`의 화면 힌트도 구현하지 않습니다.
- 확장자 없는 파일을 거부하지 않습니다.
- 허용 목록을 기본값으로 전환하지 않고, 파일 내용(매직넘버) 검사도 추가하지 않습니다.
- 레코드 단위 논리 삭제에서는 디스크 파일을 삭제하지 않습니다. 메타데이터가 남아 있어 운영 정책으로 정리할 수 있고, 공통컴포넌트도 같은 방식입니다.
- 파일 저장과 도메인 저장을 하나의 트랜잭션으로 묶지 않습니다.
- 이미 생성되었거나 인프라가 이미 설치된 프로젝트를 변경하는 마이그레이션은 제공하지 않습니다.

### 실패로 보는 결과

- `withAttachment`를 쓰지 않는 산출물에서 `EgovConfigTransaction.java`와 생성되는 첨부파일 안내 문서 외의 파일이 바뀌는 경우
- WAR 프로젝트의 생성·검증 동작이 바뀌는 경우 (생성되는 첨부파일 안내 문서의 내용은 제외)

## 3. 결정 사항

### 사용자가 결정한 사항

| 항목 | 결정 |
|---|---|
| 작업 순서 | 5.0 결함을 먼저 고친 뒤 4.3 Boot로 옮깁니다. |
| 수정 대상 | 요청 `atchFileId` 불신, 트랜잭션 포인트컷, Content-Disposition, UUID 저장명, 개별 삭제 시 실제 파일 삭제, 확장자 끝 점·공백 정리 |
| 수정하지 않는 항목 | 업로드 전 전체 사전검증, 서버 측 전역 파일 개수 제한, 확장자 없는 파일 거부 |
| 4.3 Boot CSRF | 이번 작업에서 제외합니다. |
| 골든 파일 | 필요하면 갱신합니다. |
| 하위 호환성 | 이전 버전 인프라와의 호환성은 유지하지 않아도 됩니다. 호환 여부는 검증하여 결과만 보고합니다 (7장). |

### 작성자가 판단한 사항

구현 전에 사용자가 바꿀 수 있습니다.

| 항목 | 결정 | 이유 |
|---|---|---|
| 인프라 템플릿 | 5.0과 4.3이 `templates/attach-file/boot/`를 공유합니다. | 두 스택의 차이가 import와 어노테이션 몇 줄뿐입니다. 복사하면 약 900줄이 중복되고 이후 수정을 양쪽에서 해야 합니다. |
| 실제 파일 삭제 위치 | 엔티티 컨트롤러가 아니라 `EgovFileMngServiceImpl` 내부에서 처리합니다. | `deleteFileInf`를 호출하는 모든 코드에 같은 동작이 적용되고, 엔티티 컨트롤러를 바꾸지 않아도 됩니다. |
| hidden 필드 | 등록·수정 화면의 `atchFileId` hidden 필드를 제거합니다. | 서버가 더 이상 이 값을 사용하지 않습니다. |
| 4.3 화면 형식 | 4.3의 기존 표 형식과 `sample.css`를 따르고 KRDS를 가져오지 않습니다. | 4.3 화면 전체와 일관성을 유지합니다. |
| 4.3 개별 삭제 후 화면 | 페이지를 새로고침하지 않고 해당 항목을 DOM에서 제거합니다. | 4.3 수정 화면은 POST로 열리므로 새로고침하면 브라우저가 재전송 확인을 표시합니다. |
| 4.3 안내 문구 | "Spring Security 정책으로 보호"를 "인증 체계를 도입할 때 보호"로 바꿉니다. | 4.3 산출물에는 Spring Security가 없습니다. |
| 파일 삭제 실패 | 경고 로그만 남기고 요청은 성공으로 처리합니다. | 이미 DB에서 제거된 뒤이므로 사용자 요청을 실패시킬 이유가 없습니다. |

## 4. 1단계: 5.0 결함 수정

### 4.1 요청 `atchFileId` 불신

**현재:** 수정 화면의 hidden 값(`templates/boot50/thymeleaf/entityRegister.html.hbs:163`)을 컨트롤러가 그대로 사용하고(`templates/boot50/java/controller/EgovEntityController.hbs:217`), Mapper가 이 값을 저장합니다(`templates/boot50/resources/mapper-sql.xml.hbs:22`). 레코드 삭제도 요청 값을 사용합니다(`templates/boot50/java/serviceImpl/EgovEntityServiceImpl.hbs:68`). 값을 조작하면 다른 레코드의 첨부 그룹을 가리키게 하거나, 연결을 끊거나, 다른 레코드의 첨부를 삭제 처리할 수 있습니다.

**변경:**

- **수정:** 입력 검증을 통과한 뒤 `select{{entityName}}`로 현재 레코드를 조회하고, 그 `atchFileId`를 사용합니다. 파일 업로드 여부와 관계없이 VO에 DB 값을 설정한 뒤 수정합니다. 새 첨부 그룹을 만든 경우에는 새 값을 설정합니다. 레코드가 없으면 기존 `select` 예외 흐름을 따릅니다.
- **삭제:** `EgovEntityServiceImpl`에서 도메인 삭제 전에 Mapper의 `select`로 레코드를 조회하고 그 값을 사용합니다. 레코드가 없으면 첨부 정리를 건너뜁니다. 없는 레코드의 삭제는 지금도 오류가 아니므로 Service의 `select`(없으면 예외)를 쓰지 않습니다.
- **등록:** 서버가 이미 값을 결정하므로 변경하지 않습니다.
- hidden 필드를 제거합니다.

### 4.2 트랜잭션 포인트컷

**현재:** `execution(* {{packageName}}..impl.*Impl.*(..))`는 첫 엔티티의 패키지만 포함합니다(`templates/boot50/java/config/EgovConfigTransaction.hbs:54`). `{{basePackage}}.cmm.service.impl`의 첨부 서비스와 `egov_add_entity`로 추가한 다른 패키지의 엔티티에는 트랜잭션이 적용되지 않습니다.

**변경:** `{{packageName}}`을 `{{basePackage}}`로 바꿉니다. 예외 처리 포인트컷(`EgovAopExceptionTransfer`)은 이미 `{{basePackage}}`를 사용하므로 프록시 대상은 늘어나지 않습니다. 4.3 Boot(`templates/boot/java/config/EgovConfigTransaction.hbs:45`)도 함께 수정합니다.

### 4.3 Content-Disposition

**현재:** UTF-8 바이트를 ISO-8859-1 문자열로 변환해 `filename="..."`에 넣고, CR/LF만 제거합니다(`templates/attach-file/boot50/java/EgovFileMngUtil.hbs:277`). 조작된 업로드 요청으로 파일명을 `evil.exe"; x=.jpg`로 만들면, 확장자는 JPG로 판정되지만 다운로드 헤더에서 브라우저가 파일명을 `evil.exe`로 해석할 수 있습니다.

**변경:** Spring의 `ContentDisposition.builder("attachment").filename(이름, StandardCharsets.UTF_8).build()`로 헤더를 만듭니다. 이 API는 두 스택의 Spring 버전에 모두 있습니다. `Content-Type`은 그대로 `application/octet-stream`입니다.

### 4.4 UUID 저장명

**현재:** `keyStr + yyyyMMddhhmmssSSS + fileKey`로 만듭니다(`EgovFileMngUtil.hbs:241`, `:306`). 12시간제이고, 동시 요청의 같은 밀리초에 이름이 겹치면 기존 파일을 오류 없이 덮어씁니다.

**변경:** `keyStr + UUID(하이픈 제거)`로 바꾸고 `getTimeStamp`를 제거합니다. `FILE_SN` 계산은 바꾸지 않습니다. `STRE_FILE_NM`은 `VARCHAR(255)`이므로 길이 문제는 없습니다.

### 4.5 개별 삭제 시 실제 파일 삭제

**현재:** `deleteFileInf`는 `COMTNFILEDETAIL` 행만 삭제합니다(`templates/attach-file/boot50/java/EgovFileMngServiceImpl.hbs:74`). 행이 사라지면 디스크의 파일을 찾아낼 방법이 없습니다.

**변경:**

- `EgovFileMngUtil`에 저장 경로와 저장 파일명을 받아 파일을 삭제하는 메서드를 추가합니다. 경로는 기존 `safeChild`로 검사하고, 파일이 없어도 오류로 처리하지 않습니다.
- `EgovFileMngServiceImpl.deleteFileInf`는 상세 정보를 조회하고, DB 행을 삭제한 뒤 파일을 삭제합니다. `deleteFileInfs`도 같은 방식으로 동작하게 합니다.
- 조회 결과가 없으면(`USE_AT='N'` 포함) 파일을 삭제하지 않습니다.
- 파일 삭제 실패는 경고 로그만 남깁니다.

트랜잭션 커밋 전에 파일이 삭제되므로, 커밋이 실패하면 DB 행은 남고 파일은 없는 상태가 될 수 있습니다. 단일 행 삭제의 커밋 실패는 드물어 커밋 후 콜백은 도입하지 않습니다.

### 4.6 확장자 끝 점·공백 정리

**현재:** `a.jsp.`는 빈 확장자로, `a.jsp `는 `JSP `로 판정되어 차단 목록을 통과합니다(`EgovFileMngUtil.hbs:324`).

**변경:** `getExtensionUpper`가 경로 구분자 이후의 이름에서 끝의 점과 공백을 제거한 뒤 확장자를 구합니다. 확장자가 없는 파일은 지금처럼 통과합니다.

### 4.7 문서 갱신

- `templates/skills/original/egovframe-attach-file-pattern.md`는 생성되는 프로젝트에 포함되어 AI 클라이언트가 참고합니다. 수정·삭제 예시가 요청 값을 사용하고 있어(122행, 152행) DB 값을 쓰도록 고칩니다. 저장 파일명 설명(28행, 200행)도 UUID로 고칩니다.
- `README.md`의 보안 정책 표(저장 파일명 재생성 등)를 갱신합니다.

## 5. 2단계: 인프라 템플릿 공용화

1단계가 끝난 뒤 수행합니다.

- `templates/attach-file/boot50/`를 `templates/attach-file/boot/`로, `templates/attach-file/manifests/boot50.json`을 `boot.json`으로 옮깁니다. 매니페스트의 템플릿 경로와 `HSQL_SEED_TEMPLATE`(`src/utils/scaffold/attachFileInstaller.ts:32`)을 갱신합니다.
- 렌더링 컨텍스트에 스택별 값을 추가합니다.
  - Java EE 네임스페이스: 5.0은 `jakarta`, 4.3은 `javax`. 대상은 `EgovFileDownloadController`, `EgovFileMngServiceImpl`, `EgovFileMngUtil`, `EgovFileUploadExceptionAdvice`입니다. `EgovFileMngUtil`의 인라인 `jakarta.servlet.http.HttpServletResponse`도 포함합니다.
  - Mapper 어노테이션: 5.0은 `org.egovframe.rte.psl.dataaccess.mapper.EgovMapper`의 `@EgovMapper("fileManageMapper")`, 4.3은 `org.egovframe.rte.psl.dataaccess.mapper.Mapper`의 `@Mapper`입니다. 대상은 `FileManageMapper`입니다. 이전 버전이 생성해 `EgovConfigMapper`가 `org.apache.ibatis.annotations.Mapper`로 스캔하는 4.3 프로젝트에서는 새로 만드는 매퍼도 그 어노테이션을 사용합니다. 4.3 Boot 산출물은 JDK 8 기준이므로 Java 9 이상의 API를 사용하지 않습니다.
- 5.0 전용으로 적힌 템플릿 주석은 두 스택에 맞는 표현으로 고칩니다.

5.0 산출물은 이 단계 전후로 주석을 제외하고 동일해야 합니다.

## 6. 3단계: 4.3 Boot 지원

### 6.1 스택 제한 해제

다음 지점에서 `projectType === "boot"`이면 스택 버전과 관계없이 허용합니다. WAR는 계속 제외합니다.

- `manifestForStack` (`src/utils/scaffold/attachFileInstaller.ts:118`): 두 Boot 스택 모두 `attach-file/manifests/boot.json`을 사용합니다.
- `ScaffoldInputSchema`의 `superRefine` (`src/tools/egovScaffoldProject.ts:96`)
- `describeScaffoldAttachmentPrompt`, `describeAddEntityAttachmentPrompt` (`src/utils/scaffold/attachmentDecision.ts:68`, `:80`)

매니페스트의 출력 경로(`application.properties`, `egovframework/egovProps/globals.properties`, `egovframework/message/message-common*.properties`, `templates/thymeleaf/...`)는 4.3 Boot에도 모두 있으므로 그대로 사용합니다.

### 6.2 엔티티 템플릿

`templates/boot/` 아래 파일에 `{{#if withAttachment}}` 분기를 추가합니다. 1단계에서 수정한 5.0의 동작을 따르되, URL과 구조는 4.3 관례를 따릅니다.

| 파일 | 변경 |
|---|---|
| `java/controller/EgovEntityController.hbs` | `/{{entityNameLower}}/add`와 `/update`가 `MultipartHttpServletRequest`를 받아 파일을 처리합니다. `/detail`은 `attachList`를 모델에 넣습니다. 수정은 4.1의 방식을 사용합니다. 개별 삭제용 `POST /{{entityNameLower}}/deleteAttachFile`을 추가합니다. |
| `java/serviceImpl/EgovEntityServiceImpl.hbs` | 삭제 시 `{{entityNameLower}}DAO`로 레코드를 조회해 첨부 그룹을 논리 삭제합니다. |
| `java/entity/EntityVO.hbs` | 첨부 필드를 추가합니다. Lombok을 사용하므로 getter/setter는 추가하지 않고, `@EgovNotNull`을 붙이지 않습니다. |
| `resources/mapper-sql.xml.hbs` | resultMap, insert, update, 단건 select, 목록 select에 첨부 컬럼을 추가합니다. |
| `thymeleaf/entityRegister.html.hbs` | `enctype`, 파일 입력(`name="file_1"`, `multiple`), 기존 파일 목록, 다운로드 링크, 개별 삭제 버튼을 추가합니다. hidden 필드는 넣지 않습니다. |
| `resources/sampledb.sql.hbs`, `resources/sampledb-migrations.sql.hbs` | 스캐폴드 경로의 테이블에 `ATCH_FILE_ID CHAR(20)`을 추가합니다. `add-entity-tables.sql.hbs`에는 이미 있습니다. |
| `message/message-common.properties.hbs`, `message-common_en.properties.hbs` | 스캐폴드 경로의 메시지 키를 추가합니다. `message-entity-keys*`에는 이미 있습니다. |

### 6.3 안내 문구와 문서

- 4.3 프로젝트의 응답에서는 3장의 안내 문구를 사용합니다. 대상은 `summarizeAttachFileInstall`(`attachFileInstaller.ts:661`)과 `egovAddAttachFileInfrastructure.ts:114`입니다.
- `src/index.ts`의 도구 설명, 스키마 설명과 오류 메시지의 "5.0 Boot 전용" 표현을 "Boot 전용(5.0, 4.3)"으로 고칩니다.
- `README.md`, `docs/design/attach-file-tool-schema.md`, 파일 머리 주석을 갱신합니다.
- `egovframe-attach-file-pattern.md`의 "Boot 5.0" 전용 표현을 확인해 4.3 Boot도 설명하게 합니다. 5.0의 CSRF 안내(58행)는 5.0에만 해당한다는 점이 드러나게 합니다.

## 7. 이전 버전 인프라와의 호환성

`egov_add_entity`는 인프라가 이미 있으면 다시 설치하지 않습니다. 따라서 이전 버전 인프라가 설치된 5.0 프로젝트에 새 버전의 엔티티 템플릿이 적용될 수 있습니다.

호환성 유지는 이번 작업의 필수 조건이 아닙니다. 이전 버전 인프라가 설치된 프로젝트에서 새 엔티티가 컴파일되는지 검증하고, 결과만 보고합니다. 컴파일에 실패해도 호환을 위해 설계를 바꾸거나 작업을 중단하지 않습니다.

이전 버전 인프라가 설치된 프로젝트의 파일 저장명, 다운로드 헤더, 삭제 동작은 바뀌지 않습니다.

## 8. 테스트와 검증

### 자동 테스트

- **결함 수정:** 렌더링된 코드에 대해 각 항목을 검증합니다. 요청 값을 사용하지 않고 DB 값을 사용하는지, 포인트컷이 `basePackage`인지, `ContentDisposition`을 사용하고 `ISO-8859-1`이 없는지, 저장명에 UUID를 사용하는지, 끝 점·공백을 제거하는지, `deleteFileInf`가 파일 삭제를 호출하는지 확인합니다.
- **스택 허용:** 현재 4.3 거부를 검증하는 테스트를 WAR 거부 또는 4.3 허용으로 바꿉니다. 대상은 `tests/scaffold/errorClassificationIntegration.test.ts:43`, `addEntityAutoInstallInfra.test.ts:125`, `scaffoldWithAttachment.test.ts:128`, `attachmentDecision.test.ts:108`, `:158`, `tests/elicitationIntegration.test.ts:170`입니다.
- **4.3 렌더링:** `javax` import, `@Mapper`, `withAttachment` 분기를 검증하고, `withAttachment=false` 산출물이 변하지 않음을 검증합니다.
- **골든 파일:** `EgovConfigTransaction.java`(boot43, boot50)와 첨부파일 안내 문서(boot43, boot50, war의 각 도구 디렉터리)만 바뀌어야 합니다. 변경 범위를 확인한 뒤 `npm run test:update`를 실행합니다.

### 실제 실행 검증

아래 조합에서 Maven 빌드와 기동을 수행하고 내장 HSQL로 확인합니다. 4.3 산출물의 HSQLDB는 2.7.3이므로, 첨부 SQL의 `SYSDATE()`, `IFNULL`이 동작하는지 함께 확인합니다.

| 조합 | 경로 |
|---|---|
| 5.0 Boot | `egov_scaffold_project`에 `withAttachment=true` |
| 5.0 Boot | `withAttachment=false`로 스캐폴드 후 `egov_add_entity`에 `withAttachment=true` |
| 4.3 Boot | `egov_scaffold_project`에 `withAttachment=true` |
| 4.3 Boot | `withAttachment=false`로 스캐폴드 후 `egov_add_entity`에 `withAttachment=true` |
| 5.0 Boot 호환성 (결과 보고 전용) | 기준 커밋의 서버로 인프라를 설치하고, 새 서버의 `egov_add_entity`로 엔티티를 추가한 뒤 컴파일 |

호환성 조합을 제외한 각 경로에서 확인할 항목은 다음과 같습니다.

- HSQL 시드 실행, 업로드, 기존 파일 목록, 다운로드 내용 일치, 파일 추가, 개별 삭제, 레코드 삭제 후 다운로드 404
- 조작 요청: 수정·삭제 요청에 다른 레코드의 `atchFileId`를 넣어도 DB 값이 유지되고 다른 첨부 그룹이 영향을 받지 않음
- 개별 삭제 후 디스크 파일 제거
- 저장 파일명이 UUID 형식임
- `a.jsp.`, `a.jsp ` 업로드 거부
- 다운로드 응답 헤더에 `filename*=UTF-8''`이 포함되고 큰따옴표가 포함된 파일명이 헤더를 깨뜨리지 않음

## 9. 구현자에게 맡기는 사항

- 컨텍스트 변수의 이름과 전달 방식
- UUID 생성과 끝 점·공백 제거의 세부 코드
- 파일 삭제 메서드의 이름
- 4.3 개별 삭제의 요청 방식(jQuery 또는 `fetch`)
- 커밋 분할 (1단계는 항목별로 나누는 것을 권장합니다)
