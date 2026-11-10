/**
 * Tool: egov_add_attach_file_infrastructure
 *
 * 이미 생성된 eGovFrame 프로젝트에 표준 첨부파일 인프라(`atchFileId` + COMTNFILE/COMTNFILEDETAIL
 * 2테이블 모델 + EgovFileMngService/Util + EgovConfigAttachFile Bean 등) 를 1회 설치한다.
 *
 * 설계 결정 (egov_add_entity 와 동일 원칙)
 * --------------------------------------
 * - **projectType/stackVersion 은 입력받지 않는다.** pom.xml 에서 자동 감지.
 * - **충돌 시 거부.** force/overwrite 옵션 없음.
 * - **skipIfPresent (기본 true)**: 모든 출력 파일이 *내용까지 동일하게* 이미 존재하면 no-op + 성공.
 *   하나라도 다른 내용이거나, append 위치에 다른 값으로 key 가 박혀 있으면 거부.
 * - **부수 효과 제한.** 8개 Java 파일 + 1개 mapper XML + 7개 dialect별 DDL + 2개 properties append.
 *   pom.xml / sql-mapper-config.xml 등은 건드리지 않음.
 *
 * 현재 한계
 * ------------
 * - **Boot(5.0, 4.3) 만 지원.** WAR 은 다음 페이즈.
 * - 매니페스트 mode `append-fallback` 은 본 도구에서는 사용 안 함 (운영 DB DDL 은 `create` 로
 *   `db/migrations/<dialect>/` 에 fan-out). HSQL 임베디드 시드 머지는 매니페스트 외부에서
 *   `decideMigrationStrategy` + `planHsqlSeedMerge` 로 별도 처리 — 시드 파일명이 프로젝트마다
 *   다르고(`<firstEntity>db.sql`), HSQL 부트는 단일 시드만 .addScript() 로 로드하기 때문.
 */

import { z } from "zod";

import { FileWriteJournal, withWriteRollback } from "../utils/scaffold/writeRollback.js";
import { completionFooter, nonRetryable } from "../utils/scaffold/toolMessages.js";
import {
  AddAttachFileInfrastructureInputSchema,
  applyAttachFileInfra,
  downloadUrlProtectionNote,
  hsqlSeedSummaryLines,
  planAttachFileInfra,
} from "../utils/scaffold/attachFileInstaller.js";

export {
  AddAttachFileInfrastructureInputSchema,
  type AddAttachFileInfrastructureInput,
} from "../utils/scaffold/attachFileInstaller.js";

function formatZodError(err: z.ZodError): string {
  const lines = err.issues.map((i) => {
    const p = i.path.length ? `${i.path.join(".")}: ` : "";
    return `  - ${p}${i.message}`;
  });
  return `입력 검증 실패:\n${lines.join("\n")}`;
}

