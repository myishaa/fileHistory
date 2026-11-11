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
  // File visibility is governed by authentication, division/category access,
  // archive, and report/search scope predicates. Do not apply a QA-only
  // Unique Code restriction here: it hides otherwise valid files from every
  // UI that uses the shared visibility helper.
  return "true";
}
