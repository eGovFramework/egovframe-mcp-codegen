# 첨부파일 결함 수정과 4.3 Boot 지원 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5.0 Boot 첨부파일 템플릿의 결함 6건을 수정한 뒤, 같은 코드로 4.3 Boot에서도 첨부파일 기능을 제공합니다.

**Architecture:** 1단계에서 5.0 템플릿을 항목별로 수정하고 실제 실행으로 검증합니다. 2단계에서 인프라 템플릿을 `templates/attach-file/boot/`로 옮겨 두 Boot 스택이 공유하게 합니다. 3단계에서 4.3 엔티티 템플릿에 첨부파일 분기를 추가하고 스택 제한을 해제합니다.

**Tech Stack:** TypeScript(strict, ESM), vitest, Handlebars, Spring Boot 2.7(4.3)과 3.x(5.0), MyBatis, Thymeleaf, HSQLDB

**Spec:** `docs/superpowers/specs/2026-11-10-attachment-hardening-and-boot43-design.md`

## Global Constraints

- 작업 브랜치는 `develop`입니다.
- 커밋 메시지는 Conventional Commits 형식의 한글 제목에 `(codegen)` 스코프를 사용하며, `Co-Authored-By` trailer를 넣지 않습니다.
- `git add`에는 해당 작업의 파일만 명시합니다. 저장소의 미커밋 `.gitignore` 변경과 `references/`는 스테이징하지 않습니다.
- `withAttachment=false` 산출물에서 바뀌어도 되는 파일은 `EgovConfigTransaction.java`(boot43, boot50)와 첨부파일 안내 문서뿐입니다.
- WAR의 생성·검증 동작은 바꾸지 않습니다. WAR 포인트컷도 수정하지 않습니다.
- 이전 버전 인프라와의 호환성은 필수 조건이 아닙니다. Task 11에서 검증해 결과만 보고합니다.
- 골든 파일을 갱신하는 작업은 `npm run test:update` 뒤에 아래 명령으로 변경 범위를 확인합니다. 각 작업에 적힌 경로 외의 항목이 나오면 갱신을 되돌리고 원인을 찾습니다.

```bash
node -e "const {execSync:x}=require('child_process'),fs=require('fs');for(const s of ['boot43','boot50','war']){const p='tests/scaffold/__golden__/'+s+'.json';const o=JSON.parse(x('git show HEAD:'+p));const n=JSON.parse(fs.readFileSync(p));const m=new Map(o.files.map(f=>[f.path,f.sha256]));console.log(s,n.files.filter(f=>m.get(f.path)!==f.sha256).map(f=>f.path))}"
```

## Review Focus

- 첨부파일이 없는 기존 레코드를 파일 없이 수정하면 `ATCH_FILE_ID`가 비어 있는 상태로 오류 없이 저장되어야 합니다.
- 수정 화면에서 입력 검증에 실패한 뒤 다시 제출해도 레코드의 첨부 그룹이 유지되어야 합니다.
- 한글, 공백, 큰따옴표가 포함된 파일명도 다운로드 헤더를 깨뜨리지 않고 원래 이름으로 내려받아야 합니다.
- 그룹의 마지막 파일을 개별 삭제한 뒤 같은 레코드에 다시 업로드할 수 있어야 합니다.
- 디스크에서 이미 사라진 파일을 개별 삭제해도 요청이 성공하고 DB 행이 제거되어야 합니다.

---

## 1단계: 5.0 결함 수정

### Task 1: 요청 `atchFileId` 불신

**Files:**
- Modify: `templates/boot50/java/controller/EgovEntityController.hbs:215-237`
- Modify: `templates/boot50/java/serviceImpl/EgovEntityServiceImpl.hbs:65-79`
- Modify: `templates/boot50/thymeleaf/entityRegister.html.hbs:161-164`
- Modify: `templates/skills/original/egovframe-attach-file-pattern.md:122,152`
- Create: `tests/scaffold/attachmentHardening.test.ts`
- Modify: `tests/scaffold/__golden__/{boot43,boot50,war}.json`

**Interfaces:**
- Produces: 테스트 파일의 `beforeEach`(`tmpRoot` 생성, `egovScaffoldProject`로 `board-app`을 `stackVersion: "5.0"`, `projectType: "boot"`, `packageName: "egovframework.example.board"`, `entityName: "Board"`, `withAttachment: true`로 생성)와 `read(relPath): Promise<string>` 도우미. Task 2~6이 이 파일에 테스트를 추가합니다.

- [ ] **Step 1: 실패하는 테스트 작성**

`CONTROLLER`는 `src/main/java/egovframework/example/board/web/EgovBoardController.java`, `SERVICE`는 `.../board/service/impl/EgovBoardServiceImpl.java`, `REGISTER`는 `src/main/resources/templates/thymeleaf/board/egovBoardRegister.html`입니다.

