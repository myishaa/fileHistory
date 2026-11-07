import { Router } from "express";
import { pool } from "../db/pool.js";
import {
  canSendFileMessages,
  canSendUrgentMessages,
  canUseAllDivisions,
  requireAuth,
  type AuthRequest,
} from "../utils/auth.js";
import type { AuthUser } from "../types.js";
import {
  asyncHandler,
  HttpError,
  requireObjectBody,
  requireParam,
  requireString,
} from "../utils/http.js";

export const urgentMessagesRouter = Router();

type UrgentMessageKind = "reminder" | "admin";
type UrgentAudience = "creator" | "all_users" | "users" | "divisions";
type UrgentMessageStatus = "open" | "snoozed" | "done";

type UrgentMessageRow = {
  id: string;
  title: string;
  body: string;
  kind: UrgentMessageKind;
  created_by_user_id: string;
  created_by_name: string;
  created_by_role: string;
  audience_type: UrgentAudience;
  recipient_user_ids: string[] | null;
  recipient_division_ids: string[] | null;
  created_at: Date | string;
  expires_at: Date | string | null;
  status: UrgentMessageStatus | null;
  snoozed_until: Date | string | null;
  done_at: Date | string | null;
};

let schemaReady: Promise<void> | undefined;

function ensureUrgentMessageSchema() {
  schemaReady ??= (async () => {
    await pool.query(`
      create table if not exists urgent_messages (
        id uuid primary key default gen_random_uuid(),
        title text not null,
        body text not null,
        kind text not null check (kind in ('reminder', 'admin')),
        created_by_user_id uuid not null references app_users(id) on delete cascade,
        created_by_name text not null,
        created_by_role text not null,
        audience_type text not null check (audience_type in ('creator', 'all_users', 'users', 'divisions')),
        recipient_user_ids uuid[] not null default '{}',
        recipient_division_ids uuid[] not null default '{}',
        created_at timestamptz not null default now(),
        expires_at timestamptz,
        deleted_at timestamptz
      )
    `);
    await pool.query(`
      create table if not exists urgent_message_user_state (
        message_id uuid not null references urgent_messages(id) on delete cascade,
        user_id uuid not null references app_users(id) on delete cascade,
        status text not null default 'open' check (status in ('open', 'snoozed', 'done')),
        snoozed_until timestamptz,
        done_at timestamptz,
        updated_at timestamptz not null default now(),
        primary key (message_id, user_id)
      )
    `);
    await pool.query(
      "create index if not exists urgent_messages_created_idx on urgent_messages(created_at desc)",
    );
    await pool.query(
      "create index if not exists urgent_messages_expiry_idx on urgent_messages(expires_at)",
    );
    await pool.query(
      "create index if not exists urgent_message_user_state_user_idx on urgent_message_user_state(user_id, status, snoozed_until)",
    );
  })();
  return schemaReady;
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function databaseUserId(user: ReturnType<typeof requireAuth>) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)
    ? user.id
    : undefined;
}

function readKind(value: unknown): UrgentMessageKind {
  if (value === "reminder" || value === "admin") return value;
  throw new HttpError(400, "kind must be reminder or admin.");
}

function readAudience(value: unknown): Exclude<UrgentAudience, "creator"> {
  if (value === "all_users" || value === "users" || value === "divisions") return value;
  throw new HttpError(400, "audience must be all_users, users, or divisions.");
}

function readIdArray(value: unknown, field: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, `${field} must be an array of ids.`);
  }
  return value as string[];
}

function readTitle(value: unknown, fallback: string) {
  const title = typeof value === "string" ? value.trim() : "";
  if (title.length > 120) throw new HttpError(400, "title must contain 1–120 characters.");
  return title || fallback.slice(0, 120);
}

function readBody(value: unknown) {
  const rawBody = requireString(value, "body");
  if (rawBody.length > 100) {
    throw new HttpError(400, "body must contain 1–100 characters, including spaces.");
  }
  const body = rawBody.trim();
  if (!body) throw new HttpError(400, "body must contain 1–100 characters, including spaces.");
  return body;
}

function canCreateAdminMessage(user: AuthUser) {
  return canSendUrgentMessages(user);
}

