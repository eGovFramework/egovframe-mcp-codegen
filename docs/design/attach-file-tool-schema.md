# Attach-File Tool — Schema Spec (v0.1, for review)

> **상태:** 1순위 스키마/계약 확정용. 본 문서는 **인터페이스**(입력/출력/충돌정책) 만 정의하고
> Handlebars 템플릿 본문·TS 구현·테스트는 다음 단계 산출물.
> **연동:** `templates/skills/original/egovframe-attach-file-pattern.md` (skill) 의 모든 invariants 를
> 이 도구의 출력 매트릭스가 **결정적으로** 보장해야 한다. skill = spec, tool = enforcement.

---

## 1. `egov_add_attach_file_infrastructure` (신규 도구)

프로젝트당 1회. eGov 표준 첨부파일 인프라를 설치한다. 멱등.

### 1.1 입력 스키마 (Zod)

```ts
export const AddAttachFileInfrastructureInputSchema = z.object({
  // ─ 필수 ─
  projectPath: z.string().min(1, "projectPath 는 필수입니다."),

  // ─ 선택 (defaults 가 안전한 표준값) ─

  /**
   * Globals.fileStorePath 값. 기본은 OS 임시 디렉터리 하위 'upload'.
   * 운영 배포는 사용자가 명시적으로 절대 경로를 지정해야 한다 — 기본값은 개발 편의용.
   */
  fileStorePath: z.string().optional(),

  /**
   * atchFileId 채번 prefix. 기본 "FILE_" — 공통컴포넌트 표준.
   * 변경 시 주의: len(idGnrPrefix) + idGnrCipers === 20 등식이 깨지면 거부.
   */
  idGnrPrefix: z.string().optional().default("FILE_"),

  /** 채번 자릿수. 기본 15. */
  idGnrCipers: z.number().int().min(1).max(30).optional().default(15),

  /**
   * 시드 SQL 에 COMTNFILE/COMTNFILEDETAIL/COMTECOPSEQ DDL 을 append 한다.
   * 안전 조건: src/main/resources/db/ 시드 *.sql 파일이 정확히 1개.
   * 0개 또는 2개 이상이면 별도 파일(add-attach-file-tables.sql) 로 fallback.
   * (egov_add_entity 의 autoApplyMigration 정책과 동일.)
   */
  autoApplyMigration: z.boolean().optional().default(true),

  /**
   * Globals.fileStorePath 등 프로퍼티 키를 application.properties / globals.properties
   * 끝에 append. 키가 이미 같은 값으로 있으면 skip(멱등). 다른 값이면 거부.
   */
  autoApplyProperties: z.boolean().optional().default(true),

  /**
   * 이미 인프라가 *완전히 동일하게* 설치되어 있으면 (모든 출력 파일이 존재하고 내용 일치)
   * no-op + 성공 보고. 한 파일이라도 다르면 거부.
   * false 면 한 파일이라도 있으면 거부 (멱등성 포기).
   */
  skipIfPresent: z.boolean().optional().default(true),
});
```

**Auto-detect** (입력 X — `egov_add_entity` 와 동일하게 pom.xml 에서 추출):
- `stackVersion`: `"5.0"` | `"4.3"`
- `projectType`: `"boot"` | `"war"`
- `basePackage`: e.g. `egovframework.example`

### 1.2 출력 파일 매트릭스

**범례**
- `scope: framework` = 프로젝트당 1회 (기본)
- `mode: create` = 신규 파일 (충돌 시 거부)
- `mode: append-idempotent` = 기존 파일 끝에 append (같은 내용 있으면 skip, 다른 값은 거부)
- `mode: append-fallback` = `autoApplyMigration: false` 또는 안전조건 불충족 시 별도 파일 fallback
- `expandDialects: true` = 8개 RDBMS(mysql/mariadb/oracle/tibero/postgres/cubrid/altibase/goldilocks) 각각

**boot50 (eGovFrame 5.0 Boot) 출력**