```ts
it("수정은 요청 값 대신 DB 의 atchFileId 를 사용한다", async () => {
  const c = await read(CONTROLLER);
  expect(c).toMatch(/BoardVO stored = boardService\.selectBoard\(boardVO\);/);
  expect(c).toMatch(/String atchFileId = stored\.getAtchFileId\(\);/);
  expect(c).not.toMatch(/String atchFileId = boardVO\.getAtchFileId\(\);/);
  expect(c).toMatch(/boardVO\.setAtchFileId\(atchFileId\);\s+boardService\.updateBoard\(boardVO\);/);
  // 첨부가 없는 레코드 (Review Focus)
  expect(c).toMatch(/atchFileId == null \|\| atchFileId\.isEmpty\(\)/);
});

it("레코드 삭제는 DB 에서 읽은 atchFileId 로 첨부를 정리한다", async () => {
  const s = await read(SERVICE);
  expect(s).toMatch(/BoardVO stored = boardMapper\.selectBoard\(vo\);/);
  expect(s).toMatch(/stored != null/);
  expect(s).not.toMatch(/= vo\.getAtchFileId\(\);/);
});

it("등록·수정 화면에 atchFileId hidden 필드가 없다", async () => {
  expect(await read(REGISTER)).not.toMatch(/name="atchFileId"/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/scaffold/attachmentHardening.test.ts`
Expected: 3건 FAIL

- [ ] **Step 3: 템플릿 수정**

- 컨트롤러 수정 핸들러: 검증 통과 직후 `{{entityName}}VO stored = {{entityNameLower}}Service.select{{entityName}}({{entityNameLower}}VO);`로 조회하고, `{{attachmentFieldName}}`의 초기값을 `stored`에서 읽습니다. 파일 처리 블록 뒤, 도메인 수정 호출 직전에 VO에 `{{attachmentFieldName}}`을 항상 설정합니다.
- `EgovEntityServiceImpl.delete`: 도메인 삭제 전에 `{{entityNameLower}}Mapper.select{{entityName}}(vo)`로 조회합니다. 결과가 `null`이면 첨부 정리를 건너뜁니다.
- 화면의 hidden 필드 블록을 삭제합니다.
- 안내 문서의 수정 예시(122행)와 삭제 예시(152행)가 `egovFaqService.selectFaq(faqVO)` 결과의 `getAtchFileId()`를 사용하게 고칩니다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/scaffold/attachmentHardening.test.ts`
Expected: PASS

- [ ] **Step 5: 골든 파일 갱신과 범위 확인**

Run: `npm run test:update`, 이어서 Global Constraints의 범위 확인 명령
Expected: 세 시나리오 모두 `egovframe-attach-file-pattern` 안내 문서 경로만 출력됩니다.

- [ ] **Step 6: 커밋**

```bash
git add templates/boot50/java/controller/EgovEntityController.hbs templates/boot50/java/serviceImpl/EgovEntityServiceImpl.hbs templates/boot50/thymeleaf/entityRegister.html.hbs templates/skills/original/egovframe-attach-file-pattern.md tests/scaffold/attachmentHardening.test.ts tests/scaffold/__golden__
git commit -m "fix(codegen): 첨부파일 그룹 키를 요청 값 대신 DB 값으로 처리"
```

### Task 2: 트랜잭션 포인트컷

**Files:**
- Modify: `templates/boot50/java/config/EgovConfigTransaction.hbs:54`
- Modify: `templates/boot/java/config/EgovConfigTransaction.hbs:45`
- Modify: `tests/scaffold/attachmentHardening.test.ts`
- Modify: `tests/scaffold/__golden__/{boot43,boot50}.json`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it.each(["5.0", "4.3"] as const)("%s 트랜잭션 포인트컷은 기본 패키지 전체를 포함한다", async (stackVersion) => {
  await generateScaffoldProject({ projectName: "tx-app", packageName: "egovframework.example.board", outputPath: tmpRoot,
    entityName: "Board", ddl: BOARD_DDL, description: "", projectType: "boot", stackVersion });
  const tx = await fs.readFile(path.join(tmpRoot, "tx-app/src/main/java/egovframework/example/config/EgovConfigTransaction.java"), "utf-8");
  expect(tx).toContain('execution(* egovframework.example..impl.*Impl.*(..))');
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/scaffold/attachmentHardening.test.ts -t "포인트컷"`
Expected: 2건 FAIL

