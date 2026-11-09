# 스캐폴드·엔티티 생성 시 첨부파일 통합과 사용자 확인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `egov_scaffold_project`와 `egov_add_entity`에서 `withAttachment` 하나로 첨부파일 인프라 설치와 엔티티 연결을 수행하고, 값이 없으면 MCP Elicitation 또는 AI를 통해 사용자에게 확인합니다.

**Architecture:** 기존 설치 도구의 로직을 쓰기 없는 계획 단계와 쓰기 단계로 나누어 공통 모듈로 추출하고, 세 도구가 이를 사용합니다. 사용자 확인은 `src/index.ts`의 핸들러 계층에서 수행하여 도구 함수의 입력 계약(`withAttachment` 기본 `false`)을 유지합니다.

**Tech Stack:** TypeScript strict, ESM, `@modelcontextprotocol/sdk` 1.29.0, zod, Handlebars, fs-extra, vitest

**Spec:** `docs/superpowers/specs/2026-11-09-attachment-elicitation-design.md`

## Global Constraints

- 지원 스택은 5.0 Boot뿐입니다. 4.3 Boot와 WAR용 템플릿은 추가하지 않습니다.
- `withAttachment`를 제외한 인프라 세부 설정 인자는 두 도구에 추가하지 않습니다.
- Elicitation 요청 제한 시간은 `120_000`ms입니다.
- `accept`는 입력값대로 진행, `decline`은 `false`로 생성, `cancel`은 파일 없이 중단합니다.
- `withAttachment`가 없거나 `false`인 도구 함수 호출의 산출물은 기존 골든 파일과 동일해야 합니다.
- 외부 입력을 셸로 전달하지 않고, 파일 쓰기는 `assertInsideProject`를 거칩니다. 사용자 메시지에 스택 트레이스를 노출하지 않습니다.
- 커밋은 Conventional Commits를 따르고 `Co-Authored-By` trailer를 넣지 않습니다.

## Review Focus

- DDL에 `ATCH_FILE_ID`를 이미 적은 첫 엔티티를 `withAttachment=true`로 스캐폴드하는 경우: 입력 필드로 노출되지 않고 컬럼이 중복되지 않아야 합니다. (Task 3)
- 복합 PK 또는 FK가 있는 첫 엔티티를 `withAttachment=true`로 스캐폴드하는 경우: 시드 DDL의 쉼표가 올바라야 합니다. (Task 3)
- `egov_add_entity`가 PK 길이 부족으로 거부되는 경우: 인프라 파일이 남지 않아야 합니다. (Task 2)
- `withAttachment=true`로 같은 엔티티를 다시 호출하는 경우: 시드에 `COMTNFILE`이 중복 추가되지 않아야 합니다. (Task 2)
- 인프라 파일 일부만 동일한 내용으로 있는 프로젝트: 나머지만 설치되어야 합니다. (Task 2)

---

### Task 1: 첨부파일 설치 공통 모듈 추출

**Files:**
- Create: `src/utils/scaffold/attachFileInstaller.ts`
- Modify: `src/tools/egovAddAttachFileInfrastructure.ts`
- Test: `tests/scaffold/attachFileInstaller.test.ts`

**Interfaces:**
- Produces:
  - `AddAttachFileInfrastructureInputSchema`: 설치 모듈로 이동합니다. 도구 모듈은 같은 이름으로 재수출합니다.
  - `type AttachFileInstallOptions = z.infer<typeof AddAttachFileInfrastructureInputSchema>`
  - `defaultAttachFileInstallOptions(projectPath: string): AttachFileInstallOptions`: 스키마 `parse`로 기본값을 채웁니다.
  - `planAttachFileInfra(options: AttachFileInstallOptions): Promise<AttachFilePlan>`: 파일을 쓰지 않습니다. prefix+cipers 검증, 스택 감지, 충돌 거부, 자체 검증을 포함합니다.
  - `applyAttachFileInfra(plan: AttachFilePlan, journal: FileWriteJournal): Promise<AttachFileApplyResult>`: `withWriteRollback`은 호출하지 않습니다.
  - `summarizeAttachFileInstall(plan: AttachFilePlan, result: AttachFileApplyResult): string[]`: 생성 파일 수, 파일 저장 경로, HSQL 시드 처리 결과를 담습니다. `fallbackCreate`이면 기존 도구의 수동 머지 안내를 포함합니다.