| # | template | output (relative to projectPath) | mode |
|---|---|---|---|
| 1 | `attach-file/boot50/java/EgovFileMngService.hbs` | `src/main/java/{{basePackagePath}}/cmm/service/EgovFileMngService.java` | create |
| 2 | `attach-file/boot50/java/EgovFileMngServiceImpl.hbs` | `src/main/java/{{basePackagePath}}/cmm/service/impl/EgovFileMngServiceImpl.java` | create |
| 3 | `attach-file/boot50/java/FileVO.hbs` | `src/main/java/{{basePackagePath}}/cmm/service/FileVO.java` | create |
| 4 | `attach-file/boot50/java/EgovFileMngUtil.hbs` | `src/main/java/{{basePackagePath}}/cmm/service/EgovFileMngUtil.java` | create |
| 5 | `attach-file/boot50/java/FileManageMapper.hbs` | `src/main/java/{{basePackagePath}}/cmm/service/impl/FileManageMapper.java` | create |
| 6 | `attach-file/boot50/java/EgovFileDownloadController.hbs` | `src/main/java/{{basePackagePath}}/cmm/web/EgovFileDownloadController.java` | create |
| 7 | `attach-file/boot50/java/EgovConfigAttachFile.hbs` | `src/main/java/{{basePackagePath}}/config/EgovConfigAttachFile.java` | create |
| 8 | `attach-file/boot50/mapper/EgovFileMng_SQL.xml.hbs` | `src/main/resources/egovframework/sqlmap/cmm/mappers/EgovFileMng_SQL.xml` | create |
| 9 | `attach-file/boot50/ddl/attach-file.sql.hbs` | `src/main/resources/db/migrations/{{dialect}}/attach-file.sql` (expandDialects) — *또는* 기존 시드 SQL 끝에 append | append-fallback |
| 10 | `attach-file/boot50/properties/attach-file.properties.hbs` | `src/main/resources/application.properties` (append: `Globals.fileStorePath=…`) | append-idempotent |
| 11 | `attach-file/boot50/properties/attach-file-globals.properties.hbs` | `src/main/resources/egovframework/egovProps/globals.properties` (append) | append-idempotent |

**boot43 (eGovFrame 4.3 Boot) 출력**

- 동일 구조, `import javax.*` / Spring 5 패키지로 차이. 별도 템플릿 디렉터리.

**war43 (전통 WAR + JSP) 출력**

| # | template | output | mode |
|---|---|---|---|
| 1~6 | (boot43 와 동일 java 소스) | 동일 | create |
| 7 | `attach-file/war43/config/context-idgn-File.xml.hbs` | `src/main/resources/egovframework/spring/com/idgn/context-idgn-File.xml` | create |
| 8 | `attach-file/war43/mapper/EgovFileMng_SQL.xml.hbs` | 동일 위치 | create |
| 9 | `attach-file/war43/ddl/attach-file.sql.hbs` | 동일 동작 | append-fallback |
| 10 | (war43 에서는 application.properties 없음) | `src/main/resources/egovframework/egovProps/globals.properties` (append) | append-idempotent |

### 1.3 EgovConfigAttachFile.java (요약)

```java
@Configuration
public class EgovConfigAttachFile {

    @Bean(name = "egovFileIdGnrService", destroyMethod = "destroy")
    public EgovTableIdGnrServiceImpl egovFileIdGnrService(DataSource dataSource) throws Exception {
        EgovTableIdGnrServiceImpl bean = new EgovTableIdGnrServiceImpl();
        bean.setDataSource(dataSource);
        bean.setStrategy(fileStrategy());
        bean.setBlockSize(10);
        bean.setTable("COMTECOPSEQ");
        bean.setTableName("FILE_ID");
        return bean;
    }

    @Bean(name = "fileStrategy")
    public EgovIdGnrStrategyImpl fileStrategy() {
        EgovIdGnrStrategyImpl s = new EgovIdGnrStrategyImpl();
        s.setPrefix("{{idGnrPrefix}}");       // 기본 "FILE_"
        s.setCipers({{idGnrCipers}});          // 기본 15
        s.setFillChar('0');
        return s;
    }
}
```

**기존 `EgovConfigWeb.java` 수정 정책**: `@Import(EgovConfigAttachFile.class)` 추가가 필요하다.
이건 *기존 파일 수정* 이라 신중하게 처리한다:
- 정확히 한 줄 (`@Import(...)` 의 클래스 배열에 `EgovConfigAttachFile.class` 추가) 만 변경
- 이미 import 되어 있으면 skip
- `@Import` 어노테이션이 없거나 형식이 비표준이면 거부 + 수동 적용 가이드 반환

