export type FilterCombinationLock = {
  locked: true;
  globalYear: string;
  fileYear: string;
};

export function getFilterCombinationLockKey(userId: string | undefined) {
  return `recordkeeper:filter-combination-lock:${userId ?? "anonymous"}`;
}

export function readFilterCombinationLock(userId: string | undefined) {
  if (typeof window === "undefined") return undefined;
  try {
    const value = JSON.parse(
      window.localStorage.getItem(getFilterCombinationLockKey(userId)) ?? "null",
    );
    if (
      value?.locked === true &&
      typeof value.globalYear === "string" &&
      typeof value.fileYear === "string"
    ) {
      return value as FilterCombinationLock;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function writeFilterCombinationLock(
  userId: string | undefined,
  value: FilterCombinationLock | undefined,
) {
  if (typeof window === "undefined") return;
  const key = getFilterCombinationLockKey(userId);
  if (value) window.localStorage.setItem(key, JSON.stringify(value));
  else window.localStorage.removeItem(key);
  window.dispatchEvent(new Event("recordkeeper:filter-combination-lock-changed"));
}

export function clearPageSubfilterLocks(userId: string | undefined) {
  if (typeof window === "undefined") return;
  const baseKey = `recordkeeper:file-year-filter:${userId ?? "anonymous"}`;
  for (const key of [baseKey, `${baseKey}:fy-activity`]) {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
      window.sessionStorage.setItem(
        key,
        JSON.stringify({ ...(saved && typeof saved === "object" ? saved : {}), locked: false }),
      );
    } catch {
      window.sessionStorage.setItem(key, JSON.stringify({ locked: false }));
    }
  }
}
