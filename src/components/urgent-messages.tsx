import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BellRing,
  Check,
  CircleAlert,
  Clock3,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useActiveUser, useDivisions, useUsers, type AppUser } from "@/lib/files-store";
import { hasCapability } from "@/lib/permissions";

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

export type UrgentMessage = {
  id: string;
  title: string;
  body: string;
  kind: "reminder" | "admin";
  createdByUserId: string;
  createdByName: string;
  createdByRole: string;
  audience: "creator" | "all_users" | "users" | "divisions";
  recipientUserIds: string[];
  recipientDivisionIds: string[];
  createdAt: string;
  expiresAt?: string;
  status: "open" | "snoozed" | "done";
  snoozedUntil?: string;
  doneAt?: string;
  visibleNow: boolean;
};

const snoozeOptions = [
  { value: 15, label: "15 minutes" },
  { value: 60, label: "1 hour" },
  { value: 240, label: "4 hours" },
  { value: 1440, label: "Next working day" },
];

const URGENT_POPUP_DISMISS_MS = 15 * 60_000;

async function urgentRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => undefined)) as
    | (T & { error?: string })
    | undefined;
  if (!response.ok)
    throw new Error(body?.error ?? `Urgent message request failed: ${response.status}`);
  return body as T;
}

export function useUrgentMessages() {
  const activeUser = useActiveUser();
  const messagingBlocked = !hasCapability(activeUser, "canSendFileMessages");
  const [messages, setMessages] = useState<UrgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reload = async () => {
    if (!activeUser || messagingBlocked) {
      setMessages([]);
      setError("");
      return;
    }
    setLoading(true);
    try {
      const result = await urgentRequest<{ messages: UrgentMessage[] }>("/api/urgent-messages");
      setMessages(result.messages);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Urgent messages could not be loaded.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void reload();
    const refresh = () => void reload();
    window.addEventListener("recordkeeper:urgent-messages-updated", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("recordkeeper:urgent-messages-updated", refresh);
      window.clearInterval(timer);
    };
  }, [activeUser?.id, messagingBlocked]);
  return { messages, setMessages, loading, error, reload };
}

function notifyUrgentMessagesUpdated() {
  window.dispatchEvent(new Event("recordkeeper:urgent-messages-updated"));
}

function formatUrgentDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

/**
 * Keeps long urgent-message lists readable without making the whole page move.
 * It runs only when the list genuinely overflows, returns to the first item
 * after the last, and pauses while the user is reading or operating a message.
 */
function AutoScrollingMessageList({
  children,
  className,
  contentKey,
}: {
  children: ReactNode;
  className: string;
  contentKey: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    const list = listRef.current;
    if (!list || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    list.scrollTop = 0;
    let frame = 0;
    let previous = performance.now();
    let pauseUntil = performance.now() + 900;

    const advance = (now: number) => {
      const maximum = Math.max(0, list.scrollHeight - list.clientHeight);
      if (maximum > 1 && !pausedRef.current && now >= pauseUntil) {
        if (list.scrollTop >= maximum - 1) {
          list.scrollTop = 0;
          pauseUntil = now + 1200;
        } else {
          const elapsed = Math.min(80, Math.max(0, now - previous));
          list.scrollTop = Math.min(maximum, list.scrollTop + elapsed * 0.016);
        }
      }
      previous = now;
      frame = window.requestAnimationFrame(advance);
    };
    frame = window.requestAnimationFrame(advance);
    return () => window.cancelAnimationFrame(frame);
  }, [contentKey]);

  return (
    <div
      ref={listRef}
      className={className}
      onPointerEnter={() => {
        pausedRef.current = true;
      }}
      onPointerLeave={() => {
        pausedRef.current = false;
      }}
      onFocusCapture={() => {
        pausedRef.current = true;
      }}
      onBlurCapture={() => {
        pausedRef.current = false;
      }}
    >
      {children}
    </div>
  );
}