- [ ] **Step 1: 실패하는 테스트 작성**

5.0 Boot 프로젝트를 `generateScaffoldProject`로 임시 디렉터리에 만들고 다음을 검증합니다.

```ts
it("plan 은 파일을 쓰지 않는다", async () => {
  const before = await listAllFiles(projectDir);
  await planAttachFileInfra(defaultAttachFileInstallOptions(projectDir));
  expect(await listAllFiles(projectDir)).toEqual(before);
});
it("apply 후 인프라가 감지된다", async () => {
  const plan = await planAttachFileInfra(defaultAttachFileInstallOptions(projectDir));
  await applyAttachFileInfra(plan, new FileWriteJournal());
  expect(detectAttachFileInfra(projectDir).present).toBe(true);
});
it("저널 롤백으로 설치 전 상태가 복원된다", async () => {
  const seedBefore = await fs.readFile(seedPath, "utf-8");
  const journal = new FileWriteJournal();
  await applyAttachFileInfra(await planAttachFileInfra(defaultAttachFileInstallOptions(projectDir)), journal);
  await journal.rollback();
  expect(detectAttachFileInfra(projectDir).present).toBe(false);
  expect(await fs.readFile(seedPath, "utf-8")).toBe(seedBefore);
});
it("다른 내용의 인프라 파일이 있으면 plan 이 거부한다", async () => {
  await fs.outputFile(attachConfigPath, "// different");
  await expect(planAttachFileInfra(defaultAttachFileInstallOptions(projectDir))).rejects.toThrow(/파일 충돌/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/scaffold/attachFileInstaller.test.ts`
Expected: FAIL (`attachFileInstaller.js` 모듈 없음)

- [ ] **Step 3: 설치 모듈 구현**

`egovAddAttachFileInfrastructure` 함수의 입력 검증 이후 쓰기 전까지를 `planAttachFileInfra`로, 쓰기 단계를 `applyAttachFileInfra`로 옮깁니다. 관련 타입과 내부 함수(`manifestForStack`, `planHsqlSeedMerge` 등)도 함께 옮깁니다. 도구 함수는 입력 검증, plan, `withWriteRollback` 안의 apply, 기존 결과 메시지 구성만 남기며, 기존 메시지 문구는 유지합니다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: 신규 테스트와 기존 전체 테스트 PASS, 골든 파일 변경 없음

- [ ] **Step 5: 커밋**

```bash
git add src/utils/scaffold/attachFileInstaller.ts src/tools/egovAddAttachFileInfrastructure.ts tests/scaffold/attachFileInstaller.test.ts
git commit -m "refactor(codegen): 첨부파일 인프라 설치 로직을 계획·적용 공통 모듈로 분리"
```

### Task 2: `egov_add_entity` 인프라 자동 설치

**Files:**
- Create: `src/utils/scaffold/attachmentContext.ts`
- Modify: `src/tools/egovAddEntity.ts:492-513,529-541,571-580,621-632,761-780,819-820`
- Modify: `tests/scaffold/errorClassificationIntegration.test.ts:44-77`
- Test: `tests/scaffold/addEntityAutoInstallInfra.test.ts`

**Interfaces:**
- Consumes: Task 1의 `planAttachFileInfra`, `applyAttachFileInfra`, `summarizeAttachFileInstall`, `defaultAttachFileInstallOptions`
- Produces: `applyAttachmentContext(ctx: ScaffoldContext, opts: { attachmentFieldName: string; maxAttachmentCount: number }): void`. 템플릿 변수를 주입하고 `attributes`, `nonPkAttributes`, `searchableAttributes`에서 `ATCH_FILE_ID`를 제외합니다.

- [ ] **Step 1: 실패하는 테스트 작성**

5.0 Boot 프로젝트(엔티티 Board)에 `MEMBER_DDL`로 Member를 추가하는 기준으로 작성합니다.

