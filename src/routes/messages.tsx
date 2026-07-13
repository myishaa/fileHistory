import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bell, Check, ChevronLeft, ChevronRight, Eye, FolderOpen, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { store, type FileMessage, useActiveUser, useMessages } from "@/lib/files-store";

type MessageView = "pending" | "resolved" | "sent" | "received";

const pageSize = 12;

export const Route = createFileRoute("/messages")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: isMessageView(search.view) ? search.view : undefined,
    page: parsePage(search.page),
    division: typeof search.division === "string" ? search.division : undefined,
    section: typeof search.section === "string" ? search.section : undefined,
  }),
  component: MessagesPage,
});

function MessagesPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const activeUser = useActiveUser();
  const messages = useMessages();
  const isViewer = activeUser?.role === "viewer" || activeUser?.role === "division_user";
  const defaultView: MessageView = isViewer ? "sent" : "pending";
  const view = search.view ?? defaultView;
  const currentPage = search.page ?? 1;
  const visibleViews = isViewer
    ? (["sent", "received"] as const)
    : (["pending", "resolved"] as const);
  const pendingMessages = messages.filter((message) => message.status === "pending");
  const resolvedMessages = messages.filter((message) => message.status === "resolved");
  const viewMessages =
    view === "sent"
      ? pendingMessages
      : view === "received"
        ? resolvedMessages
        : view === "pending"
          ? pendingMessages
          : resolvedMessages;
  const divisions = useMemo(
    () => uniqueSorted(viewMessages.map((message) => message.divisionName)),
    [viewMessages],
  );
  const divisionFiltered = search.division
    ? viewMessages.filter((message) => message.divisionName === search.division)
    : viewMessages;
  const sections = useMemo(
    () => uniqueSorted(divisionFiltered.map((message) => message.section)),
    [divisionFiltered],
  );
  const filteredMessages = search.section
    ? divisionFiltered.filter((message) => message.section === search.section)
    : divisionFiltered;
  const totalPages = Math.max(1, Math.ceil(filteredMessages.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageMessages = filteredMessages.slice((safePage - 1) * pageSize, safePage * pageSize);

  const updateSearch = (
    patch: Partial<{ view: MessageView; page: number; division: string; section: string }>,
  ) => {
    navigate({
      to: "/messages",
      search: {
        view,
        page: safePage,
        division: search.division,
        section: search.section,
        ...patch,
      },
    });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Bell className="size-5" />
            Messages
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filteredMessages.length} message{filteredMessages.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="grid grid-cols-2 rounded-md border border-border bg-card p-1">
          {visibleViews.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() =>
                updateSearch({
                  view: item,
                  page: 1,
                  division: undefined,
                  section: undefined,
                })
              }
              className={
                "h-8 rounded px-4 text-sm font-medium capitalize " +
                (view === item ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground")
              }
            >
              {item} {countForView(item, pendingMessages, resolvedMessages)}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-3 md:grid-cols-[1fr_1fr_auto]">
        <label className="block">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Division</div>
          <select
            value={search.division ?? ""}
            onChange={(event) =>
              updateSearch({
                division: event.target.value || undefined,
                section: undefined,
                page: 1,
              })
            }
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="">All divisions</option>
            {divisions.map((division) => (
              <option key={division} value={division}>
                {division}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Section</div>
          <select
            value={search.section ?? ""}
            onChange={(event) =>
              updateSearch({
                section: event.target.value || undefined,
                page: 1,
              })
            }
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="">All sections</option>
            {sections.map((section) => (
              <option key={section} value={section}>
                {section}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => updateSearch({ division: undefined, section: undefined, page: 1 })}
          className="self-end rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Clear
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="grid grid-cols-[1fr_8rem_8rem_9rem] gap-3 border-b border-border bg-secondary px-4 py-2.5 text-xs font-medium text-muted-foreground">
          <div>Message</div>
          <div>Division</div>
          <div>Section</div>
          <div className="text-right">Action</div>
        </div>
        {pageMessages.length ? (
          pageMessages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              isViewer={isViewer}
              isAdmin={activeUser?.role === "admin"}
            />
          ))
        ) : (
          <div className="p-6 text-sm text-muted-foreground">No messages found.</div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Page {safePage} of {totalPages}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => updateSearch({ page: Math.max(1, safePage - 1) })}
            disabled={safePage <= 1}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            <ChevronLeft className="size-4" />
            Previous
          </button>
          <button
            type="button"
            onClick={() => updateSearch({ page: Math.min(totalPages, safePage + 1) })}
            disabled={safePage >= totalPages}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Next
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  isViewer,
  isAdmin,
}: {
  message: FileMessage;
  isViewer: boolean;
  isAdmin: boolean;
}) {
  const navigate = useNavigate();
  const canMarkViewed = isViewer && message.status === "resolved" && !message.viewedAt;
  const canDelete = isAdmin || (isViewer && message.status === "pending");
  const canResolve = !isViewer && message.status === "pending";

  return (
    <div className="grid grid-cols-[1fr_8rem_8rem_9rem] gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <button
        type="button"
        onClick={() =>
          navigate({
            to: "/add",
            search: {
              fileId: message.fileId,
              section: message.section,
              milestone: undefined,
              quickFocus: false,
            },
          })
        }
        className="min-w-0 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {message.fileUniqueCode || message.fileNo || message.imms || "File"}
          </span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium capitalize">
            {message.status}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{message.text}</p>
        <div className="mt-1 text-xs text-muted-foreground">
          {message.createdByName} · {formatMessageDate(message.createdAt)}
          {message.resolvedByName
            ? ` · Resolved by ${message.resolvedByName}${message.resolvedAt ? ` on ${formatMessageDate(message.resolvedAt)}` : ""}`
            : ""}
        </div>
      </button>
      <div className="truncate text-sm text-muted-foreground">{message.divisionName}</div>
      <div className="truncate text-sm text-muted-foreground">{message.section}</div>
      <div className="flex justify-end gap-1">
        <button
          type="button"
          onClick={() =>
            navigate({
              to: "/add",
              search: {
                fileId: message.fileId,
                section: message.section,
                milestone: undefined,
                quickFocus: false,
              },
            })
          }
          title="Open section"
          aria-label="Open section"
          className="grid size-8 place-items-center rounded-md border border-border hover:bg-accent"
        >
          <FolderOpen className="size-4" />
        </button>
        {canMarkViewed ? (
          <button
            type="button"
            onClick={() => void store.markMessageViewed(message.id)}
            title="Mark viewed"
            aria-label="Mark viewed"
            className="grid size-8 place-items-center rounded-md border border-border hover:bg-accent"
          >
            <Eye className="size-4" />
          </button>
        ) : null}
        {canResolve ? (
          <button
            type="button"
            onClick={() => void store.resolveMessage(message.id)}
            title="Resolve"
            aria-label="Resolve"
            className="grid size-8 place-items-center rounded-md border border-border text-success hover:bg-success/10"
          >
            <Check className="size-4" />
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            onClick={() => void store.deleteMessage(message.id)}
            title="Delete"
            aria-label="Delete"
            className="grid size-8 place-items-center rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function isMessageView(value: unknown): value is MessageView {
  return value === "pending" || value === "resolved" || value === "sent" || value === "received";
}

function parsePage(value: unknown) {
  const page = typeof value === "string" ? Number.parseInt(value, 10) : undefined;
  return page && page > 0 ? page : undefined;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function countForView(
  view: MessageView,
  pendingMessages: FileMessage[],
  resolvedMessages: FileMessage[],
) {
  return view === "pending" || view === "sent" ? pendingMessages.length : resolvedMessages.length;
}

function formatMessageDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
