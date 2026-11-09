/**
 * withAttachment=true 엔티티 생성용 템플릿 컨텍스트 주입.
 *
 * `egov_add_entity` 가 사용하며, 모든 entity 템플릿이 `{{#if withAttachment}}` 분기로 활용하는
 * 변수를 ctx 에 넣고, attribute 컬렉션에서 ATCH_FILE_ID 를 제외한다.
 */

import type { ScaffoldContext } from "./scaffoldGenerator.js";

const ATTACH_COL = "ATCH_FILE_ID";

export function applyAttachmentContext(
  ctx: ScaffoldContext,
  opts: { attachmentFieldName: string; maxAttachmentCount: number },
): void {
  // ScaffoldContext 의 정적 타입에 없는 필드는 동적 캐스팅으로 추가 (기존 패턴 따름).
  // 'unknown' 경유 캐스팅은 TS 의 사용자 정의 인터페이스↔동적 dict 호환 우회 표준 패턴.
  const ctxDyn = ctx as unknown as Record<string, unknown>;
  ctxDyn.withAttachment = true;
  ctxDyn.attachmentFieldName = opts.attachmentFieldName;
  ctxDyn.attachmentFieldNamePascal =
    opts.attachmentFieldName.charAt(0).toUpperCase() + opts.attachmentFieldName.slice(1);
  ctxDyn.attachmentColumnName = ATTACH_COL;
  ctxDyn.maxAttachmentCount = opts.maxAttachmentCount;

  // attribute 컬렉션들에서 ATCH_FILE_ID 를 제외한다.
  //
  // 이유: 사용자가 DDL 에 ATCH_FILE_ID 를 명시 포함했거나, 이전 호출에서 자동 주입된
  //       컬럼을 DDL 에 다시 넣은 경우, attribute 리스트에 들어가 다음 부작용을 일으킨다.
  //
  //   (a) Register view 의 일반 필드 루프가 visible text input 으로 렌더 → 사용자에게
  //       "AtchFileId 은(는) 필수 입력값입니다" 로 입력 요구. atchFileId 는 Controller 가
  //       채번하는 *내부* 키이므로 사용자가 보거나 입력해선 안 됨.
  //   (b) Register view 의 client-side validate 가 String 필드는 모두 required 로 잡아
  //       파일을 안 올린 경우에도 빈 atchFileId 가 검증 실패로 막힘.
  //   (c) Mapper SQL 의 INSERT/UPDATE 컬럼 루프에서 중복 발생 — withAttachment 분기가
  //       별도로 컬럼을 추가하기 때문.
  //
  // 안전성: ATCH_FILE_ID 는 표준 컬럼명이고 도메인 컬럼명과 충돌하지 않는다 (CHAR(20)
  //         이 의미하는 첨부파일 그룹 키는 일반 도메인 의미를 갖지 않음).
  ctx.attributes = ctx.attributes.filter((a) => a.columnName !== ATTACH_COL);
  if (ctx.nonPkAttributes) {
    ctx.nonPkAttributes = ctx.nonPkAttributes.filter((a) => a.columnName !== ATTACH_COL);
  }
  const searchable = (ctx as { searchableAttributes?: { columnName: string }[] }).searchableAttributes;
  if (searchable) {
    (ctx as { searchableAttributes: { columnName: string }[] }).searchableAttributes = searchable.filter(
      (a) => a.columnName !== ATTACH_COL,
    );
  }
}
