/**
 * 마이그레이션 SQL 처리 전략 결정 헬퍼.
 *
 * `src/main/resources/db/` 디렉터리에 있는 사용자 시드 SQL 후보를 스캔해서
 *   - 정확히 1개면 그 끝에 자동 append (`appendToSeed`)
 *   - 0개이거나 2개 이상이면 별도 파일로 떨어뜨리는 fallback (`separateFile`)
 *
 * 호출자:
 *   - egov_add_entity: 엔티티 CRUD 마이그레이션 (`add-<entity>-tables.sql`)
 *   - egov_add_attach_file_infrastructure: 첨부파일 인프라 HSQL 시드 (`attach-file.sql`)
 *
 * HSQL 임베디드 부트는 `EgovConfigDatasource` 가 `.addScript()` 로 *단일* 시드만
 * 로드하므로, 시드가 1개일 때 그 안에 머지해야 부팅 시 자동 적용된다.
 *
 * 시드 후보 스캔 규칙:
 *   - 대상: `src/main/resources/db/*.sql`
 *   - 제외: 이전 마이그레이션 파일 패턴 (`add-*-tables.sql`, `attach-file.sql`)
 *   - 추가 제외: 이번 호출이 만들 fallback 출력의 파일명 (혹시 모를 동명 회피)
 */

import * as path from "node:path";
import fs from "fs-extra";

export type MigrationStrategyDecision =
  | { strategy: "separateFile"; fallbackReason?: string }
  | { strategy: "appendToSeed"; seedFileAbsPath: string };

const KNOWN_MIGRATION_OUTPUT_PATTERNS: RegExp[] = [
  /^add-.+-tables\.sql$/i,
  /^attach-file\.sql$/i,
];

function isPreviousMigrationName(name: string): boolean {
  return KNOWN_MIGRATION_OUTPUT_PATTERNS.some((re) => re.test(name));
}

export async function decideMigrationStrategy(args: {
  projectDir: string;
  /** false 면 무조건 separateFile (사용자가 자동 적용을 끈 경우). */
  autoApplyMigration: boolean;
  /** 이번 호출이 만들 separateFile 출력 경로 (프로젝트 상대). 시드 후보에서 제외하기 위해 사용. */
  newMigrationOutput: string;
}): Promise<MigrationStrategyDecision> {
  if (!args.autoApplyMigration) return { strategy: "separateFile" };

  const dbDir = path.join(args.projectDir, "src/main/resources/db");
  if (!(await fs.pathExists(dbDir))) {
    return {
      strategy: "separateFile",
      fallbackReason:
        "src/main/resources/db/ 디렉터리가 존재하지 않아 시드 파일을 찾을 수 없습니다.",
    };
  }

  const newMigrationBaseName = path.basename(args.newMigrationOutput);

  const entries = await fs.readdir(dbDir);
  const seedCandidates = entries.filter(
    (name) =>
      name.toLowerCase().endsWith(".sql") &&
      !isPreviousMigrationName(name) &&
      name !== newMigrationBaseName,
  );

  if (seedCandidates.length === 1) {
    return {
      strategy: "appendToSeed",
      seedFileAbsPath: path.join(dbDir, seedCandidates[0]),
    };
  }

  return {
    strategy: "separateFile",
    fallbackReason:
      seedCandidates.length === 0
        ? "src/main/resources/db/ 에 사용자 시드 SQL 파일이 발견되지 않아 자동 append 대상이 없습니다."
        : `src/main/resources/db/ 에 사용자 시드 SQL 후보가 ${seedCandidates.length}개 (${seedCandidates.join(", ")}) 발견되어 어느 파일에 append 할지 결정할 수 없습니다. 정확히 1개일 때만 자동 적용됩니다.`,
  };
}
