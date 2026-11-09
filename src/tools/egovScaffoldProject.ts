/**
 * Tool: egov_scaffold_project
 *
 * DDL 한 줄에서 eGovFrame 5.0/4.3 Boot 또는 WAR 프로젝트를 완전 생성합니다.
 */

import path from "node:path";
import { z } from "zod";
import { generateScaffoldProject } from "../utils/scaffold/scaffoldGenerator.js";
import {
  formatNormalizationReport,
  normalizeDdl,
  type NormalizationReport,
} from "../utils/ddlNormalizer.js";
import {
  completionFooter,
  nonRetryable,
  retryAfterAction,
  RETRY_AFTER_ACTION_PREFIX,
} from "../utils/scaffold/toolMessages.js";
import {
  applyAttachFileInfra,
  defaultAttachFileInstallOptions,
  planAttachFileInfra,
  summarizeAttachFileInstall,
} from "../utils/scaffold/attachFileInstaller.js";
import { FileWriteJournal, withWriteRollback } from "../utils/scaffold/writeRollback.js";

/**
 * 입력 검증 스키마.
 *
 * - `projectName`: Maven artifactId 규약(소문자 시작, 영숫자+`-`)
 * - `packageName`: Java 패키지 명명 규약(점 구분, 식별자 시작 영문)
 * - `entityName`: PascalCase
 * - `projectType` / `stackVersion`: enum, 모순 조합 차단(WAR + 5.0 금지)
 */
export const ScaffoldInputSchema = z
  .object({
    projectName: z
      .string()
      .min(1, { error: "projectName 은 필수입니다." })
      .regex(/^[a-z][a-z0-9-]*$/, {
        error:
          "projectName 은 소문자로 시작하며 영숫자와 '-' 만 허용합니다 (예: 'board-app').",
      }),
    packageName: z
      .string()
      .min(1, { error: "packageName 은 필수입니다." })
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/, {
        error:
          "packageName 은 Java 패키지 규약을 따라야 합니다 (예: 'egovframework.example.board').",
      }),
    outputPath: z.string().min(1, { error: "outputPath 는 필수입니다." }),
    entityName: z
      .string()
      .min(1, { error: "entityName 은 필수입니다." })
      .regex(/^[A-Z][a-zA-Z0-9]*$/, {
        error: "entityName 은 PascalCase 여야 합니다 (예: 'Board', 'Article').",
      }),
    ddl: z
      .string()
      .min(1, { error: "ddl 은 필수입니다." })
      .refine((v) => /CREATE\s+(?:MEMORY\s+)?TABLE/i.test(v), {
        error: "ddl 은 CREATE TABLE 문이어야 합니다.",
      }),
    description: z.string().optional().default(""),
    projectType: z.enum(["boot", "war"]).optional().default("boot"),
    stackVersion: z.enum(["4.3", "5.0"]).optional().default("5.0"),
    /**
     * scaffold 진입 전 DDL 정규화(케이스/공백/인용부호) 수행 여부 (기본 true).
     * 의미를 바꾸지 않는 보수적 변환만 수행하므로 끄지 않는 것을 권장한다.
     */
    normalizeDdl: z.boolean().optional().default(true),
    /**
     * true 이면 첫 엔티티를 첨부파일 연결 형태로 만들고 첨부파일 인프라를 함께 설치한다.
     * eGovFrame 5.0 Boot 에서만 지원한다.
     */
    withAttachment: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "true 이면 첫 엔티티에 첨부파일 업로드/다운로드를 연결하고 첨부파일 인프라를 함께 설치합니다 (eGovFrame 5.0 Boot 전용).",
      ),
  })
  .superRefine((v, ctx) => {
    // WAR 는 4.3 만 지원한다. 모순 조합을 차단한다.
    if (v.projectType === "war" && v.stackVersion === "5.0") {
      ctx.addIssue({
        code: "custom",
        path: ["stackVersion"],
        message:
          "projectType='war' 는 stackVersion='4.3' 만 지원합니다. WAR + 5.0 조합은 허용되지 않습니다.",
      });
    }
    if (v.withAttachment && !(v.projectType === "boot" && v.stackVersion === "5.0")) {
      ctx.addIssue({
        code: "custom",
        path: ["withAttachment"],
        message:
          "withAttachment=true 는 eGovFrame 5.0 Boot(projectType='boot', stackVersion='5.0') 만 지원합니다.",
      });
    }
  });

export type ScaffoldInput = z.infer<typeof ScaffoldInputSchema>;

function formatZodError(err: z.ZodError): string {
  const lines = err.issues.map((i) => {
    const path = i.path.length ? `${i.path.join(".")}: ` : "";
    return `  - ${path}${i.message}`;
  });
  return `입력 검증 실패:\n${lines.join("\n")}`;
}