- [ ] **Step 3: 두 템플릿의 표현식에서 `{{packageName}}`을 `{{basePackage}}`로 변경**

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/scaffold/attachmentHardening.test.ts -t "포인트컷"`
Expected: PASS

- [ ] **Step 5: 골든 파일 갱신과 범위 확인**

Run: `npm run test:update`, 이어서 범위 확인 명령
Expected: boot43, boot50은 `EgovConfigTransaction.java` 한 경로만, war는 빈 배열을 출력합니다.

- [ ] **Step 6: 커밋**

```bash
git add templates/boot50/java/config/EgovConfigTransaction.hbs templates/boot/java/config/EgovConfigTransaction.hbs tests/scaffold/attachmentHardening.test.ts tests/scaffold/__golden__
git commit -m "fix(codegen): 트랜잭션 포인트컷을 기본 패키지 전체로 확대"
```

### Task 3: Content-Disposition

**Files:**
- Modify: `templates/attach-file/boot50/java/EgovFileMngUtil.hbs:274-278`
- Modify: `tests/scaffold/attachmentHardening.test.ts`

`UTIL`은 `src/main/java/egovframework/example/cmm/service/EgovFileMngUtil.java`입니다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it("다운로드 헤더를 ContentDisposition 으로 생성한다", async () => {
  const u = await read(UTIL);
  expect(u).toMatch(/ContentDisposition\.builder\("attachment"\)\s*\.filename\([^,]+,\s*StandardCharsets\.UTF_8\)/);
  expect(u).not.toContain("ISO-8859-1");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/scaffold/attachmentHardening.test.ts -t "ContentDisposition"`
Expected: FAIL

- [ ] **Step 3: `downFile`이 `org.springframework.http.ContentDisposition`으로 헤더 값을 만들도록 수정**

`Content-Type`과 파일명이 `null`일 때 저장 파일명을 사용하는 동작은 유지합니다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/scaffold/attachmentHardening.test.ts -t "ContentDisposition"`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add templates/attach-file/boot50/java/EgovFileMngUtil.hbs tests/scaffold/attachmentHardening.test.ts
git commit -m "fix(codegen): 다운로드 Content-Disposition 을 RFC 5987 형식으로 생성"
```

### Task 4: UUID 저장명

