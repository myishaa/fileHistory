import { Router } from "express";
import { pool } from "../db/pool.js";
import { visibleFileSql } from "../utils/qa-data.js";
import type { FileMessage, FileMessageReply } from "../types.js";
import {
  canAccessDivision,
  canResolveMessages,
  canSendFileMessages,
  getDivisionScopeCondition,
  requireAuth,
  type AuthRequest,
} from "../utils/auth.js";
import {
  asyncHandler,
  HttpError,
  requireObjectBody,
  requireParam,
  requireString,
} from "../utils/http.js";
import {
  acknowledgeFileProcessingNotification,
  loadFileProcessingNotifications,
} from "../utils/file-processing-notifications.js";

export const messagesRouter = Router();

type MessageRow = {
  id: string;
  file_id: string;
  division_id: string | null;
  division_name: string | null;
  unique_code: string | null;
  file_no: string | null;
  imms: string | null;
  section: string;
  message: string;
  status: "pending" | "resolved";
  created_by_user_id: string | null;
  recipient_user_id: string | null;
  recipient_user_name: string | null;
  created_by_name: string;
  created_by_role: string;
  created_at: Date | string;
  resolved_by_name: string | null;
  resolved_at: Date | string | null;
  viewed_at: Date | string | null;
};

let schemaReady: Promise<void> | undefined;

function ensureFileMessageSchema() {
  schemaReady ??= (async () => {
    await pool.query(
      `alter table if exists file_messages
         add column if not exists recipient_user_id uuid references app_users(id) on delete set null`,
    );
    await pool.query(
      `create index if not exists file_messages_recipient_user_idx
         on file_messages(recipient_user_id) where recipient_user_id is not null`,
    );
  })();
  return schemaReady;
}

function messagingBlocked(user: ReturnType<typeof requireAuth>) {
  return !canSendFileMessages(user);
}

function isMmgMessageRole(user: ReturnType<typeof requireAuth>) {
  return canResolveMessages(user);
}

messagesRouter.get(
  "/recipients",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user) || !isMmgMessageRole(user)) {
      throw new HttpError(403, "This role cannot select file-message recipients.");
    }
    const divisionId =
      typeof request.query.divisionId === "string" ? request.query.divisionId.trim() : "";
    if (!divisionId) throw new HttpError(400, "divisionId is required.");
    if (!canAccessDivision(user, divisionId)) {
      throw new HttpError(403, "You cannot select recipients outside your divisions.");
    }
    const result = await pool.query<{
      id: string;
      name: string;
      username: string;
      role: string;
      division_ids: string[];
    }>(
      `select
         u.id::text as id,
         u.name,
         u.username,
         u.role,
         coalesce(array_agg(ud.division_id::text) filter (where ud.division_id is not null), array[]::text[]) as division_ids
       from app_users u
       join user_divisions ud on ud.user_id = u.id and ud.division_id::text = $1
       where u.is_active = true
         and u.archived_at is null
         and u.role = 'division_user'
       group by u.id, u.name, u.username, u.role
       order by lower(u.name), lower(u.username)`,
      [divisionId],
    );
    response.json({ users: result.rows });
  }),
);

type ReplyRow = {
  id: string;
  message_id: string;
  body: string;
  created_by_name: string;
  created_by_role: string;
  created_at: Date | string;
};

function toIso(value: Date | string | null | undefined) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapMessage(row: MessageRow, replies: Map<string, FileMessageReply[]>): FileMessage {
  return {
    id: row.id,
    fileId: row.file_id,
    createdByUserId: row.created_by_user_id ?? undefined,
    recipientUserId: row.recipient_user_id ?? undefined,
    recipientUserName: row.recipient_user_name ?? undefined,
    divisionId: row.division_id ?? undefined,
    divisionName: row.division_name ?? "Unassigned",
    fileUniqueCode: row.unique_code ?? undefined,
    fileNo: row.file_no ?? undefined,
    imms: row.imms ?? undefined,
    section: row.section,
    text: row.message,
    status: row.status,
    createdByName: row.created_by_name,
    createdByRole: row.created_by_role,
    createdAt: toIso(row.created_at) ?? "",
    resolvedByName: row.resolved_by_name ?? undefined,
    resolvedAt: toIso(row.resolved_at),
    viewedAt: toIso(row.viewed_at),
    replies: replies.get(row.id) ?? [],
  };
}

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function requireShortMessage(value: unknown, field: string) {
  const text = requireString(value, field).trim();
  if (countWords(text) > 20) throw new HttpError(400, `${field} cannot exceed 20 words.`);
  return text;
}