```ts
it("인프라가 없으면 자동 설치하고 엔티티를 연결한다", async () => {
  const out = await egovAddEntity(memberArgs({ withAttachment: true }));
  expect(detectAttachFileInfra(projectDir).present).toBe(true);
  expect(out).toMatch(/첨부파일 인프라 자동 설치/);
  const seed = await fs.readFile(seedPath, "utf-8");
  expect(seed).toMatch(/COMTNFILE/);
  expect(seed).toMatch(/CREATE MEMORY TABLE MEMBER/);
});
it("인프라가 있으면 재설치하지 않는다", async () => {
  await egovAddAttachFileInfrastructure({ projectPath: projectDir });
  const out = await egovAddEntity(memberArgs({ withAttachment: true }));
  expect(out).not.toMatch(/첨부파일 인프라 자동 설치/);
});
it("엔티티 충돌로 거부되면 인프라를 쓰지 않는다", async () => {
  await egovAddEntity(memberArgs({ withAttachment: false }));
  await expect(egovAddEntity(memberArgs({ withAttachment: true }))).rejects.toThrow(/충돌로 거부/);
  expect(detectAttachFileInfra(projectDir).present).toBe(false);
});
it("PK 길이 부족으로 거부되면 인프라를 쓰지 않는다", async () => {
  await expect(egovAddEntity(memberArgs({ withAttachment: true, ddl: SHORT_PK_DDL }))).rejects.toThrow(/PK 컬럼 길이 부족/);
  expect(detectAttachFileInfra(projectDir).present).toBe(false);
});
it("엔티티 파일 쓰기가 실패하면 인프라도 복원한다", async () => {
  await fs.outputFile(/* templates/manifests/boot50.json 의 Member 컨트롤러 출력 경로의 상위 디렉터리 */ blockedParent, "");
  await expect(egovAddEntity(memberArgs({ withAttachment: true }))).rejects.toThrow(/조치 후 재시도 가능/);
  expect(detectAttachFileInfra(projectDir).present).toBe(false);
});
it("인프라가 없는 4.3 프로젝트는 거부한다", async () => {
  await expect(egovAddEntity(memberArgs43({ withAttachment: true }))).rejects.toThrow(/5\.0 Boot 만 지원/);
});
it("재호출해도 시드에 COMTNFILE 이 중복되지 않는다", async () => {
  await egovAddEntity(memberArgs({ withAttachment: true }));
  const out = await egovAddEntity(memberArgs({ withAttachment: true }));
  expect(out).toMatch(/변경 사항 없음/);
  const seed = await fs.readFile(seedPath, "utf-8");
  expect(seed.match(/CREATE MEMORY TABLE COMTNFILE\b/gi)).toHaveLength(1);
});
it("일부 인프라 파일이 동일 내용으로 있으면 나머지만 설치한다", async () => {
  await egovAddAttachFileInfrastructure({ projectPath: projectDir });
  await fs.remove(attachConfigPath);
  await egovAddEntity(memberArgs({ withAttachment: true }));
  expect(detectAttachFileInfra(projectDir).present).toBe(true);
});
it("엔티티 파일이 동일하고 인프라만 없으면 인프라를 설치한다", async () => {
  await egovAddEntity(memberArgs({ withAttachment: true }));
  await removeInfraFiles(projectDir);
  const out = await egovAddEntity(memberArgs({ withAttachment: true }));
  expect(detectAttachFileInfra(projectDir).present).toBe(true);
  expect(out).toMatch(/첨부파일 인프라 자동 설치/);
});
it("시드 후보가 2개이면 fallback 안내를 응답에 포함한다", async () => {
  await fs.outputFile(path.join(projectDir, "src/main/resources/db/extra.sql"), "");
  const out = await egovAddEntity(memberArgs({ withAttachment: true }));
  expect(out).toMatch(/HSQL 시드 \(fallback\)/);
});
```