function messagingBlocked(user: AuthUser) {
  return !canSendFileMessages(user);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function uniqueIds(values: string[]) {
  return [...new Set(values)];
}

async function validateAdminMessageRecipients(
  user: AuthUser,
  audience: Exclude<UrgentAudience, "creator">,
  recipientUserIds: string[],
  recipientDivisionIds: string[],
) {
  const userIds = uniqueIds(recipientUserIds);
  const divisionIds = uniqueIds(recipientDivisionIds);
  if ([...userIds, ...divisionIds].some((id) => !isUuid(id))) {
    throw new HttpError(400, "Recipient ids must be valid ids.");
  }
  if (user.role !== "sub_admin") {
    if (audience === "users" && userIds.length) {
      const result = await pool.query<{ role: string }>(
        `select role
           from app_users
          where id = any($1::uuid[])
            and is_active = true
            and archived_at is null`,
        [userIds],
      );
      if (
        result.rows.length !== userIds.length ||
        result.rows.some((row) => !["admin", "sub_admin", "editor"].includes(row.role))
      ) {
        throw new HttpError(403, "Urgent messages are limited to MMG users.");
      }
    }
    return { recipientUserIds: userIds, recipientDivisionIds: divisionIds };
  }

  const allowedDivisionIds = new Set(user.divisionIds);
  if (!allowedDivisionIds.size) {
    throw new HttpError(403, "Assign this Sub-admin to at least one division before sending messages.");
  }
  if (audience === "all_users") {
    throw new HttpError(403, "Sub-admin messages must target selected users or assigned divisions.");
  }
  if (audience === "divisions") {
    if (!divisionIds.length || divisionIds.some((id) => !allowedDivisionIds.has(id))) {
      throw new HttpError(403, "Sub-admins may target only their assigned divisions.");
    }
    return { recipientUserIds: [], recipientDivisionIds: divisionIds };
  }

  if (!userIds.length) throw new HttpError(400, "Select at least one recipient.");
  const result = await pool.query<{ id: string; role: string; division_ids: string[] | null }>(
    `select
       u.id::text as id,
       u.role,
       coalesce(
         array_agg(ud.division_id::text) filter (where ud.division_id is not null),
         array[]::text[]
       ) as division_ids
     from app_users u
     left join user_divisions ud on ud.user_id = u.id
     where u.id = any($1::uuid[])
       and u.is_active = true
       and u.archived_at is null
     group by u.id, u.role`,
    [userIds],
  );
  if (result.rows.length !== userIds.length) {
    throw new HttpError(403, "Recipients must be active users in your assigned divisions.");
  }
  const invalidRecipient = result.rows.find(
    (row) =>
      !["admin", "editor"].includes(row.role) ||
      !(row.division_ids ?? []).some((divisionId) => allowedDivisionIds.has(divisionId)),
  );
  if (invalidRecipient) {
    throw new HttpError(403, "Sub-admins may message only Editors and Admins in their assigned divisions.");
  }
  return { recipientUserIds: userIds, recipientDivisionIds: [] };
}

function mapMessage(row: UrgentMessageRow) {
  const visibleNow =
    row.status !== "done" &&
    (row.status !== "snoozed" ||
      !row.snoozed_until ||
      new Date(row.snoozed_until).getTime() <= Date.now());
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    kind: row.kind,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdByRole: row.created_by_role,
    audience: row.audience_type,
    recipientUserIds: row.recipient_user_ids ?? [],
    recipientDivisionIds: row.recipient_division_ids ?? [],
    createdAt: toIso(row.created_at) ?? "",
    expiresAt: toIso(row.expires_at),
    status: row.status ?? "open",
    snoozedUntil: toIso(row.snoozed_until),
    doneAt: toIso(row.done_at),
    visibleNow,
  };
}