대안: `EgovConfigWeb.java` 를 건드리지 않고 `EgovConfigAttachFile` 에 `@Configuration` + 컴포넌트 스캔 의존만으로 등록되게 — `egov_scaffold_project` 가 base package 에 component-scan 을 거는지 매니페스트로 확인 필요. **걸려 있으면 두 번째 안 (수정 0건) 채택 권장.**

### 1.4 충돌 / 멱등성 정책

| 상황 | 동작 |
|---|---|
| 모든 create 파일이 부재 + append 위치 깨끗 | 정상 emit |
| create 파일 중 1개 이상 존재 (내용 동일) | `skipIfPresent: true` → skip + 성공 보고. `false` → 거부 |
| create 파일 중 1개 이상 존재 (내용 다름) | 항상 거부, 충돌 파일 목록 반환 |
| append 위치에 키가 같은 값으로 존재 | skip (멱등) |
| append 위치에 키가 다른 값으로 존재 | 거부 + 어느 키가 충돌하는지 보고 |
| 시드 SQL 이 0개 또는 2개 이상 | `add-attach-file-tables.sql` 별도 파일로 fallback |
| pom.xml 없음 / RTE 의존 없음 | 거부 |

**원칙**: `egov_add_entity` 와 같다 — 한 파일이라도 충돌이면 **모든 파일 거부, 부분 적용 없음**. 사전 검사 통과 후에만 실제 write.

### 1.5 에러 / 거부 메시지 (themes)

`throw new Error("...")` 로 던지되 다음 7가지 케이스만 다루면 충분:

1. **프로젝트 미식별** — `projectPath` 에 `pom.xml` 이 없거나 egovframe RTE 의존이 없음.
2. **stack 자동감지 실패** — pom.xml 에서 5.0 / 4.3 / war 어느 것도 매칭 안 됨.
3. **충돌 파일** — create 모드 파일 중 하나라도 다른 내용으로 존재. 충돌 목록 포함.
4. **충돌 속성** — `Globals.fileStorePath` 가 다른 값으로 이미 정의됨. 기존 값 vs 요청 값 표시.
5. **충돌 시드** — 기존 시드에 `COMTNFILE` 이 다른 스키마로 정의됨.
6. **잘못된 prefix/cipers** — `len(idGnrPrefix) + idGnrCipers !== 20`.
7. **EgovConfigWeb 비표준** — `@Import` 갱신 모드 선택 시 형식이 비표준이라 자동 적용 불가.

### 1.6 성공 응답 (JSON, MCP tool 결과)

```jsonc
{
  "status": "ok",
  "stackVersion": "5.0",
  "projectType": "boot",
  "basePackage": "egovframework.example",
  "filesCreated":    ["src/main/java/.../cmm/service/EgovFileMngService.java", "…"],
  "filesAppended":   [{ "path": "src/main/resources/application.properties", "addedKeys": ["Globals.fileStorePath"] }],
  "filesSkipped":    ["…already-present, identical content"],
  "ddlEmitted":      ["src/main/resources/db/migrations/mysql/attach-file.sql", "…/oracle/attach-file.sql", "…"],
  "configEdits":     [{ "path": "src/main/java/.../config/EgovConfigWeb.java", "change": "added @Import(EgovConfigAttachFile.class)" }],
  "nextSteps": [
    "egov_add_entity 호출 시 withAttachment: true 옵션을 줄 수 있습니다 (인프라가 없으면 withAttachment: true 호출이 자동 설치하므로 이 도구는 세부 옵션이 필요할 때만 사용).",
    "Globals.fileStorePath 경로의 디렉터리 쓰기 권한을 확인하세요."
  ]
}
```

---

## 2. 인프라 템플릿 디렉터리 구조

**원칙**: 기존 `templates/{boot,boot50,...}/` 구조와 **분리된 네임스페이스**(`templates/attach-file/`) 로 둔다.
인프라는 독립 모듈이라 같은 디렉터리에 섞으면 `egov_scaffold_project` 의 매니페스트(boot50.json 등) 와
혼동된다.

