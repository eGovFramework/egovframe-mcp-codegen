/**
 * Legacy regex-based DDL parser
 *
 * 정규식 + `split(/,(?![^(]*\))/)` 기반의 1세대 파서. Phase 2-C 에서 AST 파서가
 * 도입된 뒤에도 비-MySQL 방언(HSQLDB `CREATE MEMORY TABLE`, Oracle `VARCHAR2` /
 * `NUMBER`, PostgreSQL `JSONB` 등)에 대한 fallback 으로 유지된다.
 *
 * 알려진 한계
 * ----------
 * - 컬럼 분리와 본문 추출은 `sqlText` 의 따옴표 인식 스캐너를 쓰므로 `COMMENT 'x, y'` 같은
 *   리터럴 안의 콤마·괄호는 안전하다. 그 외 토큰 해석(이름/타입)은 여전히 공백 분리 기반이다.
 * - 코멘트는 인라인 `COMMENT '...'` 와 후속 `COMMENT ON COLUMN/TABLE ... IS '...'` 문장만 읽는다.
 * - 외래키, CHECK 제약, GENERATED 열 등 복잡한 DDL 문법은 무시한다.
 *
 * `parseDDL` 의 공식 진입점은 `ddlParser.ts` 이며, 이 모듈은 그쪽에서만
 * 내부적으로 호출된다.
 */
import { getJavaClassName } from "./dataTypes.js"
import type { Column, ParsedDDLCore } from "./ddlParser.js"
import { computeIsLongText, computeIsYnFlag, normalizeComment } from "./ddlParser.js"
import { findMatchingParen, splitTopLevel, stripSqlComments, unquoteSqlString } from "../sqlText.js"

const DATE_JAVA_TYPES = new Set([
	"java.sql.Date",
	"java.sql.Time",
	"java.sql.Timestamp",
	"java.util.Date",
])

function convertToCamelCase(str: string): string {
	return str.toLowerCase().replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase())
}

function convertCamelcaseToPascalcase(name: string): string {
	if (!name) return name
	return name.charAt(0).toUpperCase() + name.slice(1)
}

/** SQL 문자열 리터럴 (`'...'` 또는 `"..."`, 내부 `''`/`""` 이스케이프 허용) */
const SQL_STRING_LITERAL = `('(?:[^']|'')*'|"(?:[^"]|"")*")`