async function assertVisibleMessage(user: ReturnType<typeof requireAuth>, id: string) {
  await ensureUrgentMessageSchema();
  if (messagingBlocked(user)) throw new HttpError(403, "Universal viewers cannot use messaging.");
  const userId = databaseUserId(user);
  if (!userId) throw new HttpError(403, "This account cannot manage urgent reminders.");
  const result = await pool.query<{ id: string }>(
    `select m.id
       from urgent_messages m
      where m.id = $1
        and m.deleted_at is null
        and (m.expires_at is null or m.expires_at > now())
        and (
          (m.kind = 'reminder' and m.created_by_user_id = $2::uuid)
          or (
            m.kind = 'admin'
            and $6::text <> 'division_user'
            and (
              m.created_by_role <> 'sub_admin'
              or $5::text in ('admin', 'editor')
              or m.created_by_user_id = $2::uuid
            )
            and (
              m.created_by_user_id = $2::uuid
              or $3::boolean
              or m.audience_type = 'all_users'
              or $2::uuid = any(m.recipient_user_ids)
              or (m.audience_type = 'divisions' and m.recipient_division_ids && $4::uuid[])
            )
          )
        )`,
    [id, userId, canUseAllDivisions(user), user.divisionIds, user.role, user.role],
  );
  if (!result.rows[0]) throw new HttpError(404, "Urgent message not found.");
}

urgentMessagesRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user)) {
      response.json({ messages: [] });
      return;
    }
    await ensureUrgentMessageSchema();
    const userId = databaseUserId(user);
    if (!userId) {
      response.json({ messages: [] });
      return;
    }
    const result = await pool.query<UrgentMessageRow>(
      `select
         m.id, m.title, m.body, m.kind, m.created_by_user_id,
         m.created_by_name, m.created_by_role, m.audience_type,
         m.recipient_user_ids, m.recipient_division_ids,
         m.created_at, m.expires_at,
         coalesce(s.status, 'open') as status,
         s.snoozed_until, s.done_at
       from urgent_messages m
       left join urgent_message_user_state s
         on s.message_id = m.id and s.user_id = $1::uuid
       where m.deleted_at is null
         and (m.expires_at is null or m.expires_at > now())
         and (
           (m.kind = 'reminder' and m.created_by_user_id = $1::uuid)
           or (
             m.kind = 'admin'
             and $5::text <> 'division_user'
             and (
               m.created_by_role <> 'sub_admin'
               or $4::text in ('admin', 'editor')
               or m.created_by_user_id = $1::uuid
             )
             and (
               m.created_by_user_id = $1::uuid
               or $2::boolean
               or m.audience_type = 'all_users'
               or $1::uuid = any(m.recipient_user_ids)
               or (m.audience_type = 'divisions' and m.recipient_division_ids && $3::uuid[])
             )
           )
         )
       order by
         case when coalesce(s.status, 'open') = 'done' then 2
              when coalesce(s.status, 'open') = 'snoozed' then 1
              else 0 end,
         m.created_at desc`,
      [userId, canUseAllDivisions(user), user.divisionIds, user.role, user.role],
    );
    response.json({ messages: result.rows.map(mapMessage) });
  }),
);

urgentMessagesRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user)) throw new HttpError(403, "Universal viewers cannot send messages.");
    const userId = databaseUserId(user);
    if (!userId) throw new HttpError(403, "This account cannot create urgent reminders.");
    await ensureUrgentMessageSchema();
    const body = requireObjectBody(request.body);
    const kind = readKind(body.kind);
    const messageBody = readBody(body.body);
    const title = readTitle(body.title, messageBody);
    let audience: UrgentAudience = "creator";
    let recipientUserIds: string[] = [userId];
    let recipientDivisionIds: string[] = [];
    if (kind === "admin") {
      if (!canCreateAdminMessage(user)) {
        throw new HttpError(403, "Admin or assigned-division Sub-admin access required.");
      }
      audience = readAudience(body.audience);
      recipientUserIds = readIdArray(body.recipientUserIds, "recipientUserIds");
      recipientDivisionIds = readIdArray(body.recipientDivisionIds, "recipientDivisionIds");
      if (audience === "users" && !recipientUserIds.length) {
        throw new HttpError(400, "Select at least one recipient.");
      }
      if (audience === "divisions" && !recipientDivisionIds.length) {
        throw new HttpError(400, "Select at least one division.");
      }
      const validatedRecipients = await validateAdminMessageRecipients(
        user,
        audience,
        recipientUserIds,
        recipientDivisionIds,
      );
      recipientUserIds = validatedRecipients.recipientUserIds;
      recipientDivisionIds = validatedRecipients.recipientDivisionIds;
    }
    const expiresAt =
      typeof body.expiresAt === "string" && body.expiresAt.trim() ? new Date(body.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime()))
      throw new HttpError(400, "expiresAt must be a valid date.");
    const result = await pool.query<{ id: string }>(
      `insert into urgent_messages (
         title, body, kind, created_by_user_id, created_by_name, created_by_role,
         audience_type, recipient_user_ids, recipient_division_ids, expires_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], $9::uuid[], $10)
       returning id`,
      [
        title,
        messageBody,
        kind,
        userId,
        user.name,
        user.role,
        audience,
        recipientUserIds,
        recipientDivisionIds,
        expiresAt,
      ],
    );
    const created = await pool.query<UrgentMessageRow>(
      `select
         m.id, m.title, m.body, m.kind, m.created_by_user_id,
         m.created_by_name, m.created_by_role, m.audience_type,
         m.recipient_user_ids, m.recipient_division_ids,
         m.created_at, m.expires_at,
         'open'::text as status, null::timestamptz as snoozed_until,
         null::timestamptz as done_at
       from urgent_messages m where m.id = $1`,
      [result.rows[0].id],
    );
    response.status(201).json({ message: mapMessage(created.rows[0]) });
  }),
);

