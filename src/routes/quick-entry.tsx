import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  FolderOpen,
  Pencil,
  Save,
  ScanLine,
  Search,
} from "lucide-react";
import { fileSupplyOrders, rawSupplyOrders } from "@/lib/effective-deliveries";
import {
  createFileStatusUpdate,
  fetchFilesByUniqueCode,
  fetchQuickStatusContext,
  lookupQuickStatusFiles,
  updateFileStatusUpdate,
  type FileRecord,
  type FileStatusUpdate,
  type QuickStatusFileSummary,
  useActiveUser,
} from "@/lib/files-store";
import {
  isBiddingApplicableForFile,
  isDeliveryInspectionApplicableByGroup,
} from "@/lib/file-type-groups";

export const Route = createFileRoute("/quick-entry")({
  component: QuickEntryPage,
});

const quickEntryStageSections = [
  {
    title: "Scrutiny and control",
    milestones: ["Scrutiny", "Controlling", "Control", "Controlled"],
  },
  {
    title: "TCEC block",
    milestones: ["Pre-TCEC", "Post-TCEC", "Refloat Post-TCEC"],
  },
  {
    title: "Approval block",
    milestones: ["High Value", "AD", "R&QA", "RQA", "IFA", "CFA"],
  },
  {
    title: "Bidding details",
    milestones: ["Bidding", "CNC", "RFP Vetting", "Refloat", "RST"],
  },
  {
    title: "Supply order and payment",
    milestones: [
      "Supply Order",
      "Financial Sanction",
      "Delivery Period",
      "PSB",
      "PWB",
      "PSB+PWB",
      "Delivery",
      "IR Preparation",
      "IR Receipt",
      "Bill preparation",
      "Bill sent for payment",
      "Payment",
      "Advance Payment",
    ],
  },
  {
    title: "Firm details",
    milestones: ["Firm details", "Firm Detail", "Firm"],
  },
];

type QuickEntryError = { tone: "error" | "success"; text: string };
type QuickStatusContext = {
  file: FileRecord;
  statuses: FileStatusUpdate[];
};
type QuickEntryDestination = {
  title: string;
  focusTarget?: string;
};

function QuickEntryPage() {
  const activeUser = useActiveUser();
  if (!activeUser) {
    return (
      <div className="max-w-xl rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <h1 className="text-sm font-semibold">Quick Entry unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">Login is required.</p>
      </div>
    );
  }

  return <QuickEntryEditor />;
}

