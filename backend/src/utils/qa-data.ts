const QA_TOKEN_PATTERN = "'(^|[^[:alnum:]])qa([^[:alnum:]]|$)'";
const QA_DESCRIPTION_PATTERN = "'(test data only|test only|controlled scenario)'";

function assertSqlIdentifier(value: string) {
  if (!/^[a-z][a-z0-9_]*$/i.test(value)) {
    throw new Error("Invalid SQL alias for QA data filter.");
  }
}

export function isQaLabelSql(valueExpression: string) {
  return `(${valueExpression} ~* ${QA_TOKEN_PATTERN}
    or ${valueExpression} ~* ${QA_DESCRIPTION_PATTERN})`;
}

export function visibleFileSql(alias = "f") {
  assertSqlIdentifier(alias);
  return `coalesce(${alias}.unique_code, '') = '2620007'`;
}