urgentMessagesRouter.patch(
  "/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user)) throw new HttpError(403, "Universal viewers cannot edit messages.");
    const userId = databaseUserId(user);
    if (!userId) throw new HttpError(403, "This account cannot edit urgent messages.");
    await ensureUrgentMessageSchema();
    const id = requireParam(request.params.id, "id");
    const existing = await pool.query<{
      kind: UrgentMessageKind;
      created_by_user_id: string;
      audience_type: UrgentAudience;
      recipient_user_ids: string[] | null;
      recipient_division_ids: string[] | null;
      expires_at: Date | string | null;
    }>(
      `select kind, created_by_user_id, audience_type, recipient_user_ids,
              recipient_division_ids, expires_at
         from urgent_messages
        where id = $1 and deleted_at is null`,
      [id],
    );
    const current = existing.rows[0];
    if (!current) throw new HttpError(404, "Urgent message not found.");
    if (current.created_by_user_id !== userId) {
      throw new HttpError(403, "Only the creator can edit this urgent message.");
    }

    const body = requireObjectBody(request.body);
    const messageBody = readBody(body.body);
    const title = readTitle(body.title, messageBody);
    let audience: UrgentAudience = "creator";
    let recipientUserIds: string[] = [userId];
    let recipientDivisionIds: string[] = [];
    if (current.kind === "admin") {
      if (!canCreateAdminMessage(user)) {
        throw new HttpError(403, "Admin or assigned-division Sub-admin access required.");
      }
      audience = readAudience(body.audience ?? current.audience_type);
      recipientUserIds = readIdArray(
        body.recipientUserIds ?? current.recipient_user_ids ?? [],
        "recipientUserIds",
      );
      recipientDivisionIds = readIdArray(
        body.recipientDivisionIds ?? current.recipient_division_ids ?? [],
        "recipientDivisionIds",
      );
      if (audience === "users" && !recipientUserIds.length) {
        throw new HttpError(400, "Select at least one recipient.");
      }
      if (audience === "divisions" && !recipientDivisionIds.length) {
        throw new HttpError(400, "Select at least one division.");
      }
      const validatedRecipients = await validateAdminMessageRecipients(
        user,
        audience,
        recipientUserIds,
        recipientDivisionIds,
      );
      recipientUserIds = validatedRecipients.recipientUserIds;
      recipientDivisionIds = validatedRecipients.recipientDivisionIds;
    }

    let expiresAt: Date | string | null = current.expires_at;
    if (body.expiresAt !== undefined) {
      expiresAt =
        typeof body.expiresAt === "string" && body.expiresAt.trim()
          ? new Date(body.expiresAt)
          : null;
      if (expiresAt instanceof Date && Number.isNaN(expiresAt.getTime())) {
        throw new HttpError(400, "expiresAt must be a valid date.");
      }
    }

    await pool.query(
      `update urgent_messages
          set title = $2,
              body = $3,
              audience_type = $4,
              recipient_user_ids = $5::uuid[],
              recipient_division_ids = $6::uuid[],
              expires_at = $7
        where id = $1 and deleted_at is null`,
      [id, title, messageBody, audience, recipientUserIds, recipientDivisionIds, expiresAt],
    );
    const updated = await pool.query<UrgentMessageRow>(
      `select
         m.id, m.title, m.body, m.kind, m.created_by_user_id,
         m.created_by_name, m.created_by_role, m.audience_type,
         m.recipient_user_ids, m.recipient_division_ids,
         m.created_at, m.expires_at,
         coalesce(s.status, 'open') as status,
         s.snoozed_until, s.done_at
       from urgent_messages m
       left join urgent_message_user_state s
         on s.message_id = m.id and s.user_id = $2::uuid
       where m.id = $1`,
      [id, userId],
    );
    response.json({ message: mapMessage(updated.rows[0]) });
  }),
);