export async function egovAddAttachFileInfrastructure(rawParams: unknown): Promise<string> {
  // 1) 입력 검증
  const parsed = AddAttachFileInfrastructureInputSchema.safeParse(rawParams);
  if (!parsed.success) {
    throw nonRetryable(formatZodError(parsed.error));
  }
  const params = parsed.data;

  // 2) 계획 (쓰기 없음) — 검증·스택 감지·충돌 거부·자체 검증
  const plan = await planAttachFileInfra(params);
  const { projectDir, detected, basePackage, fileStorePath } = plan;

  // 3) 적용 — create/append/HSQL 시드를 하나의 저널로 묶어, 쓰기 시작 후 OS 레벨 중간 실패
  //    (권한/디스크 풀) 시 이미 반영된 항목을 전부 원상 복구한다.
  const journal = new FileWriteJournal();
  const { filesCreated, filesSkipped, filesAppended, filesAppendSkipped, hsqlSeedResult } =
    await withWriteRollback(projectDir, journal, () => applyAttachFileInfra(plan, journal));

  // 9) 결과 메시지
  const egovLabel = detected.stackVersion === "5.0" ? "eGovFrame 5.0" : "eGovFrame 4.3";
  const kindLabel = detected.projectType === "war" ? "WAR" : "Spring Boot";

  const lines = [
    `✅ ${egovLabel} ${kindLabel} 프로젝트에 첨부파일 인프라 설치 완료!`,
    ``,
    `📁 프로젝트: ${projectDir}`,
    `🔎 감지된 스택: ${detected.reason}`,
    `📦 base package: ${basePackage}`,
    `🔐 atchFileId 채번: prefix="${params.idGnrPrefix}" + cipers=${params.idGnrCipers} (총 ${params.idGnrPrefix.length + params.idGnrCipers}자)`,
    `📂 파일 저장 경로: ${fileStorePath}`,
    ``,
    `📄 생성된 파일 (${filesCreated.length}):`,
    ...filesCreated.map((f) => `  - ${f}`),
  ];

  if (filesAppended.length > 0) {
    lines.push(``, `📝 속성 append (${filesAppended.length}):`);
    for (const a of filesAppended) {
      lines.push(`  - ${a.path}  (+ ${a.addedKeys.join(", ")})`);
    }
  }
  if (filesSkipped.length > 0) {
    lines.push(``, `⏭️  내용 동일로 skip (${filesSkipped.length}):`);
    for (const s of filesSkipped) {
      lines.push(`  - ${s}`);
    }
  }
  if (filesAppendSkipped.length > 0) {
    lines.push(``, `ℹ️  append 건너뜀:`);
    for (const s of filesAppendSkipped) {
      lines.push(`  - ${s.path}: ${s.reason}`);
    }
  }

  lines.push(...hsqlSeedSummaryLines(hsqlSeedResult));

  lines.push(
    ``,
    `다음 단계:`,
    `  1. ${fileStorePath} 디렉터리의 쓰기 권한을 확인하세요 (운영 배포 시 외부 마운트 권장).`,
    `     ⚠️  Globals.fileStorePath 는 절대로 src/main/resources/static, src/main/webapp 등 webroot 하위로`,
    `         지정하지 마세요 — EgovFileMngUtil 가 @PostConstruct 에서 거부합니다.`,
    `  2. 운영 DB 벤더에 맞는 DDL 을 적용하세요: src/main/resources/db/migrations/<dialect>/attach-file.sql`,
    `     (HSQL 임베디드용 DDL 은 위 시드 머지 결과를 참고하세요.)`,
    `  3. egov_add_entity 호출 시 첨부 와이어드 컨트롤러를 받으려면 withAttachment 옵션을 켜세요.`,
    `  4. ${downloadUrlProtectionNote(detected.stackVersion)}  (GET /cmm/fms/FileDown.do?atchFileId=&fileSn=)`,
    ``,
    `🔐 보안 정책 (자동 적용됨):`,
    `  - 실행 가능 확장자 차단 (EXE/BAT/SH/JSP/PHP/SVG/HTML/JAR 등) — EgovFileMngUtil.BLOCKED_EXTENSIONS`,
    `  - 저장 경로 webroot/classpath 겹침 검증 — 부팅 시 @PostConstruct 로 거부`,
    `  - 차단/사이즈초과 시 EgovFileUploadExceptionAdvice 가 referer 로 redirect + flash errorMessage`,
    ``,
    `🪧 화면에 에러 메시지를 보여주려면 (기존 첨부 화면들에 1회만):`,
    `   List/Register/Update 화면의 콘텐츠 영역 상단에 다음 한 줄을 추가하세요 —`,
    `     <th:block th:replace="~{_fragments/alertMessages :: messages}"></th:block>`,
    `   메시지 키는 message-common.properties 의 fail.common.fileSize.exceeded / fail.common.fileType.blocked`,
    `   가 자동 append 되었습니다. 추가 키가 필요하면 같은 파일에 직접 추가하세요.`,
    ``,
    `✅ 자체 검증 통과 (검사한 파일 ${plan.validatedFileCount}개)`,
  );

  return lines.join("\n") + completionFooter();
}