async function loadReplies(messageIds: string[]) {
  const replies = new Map<string, FileMessageReply[]>();
  if (!messageIds.length) return replies;
  const result = await pool.query<ReplyRow>(
    `select id, message_id, body, created_by_name, created_by_role, created_at
     from file_message_replies
     where message_id = any($1::uuid[])
     order by created_at asc, id asc`,
    [messageIds],
  );
  for (const row of result.rows) {
    const reply = {
      id: row.id,
      messageId: row.message_id,
      text: row.body,
      createdByName: row.created_by_name,
      createdByRole: row.created_by_role,
      createdAt: toIso(row.created_at) ?? "",
    };
    replies.set(row.message_id, [...(replies.get(row.message_id) ?? []), reply]);
  }
  return replies;
}

async function loadMessages(whereSql: string, values: unknown[]) {
  await ensureFileMessageSchema();
  const result = await pool.query<MessageRow>(
    `select
       m.id, m.file_id, m.division_id, d.name as division_name,
       f.unique_code, f.file_no, f.imms,
       m.section, m.message, m.status, m.created_by_user_id, m.recipient_user_id,
       recipient.name as recipient_user_name, m.created_by_name, m.created_by_role,
       m.created_at, m.resolved_by_name, m.resolved_at, m.viewed_at
     from file_messages m
     join files f on f.id = m.file_id and f.archived_at is null and ${visibleFileSql("f")}
     left join divisions d on d.id = m.division_id
     left join app_users recipient on recipient.id = m.recipient_user_id
     ${whereSql}
       ${whereSql ? "and" : "where"} m.deleted_at is null
     order by
       case when m.status = 'pending' then 0 else 1 end,
       m.created_at desc`,
    values,
  );
  const replies = await loadReplies(result.rows.map((row) => row.id));
  return result.rows.map((row) => mapMessage(row, replies));
}

messagesRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user)) {
      response.json({ messages: [] });
      return;
    }
    const conditions = [];
    const values: unknown[] = [];
    const scope = getDivisionScopeCondition(user, "m");
    if (scope.sql) {
      conditions.push(scope.sql.replace("$1", `$${values.length + 1}`));
      values.push(...scope.values);
    }
    if (user.role === "division_user") {
      values.push(user.id);
      conditions.push(`(m.created_by_user_id = $${values.length}::uuid or m.recipient_user_id = $${values.length}::uuid)`);
    } else if (isMmgMessageRole(user)) {
      values.push(user.id);
      conditions.push(
        `(m.recipient_user_id is null or m.created_by_user_id = $${values.length}::uuid or m.recipient_user_id = $${values.length}::uuid)`,
      );
    }
    if (typeof request.query.fileId === "string" && request.query.fileId.trim()) {
      values.push(request.query.fileId.trim());
      conditions.push(`m.file_id = $${values.length}`);
    }
    if (typeof request.query.status === "string" && request.query.status.trim()) {
      values.push(request.query.status.trim());
      conditions.push(`m.status = $${values.length}`);
    }
    const whereSql = conditions.length ? `where ${conditions.join(" and ")}` : "";
    response.json({ messages: await loadMessages(whereSql, values) });
  }),
);

messagesRouter.get(
  "/file-processing",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user)) {
      response.json({ notifications: [] });
      return;
    }
    response.json({ notifications: await loadFileProcessingNotifications(user) });
  }),
);

messagesRouter.post(
  "/file-processing/:id/acknowledge",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user)) throw new HttpError(403, "Universal viewers cannot use messaging.");
    const id = requireParam(request.params.id, "id");
    const notification = await acknowledgeFileProcessingNotification(id, user);
    if (!notification) throw new HttpError(404, "Notification not found.");
    response.json({ notification });
  }),
);

messagesRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user)) throw new HttpError(403, "Universal viewers cannot send messages.");
    if (!["division_user", "admin", "sub_admin", "editor"].includes(user.role)) {
      throw new HttpError(403, "This role cannot create file messages.");
    }
    await ensureFileMessageSchema();
    const body = requireObjectBody(request.body);
    const fileId = requireString(body.fileId, "fileId");
    const section = requireString(body.section, "section");
    const message = requireShortMessage(body.text, "text");
    const file = await pool.query<{ division_id: string | null; messages_enabled: boolean | null }>(
      `select f.division_id, d.messages_enabled
       from files f
       left join divisions d on d.id = f.division_id
       where f.id = $1 and f.archived_at is null and ${visibleFileSql("f")}`,
      [fileId],
    );
    const divisionId = file.rows[0]?.division_id;
    if (!file.rows[0]) throw new HttpError(404, "File not found.");
    if (!canAccessDivision(user, divisionId))
      throw new HttpError(403, "You cannot query this file.");
    if (file.rows[0].messages_enabled === false) {
      throw new HttpError(403, "Messages are disabled for this division.");
    }

    let recipientUserId: string | null = null;
    if (isMmgMessageRole(user)) {
      if (typeof body.recipientUserId !== "string" || !body.recipientUserId.trim()) {
        throw new HttpError(400, "recipientUserId is required for MMG-initiated messages.");
      }
      recipientUserId = body.recipientUserId.trim();
      const recipient = await pool.query<{ id: string }>(
        `select u.id::text as id
           from app_users u
           join user_divisions ud on ud.user_id = u.id
          where u.id = $1::uuid
            and u.role = 'division_user'
            and u.is_active = true
            and u.archived_at is null
            and ud.division_id = $2::uuid`,
        [recipientUserId, divisionId],
      );
      if (!recipient.rows[0]) {
        throw new HttpError(403, "Recipient must be an active Division user for this file's division.");
      }
    }

    const result = await pool.query<{ id: string }>(
      `insert into file_messages (
         file_id, division_id, section, message,
         created_by_user_id, created_by_viewer_division_id, created_by_name, created_by_role,
         recipient_user_id
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [
        fileId,
        divisionId,
        section,
        message,
        user.role === "division_user" ? user.id : user.id,
        user.role === "division_user" ? (user.divisionIds[0] ?? null) : null,
        user.name,
        user.role,
        recipientUserId,
      ],
    );
    const messages = await loadMessages("where m.id = $1", [result.rows[0].id]);
    response.status(201).json({ message: messages[0] });
  }),
);

messagesRouter.post(
  "/:id/replies",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user)) throw new HttpError(403, "Universal viewers cannot use messaging.");
    if (!["division_user", "admin", "sub_admin", "editor"].includes(user.role)) {
      throw new HttpError(403, "This role cannot reply to file messages.");
    }
    await ensureFileMessageSchema();
    const id = requireParam(request.params.id, "id");
    const body = requireObjectBody(request.body);
    const text = requireShortMessage(body.text, "text");
    const existing = await pool.query<{
      division_id: string | null;
      created_by_user_id: string | null;
      recipient_user_id: string | null;
    }>(
      "select division_id, created_by_user_id, recipient_user_id from file_messages where id = $1 and deleted_at is null",
      [id],
    );
    if (!existing.rows[0]) throw new HttpError(404, "Message not found.");
    if (!canAccessDivision(user, existing.rows[0].division_id)) {
      throw new HttpError(403, "You cannot reply to this division.");
    }
    const message = existing.rows[0];
    if (
      user.role === "division_user" &&
      message.created_by_user_id !== user.id &&
      message.recipient_user_id !== user.id
    ) {
      throw new HttpError(403, "You are not a participant in this message thread.");
    }
    if (isMmgMessageRole(user) && message.recipient_user_id && message.recipient_user_id !== user.id) {
      throw new HttpError(403, "Only the authorized recipient may reply to this thread.");
    }
    await pool.query(
      `insert into file_message_replies (message_id, body, created_by_user_id, created_by_name, created_by_role)
       values ($1, $2, $3, $4, $5)`,
      [id, text, user.id, user.name, user.role],
    );
    const messages = await loadMessages("where m.id = $1", [id]);
    response.status(201).json({ message: messages[0] });
  }),
);

messagesRouter.post(
  "/:id/resolve",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user) || !isMmgMessageRole(user)) {
      throw new HttpError(403, "Only authorized MMG users can resolve messages.");
    }
    await ensureFileMessageSchema();
    const id = requireParam(request.params.id, "id");
    const existing = await pool.query<{
      division_id: string | null;
      created_by_user_id: string | null;
      recipient_user_id: string | null;
    }>(
      "select division_id, created_by_user_id, recipient_user_id from file_messages where id = $1 and deleted_at is null",
      [id],
    );
    if (!existing.rows[0]) throw new HttpError(404, "Message not found.");
    if (!canAccessDivision(user, existing.rows[0].division_id)) {
      throw new HttpError(403, "You cannot resolve this division.");
    }
    if (
      existing.rows[0].recipient_user_id &&
      existing.rows[0].created_by_user_id !== user.id &&
      existing.rows[0].recipient_user_id !== user.id
    ) {
      throw new HttpError(403, "Only the authorized participants may resolve this message.");
    }
    await pool.query(
      `update file_messages
       set status = 'resolved', resolved_by = $2, resolved_by_name = $3, resolved_at = now()
       where id = $1`,
      [id, user.id, user.name],
    );
    const messages = await loadMessages("where m.id = $1", [id]);
    response.json({ message: messages[0] });
  }),
);

messagesRouter.post(
  "/:id/view",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user)) throw new HttpError(403, "Universal viewers cannot use messaging.");
    await ensureFileMessageSchema();
    const id = requireParam(request.params.id, "id");
    const existing = await pool.query<{
      division_id: string | null;
      created_by_user_id: string | null;
      recipient_user_id: string | null;
    }>(
      "select division_id, created_by_user_id, recipient_user_id from file_messages where id = $1 and deleted_at is null",
      [id],
    );
    if (!existing.rows[0]) throw new HttpError(404, "Message not found.");
    if (!canAccessDivision(user, existing.rows[0].division_id)) {
      throw new HttpError(403, "You cannot view this message.");
    }
    if (
      user.role === "division_user" &&
      existing.rows[0].created_by_user_id !== user.id &&
      existing.rows[0].recipient_user_id !== user.id
    ) {
      throw new HttpError(403, "You cannot view this message.");
    }
    if (
      isMmgMessageRole(user) &&
      existing.rows[0].recipient_user_id &&
      existing.rows[0].created_by_user_id !== user.id &&
      existing.rows[0].recipient_user_id !== user.id
    ) {
      throw new HttpError(403, "You cannot view this message.");
    }
    await pool.query("update file_messages set viewed_at = now() where id = $1", [id]);
    const messages = await loadMessages("where m.id = $1", [id]);
    response.json({ message: messages[0] });
  }),
);

messagesRouter.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user)) throw new HttpError(403, "Universal viewers cannot use messaging.");
    if (!["division_user", "admin", "sub_admin", "editor"].includes(user.role)) {
      throw new HttpError(403, "This role cannot delete messages.");
    }
    await ensureFileMessageSchema();
    const id = requireParam(request.params.id, "id");
    const existing = await pool.query<{
      division_id: string | null;
      created_by_user_id: string | null;
    }>(
      "select division_id, created_by_user_id from file_messages where id = $1 and deleted_at is null",
      [id],
    );
    if (!existing.rows[0]) throw new HttpError(404, "Message not found.");
    if (existing.rows[0].created_by_user_id !== user.id) {
      throw new HttpError(403, "Only the message creator can delete it.");
    }
    if (!canAccessDivision(user, existing.rows[0].division_id)) {
      throw new HttpError(403, "You cannot delete this message.");
    }
    await pool.query("delete from file_messages where id = $1", [id]);
    response.json({ deleted: true });
  }),
);
