import type {
  AppUserRole,
  AuthUser,
  PermissionCapability,
  UserCapabilities,
} from "../types.js";

/**
 * The single role capability policy used by backend authorization helpers.
 * Division and file-category scope are applied separately by auth.ts.
 */
const roleCapabilities: Record<AppUserRole, UserCapabilities> = {
  admin: {
    canManageUsers: true,
    canViewUsers: true,
    canEditFiles: true,
    canResolveMessages: true,
    canArchiveFiles: true,
    canSendUrgentMessages: true,
    canSendFileMessages: true,
    canUseAllDivisions: true,
    canAcceptUniversalAnomalies: true,
  },
  sub_admin: {
    canManageUsers: false,
    canViewUsers: true,
    canEditFiles: true,
    canResolveMessages: true,
    canArchiveFiles: true,
    canSendUrgentMessages: true,
    canSendFileMessages: true,
    canUseAllDivisions: false,
    canAcceptUniversalAnomalies: false,
  },
  editor: {
    canManageUsers: false,
    canViewUsers: false,
    canEditFiles: true,
    canResolveMessages: true,
    canArchiveFiles: true,
    canSendUrgentMessages: false,
    canSendFileMessages: true,
    canUseAllDivisions: false,
    canAcceptUniversalAnomalies: false,
  },
  division_user: {
    canManageUsers: false,
    canViewUsers: false,
    canEditFiles: false,
    canResolveMessages: false,
    canArchiveFiles: false,
    canSendUrgentMessages: false,
    canSendFileMessages: true,
    canUseAllDivisions: false,
    canAcceptUniversalAnomalies: false,
  },
  viewer: {
    canManageUsers: false,
    canViewUsers: false,
    canEditFiles: false,
    canResolveMessages: false,
    canArchiveFiles: false,
    canSendUrgentMessages: false,
    canSendFileMessages: false,
    canUseAllDivisions: false,
    canAcceptUniversalAnomalies: false,
  },
  universal_viewer: {
    canManageUsers: false,
    canViewUsers: false,
    canEditFiles: false,
    canResolveMessages: false,
    canArchiveFiles: false,
    canSendUrgentMessages: false,
    canSendFileMessages: false,
    canUseAllDivisions: false,
    canAcceptUniversalAnomalies: false,
  },
};

export function getRoleCapabilities(role: AppUserRole): UserCapabilities {
  return roleCapabilities[role];
}

export function hasCapability(
  user: Pick<AuthUser, "role"> | null | undefined,
  capability: PermissionCapability,
) {
  return Boolean(user && roleCapabilities[user.role][capability]);
}