function QuickEntryEditor() {
  const navigate = useNavigate();
  const activeUser = useActiveUser();
  const canEditFiles =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    activeUser?.role === "editor";
  const isReadOnlyQuickEntry = activeUser?.role === "universal_viewer";
  const canCreateFileStatus = activeUser?.role !== "universal_viewer";
  const [uniqueCode, setUniqueCode] = useState("");
  const [message, setMessage] = useState<QuickEntryError | null>(null);
  const [milestoneFileId, setMilestoneFileId] = useState("");
  const [loading, setLoading] = useState(false);

  const [controlNo, setControlNo] = useState("");
  const [description, setDescription] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<QuickEntryError | null>(null);
  const [matches, setMatches] = useState<QuickStatusFileSummary[]>([]);
  const [context, setContext] = useState<QuickStatusContext | undefined>();
  const [statusDraft, setStatusDraft] = useState("");
  const [editingStatusId, setEditingStatusId] = useState("");
  const [editingStatusText, setEditingStatusText] = useState("");

  const findFile = async () => {
    const code = normalizeQuickEntryCode(uniqueCode);
    if (!code) {
      setMessage({ tone: "error", text: "Scan or enter the Unique code first." });
      return undefined;
    }

    setLoading(true);
    const found = await fetchFilesByUniqueCode(code)
      .then((result) => result.files)
      .catch((error) => {
        console.error(error);
        setMessage({ tone: "error", text: "File lookup failed. Please try again." });
        return [];
      })
      .finally(() => setLoading(false));
    if (found.length === 0) {
      setMessage({
        tone: "error",
        text: "No accessible file was found for this Unique code.",
      });
      return undefined;
    }
    if (found.length > 1) {
      setMessage({
        tone: "error",
        text: "More than one accessible file has this Unique code. Please correct duplicate codes before using Quick Entry.",
      });
      return undefined;
    }
    return found[0];
  };

  const continueToCurrentStage = async () => {
    const file = await findFile();
    if (!file) return;

    const stage = getQuickEntryStageForCurrentMilestone(file);
    if (!stage) {
      setMilestoneFileId(file.id);
      setMessage({
        tone: "error",
        text: file.currentMilestone
          ? `The current milestone "${file.currentMilestone}" is not linked to a Quick Entry stage. Please update the current status under Milestones.`
          : "Current status is not selected and no dated Quick Entry stage was found for this file. Please select the current status under Milestones.",
      });
      return;
    }

    setMilestoneFileId("");
    navigate({
      to: "/add",
      search: {
        fileId: file.id,
        section: stage.title,
        milestone: undefined,
        focusTarget: stage.focusTarget,
        quickFocus: true,
      },
    });
  };

  const loadStatusContext = async (fileId: string) => {
    const loaded = await fetchQuickStatusContext(fileId);
    setContext(loaded);
    setControlNo(loaded.file.imms ?? "");
    setDescription(loaded.file.demandDescription ?? "");
    setStatusDraft("");
    setEditingStatusId("");
    setEditingStatusText("");
    return loaded;
  };

  const lookupFile = async () => {
    const cleanControl = controlNo.trim();
    const cleanDescription = description.trim();
    if (!cleanControl && !cleanDescription) {
      setLookupMessage({ tone: "error", text: "Enter Control No. or Item description." });
      return;
    }
    setLookupLoading(true);
    setLookupMessage(null);
    setContext(undefined);
    const result = await lookupQuickStatusFiles({
      controlNo: cleanControl,
      description: cleanDescription,
    })
      .catch((error) => {
        console.error(error);
        setLookupMessage({ tone: "error", text: "File lookup failed." });
        return { files: [] };
      })
      .finally(() => setLookupLoading(false));
    setMatches(result.files);
    if (result.files.length === 0) {
      setLookupMessage({ tone: "error", text: "No matching file found." });
      return;
    }
    if (result.files.length === 1) {
      await loadStatusContext(result.files[0].id);
      setLookupMessage({ tone: "success", text: "File matched." });
      return;
    }
    setLookupMessage({ tone: "success", text: "Multiple files matched. Select one." });
  };

  const saveStatus = async () => {
    if (!context) return;
    if (!canCreateFileStatus) {
      setLookupMessage({ tone: "error", text: "Universal Viewer can view File Status only." });
      return;
    }
    if (countWords(statusDraft) > 50) {
      setLookupMessage({ tone: "error", text: "File Status cannot exceed 50 words." });
      return;
    }
    if (!statusDraft.trim()) {
      setLookupMessage({ tone: "error", text: "Enter File Status." });
      return;
    }
    const result = await createFileStatusUpdate(context.file.id, statusDraft.trim()).catch(
      (error) => {
        console.error(error);
        setLookupMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Save failed.",
        });
        return undefined;
      },
    );
    if (!result) return;
    setContext({ ...context, statuses: result.statuses });
    setStatusDraft("");
    setLookupMessage({ tone: "success", text: "File Status saved." });
  };

  const saveEditedStatus = async (statusId: string) => {
    if (!context) return;
    if (countWords(editingStatusText) > 50) {
      setLookupMessage({ tone: "error", text: "File Status cannot exceed 50 words." });
      return;
    }
    const result = await updateFileStatusUpdate(statusId, editingStatusText.trim()).catch(
      (error) => {
        console.error(error);
        setLookupMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Update failed.",
        });
        return undefined;
      },
    );
    if (!result) return;
    setContext({ ...context, statuses: result.statuses });
    setEditingStatusId("");
    setEditingStatusText("");
    setLookupMessage({ tone: "success", text: "File Status updated." });
  };

  return (
    <div className="space-y-4">
      {!isReadOnlyQuickEntry ? (
        <section className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <div className="mb-5 flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-secondary">
              <ScanLine className="size-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Quick Entry</h2>
              <p className="text-xs text-muted-foreground">
                Scan the file barcode to open the currently running stage and focus the first
                unfilled field.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
            <label className="block">
              <div className="mb-1.5 text-xs font-medium">Unique code</div>
              <input
                value={uniqueCode}
                onChange={(event) => {
                  setUniqueCode(event.target.value);
                  setMessage(null);
                  setMilestoneFileId("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canEditFiles) {
                    event.preventDefault();
                    void continueToCurrentStage();
                  }
                }}
                autoFocus
                placeholder="Scan barcode or type Unique code"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <button
              type="button"
              onClick={() => void continueToCurrentStage()}
              disabled={loading || !canEditFiles}
              title={canEditFiles ? "Open current stage" : "Only editors/admins can open stages"}
              className="inline-flex h-10 items-center justify-center gap-1.5 self-end rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Finding..." : "Open current stage"} <ArrowRight className="size-4" />
            </button>
          </div>

          {message ? (
            <div
              className={
                "mt-4 rounded-md border px-3 py-2 text-sm " +
                "border-destructive/40 bg-destructive/10 text-destructive"
              }
            >
              <div>{message.text}</div>
              {milestoneFileId ? (
                <button
                  type="button"
                  onClick={() =>
                    navigate({
                      to: "/add",
                      search: {
                        fileId: milestoneFileId,
                        section: "Milestones",
                        milestone: undefined,
                        quickFocus: true,
                      },
                    })
                  }
                  className="mt-2 h-8 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
                >
                  Open Milestones
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="mb-5 flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-secondary">
            <FileText className="size-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold">File Status</h2>
            <p className="text-xs text-muted-foreground">
              Find a file, view its timeline, then add an independent status note.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(180px,0.9fr)_minmax(260px,1.4fr)_auto]">
          <label>
            <div className="mb-1.5 text-xs font-medium">Control No.</div>
            <input
              value={controlNo}
              onChange={(event) => setControlNo(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void lookupFile();
              }}
              placeholder="Enter Control No."
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label>
            <div className="mb-1.5 text-xs font-medium">Item description</div>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void lookupFile();
              }}
              placeholder="Enter item description"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <button
            type="button"
            onClick={() => void lookupFile()}
            disabled={lookupLoading}
            className="inline-flex h-10 items-center justify-center gap-1.5 self-end rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            <Search className="size-4" />
            {lookupLoading ? "Finding..." : "Find"}
          </button>
        </div>

        {lookupMessage ? (
          <div
            className={
              "mt-4 rounded-md border px-3 py-2 text-sm " +
              (lookupMessage.tone === "success"
                ? "border-success/40 bg-success/10 text-success"
                : "border-destructive/40 bg-destructive/10 text-destructive")
            }
          >
            {lookupMessage.text}
          </div>
        ) : null}

        {!context && matches.length > 1 ? (
          <div className="mt-4 overflow-hidden rounded-md border border-border">
            {matches.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => void loadStatusContext(file.id)}
                className="grid w-full grid-cols-1 gap-1 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent md:grid-cols-[10rem_1fr_9rem_10rem]"
              >
                <span className="font-medium">{file.controlNo || file.uniqueCode || "File"}</span>
                <span className="truncate">{file.itemDescription || "-"}</span>
                <span className="text-muted-foreground">{file.division || "-"}</span>
                <span className="text-muted-foreground">{formatDate(file.receivedDate)}</span>
              </button>
            ))}
          </div>
        ) : null}

        {context ? (
          <div className="mt-5 space-y-5">
            <FileConfirmation
              file={context.file}
              onOpenFullFile={() => openFullFile(navigate, context.file.id)}
            />
            <StatusComposer
              value={statusDraft}
              onChange={setStatusDraft}
              onSave={() => void saveStatus()}
              disabled={!canCreateFileStatus}
            />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <TimelinePanel file={context.file} />
              <StatusHistoryPanel
                statuses={context.statuses}
                editingStatusId={editingStatusId}
                editingStatusText={editingStatusText}
                onEdit={(status) => {
                  setEditingStatusId(status.id);
                  setEditingStatusText(status.text);
                }}
                onCancel={() => {
                  setEditingStatusId("");
                  setEditingStatusText("");
                }}
                onChange={setEditingStatusText}
                onSave={(statusId) => void saveEditedStatus(statusId)}
              />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function FileConfirmation({
  file,
  onOpenFullFile,
}: {
  file: FileRecord;
  onOpenFullFile: () => void;
}) {
  const details = [
    ["Control No.", file.imms],
    ["Item description", file.demandDescription],
    ["Division", file.division],
    ["Indentor", file.indentor],
    ["Demand Received date", formatDate(file.receivedDate)],
  ];
  return (
    <div className="rounded-md border border-border bg-secondary/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Matched file</h3>
        <button
          type="button"
          onClick={onOpenFullFile}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
        >
          <FolderOpen className="size-3.5" />
          Open full file
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
        {details.map(([label, value]) => (
          <div key={label} className="rounded-md bg-background/70 p-2">
            <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
            <div className="mt-1 min-h-5 break-words text-sm font-medium">{value || "-"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusComposer({
  value,
  onChange,
  onSave,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  disabled?: boolean;
}) {
  const words = countWords(value);
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="text-sm font-semibold" htmlFor="file-status-draft">
          File Status
        </label>
        <span
          className={
            words > 50 ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {words}/50 words
        </span>
      </div>
      <textarea
        id="file-status-draft"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder="Enter latest file status"
        rows={3}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={disabled || !value.trim() || words > 50}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="size-4" />
          Save File Status
        </button>
      </div>
    </div>
  );
}

function TimelinePanel({ file }: { file: FileRecord }) {
  const items = getQuickStatusTimelineItems(file);
  const firstDate = parseDate(items[0]?.date);
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <h3 className="text-sm font-semibold">Timeline</h3>
      <div className="mt-3 max-h-[520px] overflow-auto pr-1">
        {items.length ? (
          <ol className="relative space-y-0">
            <span className="absolute left-[5.75rem] top-2 bottom-2 w-px bg-success/60" />
            {items.map((item, index) => {
              const currentDate = parseDate(item.date);
              const previousDate = parseDate(items[index - 1]?.date);
              const stageGap = daysBetween(previousDate, currentDate);
              const cumulativeGap = daysBetween(firstDate, currentDate);
              return (
                <li key={`${item.label}:${item.date}:${index}`} className="relative pb-4 last:pb-0">
                  <div className="grid grid-cols-[4.5rem_1.5rem_minmax(0,1fr)] items-start gap-2">
                    <div className="pt-0.5 text-right text-[11px] font-medium text-muted-foreground">
                      {formatDays(stageGap)}
                    </div>
                    <div className="relative flex h-5 justify-center">
                      <span className="mt-1.5 size-3 rounded-full border-2 border-card bg-success shadow-[0_0_0_3px_var(--color-success)]/10" />
                    </div>
                    <div className="rounded-md border border-border bg-card px-3 py-2.5">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0 text-sm font-medium">{item.label}</div>
                        <div className="shrink-0 text-right text-[11px] font-medium text-muted-foreground">
                          {formatDays(cumulativeGap)}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">{formatDate(item.date)}</div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="text-sm text-muted-foreground">No timeline dates are filled.</div>
        )}
      </div>
    </div>
  );
}

function StatusHistoryPanel({
  statuses,
  editingStatusId,
  editingStatusText,
  onEdit,
  onCancel,
  onChange,
  onSave,
}: {
  statuses: FileStatusUpdate[];
  editingStatusId: string;
  editingStatusText: string;
  onEdit: (status: FileStatusUpdate) => void;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSave: (statusId: string) => void;
}) {
  const sortedStatuses = [...statuses].sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <h3 className="text-sm font-semibold">File Status history</h3>
      <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
        {sortedStatuses.length ? (
          sortedStatuses.map((status) => {
            const editing = editingStatusId === status.id;
            const words = countWords(editing ? editingStatusText : status.text);
            return (
              <div key={status.id} className="rounded-md bg-card p-2">
                {editing ? (
                  <>
                    <textarea
                      value={editingStatusText}
                      onChange={(event) => onChange(event.target.value)}
                      rows={3}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span
                        className={
                          words > 50 ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                        }
                      >
                        {words}/50 words
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={onCancel}
                          className="h-8 rounded-md border border-border px-3 text-xs font-medium hover:bg-accent"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => onSave(status.id)}
                          disabled={!editingStatusText.trim() || words > 50}
                          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                        >
                          <Check className="size-3.5" />
                          Save
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="whitespace-pre-wrap text-sm">{status.text}</div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {status.createdByName} · {formatDateTime(status.createdAt)}
                        {status.updatedAt
                          ? ` · Edited by ${status.updatedByName || "User"} on ${formatDateTime(status.updatedAt)}`
                          : ""}
                      </span>
                      {status.canEdit ? (
                        <button
                          type="button"
                          onClick={() => onEdit(status)}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-medium text-foreground hover:bg-accent"
                        >
                          <Pencil className="size-3" />
                          Edit
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            );
          })
        ) : (
          <div className="text-sm text-muted-foreground">No File Status entered yet.</div>
        )}
      </div>
    </div>
  );
}

function openFullFile(navigate: ReturnType<typeof useNavigate>, fileId: string) {
  navigate({
    to: "/add",
    search: {
      fileId,
      section: "File details",
      milestone: undefined,
      quickFocus: false,
    },
  });
}

function getQuickStatusTimelineItems(file: FileRecord) {
  const items = [
    ["Demand received", file.receivedDate],
    ["Scrutiny", file.scrutinyDate],
    ["Scrutiny response", file.scrutinyResponseDate],
    ["Scrutiny completion", file.scrutinyCompletionDate],
    ["Control", file.immsDate],
    ["High Value meeting", file.highValueMeetingDate],
    ["High Value minutes", file.highValueMinutesDate],
    ["AD sent", file.adSentDate],
    ["AD vetting", file.adVettingDate],
    ["RQA sent", file.rqaSentDate],
    ["RQA approval", file.rqaApprovalDate],
    ["Pre-TCEC", file.preTcecDate],
    ["Pre-TCEC minutes", file.preTcecMinutesDate],
    ["IFA sent", file.ifaSentDate],
    ["IFA final", file.ifaFinalDate],
    ["CFA sent", file.cfaSentDate],
    ["CFA approval", file.cfaDate],
    ["GeM undertaking", file.gemUndertakingDate],
    ["RFP vetting initiation", file.rfpVettingInitiationDate],
    ["RFP vetting approval", file.rfpVettingApprovalDate],
    ["Pre-Bid Meeting", file.preBidMeetingDate],
    ["Bid date", file.bidDate],
    ["Bid opening", file.bidOpeningDate],
    ["Refloat Pre-Bid Meeting", file.refloatPreBidMeetingDate],
    ["Refloat bid date", file.refloatBiddingDate],
    ["Refloat bid opening", file.refloatBidOpeningDate],
    ["Post-TCEC", file.postTcecDate],
    ["Post-TCEC minutes", file.postTcecMinutesDate],
    ["CNC", file.cncDate],
    ["CNC approval", file.cncApprovalDate],
    ["File closure", file.fileClosureDate],
    ...rawSupplyOrders(file).flatMap((order, orderIndex) =>
      [
        ["Financial Sanction", order.financialSanctionDate],
        ["S.O. date", order.soDate],
        ["D.P.", order.dpDate],
        ["Revised D.P.", order.revisedDp],
        ["Material receipt", order.materialReceiptDate],
        ["Job Completion", order.jobCompletionDate],
        ["IR Preparation", order.irPreparationDate],
        ["IR Receipt", order.irReceiptDate],
        ["Bill preparation", order.billPreparationDate],
        ["Bill sent for payment", order.billSentForPaymentDate],
        ["Payment", order.paymentDate],
        ["S.O. cancellation", order.soCancelledDate],
        ["Shortclosure", order.shortclosureDate],
      ].map(([label, date]) => [`S.O. ${orderIndex + 1} - ${label}`, date]),
    ),
  ]
    .filter((item): item is [string, string] => Boolean(item[1]))
    .sort((a, b) => (parseDate(a[1])?.getTime() ?? 0) - (parseDate(b[1])?.getTime() ?? 0));
  return items.map(([label, date]) => ({ label, date }));
}

function normalizeQuickEntryCode(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function getQuickEntryStageForCurrentMilestone(
  file: FileRecord,
): QuickEntryDestination | undefined {
  const current = getEffectiveQuickEntryMilestone(file);
  if (!current) return getQuickEntryStageForLastFilledDate(file);
  const stage = quickEntryStageSections.find((item) =>
    item.milestones.some((milestone) => normalizeQuickEntryMilestone(milestone) === current),
  );
  if (!stage) return undefined;
  return {
    ...stage,
    focusTarget: isSupplyOrderQuickEntryMilestone(current) ? `${current}:current` : undefined,
  };
}

function getQuickEntryStageForLastFilledDate(file: FileRecord): QuickEntryDestination | undefined {
  const datedStages: { title: string; date: unknown }[] = [
    { title: "File details", date: file.receivedDate },
    { title: "Scrutiny and control", date: file.scrutinyDate },
    { title: "Scrutiny and control", date: file.scrutinyResponseDate },
    { title: "Scrutiny and control", date: file.scrutinyCompletionDate },
    { title: "Scrutiny and control", date: file.immsDate },
    { title: "Approval block", date: file.highValueMeetingDate },
    { title: "Approval block", date: file.highValueMinutesDate },
    { title: "Approval block", date: file.adSentDate },
    { title: "Approval block", date: file.adVettingDate },
    { title: "Approval block", date: file.rqaSentDate },
    { title: "Approval block", date: file.rqaApprovalDate },
    { title: "TCEC block", date: file.preTcecDate },
    { title: "TCEC block", date: file.preTcecMinutesDate },
    { title: "Approval block", date: file.ifaSentDate },
    { title: "Approval block", date: file.ifaFinalDate },
    { title: "Approval block", date: file.cfaSentDate },
    { title: "Approval block", date: file.cfaDate },
    { title: "Bidding details", date: file.gemUndertakingDate },
    { title: "Bidding details", date: file.rfpVettingInitiationDate },
    { title: "Bidding details", date: file.rfpVettingApprovalDate },
    { title: "Bidding details", date: file.preBidMeetingDate },
    { title: "Bidding details", date: file.bidDate },
    { title: "Bidding details", date: file.bidOpeningDate },
    { title: "Bidding details", date: file.refloatPreBidMeetingDate },
    { title: "Bidding details", date: file.refloatBiddingDate },
    { title: "Bidding details", date: file.refloatBidOpeningDate },
    { title: "TCEC block", date: file.postTcecDate },
    { title: "TCEC block", date: file.postTcecMinutesDate },
    { title: "Bidding details", date: file.cncDate },
    { title: "Bidding details", date: file.cncApprovalDate },
    { title: "File details", date: file.demandCancelledDate },
    { title: "File details", date: file.fileClosureDate },
    ...rawSupplyOrders(file).flatMap((order) =>
      [
        order.financialSanctionDate,
        order.soDate,
        order.dpDate,
        order.revisedDp,
        order.materialReceiptDate,
        order.jobCompletionDate,
        order.irPreparationDate,
        order.irReceiptDate,
        order.billPreparationDate,
        order.billSentForPaymentDate,
        order.paymentDate,
        order.soCancelledDate,
        order.shortclosureDate,
      ].map((date) => ({ title: "Supply order and payment", date })),
    ),
  ];

  return datedStages
    .map((stage, index) => ({ ...stage, index, parsedDate: parseDate(stage.date) }))
    .filter((stage): stage is typeof stage & { parsedDate: Date } => Boolean(stage.parsedDate))
    .sort((a, b) => {
      const dateDiff = b.parsedDate.getTime() - a.parsedDate.getTime();
      return dateDiff || b.index - a.index;
    })[0];
}

function getEffectiveQuickEntryMilestone(file: FileRecord) {
  const orderCurrent = getCurrentSupplyOrderMilestone(file);
  if (orderCurrent) return orderCurrent;
  return normalizeQuickEntryMilestone(file.currentMilestone);
}

function getCurrentSupplyOrderMilestone(file: FileRecord) {
  const currentMilestones = [
    ...rawSupplyOrders(file).map((order) => getEffectiveQuickEntryOrderMilestone(file, order)),
    ...fileSupplyOrders(file).map((order) => getEffectiveQuickEntryOrderMilestone(file, order)),
  ];
  return (
    currentMilestones
      .map(normalizeQuickEntryMilestone)
      .find((milestone) => milestone && isSupplyOrderQuickEntryMilestone(milestone)) ?? ""
  );
}

function getEffectiveQuickEntryOrderMilestone(file: FileRecord, order: { [key: string]: unknown }) {
  if (isYes(order.soCancelled)) return "";
  if (isFinancialSanctionReached(file) && !hasDate(order.financialSanctionDate)) {
    return "financialsanction";
  }
  if (hasDate(order.financialSanctionDate) && !hasDate(order.soDate)) return "supplyorder";
  if (hasDate(order.soDate) && !hasDate(order.dpDate)) return "deliveryperiod";
  if (isAdvancePaymentPending(order)) return "advancepayment";
  if (isJobCompletionWorkflow(file)) {
    if (
      hasDate(order.soDate) &&
      isDateBeforeToday(getDeliveryPeriodDate(order)) &&
      !hasDate(order.jobCompletionDate)
    ) {
      return "jobcompletion";
    }
  } else if (
    hasDate(order.soDate) &&
    hasDate(getDeliveryPeriodDate(order)) &&
    !hasDate(order.materialReceiptDate)
  ) {
    return "delivery";
  }
  if (isBgPending(file, order, "psbpwb")) return "psbpwb";
  if (isBgPending(file, order, "psb")) return "psb";
  if (isBgPending(file, order, "pwb")) return "pwb";
  if (isYes(file.ir) && hasDate(order.materialReceiptDate) && !hasDate(order.irPreparationDate)) {
    return "irpreparation";
  }
  if (isYes(file.ir) && hasDate(order.irPreparationDate) && !hasDate(order.irReceiptDate)) {
    return "irreceipt";
  }
  if (isBillPreparationCurrent(file, order)) return "billpreparation";
  if (hasDate(order.billPreparationDate) && !hasDate(order.billSentForPaymentDate)) {
    return "billsentforpayment";
  }
  if (hasPaymentWorkflowStarted(file, order) && !hasDate(order.paymentDate)) return "payment";
  return normalizeQuickEntryMilestone(String(order.currentMilestone ?? ""));
}

function isFinancialSanctionReached(file: FileRecord) {
  return (
    (isBiddingApplicableForFile(file) ? isYes(file.biddingStageOver) : hasDate(file.cfaDate)) &&
    (!isYes(file.tcec) || hasDate(file.cncApprovalDate))
  );
}

function isJobCompletionWorkflow(file: FileRecord) {
  return !isDeliveryInspectionApplicableByGroup(file);
}

function isBillPreparationCurrent(file: FileRecord, order: { [key: string]: unknown }) {
  if (hasDate(order.billPreparationDate)) return false;
  return isJobCompletionWorkflow(file)
    ? hasDate(order.jobCompletionDate)
    : hasDate(order.irReceiptDate);
}

function hasPaymentWorkflowStarted(file: FileRecord, order: { [key: string]: unknown }) {
  return (
    hasDate(order.billPreparationDate) ||
    hasDate(order.billSentForPaymentDate) ||
    (isJobCompletionWorkflow(file)
      ? hasDate(order.jobCompletionDate)
      : hasDate(order.materialReceiptDate))
  );
}

function isAdvancePaymentPending(order: { [key: string]: unknown }) {
  const detail = order.advancePaymentDetail as { paymentDate?: unknown } | undefined;
  return isYes(order.advancePayment) && !hasDate(detail?.paymentDate);
}

function isBgPending(file: FileRecord, order: { [key: string]: unknown }, kind: string) {
  if (kind === "psb") {
    return (
      isYes(order.psbApplicable) &&
      ["PSB", "PSB and PWB separately"].includes(String(order.bgCoverageType ?? "")) &&
      hasDate(order.financialSanctionDate) &&
      !hasDate(order.psbBgReceivedDate)
    );
  }
  if (kind === "pwb") {
    return (
      isYes(file.bg) &&
      ["PWB", "PSB and PWB separately"].includes(String(order.bgCoverageType ?? "")) &&
      hasPaymentWorkflowStarted(file, order) &&
      !hasDate(order.pwbBgReceivedDate)
    );
  }
  return (
    isYes(file.bg) &&
    String(order.bgCoverageType ?? "") === "PSB+PWB" &&
    hasDate(order.financialSanctionDate) &&
    !hasDate(order.combinedBgReceivedDate)
  );
}

function getDeliveryPeriodDate(order: { [key: string]: unknown }) {
  return String(order.revisedDp || order.dpDate || "");
}

function isDateBeforeToday(value: unknown) {
  const date = parseDate(value);
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() < today.getTime();
}

function parseDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return undefined;
  const date = new Date(`${text.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function hasDate(value: unknown) {
  return Boolean(parseDate(value));
}

function isYes(value: unknown) {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === "yes"
  );
}

function isSupplyOrderQuickEntryMilestone(value: string) {
  return supplyOrderQuickEntryMilestones.has(value);
}

function normalizeQuickEntryMilestone(value: string | undefined) {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") ?? ""
  );
}

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function formatDate(value: string | undefined) {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTime(value: string | undefined) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function daysBetween(start: Date | undefined, end: Date | undefined) {
  if (!start || !end) return undefined;
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / 86_400_000);
}

function formatDays(days: number | undefined) {
  if (days === undefined) return "-";
  return days === 1 ? "1 day" : `${days} days`;
}

const supplyOrderQuickEntryMilestones = new Set(
  quickEntryStageSections
    .find((stage) => stage.title === "Supply order and payment")!
    .milestones.map(normalizeQuickEntryMilestone),
);