```
templates/
├── stacks.json                        # 기존
├── manifests/                          # 기존
│   ├── boot43.json
│   ├── boot50.json
│   └── war43.json
├── skills/                             # 기존
│   └── original/
│       ├── egovframe-conventions.md
│       ├── egovframe-troubleshooting.md
│       └── egovframe-attach-file-pattern.md   # 이미 작성됨
├── boot/  boot50/  static/  static50/  ...    # 기존
└── attach-file/                        # ★ 신규
    ├── manifests/
    │   ├── boot50.json                 # 위 1.2 표의 boot50 행을 manifest 로
    │   ├── boot43.json
    │   └── war43.json
    ├── boot50/
    │   ├── java/
    │   │   ├── EgovFileMngService.hbs
    │   │   ├── EgovFileMngServiceImpl.hbs
    │   │   ├── FileVO.hbs
    │   │   ├── EgovFileMngUtil.hbs
    │   │   ├── FileManageMapper.hbs
    │   │   ├── EgovFileDownloadController.hbs
    │   │   └── EgovConfigAttachFile.hbs
    │   ├── mapper/
    │   │   └── EgovFileMng_SQL.xml.hbs
    │   ├── ddl/
    │   │   └── attach-file.sql.hbs     # expandDialects 로 8 RDBMS 변형
    │   └── properties/
    │       ├── attach-file.properties.hbs           # application.properties append 조각
    │       └── attach-file-globals.properties.hbs   # globals.properties append 조각
    ├── boot43/
    │   └── …                            # boot50 와 동일 구조, javax/spring5 차이
    └── war43/
        ├── java/                       # boot43 와 java 는 동일 (재사용 가능 — symlink 또는 복제)
        ├── config/
        │   └── context-idgn-File.xml.hbs
        ├── mapper/
        ├── ddl/
        └── properties/
            └── attach-file-globals.properties.hbs
```

### 2.1 Handlebars 컨텍스트 (이 도구가 템플릿에 주입하는 변수)

```ts
type AttachFileTemplateContext = {
  // 기존 ScaffoldContext 와 호환되는 부분
  basePackage: string;          // "egovframework.example"
  basePackagePath: string;      // "egovframework/example"
  stackVersion: "5.0" | "4.3";
  projectType: "boot" | "war";

  // 인프라 도구 고유
  idGnrPrefix: string;          // "FILE_"
  idGnrCipers: number;          // 15
  fileStorePath: string;        // 정규화된 절대 경로 또는 placeholder

  // expandDialects 활성 시 ddl/*.sql.hbs 에 주입
  dialect?: "mysql" | "mariadb" | "oracle" | "tibero" | "postgres" | "cubrid" | "altibase" | "goldilocks";
};
```

### 2.2 매니페스트 항목 형태 (기존 매니페스트 스키마 재사용)

```jsonc
// templates/attach-file/manifests/boot50.json
{
  "name": "attach-file-boot50",
  "scope": "framework",   // 모두 framework (per-project once)
  "files": [
    { "template": "attach-file/boot50/java/EgovFileMngService.hbs",
      "output":   "src/main/java/{{basePackagePath}}/cmm/service/EgovFileMngService.java",
      "mode": "create" },
    // ... (1.2 표의 boot50 행 그대로)
    { "template": "attach-file/boot50/ddl/attach-file.sql.hbs",
      "output":   "src/main/resources/db/migrations/{{dialect}}/attach-file.sql",
      "expandDialects": true,
      "mode": "append-fallback",
      "appendTarget": { "glob": "src/main/resources/db/*.sql", "matchCount": 1 } }
  ]
}
```

**기존 매니페스트 스키마 확장 1건만 필요**: `mode` (선택, 기본 `"create"`) 필드와 `appendTarget` 메타데이터.
`scope` 의 기본값을 entity 가 아닌 framework 로 두는 건 기존과 동일.

---

## 3. `egov_add_entity` — `withAttachment` 옵션 추가

기존 도구 확장. 새 도구로 분리하지 않는 이유: entity 생성 시점에 첨부 와이어링이 결정되어야 자연스럽고, 사후 수정은 v1 범위 밖.

### 3.1 입력 스키마 diff

