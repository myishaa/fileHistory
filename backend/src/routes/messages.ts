import { Router } from "express";
import { pool } from "../db/pool.js";
import type { FileMessage, FileMessageReply } from "../types.js";
import {
  canAccessDivision,
  canMutateFiles,
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
  created_by_name: string;
  created_by_role: string;
  created_at: Date | string;
  resolved_by_name: string | null;
  resolved_at: Date | string | null;
  viewed_at: Date | string | null;
};

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
  const result = await pool.query<MessageRow>(
    `select
       m.id, m.file_id, m.division_id, d.name as division_name,
       f.unique_code, f.file_no, f.imms,
       m.section, m.message, m.status, m.created_by_name, m.created_by_role,
       m.created_at, m.resolved_by_name, m.resolved_at, m.viewed_at
     from file_messages m
     join files f on f.id = m.file_id and f.archived_at is null
     left join divisions d on d.id = m.division_id
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
    const conditions = [];
    const values: unknown[] = [];
    const scope = getDivisionScopeCondition(user, "m");
    if (scope.sql) {
      conditions.push(scope.sql.replace("$1", `$${values.length + 1}`));
      values.push(...scope.values);
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
    response.json({ notifications: await loadFileProcessingNotifications(user) });
  }),
);

messagesRouter.post(
  "/file-processing/:id/acknowledge",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
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
    if (user.role !== "viewer" && user.role !== "division_user") {
      throw new HttpError(403, "Only division viewers can create queries.");
    }
    const body = requireObjectBody(request.body);
    const fileId = requireString(body.fileId, "fileId");
    const section = requireString(body.section, "section");
    const message = requireShortMessage(body.text, "text");
    const file = await pool.query<{ division_id: string | null; messages_enabled: boolean | null }>(
      `select f.division_id, d.messages_enabled
       from files f
       left join divisions d on d.id = f.division_id
       where f.id = $1 and f.archived_at is null`,
      [fileId],
    );
    const divisionId = file.rows[0]?.division_id;
    if (!file.rows[0]) throw new HttpError(404, "File not found.");
    if (!canAccessDivision(user, divisionId))
      throw new HttpError(403, "You cannot query this file.");
    if (file.rows[0].messages_enabled === false) {
      throw new HttpError(403, "Messages are disabled for this division.");
    }

    const result = await pool.query<{ id: string }>(
      `insert into file_messages (
         file_id, division_id, section, message,
         created_by_user_id, created_by_viewer_division_id, created_by_name, created_by_role
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        fileId,
        divisionId,
        section,
        message,
        user.role === "viewer" ? null : user.id,
        user.role === "viewer" ? (user.divisionIds[0] ?? null) : null,
        user.name,
        user.role,
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
    if (!canMutateFiles(user)) throw new HttpError(403, "Only editors and admins can reply.");
    const id = requireParam(request.params.id, "id");
    const body = requireObjectBody(request.body);
    const text = requireShortMessage(body.text, "text");
    const existing = await pool.query<{ division_id: string | null }>(
      "select division_id from file_messages where id = $1 and deleted_at is null",
      [id],
    );
    if (!existing.rows[0]) throw new HttpError(404, "Message not found.");
    if (!canAccessDivision(user, existing.rows[0].division_id)) {
      throw new HttpError(403, "You cannot reply to this division.");
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
    if (!canMutateFiles(user)) throw new HttpError(403, "Only editors and admins can resolve.");
    const id = requireParam(request.params.id, "id");
    const existing = await pool.query<{ division_id: string | null }>(
      "select division_id from file_messages where id = $1 and deleted_at is null",
      [id],
    );
    if (!existing.rows[0]) throw new HttpError(404, "Message not found.");
    if (!canAccessDivision(user, existing.rows[0].division_id)) {
      throw new HttpError(403, "You cannot resolve this division.");
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
    const id = requireParam(request.params.id, "id");
    const existing = await pool.query<{ division_id: string | null }>(
      "select division_id from file_messages where id = $1 and deleted_at is null",
      [id],
    );
    if (!existing.rows[0]) throw new HttpError(404, "Message not found.");
    if (!canAccessDivision(user, existing.rows[0].division_id)) {
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
    if (user.role !== "admin" && user.role !== "viewer" && user.role !== "division_user") {
      throw new HttpError(403, "Only admins and viewers can delete messages.");
    }
    const id = requireParam(request.params.id, "id");
    const existing = await pool.query<{ division_id: string | null }>(
      "select division_id from file_messages where id = $1 and deleted_at is null",
      [id],
    );
    if (!existing.rows[0]) throw new HttpError(404, "Message not found.");
    if (!canAccessDivision(user, existing.rows[0].division_id)) {
      throw new HttpError(403, "You cannot delete this message.");
    }
    await pool.query("update file_messages set deleted_at = now() where id = $1", [id]);
    response.json({ deleted: true });
  }),
);
