import path from "node:path";
import * as fs from "fs-extra";
import { retryAfterAction } from "./toolMessages.js";

/**
 * 다중 파일 쓰기(생성/append)의 중간 실패 대비 롤백 저널.
 *
 * 사전 충돌 검사가 "쓰기 시작 전 원자성"(충돌 시 전량 미기록)을 보장하더라도,
 * 쓰기 루프가 시작된 뒤 OS 레벨 실패(권한/디스크 풀)가 나면 이미 쓰인 파일이
 * 남는다. 이 저널은 각 파일을 수정하기 직전의 원본 상태(존재 여부 + 내용)를
 * 기록해 두었다가, 실패 시 역순으로 복원한다 — 신규 파일은 삭제, 기존 파일은
 * 원본 내용 복원. (ensureDir 로 만들어진 빈 디렉터리는 복원 대상이 아니다 —
 * 빈 디렉터리 잔존은 무해하며, 삭제 시도가 오히려 다른 산출물을 건드릴 위험이 있다.)
 */

interface JournalEntry {
  absPath: string;
  existedBefore: boolean;
  originalContent?: string;
}

export interface RollbackOutcome {
  restoredCount: number;
  /** 복원에 실패한 파일의 절대 경로 목록 — 메시지 노출 시 상대 경로로 변환할 것. */
  failedPaths: string[];
}

export class FileWriteJournal {
  private entries: JournalEntry[] = [];

  /** absPath 를 생성/수정하기 직전에 호출해 원본 상태를 기록한다. */
  async recordBeforeWrite(absPath: string): Promise<void> {
    if (await fs.pathExists(absPath)) {
      this.entries.push({
        absPath,
        existedBefore: true,
        originalContent: await fs.readFile(absPath, "utf-8"),
      });
    } else {
      this.entries.push({ absPath, existedBefore: false });
    }
  }

  get recordedCount(): number {
    return this.entries.length;
  }

  /**
   * 기록 역순으로 원상 복구한다. 개별 복원 실패는 예외로 전파하지 않고 목록으로
   * 모아 반환한다 — 복구 중 2차 예외가 원인 에러를 가리면 안 되기 때문.
   */
  async rollback(): Promise<RollbackOutcome> {
    let restoredCount = 0;
    const failedPaths: string[] = [];
    for (const e of [...this.entries].reverse()) {
      try {
        if (e.existedBefore) {
          await fs.writeFile(e.absPath, e.originalContent ?? "", "utf-8");
        } else {
          await fs.remove(e.absPath);
        }
        restoredCount += 1;
      } catch {
        failedPaths.push(e.absPath);
      }
    }
    return { restoredCount, failedPaths };
  }
}

/** 롤백 결과를 사용자 안내 문구로 변환한다 (경로는 프로젝트 상대 경로로만 노출). */
export function formatRollbackNotice(projectDir: string, outcome: RollbackOutcome): string {
  if (outcome.failedPaths.length > 0) {
    const rel = outcome.failedPaths.map((p) => path.relative(projectDir, p));
    return (
      `원상 복구를 시도했으나 다음 ${rel.length}개 파일은 복구하지 못했습니다 — 직접 확인 후 정리가 필요합니다:\n` +
      rel.map((f) => `  - ${f}`).join("\n")
    );
  }
  return outcome.restoredCount > 0
    ? `이미 작성된 ${outcome.restoredCount}개 파일은 쓰기 전 상태로 원상 복구했습니다.`
    : `파일이 작성되기 전이므로 프로젝트는 변경되지 않았습니다.`;
}

/**
 * apply() 안에서 파일을 쓰기 직전마다 journal.recordBeforeWrite() 를 호출한다는
 * 전제 하에, 중간 실패 시 롤백을 수행하고 루프 차단형 에러로 변환해 던진다.
 * 롤백이 성공하면 프로젝트는 쓰기 전 상태이므로, 원인(권한/디스크 풀)을 해결한 뒤
 * 같은 인자로 재시도하는 것이 실제로 유효하다 — retryAfterAction 으로 분류한다.
 */
export async function withWriteRollback<T>(
  projectDir: string,
  journal: FileWriteJournal,
  apply: () => Promise<T>,
): Promise<T> {
  try {
    return await apply();
  } catch (error) {
    const outcome = await journal.rollback();
    const cause = error instanceof Error ? error.message : String(error);
    // OS 에러 메시지(EACCES 등)에 절대 경로가 포함될 수 있어 프로젝트 경로를 가린다.
    const sanitizedCause = cause.split(path.resolve(projectDir)).join("<projectDir>");
    throw retryAfterAction(
      `파일 쓰기 중 오류가 발생해 작업을 중단했습니다: ${sanitizedCause}\n` +
        `${formatRollbackNotice(projectDir, outcome)}\n` +
        `원인(권한/디스크 공간 등)을 해결한 뒤 같은 인자로 다시 시도하세요.`,
    );
  }
}