export async function egovScaffoldProject(rawParams: unknown): Promise<string> {
  // 1) 입력 검증 (Zod)
  const parsed = ScaffoldInputSchema.safeParse(rawParams);
  if (!parsed.success) {
    throw nonRetryable(formatZodError(parsed.error));
  }
  const params = parsed.data;

  try {
    // 2) DDL 정규화 (옵션, 기본 on)
    let ddlForGenerator = params.ddl;
    let normalizationReport: NormalizationReport | undefined;
    if (params.normalizeDdl) {
      const r = normalizeDdl(params.ddl);
      ddlForGenerator = r.normalizedDdl;
      normalizationReport = r.report;
    }

    // 3) 프로젝트 생성
    const resultJson = await generateScaffoldProject({
      projectName: params.projectName,
      packageName: params.packageName,
      outputPath: params.outputPath,
      entityName: params.entityName,
      ddl: ddlForGenerator,
      description: params.description,
      projectType: params.projectType,
      stackVersion: params.stackVersion,
      withAttachment: params.withAttachment,
    });

    const result = JSON.parse(resultJson);

    // 3-a) 첨부파일 인프라 설치 — 프로젝트는 이미 생성된 상태이므로 실패 시 복구 방법을 안내한다.
    let attachInfraLines: string[] = [];
    if (params.withAttachment) {
      try {
        const plan = await planAttachFileInfra(defaultAttachFileInstallOptions(result.projectDir));
        const journal = new FileWriteJournal();
        const applied = await withWriteRollback(result.projectDir, journal, () =>
          applyAttachFileInfra(plan, journal),
        );
        attachInfraLines = [``, `🧩 첨부파일 인프라 설치:`, ...summarizeAttachFileInstall(plan, applied)];
      } catch (infraError) {
        const rawCause = infraError instanceof Error ? infraError.message : String(infraError);
        // 절대 경로 노출 방지 + 이미 붙은 재시도 프리픽스 중첩 방지.
        const cause = rawCause
          .split(path.resolve(result.projectDir))
          .join("<projectDir>")
          .replace(RETRY_AFTER_ACTION_PREFIX, "")
          .trim();
        throw retryAfterAction(
          `프로젝트는 생성되었으나 첨부파일 인프라 설치에 실패했습니다. ` +
            `원인을 해결한 뒤 egov_add_attach_file_infrastructure 를 호출하면 복구됩니다.\n${cause}`,
        );
      }
    }

    const isWar = result.projectType === "war";
    const isBoot50 = result.stackVersion === "5.0";
    const egovLabel = isBoot50 ? "eGovFrame 5.0" : "eGovFrame 4.3";

    const lines = [
      `✅ ${egovLabel} ${isWar ? "WAR" : "Spring Boot"} 프로젝트 생성 완료!`,
      ``,
      `📁 프로젝트: ${result.projectDir}`,
      `📦 ${result.frameworkVersion} (${egovLabel} 표준)`,
      `🏷️  엔티티: ${result.entityName} (테이블: ${result.tableName})`,
      `📄 생성된 파일 수: ${result.fileCount}`,
      `🔧 타입: ${
        isWar
          ? "WAR (JSP + XML Spring Config + Tomcat 배포)"
          : isBoot50
          ? "Spring Boot 3 JAR (Thymeleaf Spring6 + Jakarta + KRDS)"
          : "Spring Boot JAR (Thymeleaf + Java Config)"
      }`,
      ``,
      `생성된 파일:`,
      ...result.files.map((f: string) => `  - ${f}`),
      ``,
      `다음 단계:`,
      `  1. cd ${result.projectDir}`,
      `  2. mvn clean package`,
    ];

    if (isWar) {
      lines.push(
        `  3. target/${result.projectDir.split("/").pop()}.war 를 Tomcat webapps/ 로 복사`,
        `  4. Tomcat 시작`,
        `  5. http://localhost:8080/${result.projectDir.split("/").pop()}/ 접속`,
      );
    } else {
      lines.push(`  3. mvn spring-boot:run`, `  4. http://localhost:8080/ 접속`);
    }

    if (isBoot50) {
      lines.push(
        ``,
        `🔐 CSRF 보호가 기본 활성입니다 — 이후 추가하는 POST 폼/fetch 는 CSRF 토큰` +
          `(hidden 필드 또는 meta 기반 헤더)을 포함해야 합니다. 토글: egov.security.csrf.` +
          ` 상세: 생성된 docs/egovframe-architecture.md 의 EgovConfigWebSecurity 섹션.`,
      );
    }

    lines.push(...attachInfraLines);

    // 4) DDL 파서 폴백 안내 — AST(MySQL) 파싱 실패로 legacy 정규식 파서가 쓰인 경우.
    //    산출물은 정상 생성되지만 입력 DDL 이 비표준일 수 있음을 사용자가 알아야 한다.
    if (result.ddlParserUsed === "legacy") {
      const warnings: string[] = Array.isArray(result.ddlWarnings) ? result.ddlWarnings : [];
      lines.push(
        ``,
        `⚠️  DDL 파서 폴백 안내:`,
        ...warnings.map((w) => `   - ${w}`),
        `   생성된 코드가 의도와 다르면 DDL 을 표준 MySQL 문법으로 정리한 뒤 다시 실행해 보세요.`,
      );
    }

    // 5) 정규화 보고서 첨부 (변경/경고가 있을 때만)
    if (normalizationReport) {
      const summary = formatNormalizationReport(normalizationReport);
      if (summary) {
        lines.push(``, `---`, `🧹 DDL 정규화 결과:`, ``, summary);
      }
    }

    // 6) 자체 검증 결과 안내 — scaffoldGenerator 가 쓰기 후 검증을 이미 통과했으므로(실패 시
    //    예외가 던져져 여기 도달하지 않는다) 검사한 파일 수만 보고한다.
    const selfValidatedFileCount =
      typeof result.selfValidatedFileCount === "number" ? result.selfValidatedFileCount : 0;
    lines.push(``, `✅ 자체 검증 통과 (검사한 파일 ${selfValidatedFileCount}개)`);

    return lines.join("\n") + completionFooter();
  } catch (error) {
    console.error("Error in egovScaffoldProject:", error);
    if (error instanceof Error && error.message.startsWith(RETRY_AFTER_ACTION_PREFIX)) {
      throw error;
    }
    throw new Error(
      `프로젝트 생성 실패: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
