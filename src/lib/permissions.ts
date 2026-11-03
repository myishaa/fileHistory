import type { AppUser, PermissionCapability } from "@/lib/files-store";

/** Capabilities are supplied by the backend policy; UI checks only presentation. */
export function hasCapability(
  user: Pick<AppUser, "capabilities"> | null | undefined,
  capability: PermissionCapability,
) {
  return user?.capabilities?.[capability] === true;
}
