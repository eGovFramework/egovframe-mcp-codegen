/**
 * egov_add_query_view — Number 컬럼의 format 이 화면 렌더링에 반영되는지 검증한다.
 * `#,##0.00` 은 천 단위 구분 + 소수 2자리, `#,##0` 은 천 단위 구분 + 소수 없음을 뜻한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddQueryView } from "../../src/tools/egovAddQueryView.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

let tmpRoot: string;
let projectDir: string;

const LIST_VIEW = "src/main/resources/templates/thymeleaf/report/egovPayReportList.html";

function addView(columns: Array<{ alias: string; label: string; type?: string; format?: string }>) {
  return egovAddQueryView({
    projectPath: projectDir,
    packageName: "egovframework.example.report",
    viewName: "PayReport",
    sql: "SELECT e.ID AS id, e.SALARY AS amount FROM EMPLOYEE e",
    columns: [{ alias: "id", label: "ID" }, ...columns],
  });
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-qv-number-"));
  projectDir = path.join(tmpRoot, "hr-app");
  await generateScaffoldProject({
    projectName: "hr-app",
    packageName: "egovframework.example.employee",
    outputPath: tmpRoot,
    entityName: "Employee",
    ddl: "CREATE TABLE EMPLOYEE (ID VARCHAR(20) NOT NULL PRIMARY KEY, SALARY DECIMAL(12,2))",
    description: "",
    projectType: "boot",
    stackVersion: "5.0",
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpRoot);
});

describe("Query view Number format", () => {
  it.each([
    ["#,##0.00", "'COMMA', 2"],
    ["#,##0", "'COMMA', 0"],
    ["0.000", "'NONE', 3"],
    ["0", "'NONE', 0"],
  ])("%s 는 천 단위 구분과 소수 자릿수를 반영한다", async (format, expected) => {
    await addView([{ alias: "amount", label: "금액", type: "Number", format }]);
    const html = await fs.readFile(path.join(projectDir, LIST_VIEW), "utf-8");
    expect(html).toContain(`#numbers.formatDecimal(result.amount, 1, ${expected}, 'POINT')`);
  });

  it("format 이 없으면 값을 그대로 표시한다", async () => {
    await addView([{ alias: "amount", label: "금액", type: "Number" }]);
    const html = await fs.readFile(path.join(projectDir, LIST_VIEW), "utf-8");
    expect(html).toContain('th:text="${result.amount}"');
    expect(html).not.toContain("formatDecimal");
  });

  it.each(["0.00%", "#,##0.00 원", "abc"])("지원하지 않는 Number format '%s' 는 입력 검증에서 거부한다", async (format) => {
    await expect(addView([{ alias: "amount", label: "금액", type: "Number", format }])).rejects.toThrow(
      /format/,
    );
    expect(await fs.pathExists(path.join(projectDir, LIST_VIEW))).toBe(false);
  });
});