```ts
export const AddEntityInputSchema = z.object({
  // ... 기존 필드 그대로 ...

  /**
   * true 면 생성되는 엔티티가 eGov 표준 첨부파일(atchFileId) 와이어드 형태로 emit 된다.
   * 인프라(`EgovFileMngService.java` + `EgovConfigAttachFile.java`)가 없으면 기본 옵션으로 자동 설치한다
   * (엔티티 사전 검사 통과 후, 엔티티 파일과 하나의 롤백 저널로 기록). 5.0 Boot 만 지원 — 그 외 스택은 거부.
   * 세부 옵션이 필요하면 먼저 `egov_add_attach_file_infrastructure` 를 호출한다.
   * 생략 시: Elicitation 지원 클라이언트는 서버가 사용자에게 직접 묻고, 미지원이면 파일을 만들지 않고
   * "사용자에게 물은 뒤 withAttachment 를 true/false 로 지정해 재호출" 오류를 반환한다.
   */
  withAttachment: z.boolean().optional().default(false),

  /**
   * atchFileId 컬럼/필드 이름. 표준값 외 사용은 비추천 (공통컴포넌트 fragment 와 어긋남).
   */
  attachmentFieldName: z.string().optional().default("atchFileId"),

  /**
   * UI 단위 첨부 파일 최대 개수. 0 = 무제한. 등록/수정 화면에 client-side 검증으로만 반영.
   * 서버 측 강제 검증은 별도(향후).
   */
  maxAttachmentCount: z.number().int().min(0).optional().default(0),
});
```

### 3.2 출력 파일 diff (when `withAttachment: true`)

기존 매니페스트 (`scope: "entity"`) 항목의 **렌더링 결과만** 달라진다 — 매니페스트 행 자체는 추가되지 않는다(Handlebars `{{#if withAttachment}}` 분기로 처리).

| 파일 | `withAttachment: false` (기존) | `withAttachment: true` (신규) |
|---|---|---|
| `{{entityName}}VO.java` | 사용자 DDL 컬럼만 | + `private String {{attachmentFieldName}};` 필드 + getter/setter |
| 엔티티 DDL (시드/마이그레이션) | 사용자 DDL 그대로 | 사용자 DDL 에 `ATCH_FILE_ID CHAR(20)` 없으면 자동 주입 |
| `{{entityName}}Mapper.java` | 기본 CRUD 시그니처 | atchFileId 컬럼 포함 매퍼 SQL |
| `Egov{{entityName}}_..._SQL.xml` | INSERT/UPDATE/SELECT 표준 | + `ATCH_FILE_ID` 컬럼 포함 |
| `Egov{{entityName}}Controller.java` | 일반 핸들러 | `final MultipartHttpServletRequest multiRequest` + `parseFileInf` + `insertFileInfs` + `getMaxFileSN` + `updateFileInfs` + `deleteAllFileInf` 와이어드 |
| `egov{{entityName}}Register.html` | 일반 폼 | + 첨부 파일 picker fragment (`<input type="file" name="file_1" multiple>`) |
| `egov{{entityName}}List.html` | 변화 없음 | (선택) 첨부 컬럼 표시 |
| (신규) 첨부 목록 fragment | — | 상세 화면용 `<th:block th:replace="_fragments/attach-list :: list">` |

**기존 매니페스트 (`boot50.json` 등) 변경량**: 0~1 행 추가 (첨부 목록 fragment 가 별도 파일이면 1행, 화면 내 인라인이면 0행). 가능한 한 인라인 (`{{#if withAttachment}}` 블록) 으로 처리해 매니페스트는 건드리지 않는 게 깔끔.

### 3.3 새 에러 / 거부 케이스

- **인프라 미설치** — 더 이상 거부하지 않는다. `withAttachment: true` 면 기본 옵션으로 자동 설치한다 (5.0 Boot 한정, 그 외 스택은 거부).
- **withAttachment 미지정** — Elicitation 미지원 클라이언트에서는 오류(`isError`)로 사용자 확인을 요청하고 아무 파일도 만들지 않는다. 사용자가 취소하면 오류 없이 "생성하지 않았다"는 안내만 반환한다.
- **DDL 첨부 필드 타입 충돌** — 사용자 DDL 에 `ATCH_FILE_ID` 가 있지만 타입이 `CHAR(20)` 이 아니거나 NOT NULL/길이가 다름.
- **필드명 충돌** — `attachmentFieldName` 이 DDL 의 다른 컬럼명과 겹침.
- **WAR + 5.0 미지원** — `egov_scaffold_project` 정책상 5.0 은 boot 전용. `egov_add_query_view` 와 동일. (실제로는 5.0+boot 에서만 `withAttachment` 지원 — 4.3 도 지원하려면 별도 결정 필요.)

