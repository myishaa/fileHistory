import assert from "node:assert/strict";
import test from "node:test";
import type { AppUserRole, AuthUser } from "../types.js";
import {
  canAccessDivision,
  canArchiveFiles,
  canEditFiles,
  canSendFileMessages,
  canResolveMessages,
  canUseAllDivisions,
} from "./auth.js";
import { getRoleCapabilities } from "./permissions.js";

function makeUser(role: AppUserRole, divisionIds: string[] = ["division-a"]): AuthUser {
  return {
    id: `${role}-id`,
    name: role,
    username: role,
    role,
    divisionIds,
  };
}

test("capability matrix exposes the intended role boundaries", () => {
  assert.equal(getRoleCapabilities("admin").canManageUsers, true);
  assert.equal(getRoleCapabilities("admin").canUseAllDivisions, true);
  assert.equal(getRoleCapabilities("sub_admin").canManageUsers, false);
  assert.equal(getRoleCapabilities("sub_admin").canArchiveFiles, true);
  assert.equal(getRoleCapabilities("editor").canEditFiles, true);
  assert.equal(getRoleCapabilities("editor").canSendUrgentMessages, false);
  assert.equal(getRoleCapabilities("division_user").canSendFileMessages, true);
  assert.equal(getRoleCapabilities("universal_viewer").canSendFileMessages, false);
});

test("division-scoped capabilities deny access outside assigned divisions", () => {
  for (const role of ["sub_admin", "editor", "division_user", "viewer", "universal_viewer"] as const) {
    const user = makeUser(role, ["division-a"]);
    assert.equal(canAccessDivision(user, "division-a"), true, `${role} should access its division`);
    assert.equal(canAccessDivision(user, "division-b"), false, `${role} should not cross divisions`);
    assert.equal(canAccessDivision(user, undefined), false, `${role} should deny unassigned records`);
  }

  const subAdmin = makeUser("sub_admin", ["division-a"]);
  assert.equal(canEditFiles(subAdmin, "division-a"), true);
  assert.equal(canEditFiles(subAdmin, "division-b"), false);
  assert.equal(canArchiveFiles(subAdmin, "division-b"), false);
  assert.equal(canResolveMessages(subAdmin, "division-a"), true);
  assert.equal(canResolveMessages(subAdmin, "division-b"), false);
  assert.equal(canSendFileMessages(subAdmin, "division-a"), true);
  assert.equal(canSendFileMessages(subAdmin, "division-b"), false);
});

test("administrators retain organization-wide access, including unassigned records", () => {
  const admin = makeUser("admin", []);

  assert.equal(canUseAllDivisions(admin), true);
  assert.equal(canAccessDivision(admin, undefined), true);
  assert.equal(canEditFiles(admin, undefined), true);
  assert.equal(canArchiveFiles(admin, undefined), true);
  assert.equal(canResolveMessages(admin, undefined), true);
});
