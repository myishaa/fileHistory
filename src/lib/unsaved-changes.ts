import { useEffect } from "react";

const dirtySources = new Map<string, boolean>();
const listeners = new Set<() => void>();
let dirtySnapshot = false;

function publishIfChanged() {
  const nextSnapshot = Array.from(dirtySources.values()).some(Boolean);
  if (nextSnapshot === dirtySnapshot) return;
  dirtySnapshot = nextSnapshot;
  listeners.forEach((listener) => listener());
}

function setSourceDirty(sourceId: string, dirty: boolean) {
  if (dirty) dirtySources.set(sourceId, true);
  else dirtySources.delete(sourceId);
  publishIfChanged();
}

export function hasUnsavedChanges() {
  return dirtySnapshot;
}

export function clearUnsavedChanges(sourceId: string) {
  setSourceDirty(sourceId, false);
}

export function subscribeToUnsavedChanges(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUnsavedChangesSnapshot() {
  return dirtySnapshot;
}

export function useUnsavedChanges(sourceId: string, dirty: boolean) {
  useEffect(() => {
    setSourceDirty(sourceId, dirty);
    return () => setSourceDirty(sourceId, false);
  }, [sourceId, dirty]);
}