urgentMessagesRouter.post(
  "/:id/snooze",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user)) throw new HttpError(403, "Universal viewers cannot use messaging.");
    const id = requireParam(request.params.id, "id");
    const userId = databaseUserId(user);
    if (!userId) throw new HttpError(403, "This account cannot snooze urgent messages.");
    await assertVisibleMessage(user, id);
    const body = requireObjectBody(request.body);
    const minutes = Number(body.minutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080) {
      throw new HttpError(400, "minutes must be an integer between 5 and 10080.");
    }
    const result = await pool.query<UrgentMessageRow>(
      `insert into urgent_message_user_state (message_id, user_id, status, snoozed_until, done_at, updated_at)
       values ($1, $2, 'snoozed', now() + ($3 || ' minutes')::interval, null, now())
       on conflict (message_id, user_id) do update set
         status = 'snoozed', snoozed_until = excluded.snoozed_until,
         done_at = null, updated_at = now()
       returning message_id as id, null::text as title, null::text as body,
         null::text as kind, null::uuid as created_by_user_id,
         null::text as created_by_name, null::text as created_by_role,
         null::text as audience_type, null::uuid[] as recipient_user_ids,
         null::uuid[] as recipient_division_ids, now() as created_at,
         null::timestamptz as expires_at, status, snoozed_until, done_at`,
      [id, userId, minutes],
    );
    response.json({ state: mapMessage(result.rows[0]) });
  }),
);

urgentMessagesRouter.post(
  "/:id/done",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user)) throw new HttpError(403, "Universal viewers cannot use messaging.");
    const id = requireParam(request.params.id, "id");
    const userId = databaseUserId(user);
    if (!userId) throw new HttpError(403, "This account cannot complete urgent messages.");
    await assertVisibleMessage(user, id);
    await pool.query(
      `insert into urgent_message_user_state (message_id, user_id, status, snoozed_until, done_at, updated_at)
       values ($1, $2, 'done', null, now(), now())
       on conflict (message_id, user_id) do update set
         status = 'done', snoozed_until = null, done_at = now(), updated_at = now()`,
      [id, userId],
    );
    response.json({ ok: true });
  }),
);

urgentMessagesRouter.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (messagingBlocked(user)) throw new HttpError(403, "Universal viewers cannot delete messages.");
    await ensureUrgentMessageSchema();
    const id = requireParam(request.params.id, "id");
    const userId = databaseUserId(user);
    if (!userId) throw new HttpError(403, "This account cannot delete urgent messages.");
    const existing = await pool.query<{
      kind: UrgentMessageKind;
      created_by_user_id: string;
    }>(
      "select kind, created_by_user_id from urgent_messages where id = $1 and deleted_at is null",
      [id],
    );
    const current = existing.rows[0];
    if (!current) throw new HttpError(404, "Urgent message not found.");
    if (current.created_by_user_id !== userId) {
      throw new HttpError(403, "Only the message creator can delete it.");
    }
    if (current.kind === "admin" && !canCreateAdminMessage(user)) {
      throw new HttpError(403, "Only Admins and Sub-admins can delete urgent messages.");
    }
    const result = await pool.query(
      `delete from urgent_messages
        where id = $1
          and created_by_user_id = $2::uuid
          and deleted_at is null`,
      [id, userId],
    );
    if (!result.rowCount) {
      throw new HttpError(403, "Only the message creator can delete it.");
    }
    response.json({ deleted: true });
  }),
);
