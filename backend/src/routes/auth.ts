import { Router } from "express";
import { pool } from "../db/pool.js";
import {
  clearSessionCookie,
  deleteSession,
  getSessionToken,
  loadAuthUser,
  requireAuth,
  saveUserSession,
  saveViewerSession,
  setSessionCookie,
  type AuthRequest,
} from "../utils/auth.js";
import { asyncHandler, HttpError, requireObjectBody, requireString } from "../utils/http.js";

export const authRouter = Router();

type LoginUserRow = {
  id: string;
};

type VerifyPasswordRow = {
  ok: boolean;
};

type ViewerDivisionRow = {
  id: string;
};

authRouter.post(
  "/login",
  asyncHandler(async (request, response) => {
    const body = requireObjectBody(request.body);
    const username = requireString(body.username, "username");
    const password = requireString(body.password, "password");

    const result = await pool.query<LoginUserRow>(
      `select id
       from app_users
       where lower(username) = lower($1)
         and is_active = true
         and password_hash is not null
         and password_hash = crypt($2, password_hash)`,
      [username, password],
    );
    const userId = result.rows[0]?.id;
    if (!userId) throw new HttpError(401, "Invalid username or password.");

    const token = await saveUserSession(userId);
    setSessionCookie(response, token);
    response.json({ user: await loadAuthUser(requestWithCookie(request, token)) });
  }),
);

authRouter.post(
  "/viewer-login",
  asyncHandler(async (request, response) => {
    const body = requireObjectBody(request.body);
    const divisionId = requireString(body.divisionId, "divisionId");
    const password = requireString(body.password, "password");

    const result = await pool.query<ViewerDivisionRow>(
      `select id
       from divisions
       where id = $1
         and archived_at is null
         and viewer_password_hash is not null
         and viewer_password_hash = crypt($2, viewer_password_hash)`,
      [divisionId, password],
    );
    const foundDivisionId = result.rows[0]?.id;
    if (!foundDivisionId) throw new HttpError(401, "Invalid division or password.");

    const token = await saveViewerSession(foundDivisionId);
    setSessionCookie(response, token);
    response.json({ user: await loadAuthUser(requestWithCookie(request, token)) });
  }),
);

authRouter.get(
  "/me",
  asyncHandler(async (request, response) => {
    response.json({ user: (request as AuthRequest).authUser ?? null });
  }),
);

authRouter.post(
  "/verify-password",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");

    const body = requireObjectBody(request.body);
    const password = requireString(body.password, "password");
    const result = await pool.query<VerifyPasswordRow>(
      `select password_hash = crypt($2, password_hash) as ok
       from app_users
       where id = $1
         and is_active = true
         and password_hash is not null`,
      [user.id, password],
    );

    if (!result.rows[0]?.ok) throw new HttpError(403, "Incorrect password.");
    response.json({ ok: true });
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (request, response) => {
    await deleteSession(getSessionToken(request));
    clearSessionCookie(response);
    response.json({ ok: true });
  }),
);

function requestWithCookie(request: unknown, token: string) {
  const nextRequest = request as AuthRequest;
  nextRequest.headers.cookie = `recordkeeper_session=${encodeURIComponent(token)}`;
  return nextRequest;
}
