/**
 * Legacy regex-based DDL parser
 *
 * 정규식 + `split(/,(?![^(]*\))/)` 기반의 1세대 파서. Phase 2-C 에서 AST 파서가
 * 도입된 뒤에도 비-MySQL 방언(HSQLDB `CREATE MEMORY TABLE`, Oracle `VARCHAR2` /
 * `NUMBER`, PostgreSQL `JSONB` 등)에 대한 fallback 으로 유지된다.
 *
 * 알려진 한계
 * ----------
 * - 컬럼 정의 안의 `COMMENT 'x, y'` 처럼 콤마가 포함된 리터럴은 컬럼 구분자로
 *   오인할 수 있다. AST 파서가 도입되면서 이 케이스는 AST 경로가 흡수한다.
 * - 외래키, CHECK 제약, GENERATED 열 등 복잡한 DDL 문법은 무시한다.
 *
 * `parseDDL` 의 공식 진입점은 `ddlParser.ts` 이며, 이 모듈은 그쪽에서만
 * 내부적으로 호출된다.
 */
import { getJavaClassName } from "./dataTypes.js"
import type { Column, ParsedDDL } from "./ddlParser.js"
import { computeIsLongText, computeIsYnFlag } from "./ddlParser.js"

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

export function parseDDLLegacy(ddl: string): ParsedDDL {
	ddl = ddl.replace(/\s+/g, " ").trim()

	const tableNameMatch = RegExp(/^\s*CREATE\s+(?:MEMORY\s+)?TABLE\s+[`]?(\w+)[`]?/i).exec(ddl)
	if (!tableNameMatch) {
		throw new Error("Unable to parse table name from DDL")
	}
	const tableName = convertCamelcaseToPascalcase(convertToCamelCase(tableNameMatch[1]))

	const columnDefinitionsMatch = RegExp(/\((.*)\)/s).exec(ddl)
	if (!columnDefinitionsMatch) {
		throw new Error("Unable to parse column definitions from DDL")
	}

	const columnDefinitions = columnDefinitionsMatch[1]
	const columnsArray = columnDefinitions
		.split(/,(?![^(]*\))/)
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
		const isPrimaryKey = primaryKeyColumns.includes(columnName) || columnDef.toUpperCase().includes("PRIMARY KEY")
		const ccName = convertToCamelCase(columnName)

		const javaType = getJavaClassName(dataType)

		// 인라인 REFERENCES: `col TYPE [NOT NULL] REFERENCES PARENT(PK)`
		// columnDef 안에서 REFERENCES 절을 정규식으로 찾는다.
		let inlineFk: { targetTable: string; targetColumn: string } | null = null
		const inlineFkMatch = /REFERENCES\s+([`"']?\w+[`"']?)\s*\(\s*([`"']?\w+[`"']?)\s*\)/i.exec(columnDef)
		if (inlineFkMatch) {
			inlineFk = {
				targetTable: inlineFkMatch[1].replace(/[`"']/g, ""),
				targetColumn: inlineFkMatch[2].replace(/[`"']/g, ""),
			}
		}
		// 제약절 FK 가 더 우선: 같은 컬럼에 둘 다 있으면 별 의미 없지만 명시적 CONSTRAINT 를 따른다.
		const constraintFk = fkByLocalCol.get(columnName)

		// NOT NULL 추출 — 데이터 타입 뒤 어딘가에 "NOT NULL" 토큰이 있으면 true
		const isNotNull = /\bNOT\s+NULL\b/i.test(columnDef)

		// DEFAULT 추출 — DEFAULT 'literal' | DEFAULT NUMBER | DEFAULT FUNC[(args)] | DEFAULT NULL
		let defaultValue: string | null = null
		const defStr = /DEFAULT\s+'((?:[^']|'')*)'/i.exec(columnDef)
		const defNum = /DEFAULT\s+(-?\d+(?:\.\d+)?)\b/i.exec(columnDef)
		const defFunc = /DEFAULT\s+([A-Z_][A-Z0-9_]*)\s*(?:\(\s*\))?/i.exec(columnDef)
		const defNull = /DEFAULT\s+NULL\b/i.exec(columnDef)
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
			isDate: DATE_JAVA_TYPES.has(javaType),
			isLongText: computeIsLongText(dataType, maxLength),
			isYnFlag: computeIsYnFlag(dataType, maxLength, columnName),
			fk: constraintFk ?? inlineFk,
			isNotNull,
			defaultValue,
		}

		attributes.push(column)
		if (isPrimaryKey) {
			pkAttributes.push(column)
		}
	})

	if (attributes.length === 0) {
		throw new Error("No valid columns found in DDL")
	}

	return { tableName, attributes, pkAttributes }
}
