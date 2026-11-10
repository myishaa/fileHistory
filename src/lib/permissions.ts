import type { AppUser, PermissionCapability } from "@/lib/files-store";

export function isDivisionScopedUser(user: Pick<AppUser, "role"> | null | undefined) {
  return user?.role === "division_user" || user?.role === "viewer";
}

export function canViewFileProcessing(
  user: Pick<AppUser, "role" | "capabilities"> | null | undefined,
) {
  return Boolean(
    user &&
      (user.role === "viewer" ||
        (user.role === "division_user" && hasCapability(user, "canSendFileMessages"))),
  );
}

/** Capabilities are supplied by the backend policy; UI checks only presentation. */
export function hasCapability(
  user: Pick<AppUser, "capabilities"> | null | undefined,
  capability: PermissionCapability,
) {
  return user?.capabilities?.[capability] === true;
}
