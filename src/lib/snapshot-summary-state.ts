export type SnapshotSummaryResult<T> = {
  query: string;
  userId?: string;
  refreshRevision: number;
  summary: T;
};

export function getSnapshotSummary<T>(
  result: SnapshotSummaryResult<T> | undefined,
  request: { query: string; userId?: string; refreshRevision: number },
  status: { loading: boolean; error?: string },
): T | undefined {
  if (status.loading || status.error) return undefined;
  if (
    !result ||
    result.query !== request.query ||
    result.userId !== request.userId ||
    result.refreshRevision !== request.refreshRevision
  ) {
    return undefined;
  }
  return result.summary;
}
