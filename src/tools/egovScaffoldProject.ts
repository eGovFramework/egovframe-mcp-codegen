/**
 * Tool: egov_scaffold_project
 *
 * DDL 한 줄에서 eGovFrame 5.0/4.3 Boot 또는 WAR 프로젝트를 완전 생성합니다.
 */

import { z } from "zod";
import { generateScaffoldProject } from "../utils/scaffold/scaffoldGenerator.js";
import {
  formatNormalizationReport,
  normalizeDdl,
  type NormalizationReport,
} from "../utils/ddlNormalizer.js";

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
      .min(1, "projectName 은 필수입니다.")
      .regex(
        /^[a-z][a-z0-9-]*$/,
        "projectName 은 소문자로 시작하며 영숫자와 '-' 만 허용합니다 (예: 'board-app').",
      ),
    packageName: z
      .string()
      .min(1, "packageName 은 필수입니다.")
      .regex(
        /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/,
        "packageName 은 Java 패키지 규약을 따라야 합니다 (예: 'egovframework.example.board').",
      ),
    outputPath: z.string().min(1, "outputPath 는 필수입니다."),
    entityName: z
      .string()
      .min(1, "entityName 은 필수입니다.")
      .regex(
        /^[A-Z][a-zA-Z0-9]*$/,
        "entityName 은 PascalCase 여야 합니다 (예: 'Board', 'Article').",
      ),
    ddl: z
      .string()
      .min(1, "ddl 은 필수입니다.")
      .refine(
        (v) => /CREATE\s+(?:MEMORY\s+)?TABLE/i.test(v),
        "ddl 은 CREATE TABLE 문이어야 합니다.",
      ),
    description: z.string().optional().default(""),
    projectType: z.enum(["boot", "war"]).optional().default("boot"),
    stackVersion: z.enum(["4.3", "5.0"]).optional().default("5.0"),
    /**
     * scaffold 진입 전 DDL 정규화(케이스/공백/인용부호) 수행 여부 (기본 true).
     * 의미를 바꾸지 않는 보수적 변환만 수행하므로 끄지 않는 것을 권장한다.
     */
    normalizeDdl: z.boolean().optional().default(true),
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
    throw new Error(formatZodError(parsed.error));
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
    });

    const result = JSON.parse(resultJson);

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

    // 4) 정규화 보고서 첨부 (변경/경고가 있을 때만)
    if (normalizationReport) {
      const summary = formatNormalizationReport(normalizationReport);
      if (summary) {
        lines.push(``, `---`, `🧹 DDL 정규화 결과:`, ``, summary);
      }
    }

    return lines.join("\n");
  } catch (error) {
    console.error("Error in egovScaffoldProject:", error);
    throw new Error(
      `프로젝트 생성 실패: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
