/**
 * Database type to Java type mapping
 */
const predefinedDataTypes: { [key: string]: string } = {
	VARCHAR: "java.lang.String",
	VARCHAR2: "java.lang.String",
	CHAR: "java.lang.String",
	TEXT: "java.lang.String",
	MEDIUMTEXT: "java.lang.String",
	INT: "java.lang.Integer",
	INTEGER: "java.lang.Integer",
	NUMBER: "java.lang.Integer",
	BIGINT: "java.lang.Long",
	SMALLINT: "java.lang.Short",
	TINYINT: "java.lang.Byte",
	DECIMAL: "java.math.BigDecimal",
	NUMERIC: "java.math.BigDecimal",
	FLOAT: "java.lang.Float",
	REAL: "java.lang.Double",
	DOUBLE: "java.lang.Double",
	SMALLSERIAL: "java.lang.Short",
	SERIAL: "java.lang.Integer",
	BIGSERIAL: "java.lang.Long",
	DATE: "java.sql.Date",
	TIME: "java.sql.Time",
	DATETIME: "java.util.Date",
	TIMESTAMP: "java.sql.Timestamp",
	BOOLEAN: "java.lang.Boolean",
	BIT: "java.lang.Boolean",
	ENUM: "java.lang.String",
	SET: "java.lang.String",
}

export function getJavaClassName(dataType: string): string {
	return predefinedDataTypes[dataType.toUpperCase()] || "java.lang.Object"
}