`errorClassificationIntegration.test.ts`의 인프라 미설치 거부 테스트는 4.3 Boot 프로젝트에서 `NON_RETRYABLE_PREFIX`와 `5.0 Boot 만 지원`을 검증하도록 바꿉니다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/scaffold/addEntityAutoInstallInfra.test.ts`
Expected: FAIL (현재는 인프라 미설치 시 거부)

- [ ] **Step 3: `applyAttachmentContext` 추출과 자동 설치 구현**

571~580행과 621~632행을 `applyAttachmentContext`로 옮깁니다. 529~541행은 `detectAttachFileInfra`가 `present: false`일 때 `planAttachFileInfra`로 계획만 만들도록 변경합니다. `writeRenderedEntityFiles`는 호출자의 저널을 받도록 바꾸고, 819~820행에서 하나의 `withWriteRollback` 안에 인프라 적용과 엔티티 쓰기를 순서대로 넣습니다. 761~780행의 멱등 경로는 인프라 계획이 있으면 먼저 적용하고 응답에 포함합니다. 결과 메시지에는 `🧩 첨부파일 인프라 자동 설치:` 머리글과 `summarizeAttachFileInstall` 결과를 추가합니다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS, 골든 파일 변경 없음

- [ ] **Step 5: 커밋**

```bash
git add src/utils/scaffold/attachmentContext.ts src/tools/egovAddEntity.ts tests/scaffold/addEntityAutoInstallInfra.test.ts tests/scaffold/errorClassificationIntegration.test.ts
git commit -m "feat(codegen): egov_add_entity 가 withAttachment 호출 시 첨부파일 인프라를 자동 설치"
```

### Task 3: `egov_scaffold_project`의 `withAttachment`

**Files:**
- Modify: `src/utils/scaffold/scaffoldGenerator.ts:16-32,356`
- Modify: `src/tools/egovScaffoldProject.ts:24-72,104-113,187-194`
- Test: `tests/scaffold/scaffoldWithAttachment.test.ts`

**Interfaces:**
- Consumes: Task 1의 설치 함수, Task 2의 `applyAttachmentContext`
- Produces: `ScaffoldParams.withAttachment?: boolean`, `ScaffoldInputSchema.withAttachment: z.boolean().optional().default(false)`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it("true 이면 인프라를 설치하고 첫 엔티티를 연결한다", async () => {
  const out = await egovScaffoldProject(boardArgs({ withAttachment: true }));
  expect(detectAttachFileInfra(projectDir).present).toBe(true);
  expect(await readController()).toMatch(/MultipartHttpServletRequest/);
  expect(await readRegisterView()).toMatch(/name="file_1"/);
  const seed = await readSeed();
  expect(seed).toMatch(/COMTNFILE/);
  expect(seed).toMatch(/ATCH_FILE_ID\s+CHAR\(20\)/);
  expect(out).toMatch(/첨부파일 인프라/);
});
it.each([["boot", "4.3"], ["war", "4.3"]])("%s %s + true 는 거부한다", async (projectType, stackVersion) => {
  await expect(egovScaffoldProject(boardArgs({ withAttachment: true, projectType, stackVersion }))).rejects.toThrow(/5\.0 Boot/);
});
it("DDL 의 ATCH_FILE_ID 는 입력 필드와 중복 컬럼을 만들지 않는다", async () => {
  await egovScaffoldProject(boardArgs({ withAttachment: true, ddl: DDL_WITH_ATCH_FILE_ID }));
  expect(await readRegisterView()).not.toMatch(/th:field="\*\{atchFileId\}"/);
  expect((await readSeed()).match(/ATCH_FILE_ID\s+CHAR/g)).toHaveLength(1);
});
it.each([["복합 PK", COMPOSITE_PK_DDL], ["FK", FK_DDL]])("%s 엔티티의 시드 DDL 이 유효하다", async (_n, ddl) => {
  await egovScaffoldProject(boardArgs({ withAttachment: true, ddl }));
  const seed = await readSeed();
  expect(seed).not.toMatch(/,\s*\)/);
  expect(seed).toMatch(/,\s*\n\s*ATCH_FILE_ID/);
});
it("설치 실패 시 복구 방법을 안내한다", async () => {
  await fs.outputFile(attachConfigPath, "// different");
  await expect(egovScaffoldProject(boardArgs({ withAttachment: true }))).rejects.toThrow(/^\[조치 후 재시도 가능\].*egov_add_attach_file_infrastructure/s);
});
```

