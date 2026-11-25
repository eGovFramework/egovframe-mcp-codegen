/**
 * 생성 컨텍스트의 라벨 계산 테스트
 *
 * `applyLabels` 가 컬럼 코멘트 규칙 → FK 부모 엔티티명 → pcName 순으로 `Column.label` 을,
 * 테이블 코멘트 규칙 → entityName 순으로 `ctx.entityLabel` 을 채우는지 고정한다.
 */
import { describe, it, expect } from "vitest";
import { applyLabels, buildContext } from "../../src/utils/scaffold/scaffoldGenerator.js";

const base = {
  projectName: "p",
  packageName: "egovframework.example.notice",
  outputPath: "/tmp/x",
  entityName: "Notice",
  description: "",
  projectType: "boot" as const,
  stackVersion: "5.1" as const,
};

describe("applyLabels", () => {
  it("코멘트 → label, 규칙 폴백 → pcName, 테이블 코멘트 → entityLabel", () => {
    const ctx = buildContext({
      ...base,
      ddl: `CREATE TABLE NOTICE (
      NTT_ID NUMERIC(20) NOT NULL COMMENT '공지사항ID',
      NTT_SJ VARCHAR(2000) COMMENT '공지사항제목',
      NTT_CN TEXT COMMENT '공지사항의 본문 내용을 저장하는 컬럼',
      USE_YN CHAR(1) COMMENT '사용여부(Y/N)',
      RGST_DT TIMESTAMP COMMENT '등록, 수정일',
      PRIMARY KEY (NTT_ID)) COMMENT='공지사항'`,
    });
    expect(ctx.attributes.map((a) => a.label)).toEqual([
      "공지사항ID",
      "공지사항제목",
      "NttCn",
      "사용여부",
      "RgstDt",
    ]);
    expect(ctx.entityLabel).toBe("공지사항");
    expect(ctx.hasTableLabel).toBe(true);
  });

  it("코멘트가 없으면 entityLabel=entityName, hasTableLabel=false, label=pcName", () => {
    const ctx = buildContext({
      ...base,
      ddl: `CREATE TABLE NOTICE (NTT_ID VARCHAR(20) PRIMARY KEY, NTT_SJ VARCHAR(100))`,
    });
    expect(ctx.entityLabel).toBe("Notice");
    expect(ctx.hasTableLabel).toBe(false);
    expect(ctx.attributes[1].label).toBe("NttSj");
  });

  it("테이블 코멘트가 규칙에 걸리면(설명문) entityName 으로 폴백", () => {
    const ctx = buildContext({
      ...base,
      ddl: `CREATE TABLE NOTICE (NTT_ID VARCHAR(20) PRIMARY KEY) COMMENT='공지사항을 저장하는 테이블입니다'`,
    });
    expect(ctx.entityLabel).toBe("Notice");
    expect(ctx.hasTableLabel).toBe(false);
  });

  it("fkParent 가 있고 코멘트가 없으면 부모 엔티티명, 코멘트가 있으면 코멘트가 우선", () => {
    const ctx = buildContext({
      ...base,
      ddl: `CREATE TABLE NOTICE (NTT_ID VARCHAR(20) PRIMARY KEY,
      DEPT_ID VARCHAR(20) REFERENCES DEPARTMENT(DEPT_ID),
      WRTR_ID VARCHAR(20) COMMENT '작성자' REFERENCES MEMBER(ID))`,
    });
    const parent = {
      entityName: "Department",
      entityNameLower: "department",
      packageName: "p",
      pkField: "deptId",
      pkColumn: "DEPT_ID",
      displayFields: [],
      displayColumns: [],
    };
    ctx.attributes[1].fkParent = parent;
    ctx.attributes[2].fkParent = { ...parent, entityName: "Member" };
    applyLabels(ctx);
    expect(ctx.attributes[1].label).toBe("Department");
    expect(ctx.attributes[2].label).toBe("작성자");
  });
});