export function parseDDLLegacy(ddl: string): ParsedDDLCore {
	// SQL 주석을 먼저 제거한다 — 공백을 한 칸으로 합치면 `-- ...` 의 줄 끝 경계가 사라지기 때문.
	ddl = stripSqlComments(ddl).replace(/\s+/g, " ").trim()

	// 문장 분리 — 첫 문장이 CREATE TABLE, 이후는 COMMENT ON ... 등 후속 문장.
	const statements = splitTopLevel(ddl, ";").map((s) => s.trim()).filter((s) => s.length > 0)
	const createStmt = statements[0] ?? ddl
	const trailingStmts = statements.slice(1)

	const tableNameMatch = RegExp(/^\s*CREATE\s+(?:MEMORY\s+)?TABLE\s+[`]?(\w+)[`]?/i).exec(createStmt)
	if (!tableNameMatch) {
		throw new Error("Unable to parse table name from DDL")
	}
	const tableName = convertCamelcaseToPascalcase(convertToCamelCase(tableNameMatch[1]))

	// 컬럼 본문: 첫 '(' 와 (따옴표를 무시하며) 짝이 되는 ')' 사이. 그 뒤는 테이블 옵션 꼬리.
	const openIdx = createStmt.indexOf("(")
	const closeIdx = openIdx === -1 ? -1 : findMatchingParen(createStmt, openIdx)
	if (openIdx === -1 || closeIdx === -1) {
		throw new Error("Unable to parse column definitions from DDL")
	}

	const columnDefinitions = createStmt.slice(openIdx + 1, closeIdx)
	const tableTail = createStmt.slice(closeIdx + 1)
	const columnsArray = splitTopLevel(columnDefinitions, ",")
		.map((column) => column.trim())
		.filter(
			(column) =>
				column && !column.startsWith("UNIQUE KEY") && !column.startsWith("KEY") && !column.startsWith("CONSTRAINT"),
		)

	const attributes: Column[] = []
	const pkAttributes: Column[] = []

	const pkConstraintMatch = RegExp(/PRIMARY KEY\s*\(([^)]+)\)/i).exec(ddl)
	const primaryKeyColumns = pkConstraintMatch
		? pkConstraintMatch[1].split(",").map((col) => col.trim().replace(/[`"']/g, ""))
		: []

	// CONSTRAINT FK 매칭: CONSTRAINT NAME FOREIGN KEY (col) REFERENCES TARGET(target_col)
	// 같은 행에 (col) 와 REFERENCES TARGET(target_col) 가 같이 나오는 형태만 지원.
	const fkConstraintRegex =
		/FOREIGN\s+KEY\s*\(\s*([^)]+?)\s*\)\s*REFERENCES\s+([`"']?\w+[`"']?)\s*\(\s*([^)]+?)\s*\)/gi
	const fkByLocalCol = new Map<string, { targetTable: string; targetColumn: string }>()
	for (const m of ddl.matchAll(fkConstraintRegex)) {
		const localCol = m[1].trim().replace(/[`"']/g, "")
		const targetTable = m[2].trim().replace(/[`"']/g, "")
		const targetColumn = m[3].trim().replace(/[`"']/g, "")
		// 단일 컬럼 FK 만 지원 (복합 FK 는 범위 밖)
		if (!localCol.includes(",")) {
			fkByLocalCol.set(localCol, { targetTable, targetColumn })
		}
	}

	columnsArray.forEach((columnDef) => {
		if (columnDef.trim().toUpperCase().startsWith("PRIMARY KEY") || columnDef.trim().toUpperCase().startsWith("COMMENT ON")) {
			return
		}

		// 인라인 COMMENT '...' 를 먼저 떼어낸다 (후속 COMMENT ON COLUMN 문보다 우선). 리터럴 안의
		// PRIMARY KEY / NOT NULL / DEFAULT / REFERENCES 같은 단어가 제약으로 오인되지 않도록
		// 이후 키워드 검사는 코멘트를 제거한 defSansComment 로 수행한다.
		const inlineCommentMatch = new RegExp(`\\bCOMMENT\\s+${SQL_STRING_LITERAL}`, "i").exec(columnDef)
		const comment = inlineCommentMatch ? normalizeComment(unquoteSqlString(inlineCommentMatch[1])) : null
		const defSansComment = inlineCommentMatch ? columnDef.replace(inlineCommentMatch[0], " ") : columnDef

		const parts = columnDef.split(" ").filter((part) => part.trim())
		const columnName = parts[0]?.replace(/[`"']/g, "")
		const rawDataType = parts[1] ? parts[1].toUpperCase() : ""

		if (!columnName || columnName.trim() === "") {
			throw new Error(`Invalid column definition: missing column name in "${columnDef}"`)
		}
		if (!rawDataType || rawDataType.trim() === "") {
			throw new Error(`Invalid column definition: missing data type for column "${columnName}"`)
		}

		const dataType = RegExp(/^\w+/).exec(rawDataType)?.[0] ?? rawDataType
		const lengthMatch = RegExp(/\((\d+)/).exec(rawDataType)
		const maxLength = lengthMatch ? parseInt(lengthMatch[1], 10) : 0
		// DECIMAL(p,s) / NUMBER(p,s) 의 두 번째 인자 — 소수 자릿수
		const scaleMatch = RegExp(/\(\s*\d+\s*,\s*(\d+)\s*\)/).exec(rawDataType)
		const scale = scaleMatch ? parseInt(scaleMatch[1], 10) : 0
		const isPrimaryKey = primaryKeyColumns.includes(columnName) || defSansComment.toUpperCase().includes("PRIMARY KEY")
		const ccName = convertToCamelCase(columnName)

		const javaType = getJavaClassName(dataType)

		// 인라인 REFERENCES: `col TYPE [NOT NULL] REFERENCES PARENT(PK)`
		// columnDef 안에서 REFERENCES 절을 정규식으로 찾는다.
		let inlineFk: { targetTable: string; targetColumn: string } | null = null
		const inlineFkMatch = /REFERENCES\s+([`"']?\w+[`"']?)\s*\(\s*([`"']?\w+[`"']?)\s*\)/i.exec(defSansComment)
		if (inlineFkMatch) {
			inlineFk = {
				targetTable: inlineFkMatch[1].replace(/[`"']/g, ""),
				targetColumn: inlineFkMatch[2].replace(/[`"']/g, ""),
			}
		}
		// 제약절 FK 가 더 우선: 같은 컬럼에 둘 다 있으면 별 의미 없지만 명시적 CONSTRAINT 를 따른다.
		const constraintFk = fkByLocalCol.get(columnName)

		// NOT NULL 추출 — 데이터 타입 뒤 어딘가에 "NOT NULL" 토큰이 있으면 true
		const isNotNull = /\bNOT\s+NULL\b/i.test(defSansComment)

		// DEFAULT 추출 — DEFAULT 'literal' | DEFAULT NUMBER | DEFAULT FUNC[(args)] | DEFAULT NULL
		let defaultValue: string | null = null
		const defStr = /DEFAULT\s+'((?:[^']|'')*)'/i.exec(defSansComment)
		const defNum = /DEFAULT\s+(-?\d+(?:\.\d+)?)\b/i.exec(defSansComment)
		const defFunc = /DEFAULT\s+([A-Z_][A-Z0-9_]*)\s*(?:\(\s*\))?/i.exec(defSansComment)
		const defNull = /DEFAULT\s+NULL\b/i.exec(defSansComment)
		if (defStr) defaultValue = `'${defStr[1].replace(/''/g, "'")}'`
		else if (defNum) defaultValue = defNum[1]
		else if (defNull) defaultValue = "NULL"
		else if (defFunc) defaultValue = defFunc[1].toUpperCase()

		const column: Column = {
			ccName,
			columnName,
			isPrimaryKey,
			pcName: convertCamelcaseToPascalcase(ccName),
			dataType,
			javaType,
			maxLength,
			scale,
			isDate: DATE_JAVA_TYPES.has(javaType),
			isLongText: computeIsLongText(dataType, maxLength),
			isYnFlag: computeIsYnFlag(dataType, maxLength, columnName),
			fk: constraintFk ?? inlineFk,
			isNotNull,
			defaultValue,
			comment,
		}

		attributes.push(column)
		if (isPrimaryKey) {
			pkAttributes.push(column)
		}
	})

	if (attributes.length === 0) {
		throw new Error("No valid columns found in DDL")
	}

	// 테이블 코멘트: `) COMMENT[=]'...'` 꼬리, 또는 후속 `COMMENT ON TABLE [schema.]t IS '...'` 문장.
	// COMMENT ON COLUMN 은 `[schema.][table.]col` 접두를 허용하고 마지막 식별자만 컬럼명으로 본다.
	let tableComment: string | null = null
	const tailCommentMatch = new RegExp(`\\bCOMMENT\\s*=?\\s*${SQL_STRING_LITERAL}`, "i").exec(tableTail)
	if (tailCommentMatch) tableComment = normalizeComment(unquoteSqlString(tailCommentMatch[1]))

	const commentOnTable = new RegExp(`^COMMENT\\s+ON\\s+TABLE\\s+(?:[\`"]?\\w+[\`"]?\\.)?[\`"]?\\w+[\`"]?\\s+IS\\s+${SQL_STRING_LITERAL}`, "i")
	const commentOnColumn = new RegExp(
		`^COMMENT\\s+ON\\s+COLUMN\\s+(?:[\`"]?\\w+[\`"]?\\.){0,2}[\`"]?(\\w+)[\`"]?\\s+IS\\s+${SQL_STRING_LITERAL}`,
		"i",
	)
	for (const stmt of trailingStmts) {
		const t = commentOnTable.exec(stmt)
		if (t) {
			if (tableComment === null) tableComment = normalizeComment(unquoteSqlString(t[1]))
			continue
		}
		const c = commentOnColumn.exec(stmt)
		if (c) {
			const target = attributes.find((a) => a.columnName.toUpperCase() === c[1].toUpperCase())
			if (target && target.comment === null) target.comment = normalizeComment(unquoteSqlString(c[2]))
		}
	}

	return { tableName, attributes, pkAttributes, tableComment }
}