`attachConfigPath`는 `src/main/java/egovframework/example/config/EgovConfigAttachFile.java`입니다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/scaffold/scaffoldWithAttachment.test.ts`
Expected: FAIL (인프라 미설치)

- [ ] **Step 3: 구현**

`generateScaffoldProject`는 `params.withAttachment`가 참이면 `buildContext` 직후 `applyAttachmentContext(ctx, { attachmentFieldName: "atchFileId", maxAttachmentCount: 0 })`을 호출합니다. 도구 스키마의 `superRefine`은 `withAttachment === true`이면서 5.0 Boot가 아니면 `eGovFrame 5.0 Boot` 문구로 거부합니다. 도구 함수는 생성 후 plan, `withWriteRollback` 안의 apply를 실행합니다. 실패하면 `retryAfterAction`으로 "프로젝트는 생성되었으나 첨부파일 인프라 설치에 실패했으며, 원인을 해결한 뒤 `egov_add_attach_file_infrastructure`를 호출하면 복구된다"고 안내합니다. 바깥 `catch`는 메시지가 `RETRY_AFTER_ACTION_PREFIX`로 시작하면 다시 감싸지 않고 그대로 던집니다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS, 골든 파일 변경 없음

- [ ] **Step 5: 커밋**

```bash
git add src/utils/scaffold/scaffoldGenerator.ts src/tools/egovScaffoldProject.ts tests/scaffold/scaffoldWithAttachment.test.ts
git commit -m "feat(codegen): egov_scaffold_project 에 withAttachment 옵션 추가"
```

### Task 4: 사용자 확인 모듈과 핸들러 연결

**Files:**
- Create: `src/utils/scaffold/attachmentDecision.ts`
- Modify: `src/index.ts:37-81,135-174`
- Test: `tests/scaffold/attachmentDecision.test.ts`, `tests/elicitationIntegration.test.ts`

**Interfaces:**
- Consumes: `detectProjectStack`, `detectAttachFileInfra`, `retryAfterAction`, `completionFooter`
- Produces:
  - `ATTACHMENT_ELICIT_TIMEOUT_MS = 120_000`
  - `type AttachmentDecision = { kind: "value"; value: boolean } | { kind: "needsUserDecision" } | { kind: "cancelled" }`
  - `resolveAttachmentDecision(args: { server: Pick<Server, "getClientCapabilities" | "elicitInput">; provided: boolean | undefined; supported: boolean; message: string }): Promise<AttachmentDecision>`
  - `describeScaffoldAttachmentPrompt(args: { projectType?: "boot" | "war"; stackVersion?: "4.3" | "5.0" }): { supported: boolean; message: string }`
  - `describeAddEntityAttachmentPrompt(projectPath: string, entityName: string): { supported: boolean; message: string }`
  - `attachmentDecisionRequiredError(): Error`
  - `attachmentCancelledMessage(): string`

- [ ] **Step 1: 실패하는 단위 테스트 작성**

`server` 스텁으로 다음 표를 `it.each`로 검증합니다.

| provided | supported | capabilities | elicitInput | 기대 결과 | elicitInput 호출 |
|---|---|---|---|---|---|
| `true` | `true` | form | - | `value: true` | 없음 |
| `false` | `true` | form | - | `value: false` | 없음 |
| `undefined` | `false` | form | - | `value: false` | 없음 |
| `undefined` | `true` | 없음 | - | `needsUserDecision` | 없음 |
| `undefined` | `true` | form | accept true | `value: true` | 1회 |
| `undefined` | `true` | form | accept false | `value: false` | 1회 |
| `undefined` | `true` | form | decline | `value: false` | 1회 |
| `undefined` | `true` | form | cancel | `cancelled` | 1회 |
| `undefined` | `true` | form | accept, content 없음 | `needsUserDecision` | 1회 |
| `undefined` | `true` | form | reject | `needsUserDecision` | 1회 |

호출 시 두 번째 인자가 `{ timeout: 120000 }`인지도 검증합니다. `describeAddEntityAttachmentPrompt`는 5.0 Boot에서 인프라 유무에 따라 설계 문서 5절의 두 문구를 반환하고, 4.3 Boot와 비표준 경로에서 `supported: false`를 반환하는지 검증합니다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/scaffold/attachmentDecision.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: `attachmentDecision.ts` 구현**

요청 스키마는 `{ type: "object", properties: { withAttachment: { type: "boolean", title: "첨부파일 포함" } }, required: ["withAttachment"] }`입니다. 질문 문구는 설계 문서 5절을 그대로 사용합니다.

- [ ] **Step 4: 단위 테스트 통과 확인**

Run: `npx vitest run tests/scaffold/attachmentDecision.test.ts`
Expected: PASS

- [ ] **Step 5: 실패하는 프로토콜 통합 테스트 작성**

`build/index.js`를 `StdioClientTransport`로 실행합니다.

```ts
it("Elicitation 미지원: 파일 없이 재호출을 요청한다", async () => {
  const res = await plainClient.callTool({ name: "egov_scaffold_project", arguments: args });
  expect(res.isError).toBe(true);
  expect(text(res)).toMatch(/withAttachment/);
  expect(await fs.pathExists(projectDir)).toBe(false);
});
it("accept true: 인프라까지 설치한다", async () => {
  const res = await elicitClient({ action: "accept", content: { withAttachment: true } }).callTool(call);
  expect(res.isError).toBeFalsy();
  expect(detectAttachFileInfra(projectDir).present).toBe(true);
});
it("decline: 첨부파일 없이 생성한다", async () => { /* detect present false, 프로젝트 존재 */ });
it("cancel: 파일 없이 정상 응답한다", async () => {
  const res = await elicitClient({ action: "cancel" }).callTool(call);
  expect(res.isError).toBeFalsy();
  expect(await fs.pathExists(projectDir)).toBe(false);
});
it("인자를 명시하면 질문하지 않는다", async () => { /* handler 호출 횟수 0 */ });
it("egov_add_entity 도 인프라 없음 문구로 질문한다", async () => { /* message 에 '함께 설치' 포함, accept true 후 present true */ });
```

- [ ] **Step 6: `src/index.ts` 연결**

두 도구의 raw shape에 `withAttachment: z.boolean().optional()`을 설계 문서 4절 내용의 `.describe()`와 함께 둡니다(`egov_add_entity`는 설명만 수정). 핸들러는 `try` 안에서 prompt 설명, `resolveAttachmentDecision({ server: server.server, ... })`을 순서대로 수행합니다. `needsUserDecision`이면 `attachmentDecisionRequiredError()`를 던지고, `cancelled`이면 `attachmentCancelledMessage()`를 `isError` 없이 반환하며, `value`이면 `{ ...args, withAttachment: value }`로 도구 함수를 호출합니다.

- [ ] **Step 7: 통합 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS (`tests/toolRegistration.test.ts` 포함)

- [ ] **Step 8: 커밋**

```bash
git add src/utils/scaffold/attachmentDecision.ts src/index.ts tests/scaffold/attachmentDecision.test.ts tests/elicitationIntegration.test.ts
git commit -m "feat(codegen): 첨부파일 포함 여부를 MCP Elicitation 으로 사용자에게 확인"
```

### Task 5: 실제 실행 검증과 문서 갱신

**Files:**
- Modify: `src/index.ts:96` (`egov_add_entity` 설명), `README.md`, `docs/design/attach-file-tool-schema.md`

- [ ] **Step 1: 스캐폴드 경로 빌드·기동**

임시 디렉터리에 `egovScaffoldProject`를 `withAttachment: true`로 실행하고, 프로젝트에서 다음을 실행합니다.

Run: `mvn -q -DskipTests package && mvn spring-boot:run`
Expected: 빌드 성공, HSQL 시드 실행 오류 없이 기동

- [ ] **Step 2: 스캐폴드 경로 기능 확인**

브라우저로 등록 화면에서 파일을 업로드하고, 수정 화면의 기존 파일 목록과 다운로드, 파일 추가 수정, 삭제를 확인합니다.
Expected: 각 동작 성공, 다운로드 내용이 업로드 파일과 일치, 삭제 후 `COMTNFILE` 관련 목록에서 제거

- [ ] **Step 3: 엔티티 추가 경로 검증**

`withAttachment: false`로 스캐폴드한 프로젝트에 `egovAddEntity`를 `withAttachment: true`와 기본 인자로 실행하고 Step 1~2를 반복합니다.
Expected: 같은 시드에 인프라 DDL과 엔티티 DDL이 들어간 상태로 기동하고 모든 동작 성공

- [ ] **Step 4: 문서 갱신**

`egov_add_entity` 설명의 공용 설정 문구에 `withAttachment=true`의 인프라 설치 예외를 명시합니다. `README.md`와 `docs/design/attach-file-tool-schema.md`에서 사전 설치를 전제한 설명과 호출 순서를 새 동작으로 수정하고, Elicitation 미지원 시 흐름을 추가합니다.

- [ ] **Step 5: 전체 테스트 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/index.ts README.md docs/design/attach-file-tool-schema.md docs/superpowers
git commit -m "docs(codegen): 첨부파일 통합 흐름과 사용자 확인 동작 문서화"
```
