export function getFirmPerformanceCohortOrder<T extends { firm?: string }>(
  order: T,
): Omit<T, "firm"> & { firm: string } {
  return {
    ...order,
    firm: order.firm?.trim() || "Unidentified supplier",
  } as Omit<T, "firm"> & { firm: string };
}