**Files:**
- Modify: `templates/attach-file/boot50/java/EgovFileMngUtil.hbs:241,300-308`와 사용하지 않게 되는 import
- Modify: `templates/skills/original/egovframe-attach-file-pattern.md:28,200`
- Modify: `README.md:127`
- Modify: `tests/scaffold/attachmentHardening.test.ts`
- Modify: `tests/scaffold/__golden__/{boot43,boot50,war}.json`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it("저장명은 UUID 로 생성하고 시각 기반 이름을 쓰지 않는다", async () => {
  const u = await read(UTIL);
  expect(u).toMatch(/keyStr \+ UUID\.randomUUID\(\)\.toString\(\)\.replace\("-", ""\)/);
  expect(u).not.toMatch(/getTimeStamp|SimpleDateFormat/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/scaffold/attachmentHardening.test.ts -t "UUID"`
Expected: FAIL

- [ ] **Step 3: 저장명을 변경하고 `getTimeStamp`, `SimpleDateFormat`, `Timestamp`를 제거**

안내 문서와 README의 저장 파일명 설명을 UUID로 고칩니다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/scaffold/attachmentHardening.test.ts -t "UUID"`
Expected: PASS

- [ ] **Step 5: 골든 파일 갱신과 범위 확인**

Run: `npm run test:update`, 이어서 범위 확인 명령
Expected: 세 시나리오 모두 `egovframe-attach-file-pattern` 안내 문서 경로만 출력됩니다.

- [ ] **Step 6: 커밋**

```bash
git add templates/attach-file/boot50/java/EgovFileMngUtil.hbs templates/skills/original/egovframe-attach-file-pattern.md README.md tests/scaffold/attachmentHardening.test.ts tests/scaffold/__golden__
git commit -m "fix(codegen): 첨부파일 저장명을 UUID 로 생성"
```

### Task 5: 확장자 끝 점·공백 정리

**Files:**
- Modify: `templates/attach-file/boot50/java/EgovFileMngUtil.hbs:317-328`
- Modify: `tests/scaffold/attachmentHardening.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it("확장자를 구하기 전에 끝의 점과 공백을 제거한다", async () => {
  const u = await read(UTIL);
  const body = /private static String getExtensionUpper[\s\S]*?\n\t}/.exec(u)![0];
  expect(body).toContain('replaceAll("[\\\\s.]+$", "")');
  expect(body.indexOf("replaceAll")).toBeLessThan(body.indexOf("lastIndexOf('.')"));
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/scaffold/attachmentHardening.test.ts -t "끝의 점"`
Expected: FAIL

- [ ] **Step 3: `getExtensionUpper`에서 경로 구분자 처리 직후 `name = name.replaceAll("[\\s.]+$", "");`를 적용**

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/scaffold/attachmentHardening.test.ts -t "끝의 점"`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add templates/attach-file/boot50/java/EgovFileMngUtil.hbs tests/scaffold/attachmentHardening.test.ts
git commit -m "fix(codegen): 확장자 끝의 점과 공백으로 차단 목록을 우회하는 문제 수정"
```

### Task 6: 개별 삭제 시 실제 파일 삭제

**Files:**
- Modify: `templates/attach-file/boot50/java/EgovFileMngUtil.hbs`
- Modify: `templates/attach-file/boot50/java/EgovFileMngServiceImpl.hbs:29-35,74-77`
- Modify: `tests/scaffold/attachmentHardening.test.ts`

**Interfaces:**
- Produces: `EgovFileMngUtil.deleteStoredFile(String fileStreCours, String streFileNm): void`. 예외를 던지지 않으며, 실패하면 경고 로그만 남깁니다.

`IMPL`은 `src/main/java/egovframework/example/cmm/service/impl/EgovFileMngServiceImpl.java`입니다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it("개별 삭제는 DB 행을 지운 뒤 디스크 파일을 삭제한다", async () => {
  const i = await read(IMPL);
  const body = /public void deleteFileInf\(FileVO fvo\)[\s\S]*?\n\t}/.exec(i)![0];
  expect(body.indexOf("selectFileInf")).toBeGreaterThan(-1);
  expect(body.indexOf("deleteFileDetail")).toBeGreaterThan(body.indexOf("selectFileInf"));
  expect(body.indexOf("deleteStoredFile")).toBeGreaterThan(body.indexOf("deleteFileDetail"));
  expect(i).toMatch(/@Resource\(name = "EgovFileMngUtil"\)/);
});

it("파일 삭제는 경로를 검사하고 없는 파일을 오류로 처리하지 않는다", async () => {
  const u = await read(UTIL);
  const body = /public void deleteStoredFile\(String fileStreCours, String streFileNm\)[\s\S]*?\n\t}/.exec(u)![0];
  expect(body).toContain("safeChild(");
  expect(body).toContain("Files.deleteIfExists(");
  expect(body).toMatch(/LOGGER\.warn/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/scaffold/attachmentHardening.test.ts -t "삭제"`
Expected: 새 테스트 2건 FAIL

- [ ] **Step 3: `deleteStoredFile`을 추가하고 `deleteFileInf`, `deleteFileInfs`를 수정**

`deleteFileInf`는 조회, DB 행 삭제, 조회 결과가 있을 때 파일 삭제 순서로 동작하고, `deleteFileInfs`는 각 항목에 `deleteFileInf`를 호출합니다. `deleteStoredFile`은 `IOException`과 `SecurityException`을 잡아 경고 로그를 남깁니다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/scaffold/attachmentHardening.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add templates/attach-file/boot50/java/EgovFileMngUtil.hbs templates/attach-file/boot50/java/EgovFileMngServiceImpl.hbs tests/scaffold/attachmentHardening.test.ts
git commit -m "fix(codegen): 첨부파일 개별 삭제 시 디스크 파일도 삭제"
```

### Task 7: 5.0 실제 실행 검증

이 작업은 코드를 바꾸지 않습니다. 결함이 발견되면 해당 Task로 돌아가 수정합니다.

- [ ] **Step 1: 전체 테스트 실행**

Run: `npm test`
Expected: 전체 통과

- [ ] **Step 2: 두 경로의 프로젝트 생성**

`build/tools/*.js`의 함수를 node 스크립트로 호출해 임시 디렉터리에 만듭니다. 경로 A는 `egovScaffoldProject`에 `withAttachment: true`, 경로 B는 `withAttachment: false`로 스캐폴드한 뒤 `egovAddEntity`로 `Member`(`ID VARCHAR(16) PK`, `EMAIL VARCHAR(100)`, `packageName: egovframework.example.member`)에 `withAttachment: true`를 지정합니다.

- [ ] **Step 3: 빌드와 기동**

Run: 각 프로젝트에서 `mvn -q -DskipTests clean package`, 이어서 `mvn spring-boot:run -Dspring-boot.run.arguments=--server.port=18050`
Expected: 빌드 성공, 기동 로그에 HSQL 시드 오류 없음. 종료는 `lsof -ti tcp:18050 | xargs kill`로 수행합니다.

- [ ] **Step 4: 동작 확인**

쿠키 저장과 화면의 CSRF 토큰을 사용하는 curl로 두 경로에서 확인합니다.

| 확인 항목 | 기대 결과 |
|---|---|
| 등록 시 업로드 | 레코드 생성, 저장 디렉터리에 `접두어+32자 16진수` 형식의 파일 생성 |
| 수정 화면 | 기존 파일 목록과 다운로드 링크 표시 |
| 다운로드 | 내용 일치, 헤더에 `filename*=UTF-8''` 포함 |
| 한글·공백·큰따옴표 파일명 다운로드 | 헤더가 깨지지 않고 원래 이름이 복원됨 |
| 파일 추가 | `FILE_SN`이 이어짐 |
| 첨부 없는 레코드를 파일 없이 수정 | 오류 없이 저장 |
| 입력 검증 실패 후 재제출 | 첨부 그룹 유지 |
| 수정 요청에 다른 레코드의 `atchFileId` 삽입 | 두 레코드의 첨부가 모두 그대로 유지 |
| 삭제 요청에 다른 레코드의 `atchFileId` 삽입 | 다른 레코드의 다운로드는 200, 삭제한 레코드의 다운로드는 404 |
| 개별 삭제 | DB 행 제거, 디스크 파일 제거 |
| 디스크에서 지운 뒤 개별 삭제 | 요청 성공 |
| 그룹의 마지막 파일 삭제 후 재업로드 | 성공 |
| `a.jsp.`, `a.jsp ` 업로드 | `cmm/uploadError` 화면으로 거부 |
| 레코드 삭제 후 기존 다운로드 URL | 404 |

- [ ] **Step 5: 결과를 표로 기록**

각 항목의 통과 여부를 다음 작업 전에 보고합니다.

---

## 2단계: 인프라 템플릿 공용화

### Task 8: `attach-file/boot` 공용 템플릿

**Files:**
- Move: `templates/attach-file/boot50/` → `templates/attach-file/boot/`
- Move: `templates/attach-file/manifests/boot50.json` → `templates/attach-file/manifests/boot.json`
- Modify: `src/utils/scaffold/attachFileInstaller.ts:32,120,352-364`
- Modify: `templates/attach-file/boot/java/{EgovFileDownloadController,EgovFileMngServiceImpl,EgovFileMngUtil,EgovFileUploadExceptionAdvice,FileManageMapper}.hbs`
- Modify: `templates/attach-file/boot/mapper/EgovFileMng_SQL.xml.hbs:4`
- Modify: `tests/scaffold/attachmentHardening.test.ts`

**Interfaces:**
- Produces: 렌더링 컨텍스트 `eeNamespace: "jakarta" | "javax"`, `useEgovMapper: boolean`. 값은 `detected.stackVersion === "5.0"`으로 결정합니다.

- [ ] **Step 1: 기준 산출물 생성**

수정 전 빌드로 `withAttachment: true`인 5.0 프로젝트를 임시 디렉터리 `before/`에 생성합니다.

- [ ] **Step 2: 5.0 렌더링을 고정하는 테스트 작성**

```ts
it("5.0 인프라는 jakarta 와 @EgovMapper 를 사용한다", async () => {
  expect(await read(UTIL)).toContain("import jakarta.annotation.Resource;");
  const mapper = await read("src/main/java/egovframework/example/cmm/service/impl/FileManageMapper.java");
  expect(mapper).toContain('@EgovMapper("fileManageMapper")');
  expect(mapper).not.toContain("org.apache.ibatis");
});
```

Run: `npx vitest run tests/scaffold/attachmentHardening.test.ts -t "jakarta"`
Expected: PASS (이후 단계의 회귀를 막습니다)

- [ ] **Step 3: 디렉터리와 매니페스트 이동, 경로 갱신**

`git mv`로 옮기고 매니페스트의 `attach-file/boot50/`를 `attach-file/boot/`로 바꿉니다. `src`, `tests`, `scripts`에서 `attach-file/boot50`과 `attach-file/manifests/boot50`을 검색해 남은 참조를 없앱니다.

- [ ] **Step 4: 스택별 값 치환**

`jakarta`를 `{{eeNamespace}}`로 바꿉니다(인라인 `HttpServletResponse` 포함). `FileManageMapper`의 import와 어노테이션을 `useEgovMapper`로 분기합니다. 4.3에서는 `org.apache.ibatis.annotations.Mapper`와 `@Mapper`입니다. 5.0 전용으로 적힌 주석 3곳은 두 스택에 맞게 고칩니다.

- [ ] **Step 5: 테스트와 동일성 확인**

Run: `npm test`, 이어서 수정 후 빌드로 `after/`를 생성하고 `diff -r before/board-app after/board-app`
Expected: 전체 통과. diff는 `EgovFileMng_SQL.xml`, `FileManageMapper.java`, `EgovFileMngServiceImpl.java`의 주석 줄만 출력합니다.

- [ ] **Step 6: 커밋**

```bash
git add templates/attach-file src tests
git commit -m "refactor(codegen): 첨부파일 인프라 템플릿을 Boot 스택 공용으로 정리"
```

---

## 3단계: 4.3 Boot 지원

### Task 9: 4.3 엔티티 템플릿

**Files:**
- Modify: `templates/boot/java/controller/EgovEntityController.hbs`
- Modify: `templates/boot/java/serviceImpl/EgovEntityServiceImpl.hbs`
- Modify: `templates/boot/java/entity/EntityVO.hbs`
- Modify: `templates/boot/resources/mapper-sql.xml.hbs`
- Modify: `templates/boot/thymeleaf/entityRegister.html.hbs`
- Modify: `templates/boot/resources/sampledb.sql.hbs`, `templates/boot/resources/sampledb-migrations.sql.hbs`
- Modify: `templates/boot/message/message-common.properties.hbs`, `message-common_en.properties.hbs`
- Create: `tests/scaffold/boot43Attachment.test.ts`

**Interfaces:**
- Consumes: 렌더링 컨텍스트 `attachmentFieldName`, `attachmentFieldNamePascal`, `attachmentColumnName`, `withAttachment` (`applyAttachmentContext`)
- Produces: `POST /{{entityNameLower}}/deleteAttachFile` (파라미터 `atchFileId`, `fileSn`, 응답 본문 `ok`)

테스트는 스택 제한의 영향을 받지 않도록 `generateScaffoldProject`를 `stackVersion: "4.3"`, `withAttachment: true`로 직접 호출합니다.

- [ ] **Step 1: 실패하는 테스트 작성**

경로는 컨트롤러 `.../board/web/EgovBoardController.java`, 서비스 `.../board/service/impl/EgovBoardServiceImpl.java`, VO `.../board/service/BoardVO.java`, 매퍼 `src/main/resources/egovframework/sqlmap/board/mappers/EgovBoard_Board_SQL.xml`, 화면 `src/main/resources/templates/thymeleaf/egovBoardRegister.html`입니다.

```ts
it("컨트롤러가 첨부 업로드와 DB 기준 수정을 수행한다", async () => {
  const c = await read(CONTROLLER);
  expect(c).toMatch(/public String add\(final MultipartHttpServletRequest multiRequest,/);
  expect(c).toMatch(/public String update\(final MultipartHttpServletRequest multiRequest,/);
  expect(c).toMatch(/model\.addAttribute\("attachList"/);
  expect(c).toMatch(/BoardVO stored = this\.boardService\.selectBoard\(boardVO\);/);
  expect(c).not.toMatch(/String atchFileId = boardVO\.getAtchFileId/);
  expect(c).toContain('@PostMapping("/board/deleteAttachFile")');
});

it("서비스 삭제는 DB 값으로 첨부 그룹을 정리한다", async () => {
  const s = await read(SERVICE);
  expect(s).toMatch(/BoardVO stored = boardDAO\.selectBoard\(vo\);/);
  expect(s).toContain("deleteAllFileInf");
});

it("VO 와 매퍼에 첨부 컬럼을 추가한다", async () => {
  expect(await read(VO)).toMatch(/private String atchFileId;/);
  const m = await read(MAPPER);
  expect(m).toContain('<result property="atchFileId" column="ATCH_FILE_ID"/>');
  expect(m).toMatch(/ATCH_FILE_ID=#\{atchFileId\}/);
  expect(m).toMatch(/t\.ATCH_FILE_ID/);
});

it("화면에 파일 선택과 기존 목록이 있고 hidden 필드는 없다", async () => {
  const r = await read(REGISTER);
  expect(r).toContain('enctype="multipart/form-data"');
  expect(r).toContain('name="file_1"');
  expect(r).toContain("/cmm/fms/FileDown.do");
  expect(r).toContain("/board/deleteAttachFile");
  expect(r).not.toMatch(/name="atchFileId"/);
  expect(r).not.toContain("krds-");
});

it("메시지 키가 모든 번들에 있다", async () => {
  for (const f of ["message-common.properties", "message-common_ko.properties", "message-common_en.properties"]) {
    expect(await read(`src/main/resources/egovframework/message/${f}`)).toMatch(/title\.board\.attachment=/);
  }
});

it.each([
  ["단일 PK", "CREATE TABLE BOARD (ID VARCHAR(20) NOT NULL PRIMARY KEY, TITLE VARCHAR(200))"],
  ["복합 PK", "CREATE TABLE BOARD (A VARCHAR(20) NOT NULL, B INT NOT NULL, PRIMARY KEY (A, B))"],
])("%s 시드에 첨부 컬럼이 올바른 쉼표로 추가된다", async (_n, ddl) => {
  // ddl 로 프로젝트를 생성한 뒤
  const seed = await read("src/main/resources/db/boarddb.sql");
  expect(seed).toMatch(/,\s*ATCH_FILE_ID CHAR\(20\)\s*\);/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/scaffold/boot43Attachment.test.ts`
Expected: 전체 FAIL

- [ ] **Step 3: 컨트롤러, 서비스, VO, 매퍼 수정**

`templates/boot50/`의 같은 파일에 있는 `withAttachment` 분기를 기준으로, 4.3의 URL과 `this.` 호출 관례에 맞춰 추가합니다. 파일 처리는 Task 1의 방식을 따릅니다. `@Resource`는 `javax.annotation.Resource`를 사용합니다. 서비스의 `delete`는 `withAttachment`일 때만 여러 줄 구현을 사용하고, 아니면 기존 한 줄을 그대로 출력합니다.

- [ ] **Step 4: 화면, 시드, 메시지 수정**

- 화면: 표의 마지막 행으로 첨부 입력과 기존 목록을 추가합니다. 개별 삭제는 성공하면 해당 `li`를 DOM에서 제거합니다.
- 시드와 마이그레이션: `templates/boot50/resources/`의 같은 파일과 동일한 쉼표 규칙과 `{{attachmentColumnName}} CHAR(20)`을 적용합니다.
- 메시지: `title.{{entityNameLower}}.attachment`와 `info.{{entityNameLower}}.attachment.existing`을 `boot50`과 같은 문구로 추가합니다.

- [ ] **Step 5: 테스트와 골든 불변 확인**

Run: `npm test`
Expected: 전체 통과, 골든 mismatch 없음

- [ ] **Step 6: 커밋**

```bash
git add templates/boot tests/scaffold/boot43Attachment.test.ts
git commit -m "feat(codegen): 4.3 Boot 엔티티 템플릿에 첨부파일 연결 추가"
```

### Task 10: 스택 제한 해제와 문서 갱신

**Files:**
- Modify: `src/utils/scaffold/attachFileInstaller.ts:115-126,654-663`
- Modify: `src/utils/scaffold/attachmentDecision.ts:68,80`
- Modify: `src/tools/egovScaffoldProject.ts:76,83,96-103`
- Modify: `src/tools/egovAddEntity.ts:143`
- Modify: `src/tools/egovAddAttachFileInfrastructure.ts:18,114`
- Modify: `src/index.ts`의 `withAttachment`와 첨부파일 인프라 도구 설명(84행, 319행, 324행 등)
- Modify: `README.md:45,64,90,109,139`와 저장소 트리, `docs/design/attach-file-tool-schema.md`
- Modify: `templates/skills/original/egovframe-attach-file-pattern.md:58,227`
- Modify: `tests/scaffold/errorClassificationIntegration.test.ts:43`, `addEntityAutoInstallInfra.test.ts:125`, `scaffoldWithAttachment.test.ts:128`, `attachmentDecision.test.ts:108,158`, `tests/elicitationIntegration.test.ts:170`
- Modify: `tests/scaffold/boot43Attachment.test.ts`
- Modify: `tests/scaffold/__golden__/{boot43,boot50,war}.json`

**Interfaces:**
- Produces: `downloadUrlProtectionNote(stackVersion: "5.0" | "4.3"): string` (`attachFileInstaller.ts`). 5.0은 기존 문구를, 4.3은 `다운로드 URL /cmm/fms/FileDown.do 에는 접근 제어가 없습니다. 인증 체계를 도입할 때 보호하세요.`를 반환합니다. `summarizeAttachFileInstall`은 `plan.detected.stackVersion`으로 호출합니다.

- [ ] **Step 1: 실패하는 테스트 작성**

`boot43Attachment.test.ts`에 추가합니다.

```ts
it("도구로 4.3 프로젝트를 첨부파일과 함께 생성한다", async () => {
  const out = await egovScaffoldProject({ /* 4.3 Boot, withAttachment: true */ });
  expect(out).toContain("접근 제어가 없습니다");
  expect(out).not.toContain("Spring Security 정책으로 보호");
  const u = await read("src/main/java/egovframework/example/cmm/service/EgovFileMngUtil.java");
  expect(u).toContain("import javax.annotation.Resource;");
  expect(u).not.toContain("jakarta");
  const m = await read("src/main/java/egovframework/example/cmm/service/impl/FileManageMapper.java");
  expect(m).toContain("import org.apache.ibatis.annotations.Mapper;");
  expect(m).not.toContain("EgovMapper");
});

it("4.3 프로젝트의 egov_add_entity 가 인프라를 자동 설치한다", async () => {
  // 4.3 스캐폴드(withAttachment 없음) 뒤 Member 엔티티 추가
  expect(out).toMatch(/첨부파일 인프라 자동 설치/);
  expect(detectAttachFileInfra(projectDir).present).toBe(true);
});
```

기존 테스트를 다음과 같이 바꿉니다.

| 테스트 | 변경 |
|---|---|
| `errorClassificationIntegration.test.ts:43` | WAR 4.3 프로젝트의 거부 검증으로 변경 |
| `addEntityAutoInstallInfra.test.ts:125` | WAR 프로젝트 거부로 변경, 기대 메시지 `Boot 만 지원` |
| `scaffoldWithAttachment.test.ts:128` | `["boot", "4.3"]` 제거, 기대 메시지 `Boot` |
| `attachmentDecision.test.ts:108,158` | 4.3 Boot는 `supported: true`, WAR 조합은 `false` |
| `elicitationIntegration.test.ts:170` | `{ projectType: "war", stackVersion: "4.3" }`로 변경 |

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/scaffold/boot43Attachment.test.ts tests/scaffold/attachmentDecision.test.ts tests/elicitationIntegration.test.ts`
Expected: 새 테스트와 변경한 4.3 허용 테스트 FAIL

- [ ] **Step 3: 스택 제한 해제**

`manifestForStack`은 `projectType === "boot"`이면 `attach-file/manifests/boot.json`을 반환하고, 그 외에는 `Boot 만 지원` 문구로 거부합니다. `superRefine`과 `describe*AttachmentPrompt`의 지원 조건을 `projectType === "boot"`로 바꿉니다.

- [ ] **Step 4: 안내 문구 적용**

`downloadUrlProtectionNote`를 추가해 `summarizeAttachFileInstall`과 `egovAddAttachFileInfrastructure.ts:114`에 적용합니다.

- [ ] **Step 5: 설명과 문서 갱신**

"5.0 Boot 전용" 표현을 "Boot 전용(5.0, 4.3)"으로 고칩니다. `egov_add_query_view`의 5.0 전용 표현은 바꾸지 않습니다. README의 139행과 저장소 트리, `attach-file-tool-schema.md`의 템플릿 경로와 스택 설명을 갱신합니다. 안내 문서의 58행은 5.0에만 해당함을 밝히고, 227행 제목은 4.3 Boot도 포함하게 합니다.

- [ ] **Step 6: 테스트 통과와 골든 범위 확인**

Run: `npm run test:update`, 이어서 범위 확인 명령, 그다음 `npx tsc --noEmit`
Expected: 전체 통과, 세 시나리오 모두 안내 문서 경로만 출력, 타입 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add src README.md docs/design/attach-file-tool-schema.md templates/skills/original/egovframe-attach-file-pattern.md tests
git commit -m "feat(codegen): 4.3 Boot 에서 첨부파일 기능 지원"
```

### Task 11: 4.3 실제 실행 검증과 호환성 보고

이 작업은 코드를 바꾸지 않습니다. 호환성 결과를 제외한 결함이 발견되면 해당 Task로 돌아가 수정합니다.

- [ ] **Step 1: 전체 테스트와 타입 검사**

Run: `npm test`, `npx tsc --noEmit`
Expected: 전체 통과

- [ ] **Step 2: 4.3 두 경로 생성, 빌드, 기동**

Task 7의 Step 2~3과 같은 방식으로 `stackVersion: "4.3"`를 사용하고 포트는 18043으로 합니다.
Expected: 빌드 성공, HSQLDB 2.7.3에서 시드 실행 오류 없음

- [ ] **Step 3: 동작 확인**

Task 7 Step 4의 표를 4.3 URL로 확인합니다. CSRF 토큰은 사용하지 않습니다. URL은 `POST /board/add`, `/board/detail`, `/board/update`, `/board/delete`, `/board/deleteAttachFile`이고, 첨부 SQL의 `SYSDATE()`, `IFNULL`이 동작하는지 함께 확인합니다. 개별 삭제 후 페이지 새로고침 없이 항목이 사라지는지 화면 코드로 확인합니다.

- [ ] **Step 4: 이전 버전 인프라 호환성 검증**

```bash
git archive e4a5331 | tar -x -C "$OLD_DIR"
ln -s "$PWD/node_modules" "$OLD_DIR/node_modules"
```

`$OLD_DIR`에서 `npm run build`를 실행하고, 그 빌드로 5.0 프로젝트를 만들어 인프라를 설치합니다. 현재 빌드의 `egovAddEntity`로 `withAttachment: true`인 엔티티를 추가한 뒤 해당 프로젝트에서 `mvn -q -DskipTests compile`을 실행합니다.
Expected: 결과를 그대로 기록합니다. 실패해도 코드를 고치지 않습니다.

- [ ] **Step 5: 결과 보고**

Task 7과 Task 11의 항목별 통과 여부, 호환성 컴파일 결과, 전체 테스트 수를 사용자에게 보고합니다.