function UrgentMessageCard({
  message,
  onDone,
  onSnooze,
  onEdit,
  onDelete,
  number,
  compact = false,
}: {
  message: UrgentMessage;
  onDone?: (message: UrgentMessage) => void;
  onSnooze?: (message: UrgentMessage, minutes: number) => void;
  onEdit?: (message: UrgentMessage) => void;
  onDelete?: (message: UrgentMessage) => void;
  number?: number;
  compact?: boolean;
}) {
  const [minutes, setMinutes] = useState(60);
  const accent = message.kind === "reminder" ? "amber" : "sky";
  return (
    <article
      className={`group rounded-lg border border-border/80 border-l-4 bg-card shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-elevated)] ${
        accent === "amber"
          ? "border-l-warning"
          : "border-l-primary"
      } ${compact ? "px-2.5 py-2" : "p-4"}`}
    >
      <div className={`flex items-start ${compact ? "gap-2" : "gap-3"}`}>
        {number !== undefined ? (
          <span
            className={`${compact ? "size-5 text-[10px]" : "mt-0.5 size-6 text-[11px]"} inline-flex shrink-0 items-center justify-center rounded-full font-bold ${
              accent === "amber"
                ? "bg-warning/15 text-warning-foreground"
                : "bg-primary/10 text-primary"
            }`}
            aria-label={`Item ${number}`}
          >
            {number}
          </span>
        ) : (
          <CircleAlert
            className={`mt-0.5 size-4 shrink-0 ${accent === "amber" ? "text-warning" : "text-primary"}`}
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            {message.status === "done" ? (
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                Done
              </span>
            ) : null}
          </div>
          <p
            className={`${compact ? "text-sm leading-5" : "mt-1 text-[15px] leading-6"} whitespace-pre-wrap break-words text-foreground`}
          >
            {message.body}
          </p>
        </div>
        <div
          className={`flex shrink-0 items-center ${compact ? "flex-row gap-1" : "flex-col items-end gap-1"}`}
        >
          {message.status !== "done" && (onDone || onSnooze || onEdit || onDelete) ? (
            <div
              className={`flex items-center justify-end ${compact ? "flex-nowrap gap-1" : "flex-wrap gap-1.5"}`}
            >
              {onDone ? (
                <button
                  type="button"
                  onClick={() => onDone(message)}
                  className={`${compact ? "size-6" : "size-7"} inline-flex items-center justify-center rounded-md border border-success/35 bg-success/10 text-success transition-colors hover:bg-success/20`}
                  aria-label="Mark as done"
                  title="Mark as done"
                >
                  <Check className={compact ? "size-3" : "size-3.5"} aria-hidden="true" />
                </button>
              ) : null}
              {onSnooze ? (
                <>
                  <button
                    type="button"
                    onClick={() => onSnooze(message, minutes)}
                    className={`${compact ? "size-6" : "size-7"} inline-flex items-center justify-center rounded-md border border-border/80 bg-muted/20 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground`}
                    aria-label="Remind me later"
                    title="Remind me later"
                  >
                    <Clock3 className={compact ? "size-3" : "size-3.5"} aria-hidden="true" />
                  </button>
                  <select
                    value={minutes}
                    onChange={(event) => setMinutes(Number(event.target.value))}
                    className={`${compact ? "h-6 w-[4.75rem] min-w-0 px-1 text-[10px]" : "h-7 px-2 text-[11px]"} rounded-md border border-input bg-background`}
                  >
                    {snoozeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
              {onEdit ? (
                <button
                  type="button"
                  onClick={() => onEdit(message)}
                  className={`${compact ? "size-6" : "size-7"} inline-flex items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground`}
                  aria-label="Edit"
                  title="Edit"
                >
                  <Pencil className={compact ? "size-3" : "size-3.5"} aria-hidden="true" />
                </button>
              ) : null}
              {onDelete ? (
                <button
                  type="button"
                  onClick={() => onDelete(message)}
                  className="inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-3" aria-hidden="true" /> Delete
                </button>
              ) : null}
            </div>
          ) : null}
          <p
            className={`text-right text-muted-foreground ${compact ? "whitespace-nowrap text-[10px] leading-4" : "text-[11px]"}`}
          >
            {formatUrgentDate(message.createdAt)}
            {message.expiresAt ? ` · ${formatUrgentDate(message.expiresAt)}` : ""}
          </p>
        </div>
      </div>
    </article>
  );
}

export function UrgentMessagePrompt({ suppress = false }: { suppress?: boolean } = {}) {
  const { messages, setMessages, loading, error } = useUrgentMessages();
  const visibleMessages = useMemo(
    () => messages.filter((message) => message.visibleNow && message.status !== "done"),
    [messages],
  );
  const visibleReminders = useMemo(
    () => visibleMessages.filter((message) => message.kind === "reminder"),
    [visibleMessages],
  );
  const visibleAdminMessages = useMemo(
    () => visibleMessages.filter((message) => message.kind === "admin"),
    [visibleMessages],
  );
  const [open, setOpen] = useState(false);
  const [dismissedUntil, setDismissedUntil] = useState<number>();
  const [rotationActive, setRotationActive] = useState(() =>
    typeof document !== "undefined" &&
    document.documentElement.dataset.noticeBoardRotation === "active",
  );
  const dismissPrompt = useCallback(() => {
    setOpen(false);
    setDismissedUntil(Date.now() + URGENT_POPUP_DISMISS_MS);
  }, []);
  useEffect(() => {
    const updateRotationState = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      const active =
        detail?.active === true ||
        document.documentElement.dataset.noticeBoardRotation === "active";
      setRotationActive(active);
      if (active) {
        // Close an already-open prompt immediately when Notice Board rotation
        // starts. The root-level suppress prop is intentionally mirrored here
        // so the prompt cannot remain over a rotating view during the brief
        // event/state update window.
        setOpen(false);
      }
    };
    window.addEventListener("recordkeeper:notice-board-rotation", updateRotationState);
    return () =>
      window.removeEventListener("recordkeeper:notice-board-rotation", updateRotationState);
  }, []);
  const isSuppressed = suppress || rotationActive;
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissPrompt();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dismissPrompt, open]);
  useEffect(() => {
    if (isSuppressed) {
      setOpen(false);
      return;
    }
    if (!visibleMessages.length) {
      setOpen(false);
      setDismissedUntil(undefined);
      return;
    }
    if (dismissedUntil && dismissedUntil > Date.now()) {
      const timer = window.setTimeout(() => {
        setDismissedUntil(undefined);
        setOpen(true);
      }, dismissedUntil - Date.now());
      return () => window.clearTimeout(timer);
    }
    setOpen(true);
  }, [dismissedUntil, isSuppressed, visibleMessages.length]);
  if (isSuppressed || !open || !visibleMessages.length || loading) return null;
  const updateState = (id: string, patch: Partial<UrgentMessage>) => {
    setMessages((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };
  const done = async (message: UrgentMessage) => {
    try {
      await urgentRequest(`/api/urgent-messages/${message.id}/done`, {
        method: "POST",
        body: "{}",
      });
      updateState(message.id, {
        status: "done",
        visibleNow: false,
        doneAt: new Date().toISOString(),
      });
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : "Could not complete the reminder.");
    }
  };
  const snooze = async (message: UrgentMessage, minutes: number) => {
    try {
      const snoozedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
      await urgentRequest(`/api/urgent-messages/${message.id}/snooze`, {
        method: "POST",
        body: JSON.stringify({ minutes }),
      });
      updateState(message.id, { status: "snoozed", visibleNow: false, snoozedUntil });
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : "Could not snooze the reminder.");
    }
  };
  const renderMessageGroup = (
    title: string,
    groupMessages: UrgentMessage[],
    emptyLabel: string,
    showClose = false,
  ) => (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border p-3 shadow-[var(--shadow-card)] ${
        title === "Urgent Reminders"
          ? "border-warning/35 bg-secondary/35"
          : "border-primary/30 bg-secondary/35"
      }`}
      aria-label={title}
    >
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-border/70 pb-2">
        <div className="flex items-center gap-2">
          {title === "Urgent Reminders" ? (
            <BellRing className="size-4 text-warning" aria-hidden="true" />
          ) : (
            <MessageSquare className="size-4 text-primary" aria-hidden="true" />
          )}
          <h3 className="text-sm font-bold tracking-tight text-foreground">
            {title} - {groupMessages.length}
          </h3>
        </div>
        {showClose ? (
          <button
            type="button"
            onClick={() => {
              dismissPrompt();
            }}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            aria-label="Close urgent reminders and messages"
            title="Close"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {groupMessages.length ? (
        <AutoScrollingMessageList
          contentKey={groupMessages.map((message) => `${message.id}:${message.status}:${message.snoozedUntil ?? message.createdAt}`).join("|")}
          className="min-h-0 max-h-[41vh] space-y-2 overflow-y-auto pr-1"
        >
          {groupMessages.map((message, index) => (
            <UrgentMessageCard
              key={message.id}
              message={message}
              number={index + 1}
              compact
              onDone={done}
              onSnooze={snooze}
            />
          ))}
        </AutoScrollingMessageList>
      ) : (
        <p className="rounded-xl border border-dashed border-border/80 bg-background/45 px-3 py-5 text-xs text-muted-foreground">
          {emptyLabel}
        </p>
      )}
    </section>
  );
  return (
    <div
      data-urgent-message-prompt="true"
      className="fixed inset-0 z-[100] grid place-items-center bg-foreground/20 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Urgent reminders and messages"
      onClick={dismissPrompt}
    >
      <div
        className="relative flex max-h-[min(1040px,calc(100dvh-1rem))] w-full max-w-[1180px] flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-elevated)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-background p-5 sm:p-6">
          {renderMessageGroup(
            "Urgent Reminders",
            visibleReminders,
            "No unresolved urgent reminders.",
            true,
          )}
          {renderMessageGroup(
            "Urgent Messages",
            visibleAdminMessages,
            "No unresolved urgent messages.",
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border bg-secondary/35 px-5 py-3 text-xs text-muted-foreground">
          <span>
            {visibleMessages.length} unresolved item{visibleMessages.length === 1 ? "" : "s"}
          </span>
          <span className="hidden sm:inline">Complete or snooze an item to clear it.</span>
        </div>
        {error ? (
          <p className="border-t border-border px-5 py-2 text-xs text-destructive">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

export function UrgentMessageTicker({ kind }: { kind: "reminder" | "admin" }) {
  const activeUser = useActiveUser();
  const { messages, loading, error } = useUrgentMessages();
  const messagingBlocked = !hasCapability(activeUser, "canSendFileMessages");
  const activeMessages = useMemo(
    () =>
      messages.filter(
        (message) => message.kind === kind && message.visibleNow && message.status !== "done",
      ),
    [kind, messages],
  );
  if (messagingBlocked) return null;
  const label = kind === "reminder" ? "Urgent reminders" : "Urgent messages";
  return (
    <section
      className="mx-auto w-full max-w-4xl rounded-xl border border-border bg-muted/30 p-6"
      aria-label={label}
    >
      <div className="flex items-center gap-2">
        <CircleAlert className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-lg font-semibold">{label}</h2>
        {activeMessages.length ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            {activeMessages.length} active
          </span>
        ) : null}
      </div>
      {loading ? <p className="mt-4 text-sm text-muted-foreground">Loading…</p> : null}
      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      {!loading && !error && activeMessages.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No active {kind === "reminder" ? "urgent reminders" : "urgent messages"}.
        </p>
      ) : null}
      {activeMessages.length ? (
        <AutoScrollingMessageList
          contentKey={activeMessages.map((message) => `${message.id}:${message.status}:${message.snoozedUntil ?? message.createdAt}`).join("|")}
          className="mt-4 grid max-h-80 gap-3 overflow-y-auto pr-1"
        >
          {activeMessages.map((message) => (
            <article key={message.id} className="rounded-lg border border-border bg-background p-4">
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {message.kind === "admin"
                  ? `From Admin · ${formatUrgentDate(message.createdAt)}`
                  : `Created ${formatUrgentDate(message.createdAt)}`}
              </p>
            </article>
          ))}
        </AutoScrollingMessageList>
      ) : null}
    </section>
  );
}

function UserRecipientPicker({
  users,
  selected,
  onChange,
}: {
  users: AppUser[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="max-h-36 overflow-y-auto rounded-md border border-border p-2">
      {users.map((user) => (
        <label
          key={user.id}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent"
        >
          <input
            type="checkbox"
            checked={selected.includes(user.id)}
            onChange={() =>
              onChange(
                selected.includes(user.id)
                  ? selected.filter((id) => id !== user.id)
                  : [...selected, user.id],
              )
            }
            className="size-3.5 accent-primary"
          />
          <span>
            {user.name} <span className="text-muted-foreground">({user.username})</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function UrgentMessagesPanel({ kind }: { kind: "reminder" | "admin" }) {
  const activeUser = useActiveUser();
  const users = useUsers();
  const divisions = useDivisions();
  const isAdmin = activeUser?.role === "admin";
  const isSubAdmin = activeUser?.role === "sub_admin";
  const messagingBlocked = !hasCapability(activeUser, "canSendFileMessages");
  const scopedDivisionIds = useMemo(
    () => new Set(activeUser?.divisionIds ?? []),
    [activeUser?.divisionIds],
  );
  const recipientDivisions = useMemo(
    () =>
      isSubAdmin ? divisions.filter((division) => scopedDivisionIds.has(division.id)) : divisions,
    [divisions, isSubAdmin, scopedDivisionIds],
  );
  const recipientUsers = useMemo(
    () =>
      isSubAdmin
        ? users.filter(
            (user) =>
              (user.role === "admin" || user.role === "editor") &&
              user.divisionIds.some((id) => scopedDivisionIds.has(id)),
          )
        : users.filter((user) =>
            ["admin", "sub_admin", "editor"].includes(user.role),
          ),
    [isSubAdmin, scopedDivisionIds, users],
  );
  const { messages, loading, error, reload } = useUrgentMessages();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<UrgentMessage>();
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all_users" | "users" | "divisions">(
    activeUser?.role === "sub_admin" && kind === "admin" ? "users" : "all_users",
  );
  const [recipientUserIds, setRecipientUserIds] = useState<string[]>([]);
  const [recipientDivisionIds, setRecipientDivisionIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [snoozeId, setSnoozeId] = useState<string>();
  const panelMessages = messages.filter(
    (message) => message.kind === kind && message.status !== "done",
  );
  const isReminderPanel = kind === "reminder";
  const canCreateAdmin = hasCapability(activeUser, "canSendUrgentMessages");
  const canCreate = !messagingBlocked && (isReminderPanel || canCreateAdmin);
  const defaultAudience = isSubAdmin && !isReminderPanel ? "users" : "all_users";
  const panelTitle = isReminderPanel ? "Urgent reminders" : "Messages";
  const panelDescription = isReminderPanel
    ? "Create personal work reminders; each user controls their own snooze timer."
    : isSubAdmin
      ? "Send urgent messages to Editors and Admins in your assigned divisions."
      : "Admin messages sent to your account, division, or all users.";
  const resetComposer = () => {
    setBody("");
    setAudience(defaultAudience);
    setRecipientUserIds([]);
    setRecipientDivisionIds([]);
    setEditingMessage(undefined);
    setCreateOpen(false);
  };
  const startCreate = () => {
    if (createOpen && !editingMessage) {
      resetComposer();
      return;
    }
    setBody("");
    setAudience(defaultAudience);
    setRecipientUserIds([]);
    setRecipientDivisionIds([]);
    setEditingMessage(undefined);
    setCreateOpen(true);
  };
  const startEdit = (message: UrgentMessage) => {
    setBody(message.body);
    setAudience(
      message.audience === "creator" || (isSubAdmin && message.audience === "all_users")
        ? defaultAudience
        : message.audience,
    );
    setRecipientUserIds(message.recipientUserIds);
    setRecipientDivisionIds(message.recipientDivisionIds);
    setEditingMessage(message);
    setCreateOpen(true);
  };
  const create = async (kind: "reminder" | "admin") => {
    setSaving(true);
    try {
      await urgentRequest(
        editingMessage ? `/api/urgent-messages/${editingMessage.id}` : "/api/urgent-messages",
        {
          method: editingMessage ? "PATCH" : "POST",
          body: JSON.stringify({
            kind,
            body,
            audience: kind === "admin" ? audience : undefined,
            recipientUserIds: kind === "admin" ? recipientUserIds : undefined,
            recipientDivisionIds: kind === "admin" ? recipientDivisionIds : undefined,
          }),
        },
      );
      resetComposer();
      notifyUrgentMessagesUpdated();
      await reload();
    } catch (reason) {
      window.alert(
        reason instanceof Error
          ? reason.message
          : editingMessage
            ? "Could not update the urgent message."
            : "Could not create the urgent message.",
      );
    } finally {
      setSaving(false);
    }
  };
  const done = async (message: UrgentMessage) => {
    await urgentRequest(`/api/urgent-messages/${message.id}/done`, { method: "POST", body: "{}" });
    notifyUrgentMessagesUpdated();
    await reload();
  };
  const snooze = async (message: UrgentMessage, minutes: number) => {
    setSnoozeId(message.id);
    try {
      await urgentRequest(`/api/urgent-messages/${message.id}/snooze`, {
        method: "POST",
        body: JSON.stringify({ minutes }),
      });
      notifyUrgentMessagesUpdated();
      await reload();
    } finally {
      setSnoozeId(undefined);
    }
  };
  const remove = async (message: UrgentMessage) => {
    if (!window.confirm("Delete this urgent message?")) return;
    await urgentRequest(`/api/urgent-messages/${message.id}`, { method: "DELETE" });
    await reload();
  };
  if (messagingBlocked) return null;
  return (
    <section
      className="mb-4 rounded-md border border-border bg-muted/30 p-4"
      aria-label={panelTitle}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CircleAlert className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-bold">{panelTitle}</h2>
            {panelMessages.length ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {panelMessages.length} unresolved
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {panelDescription} These items are also shown in the scrolling Notice Board ticker when
            due.
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
          >
            <Plus className="size-3.5" />{" "}
            {isReminderPanel ? "Add urgent reminder" : "Send urgent message"}
          </button>
        ) : null}
      </div>
      {panelMessages.length ? (
        <AutoScrollingMessageList
          contentKey={panelMessages.map((message) => `${message.id}:${message.status}:${message.snoozedUntil ?? message.createdAt}`).join("|")}
          className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1"
        >
          {panelMessages.map((message) => (
            <UrgentMessageCard
              key={message.id}
              message={message}
              compact
              onDone={done}
              onSnooze={snooze}
              onEdit={message.createdByUserId === activeUser?.id ? startEdit : undefined}
              onDelete={message.createdByUserId === activeUser?.id ? remove : undefined}
            />
          ))}
        </AutoScrollingMessageList>
      ) : (
        <p className="mt-3 rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          No unresolved {isReminderPanel ? "urgent reminders" : "messages"}.
        </p>
      )}
      {createOpen && canCreate ? (
        <div className="mt-4 rounded-md border border-border bg-background p-3">
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">
                {editingMessage
                  ? isReminderPanel
                    ? "Edit urgent reminder"
                    : "Edit urgent message"
                  : isReminderPanel
                    ? "New urgent reminder"
                    : "New urgent message"}
              </h3>
            </div>
            <label className="text-xs font-medium">
              Message
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={100}
                rows={3}
                className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm"
                placeholder={
                  isReminderPanel
                    ? "Describe the work reminder"
                    : "Write the message for recipients"
                }
              />
              <div className="mt-1 text-right text-[11px] text-muted-foreground">
                {body.length}/100
              </div>
            </label>
            {!isReminderPanel ? (
              <>
                <label className="text-xs font-medium">
                  Send to
                  <select
                    value={audience}
                    onChange={(event) => setAudience(event.target.value as typeof audience)}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm"
                  >
                    {!isSubAdmin ? <option value="all_users">All users</option> : null}
                    <option value="users">Selected users</option>
                    <option value="divisions">Selected divisions</option>
                  </select>
                  {isSubAdmin ? (
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      Only Editors and Admins in your assigned divisions can receive these messages.
                    </span>
                  ) : null}
                </label>
                {audience === "users" ? (
                  <UserRecipientPicker
                    users={recipientUsers}
                    selected={recipientUserIds}
                    onChange={setRecipientUserIds}
                  />
                ) : null}
                {audience === "divisions" ? (
                  <div className="max-h-36 overflow-y-auto rounded-md border border-border p-2">
                    {recipientDivisions.map((division) => (
                      <label
                        key={division.id}
                        className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent"
                      >
                        <input
                          type="checkbox"
                          checked={recipientDivisionIds.includes(division.id)}
                          onChange={() =>
                            setRecipientDivisionIds(
                              recipientDivisionIds.includes(division.id)
                                ? recipientDivisionIds.filter((id) => id !== division.id)
                                : [...recipientDivisionIds, division.id],
                            )
                          }
                          className="size-3.5 accent-primary"
                        />
                        {division.name}
                      </label>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={resetComposer}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !body.trim()}
                onClick={() => void create(isReminderPanel ? "reminder" : "admin")}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {editingMessage ? (
                  <Pencil className="size-3.5" />
                ) : isReminderPanel ? (
                  <Plus className="size-3.5" />
                ) : (
                  <Send className="size-3.5" />
                )}
                {saving
                  ? "Saving…"
                  : editingMessage
                    ? "Save changes"
                    : isReminderPanel
                      ? "Save reminder"
                      : "Send urgent message"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {loading || snoozeId ? (
        <p className="mt-2 text-[11px] text-muted-foreground">Updating urgent messages…</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
