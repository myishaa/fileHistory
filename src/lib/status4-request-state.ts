export type Status4Result<T> = { requestKey: string; files: T[] };

export function getStatus4RequestKey(scope: {
  userId?: string;
  selectedYear: string;
  includeArchivedYears: boolean;
  includeAllCancelledSupplyOrderFiles: boolean;
  refreshRevision: number;
}) {
  return JSON.stringify(scope);
}

export function getStatus4CurrentFiles<T>(
  result: Status4Result<T> | undefined,
  requestKey: string,
): T[] | undefined {
  return result?.requestKey === requestKey ? result.files : undefined;
}