### 3.4 인프라 존재 자동 감지 로직

`detectAttachFileInfra(projectPath: string): boolean` (새 유틸 함수)
- True 조건: `src/main/java/**/cmm/service/EgovFileMngService.java` **AND**
            `src/main/java/**/config/EgovConfigAttachFile.java` (boot) 또는
            `src/main/resources/**/context-idgn-File.xml` (war)
- False 이고 `withAttachment: true` 면 인프라를 자동 설치하고, 질문 문구에 "함께 설치됩니다"를 덧붙인다 (사용 가능 판정에는 쓰지 않음).

---

## 4. v1 범위 밖 (의도적 미포함)

다음은 v1 에 포함하지 않는다 — skill 이 사람/LLM 에게 가이드하도록 위임:

- **기존 엔티티에 사후로 첨부파일 추가** — Java AST 수정 / 기존 Controller 메서드 시그니처 변경. 복잡도 비싸고 v1 ROI 낮음.
- **첨부 파일 다운로드 로그/통계** — `COMTNFILEUPLOAD` 통계 테이블 등 부가 기능.
- **파일 크기/확장자 서버측 강제 검증** — Bean Validation 또는 인터셉터 형태. 별도 cross-cutting 사안.
- **이미지 전용 처리(섬네일/리사이즈)** — `selectImageFileList` 는 service 에 이미 있지만 별도 도구로 분리.
- **S3 / NAS 스토리지 백엔드** — `Globals.fileStorePath` 의 로컬 디스크 가정 유지.

---

## 5. 검증 체크리스트 (다음 단계 구현 시)

skill (`egovframe-attach-file-pattern.md`) 의 7개 invariants 가 도구 출력으로 자동 보장되는지:

- [ ] **(1)** atchFileId 자체 생성 금지 → Controller 템플릿이 `parseFileInf` + `insertFileInfs` 호출 시퀀스로 고정
- [ ] **(2)** 도메인 VO 에 `atchFileId` 만 → VO 템플릿 + `{{#if withAttachment}}` 분기가 단일 필드만 추가
- [ ] **(3)** `multiRequest.getFiles("file_1")` → Controller 템플릿에 파라미터명 하드코딩
- [ ] **(4)** parseFileInf → insertFileInfs 2단계 → Controller 템플릿 골든 스냅샷이 두 호출을 모두 포함
- [ ] **(5)** Update 시 `getMaxFileSN` → Controller update 핸들러 골든 스냅샷 확인
- [ ] **(6)** Delete 시 `deleteAllFileInf` → Controller delete 핸들러 + Service deleteEntity 골든 확인
- [ ] **(7)** `egovFileIdGnrService` Bean 분리 → `EgovConfigAttachFile.java` 골든 확인 + `len(prefix) + cipers === 20` 검증

8 RDBMS DDL 변형은 `expandDialects` 골든으로 8 파일 모두 스냅샷 (기존 `egov_add_entity` 의 마이그레이션 DDL 패턴과 동일).

---

## 6. 합의 후 다음 단계 (이 문서 승인되면)

1. `templates/attach-file/` 디렉터리 생성 + 각 `.hbs` 파일 본문 작성 (공통컴포넌트 코드 기반, stack 별 차이 반영)
2. `templates/attach-file/manifests/{boot50,boot43,war43}.json` 작성
3. `src/utils/scaffold/manifestLoader.ts` 에 `mode` / `appendTarget` 필드 지원 추가
4. `src/tools/egovAddAttachFileInfrastructure.ts` 신규 — `egovAddEntity.ts` 의 사전검사·충돌처리 로직 일부 재사용
5. `src/tools/egovAddEntity.ts` 에 `withAttachment` 분기 추가 + `detectAttachFileInfra` 유틸 추가
6. `src/index.ts` 에 신규 tool 등록 (4번째 tool)
7. `tests/` 골든 스냅샷: boot50 인프라 emit / boot43 / war43 각 1건 + withAttachment=true 엔티티 1건
8. README 도구 카탈로그 업데이트

추정 변경량: 신규 TS 약 600~900 LoC + 템플릿 약 15~20 파일 + 매니페스트 3 + 골든 4건.
