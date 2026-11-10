import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  FolderOpen,
  Pencil,
  RotateCcw,
  Save,
  ScanLine,
  Search,
} from "lucide-react";
import { rawSupplyOrders } from "@/lib/effective-deliveries";
import { CompactTableText } from "@/components/compact-table-text";
import { showAppConfirm } from "@/components/app-dialog";
import { TimelineStageSelect } from "@/components/timeline-stage-select";
import { QuickEntryAccess } from "@/components/quick-access";
import {
  fetchFileIdentifierSuggestions,
  createFileStatusUpdate,
  fetchFile,
  fetchFilesByIdentifier,
  fetchQuickStatusContext,
  lookupQuickStatusFiles,
  updateFileStatusUpdate,
  type FileIdentifierSuggestion,
  type FileRecord,
  type FileStatusUpdate,
  type QuickStatusFileSummary,
  type StageDeliveryDetail,
  type SupplyOrderDetail,
  useActiveUser,
} from "@/lib/files-store";
import { SearchableDropdown } from "@/components/searchable-dropdown";
import {
  isBiddingApplicableForFile,
  isRefloatBiddingApplicableForFile,
  isDeliveryInspectionApplicableByGroup,
} from "@/lib/file-type-groups";
import { hasCapability } from "@/lib/permissions";
import { useUnsavedChanges } from "@/lib/unsaved-changes";

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
    milestones: ["Bidding", "Refloat Bidding", "CNC", "RFP Vetting", "Refloat", "RST"],
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
      "Job Completion",
      "IR Preparation",
      "IR Receipt",
      "Bill preparation",
      "Bill sent for payment",
      "Bill returned for correction",
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
type QuickTimelineStatus = "upcoming" | "due" | "overdue" | "complete" | "inactive";
type QuickTimelineItem = {
  label: string;
  date: string;
  deliveryStatus?: QuickTimelineStatus;
};
type QuickStatusContext = {
  file: FileRecord;
  statuses: FileStatusUpdate[];
};
type QuickEntryDestination = {
  title: string;
  focusTarget?: string;
};
type QuickEntryOrderMilestone = {
  milestone: string;
  orderIndex: number;
  stageIndex?: number;
  latestDate?: number;
  isStage: boolean;
  hasExplicitMilestone: boolean;
};

function QuickEntryPage() {
  const activeUser = useActiveUser();
  if (!activeUser) {
    return (
      <div className="section-accent-border max-w-xl rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
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
  const canEditFiles = hasCapability(activeUser, "canEditFiles");
  const isReadOnlyQuickEntry =
    activeUser?.role === "universal_viewer" ||
    activeUser?.role === "viewer" ||
    activeUser?.role === "division_user";
  const canOpenCurrentStage = canEditFiles || isReadOnlyQuickEntry;
  const canCreateFileStatus = canEditFiles || activeUser?.role === "universal_viewer";
  const [includeArchivedYears, setIncludeArchivedYears] = useState(true);
  const [entryIdentifier, setEntryIdentifier] = useState("");
  const [entryIdentifierQuery, setEntryIdentifierQuery] = useState("");
  const [entrySuggestions, setEntrySuggestions] = useState<FileIdentifierSuggestion[]>([]);
  const [selectedEntrySuggestion, setSelectedEntrySuggestion] =
    useState<FileIdentifierSuggestion | null>(null);
  const [message, setMessage] = useState<QuickEntryError | null>(null);
  const [milestoneFileId, setMilestoneFileId] = useState("");
  const [loading, setLoading] = useState(false);

  const [fileIdentifier, setFileIdentifier] = useState("");
  const [statusIdentifierQuery, setStatusIdentifierQuery] = useState("");
  const [statusIdentifierSuggestions, setStatusIdentifierSuggestions] = useState<
    FileIdentifierSuggestion[]
  >([]);
  const [selectedStatusSuggestion, setSelectedStatusSuggestion] =
    useState<FileIdentifierSuggestion | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [loadingStatusFileId, setLoadingStatusFileId] = useState("");
  const [lookupMessage, setLookupMessage] = useState<QuickEntryError | null>(null);
  const [matches, setMatches] = useState<QuickStatusFileSummary[]>([]);
  const [context, setContext] = useState<QuickStatusContext | undefined>();
  const [statusDraft, setStatusDraft] = useState("");
  const [editingStatusId, setEditingStatusId] = useState("");
  const [editingStatusText, setEditingStatusText] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);
  const statusSaveBusy = useRef(false);
  const contextRevision = useRef(0);
  const contextRef = useRef(context);
  const statusDraftRef = useRef(statusDraft);
  const editingStatusRef = useRef({ id: editingStatusId, text: editingStatusText });
  contextRef.current = context;
  statusDraftRef.current = statusDraft;
  editingStatusRef.current = { id: editingStatusId, text: editingStatusText };
  const clearStatusContext = () => {
    contextRevision.current += 1;
    contextRef.current = undefined;
    setContext(undefined);
    setStatusDraft("");
    setEditingStatusId("");
    setEditingStatusText("");
  };
  useEffect(
    () => () => {
      contextRevision.current += 1;
    },
    [],
  );
  const editingStatusOriginalText = context?.statuses.find(
    (status) => status.id === editingStatusId,
  )?.text;
  const quickEntryStatusDirty =
    Boolean(statusDraft.trim()) ||
    Boolean(editingStatusId && editingStatusText !== editingStatusOriginalText);
  useUnsavedChanges("quick-entry-status-editor", quickEntryStatusDirty);

  useEffect(() => {
    const query = entryIdentifierQuery.trim();
    if (!query) {
      setEntrySuggestions(selectedEntrySuggestion ? [selectedEntrySuggestion] : []);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchFileIdentifierSuggestions(query, false, includeArchivedYears)
        .then(({ files }) => {
          if (!cancelled) setEntrySuggestions(files);
        })
        .catch(() => {
          if (!cancelled) setEntrySuggestions([]);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [entryIdentifierQuery, includeArchivedYears, selectedEntrySuggestion]);

  useEffect(() => {
    const query = statusIdentifierQuery.trim();
    if (!query) {
      setStatusIdentifierSuggestions(selectedStatusSuggestion ? [selectedStatusSuggestion] : []);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchFileIdentifierSuggestions(query, true, includeArchivedYears)
        .then(({ files }) => {
          if (!cancelled) setStatusIdentifierSuggestions(files);
        })
        .catch(() => {
          if (!cancelled) setStatusIdentifierSuggestions([]);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [includeArchivedYears, statusIdentifierQuery, selectedStatusSuggestion]);

  const entrySuggestionOptions = makeIdentifierSuggestionOptions([
    ...entrySuggestions,
    ...(selectedEntrySuggestion ? [selectedEntrySuggestion] : []),
  ]);
  const statusSuggestionOptions = makeIdentifierSuggestionOptions([
    ...statusIdentifierSuggestions,
    ...(selectedStatusSuggestion ? [selectedStatusSuggestion] : []),
  ]);

  const findFile = async () => {
    if (selectedEntrySuggestion) {
      setLoading(true);
      const selected = await fetchFile(selectedEntrySuggestion.id, includeArchivedYears)
        .then((result) => result.file)
        .catch((error) => {
          console.error(error);
          setMessage({ tone: "error", text: "File lookup failed. Please try again." });
          return undefined;
        })
        .finally(() => setLoading(false));
      return selected;
    }
    const code = normalizeQuickEntryCode(entryIdentifier);
    if (!code) {
      setMessage({ tone: "error", text: "Scan or enter a file identifier first." });
      return undefined;
    }

    setLoading(true);
    const found = await fetchFilesByIdentifier(code, includeArchivedYears)
      .then((result) => result.files)
      .catch((error) => {
        console.error(error);
        setMessage({ tone: "error", text: "File lookup failed. Please try again." });
        return undefined;
      })
      .finally(() => setLoading(false));
    if (!found) return undefined;
    if (found.length === 0) {
      setMessage({
        tone: "error",
        text: "No accessible file matches that identifier.",
      });
      return undefined;
    }
    if (found.length > 1) {
      setMessage({
        tone: "error",
        text: "More than one accessible file matches this identifier. Use a different identifier or correct the duplicate before using Quick Entry.",
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
        returnToQuickEntry: true,
      },
    });
  };

  const loadStatusContext = async (fileId: string) => {
    const revision = ++contextRevision.current;
    const loaded = await fetchQuickStatusContext(fileId, includeArchivedYears);
    if (revision !== contextRevision.current) return undefined;
    contextRef.current = loaded;
    setContext(loaded);
    setStatusDraft("");
    setEditingStatusId("");
    setEditingStatusText("");
    return loaded;
  };

  const loadMatchedStatusContext = async (fileId: string) => {
    setLoadingStatusFileId(fileId);
    try {
      const loaded = await loadStatusContext(fileId);
      if (!loaded) return false;
      setLookupMessage({ tone: "success", text: "File matched." });
      return true;
    } catch (error) {
      console.error(error);
      setLookupMessage({ tone: "error", text: "File details could not be loaded. Try again." });
      return false;
    } finally {
      setLoadingStatusFileId("");
    }
  };

  const lookupFile = async () => {
    if (
      quickEntryStatusDirty &&
      !(await showAppConfirm("You have unsaved changes. Discard them and look up another file?"))
    ) {
      return;
    }
    const query = fileIdentifier.trim();
    if (!query) {
      setLookupMessage({
        tone: "error",
        text: "Enter an identifier or demand description.",
      });
      return;
    }
    setLookupLoading(true);
    setLookupMessage(null);
    clearStatusContext();
    setMatches([]);
    try {
      if (selectedStatusSuggestion) {
        await loadMatchedStatusContext(selectedStatusSuggestion.id);
        return;
      }
      const result = await lookupQuickStatusFiles({
        controlNo: query,
        description: query,
        includeArchivedYears,
      });
      setMatches(result.files);
      if (result.files.length === 0) {
        setLookupMessage({ tone: "error", text: "No matching file found." });
        return;
      }
      if (result.files.length === 1) {
        await loadMatchedStatusContext(result.files[0].id);
        return;
      }
      setLookupMessage({ tone: "success", text: "Multiple files matched. Select one." });
    } catch (error) {
      console.error(error);
      setLookupMessage({ tone: "error", text: "File lookup failed." });
    } finally {
      setLookupLoading(false);
    }
  };

  const selectMatchedStatusFile = async (fileId: string) => {
    if (lookupLoading) return;
    setLookupLoading(true);
    setLookupMessage(null);
    clearStatusContext();
    try {
      await loadMatchedStatusContext(fileId);
    } finally {
      setLookupLoading(false);
    }
  };

  const resetLookup = async () => {
    if (
      quickEntryStatusDirty &&
      !(await showAppConfirm("You have unsaved changes. Discard them and clear this lookup?"))
    ) {
      return;
    }
    setFileIdentifier("");
    setSelectedStatusSuggestion(null);
    setStatusIdentifierQuery("");
    setLookupMessage(null);
    setMatches([]);
    clearStatusContext();
  };

  const saveStatus = async () => {
    if (!context || statusSaveBusy.current) return;
    if (!canCreateFileStatus) {
      setLookupMessage({ tone: "error", text: "Your account cannot add File Status." });
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
    const revision = contextRevision.current;
    const fileId = context.file.id;
    const draft = statusDraft;
    statusSaveBusy.current = true;
    setSavingStatus(true);
    const result = await createFileStatusUpdate(fileId, draft.trim())
      .catch((error) => {
        console.error(error);
        if (revision === contextRevision.current)
          setLookupMessage({
            tone: "error",
            text: error instanceof Error ? error.message : "Save failed.",
          });
        return undefined;
      })
      .finally(() => {
        statusSaveBusy.current = false;
        setSavingStatus(false);
      });
    if (!result) return;
    if (revision !== contextRevision.current || contextRef.current?.file.id !== fileId) return;
    setContext((current) =>
      current?.file.id === fileId ? { ...current, statuses: result.statuses } : current,
    );
    if (statusDraftRef.current === draft) setStatusDraft("");
    setLookupMessage({ tone: "success", text: "File Status saved." });
  };

  const saveEditedStatus = async (statusId: string) => {
    if (!context || statusSaveBusy.current) return;
    if (countWords(editingStatusText) > 50) {
      setLookupMessage({ tone: "error", text: "File Status cannot exceed 50 words." });
      return;
    }
    if (!editingStatusText.trim()) return;
    const revision = contextRevision.current;
    const fileId = context.file.id;
    const draft = editingStatusText;
    statusSaveBusy.current = true;
    setSavingStatus(true);
    const result = await updateFileStatusUpdate(statusId, draft.trim())
      .catch((error) => {
        console.error(error);
        if (revision === contextRevision.current)
          setLookupMessage({
            tone: "error",
            text: error instanceof Error ? error.message : "Update failed.",
          });
        return undefined;
      })
      .finally(() => {
        statusSaveBusy.current = false;
        setSavingStatus(false);
      });
    if (!result) return;
    if (revision !== contextRevision.current || contextRef.current?.file.id !== fileId) return;
    setContext((current) =>
      current?.file.id === fileId ? { ...current, statuses: result.statuses } : current,
    );
    if (editingStatusRef.current.id === statusId && editingStatusRef.current.text === draft) {
      setEditingStatusId("");
      setEditingStatusText("");
    }
    setLookupMessage({ tone: "success", text: "File Status updated." });
  };

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-border/80 border-l-4 border-l-primary/45 bg-card px-4 py-3 shadow-[var(--shadow-card)]">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={includeArchivedYears}
            disabled={loading || lookupLoading}
            onChange={async (event) => {
              const checked = event.target.checked;
              if (
                quickEntryStatusDirty &&
                !(await showAppConfirm(
                  "Discard the unsaved file status before changing this filter?",
                ))
              ) {
                return;
              }
              setIncludeArchivedYears(checked);
              setSelectedEntrySuggestion(null);
              setSelectedStatusSuggestion(null);
              clearStatusContext();
              setMatches([]);
              setMessage(null);
              setLookupMessage(null);
            }}
            className="size-4 accent-primary"
          />
          Active files from archived years
        </label>
        <p className="ml-6 mt-1 text-xs leading-relaxed text-muted-foreground">
          When checked, active carry-forward files from archived years can be found. Closed or
          cancelled files from archived years remain excluded. When unchecked, all files from
          archived years are excluded from both lookups.
        </p>
      </div>
      <section className="relative z-30 flex flex-col overflow-visible rounded-xl border border-border/80 border-l-4 border-l-primary/45 bg-card shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2.5 border-b border-border bg-secondary px-4 py-2 text-foreground">
          <div className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-card text-primary">
            <ScanLine className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Quick Entry</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="block">
            <SearchableDropdown
              value={selectedEntrySuggestion?.id ?? entryIdentifier}
              onChange={(value) => {
                const selected = entrySuggestions.find((file) => file.id === value);
                setSelectedEntrySuggestion(selected ?? null);
                setEntryIdentifier(selected ? "" : value);
                setMessage(null);
                setMilestoneFileId("");
              }}
              onSearchChange={setEntryIdentifierQuery}
              options={[]}
              optionItems={entrySuggestionOptions}
              typeAheadOnly
              containerClassName="max-w-lg"
              onEnter={() => {
                if (canOpenCurrentStage) void continueToCurrentStage();
              }}
              disabled={!canOpenCurrentStage}
              autoFocus
              placeholder="Scan barcode or enter Unique Code / Control No. / File No. / S.O. No."
              className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-500 placeholder:text-zinc-500 outline-none transition-shadow focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/20 dark:border-border dark:bg-input dark:text-foreground dark:placeholder:text-muted-foreground dark:focus:border-ring dark:focus:ring-ring/30"
            />
          </label>
          <button
            type="button"
            onClick={() => void continueToCurrentStage()}
            disabled={loading || !canOpenCurrentStage}
            title="Open current stage"
            className="inline-flex h-10 items-center justify-center gap-1.5 self-end rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Finding..." : "Open current stage"} <ArrowRight className="size-4" />
          </button>
        </div>

        {message ? (
          <div
            className={
              "mt-3 rounded-md border px-3 py-2 text-sm " +
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
                      returnToQuickEntry: true,
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

      <section className="relative z-20 flex flex-col overflow-visible rounded-xl border border-zinc-300 border-l-4 border-l-primary/45 bg-white shadow-[var(--shadow-card)] dark:border-border dark:bg-card">
        <div className="flex items-center gap-2.5 border-b border-border bg-secondary px-4 py-2 text-foreground">
          <div className="grid size-8 shrink-0 place-items-center rounded-md border border-zinc-300 bg-zinc-100 text-black dark:border-border dark:bg-muted dark:text-foreground">
            <FileText className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              {isReadOnlyQuickEntry ? "Quick Viewer" : "File Status"}
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label>
            <SearchableDropdown
              value={selectedStatusSuggestion?.id ?? fileIdentifier}
              onChange={async (value) => {
                const selected = statusIdentifierSuggestions.find((file) => file.id === value);
                if (
                  selected &&
                  quickEntryStatusDirty &&
                  !(await showAppConfirm(
                    "Discard the unsaved file status before loading the selected file?",
                  ))
                ) {
                  return;
                }

                setSelectedStatusSuggestion(selected ?? null);
                setFileIdentifier(
                  selected
                    ? selected.uniqueCode ||
                        selected.controlNo ||
                        selected.fileNo ||
                        selected.soNumbers?.split(",")[0]?.trim() ||
                        ""
                    : value,
                );
                // Typing a search query should not hide an unsaved status draft.
                // Find or choosing a result will confirm before replacing its context.
                if (!selected && quickEntryStatusDirty) return;
                clearStatusContext();
                setMatches([]);
                setLookupMessage(null);
                if (selected) {
                  setLookupLoading(true);
                  try {
                    await loadMatchedStatusContext(selected.id);
                  } finally {
                    setLookupLoading(false);
                  }
                }
              }}
              onSearchChange={setStatusIdentifierQuery}
              options={[]}
              optionItems={statusSuggestionOptions}
              typeAheadOnly
              disabled={lookupLoading}
              containerClassName="max-w-lg"
              onEnter={() => void lookupFile()}
              placeholder="Unique Code / Control No. / File No. / S.O. No."
              className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-500 placeholder:text-zinc-500 outline-none transition-shadow focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/20 dark:border-border dark:bg-input dark:text-foreground dark:placeholder:text-muted-foreground dark:focus:border-ring dark:focus:ring-ring/30"
            />
          </label>
          <button
            type="button"
            onClick={() => void lookupFile()}
            disabled={lookupLoading}
            className="inline-flex h-10 items-center justify-center gap-1.5 self-end rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            <Search className="size-4" />
            {lookupLoading ? "Finding..." : "Find"}
          </button>
          <button
            type="button"
            onClick={resetLookup}
            disabled={
              lookupLoading ||
              (!fileIdentifier && !lookupMessage && matches.length === 0 && !context)
            }
            title="Reset file search"
            aria-label="Reset file search"
            className="inline-flex h-10 items-center justify-center gap-1.5 self-end rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-black transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted"
          >
            <RotateCcw className="size-4" />
            Reset
          </button>
        </div>

        {lookupMessage && lookupMessage.tone !== "success" ? (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {lookupMessage.text}
          </div>
        ) : null}

        {!context &&
        (matches.length > 1 ||
          (matches.length === 1 &&
            (lookupMessage?.tone === "error" || loadingStatusFileId === matches[0]?.id))) ? (
          <div className="mt-4 overflow-hidden rounded-md border border-border">
            {matches.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => void selectMatchedStatusFile(file.id)}
                disabled={lookupLoading}
                aria-busy={loadingStatusFileId === file.id}
                className="grid w-full grid-cols-1 gap-1 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent disabled:cursor-wait disabled:opacity-70 md:grid-cols-[10rem_1fr_9rem_10rem]"
              >
                <span className="font-medium">
                  {loadingStatusFileId === file.id
                    ? "Loading details…"
                    : getQuickStatusMatchedIdentifier(file, fileIdentifier)?.value ||
                      file.controlNo ||
                      file.uniqueCode ||
                      "File"}
                </span>
                <CompactTableText value={file.itemDescription || "-"} width={36} />
                <span className="text-muted-foreground">{file.division || "-"}</span>
                <span className="text-muted-foreground">{formatDate(file.receivedDate)}</span>
              </button>
            ))}
          </div>
        ) : null}

        {context ? (
          <div className="mt-5 space-y-5">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className={canCreateFileStatus ? "" : "lg:col-span-2"}>
                <FileConfirmation
                  file={context.file}
                  onOpenFullFile={() => openFullFile(navigate, context.file.id)}
                />
              </div>
              {canCreateFileStatus ? (
                <StatusComposer
                  value={statusDraft}
                  onChange={setStatusDraft}
                  onSave={() => void saveStatus()}
                  disabled={!canCreateFileStatus || savingStatus}
                />
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <MilestoneHistoryPanel file={context.file} />
              <StatusHistoryPanel
                statuses={context.statuses}
                editingStatusId={editingStatusId}
                editingStatusText={editingStatusText}
                saving={savingStatus}
                onEdit={async (status) => {
                  if (editingStatusId === status.id) return;
                  if (
                    editingStatusId &&
                    editingStatusText !== editingStatusOriginalText &&
                    !(await showAppConfirm(
                      "Discard the unsaved File Status edit and edit another entry?",
                    ))
                  )
                    return;
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

      <QuickEntryAccess />
    </div>
  );
}

function getQuickStatusMatchedIdentifier(
  file: {
    uniqueCode?: string;
    controlNo?: string;
    imms?: string;
    fileNo?: string;
    soNumbers?: string;
  },
  query: string,
) {
  const identifier = query.trim().toLowerCase();
  if (!identifier) return undefined;
  const values = [
    { label: "Unique Code", value: file.uniqueCode?.trim() || "" },
    { label: "Control No.", value: (file.controlNo || file.imms)?.trim() || "" },
    { label: "File No.", value: file.fileNo?.trim() || "" },
    ...(file.soNumbers?.split(",") ?? []).map((value) => ({
      label: "S.O. No.",
      value: value.trim(),
    })),
  ];
  return (
    values.find((item) => item.value.toLowerCase() === identifier) ||
    values.find((item) => item.value.toLowerCase().includes(identifier))
  );
}

function makeIdentifierSuggestionOptions(files: FileIdentifierSuggestion[]) {
  const uniqueFiles = Array.from(new Map(files.map((file) => [file.id, file])).values());
  return uniqueFiles.map((file) => {
    const primaryIdentifier =
      file.uniqueCode ||
      file.controlNo ||
      file.fileNo ||
      file.soNumbers?.split(",")[0]?.trim() ||
      "File";
    const description = file.itemDescription?.trim();
    return {
      value: file.id,
      label: description ? `${primaryIdentifier} · ${description}` : primaryIdentifier,
      searchTerms: [
        file.uniqueCode,
        file.controlNo,
        file.fileNo,
        file.itemDescription,
        ...(file.soNumbers?.split(",") ?? []),
      ]
        .filter((term): term is string => Boolean(term?.trim()))
        .map((term) => term.trim()),
    };
  });
}

function FileConfirmation({
  file,
  onOpenFullFile,
}: {
  file: FileRecord;
  onOpenFullFile: () => void;
}) {
  const details = [
    ["Unique Code", file.uniqueCode],
    ["Control No.", file.imms],
    ["File No.", file.fileNo],
    [
      "S.O. No.",
      rawSupplyOrders(file)
        .flatMap((order) => [order.soNo, order.gemSoNo])
        .filter(Boolean)
        .join(", "),
    ],
    ["Division", file.division],
    ["Indentor", file.indentor],
    ["Demand Received date", formatDate(file.receivedDate)],
    ["Demand Description", file.demandDescription],
  ];
  return (
    <div className="min-h-[190px] rounded-md border border-border bg-secondary/20 p-3">
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
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        {details.map(([label, value]) => (
          <div
            key={label}
            className={`rounded-md bg-background/70 p-2 ${label === "Demand Description" ? "md:col-span-4" : ""}`}
          >
            <div className="text-[0.6875rem] font-medium text-muted-foreground">{label}</div>
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
        rows={2}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={disabled || !value.trim() || words > 50}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary/80 px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="size-4" />
          Save File Status
        </button>
      </div>
    </div>
  );
}

function MilestoneHistoryPanel({ file }: { file: FileRecord }) {
  const orders = rawSupplyOrders(file);
  const [activeOrderIndex, setActiveOrderIndex] = useState<number | null>(null);
  const [activeStageIndex, setActiveStageIndex] = useState<number | null>(null);
  useEffect(() => {
    setActiveOrderIndex(null);
    setActiveStageIndex(null);
  }, [file.id]);
  const selectedOrderIndex =
    activeOrderIndex !== null && activeOrderIndex < orders.length ? activeOrderIndex : null;
  const activeOrder = selectedOrderIndex === null ? undefined : orders[selectedOrderIndex];
  const stages = activeOrder ? getQuickStatusStages(activeOrder) : [];
  const selectedStage =
    activeStageIndex !== null && activeStageIndex < stages.length
      ? stages[activeStageIndex]
      : undefined;
  const items =
    selectedStage && activeOrder
      ? getQuickStatusStageTimelineItems(file, activeOrder, selectedStage)
      : activeOrder
        ? getQuickStatusOrderTimelineItems(file, activeOrder)
        : getQuickStatusFileTimelineItems(file);
  const firstDate = parseDate(items[0]?.date);
  const stageProgress =
    activeOrder && stages.length
      ? getQuickStageDeliveryProgress(file, activeOrder, stages)
      : undefined;
  const milestoneStatuses = activeOrder
    ? getQuickViewerOrderMilestoneStatuses(file, activeOrder, selectedStage).filter(
        (milestone) =>
          !stages.length ||
          !["deliveryperiod", "delivery", "jobcompletion"].includes(
            normalizeQuickEntryMilestone(milestone.label),
          ),
      )
    : getQuickViewerMilestoneStatuses(file).filter(
        (milestone) =>
          !supplyOrderQuickEntryMilestones.has(normalizeQuickEntryMilestone(milestone.label)),
      );
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <h3 className="text-sm font-semibold">Milestone History</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Only applicable milestones are shown. Pending means the milestone applies but is not
        completed yet. Incomplete future D.P. dates are red; due or overdue incomplete delivery is
        yellow; completed delivery is green.
      </p>
      <div
        className="mt-3 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Milestone history scope"
      >
        <button
          type="button"
          role="tab"
          aria-selected={selectedOrderIndex === null}
          onClick={() => {
            setActiveOrderIndex(null);
            setActiveStageIndex(null);
          }}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${selectedOrderIndex === null ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-accent"}`}
        >
          File Level
        </button>
        {orders.map((order, orderIndex) => (
          <button
            key={order.id ?? `milestone-history-order-tab-${orderIndex}`}
            type="button"
            role="tab"
            aria-selected={selectedOrderIndex === orderIndex}
            onClick={() => {
              setActiveOrderIndex(orderIndex);
              setActiveStageIndex(null);
            }}
            className={`rounded-md border px-3 py-2 text-sm font-medium ${selectedOrderIndex === orderIndex ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-accent"}`}
          >
            Supply Order {orderIndex + 1}
          </button>
        ))}
      </div>
      {stageProgress ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-2 text-xs">
          <span className="font-semibold text-foreground">Delivery progress</span>
          <span
            className={`font-medium ${stageProgress.completed === stageProgress.total ? "text-success" : "text-foreground"}`}
          >
            {stageProgress.completed} of {stageProgress.total} stages complete
          </span>
          {stageProgress.overdue ? (
            <span className="font-medium text-warning">{stageProgress.overdue} overdue</span>
          ) : null}
          {stageProgress.dueToday ? (
            <span className="font-medium text-warning">{stageProgress.dueToday} due today</span>
          ) : null}
          {stageProgress.upcoming ? (
            <span className="font-medium text-destructive">{stageProgress.upcoming} upcoming</span>
          ) : null}
          {stageProgress.unscheduled ? (
            <span className="text-muted-foreground">{stageProgress.unscheduled} without D.P.</span>
          ) : null}
          {stageProgress.stopped ? (
            <span className="text-muted-foreground">{stageProgress.stopped} stopped</span>
          ) : null}
        </div>
      ) : null}
      {activeOrder && stages.length ? (
        <div className="mt-3">
          <TimelineStageSelect
            value={selectedStage === undefined ? "order" : String(activeStageIndex)}
            onValueChange={(value) => setActiveStageIndex(value === "order" ? null : Number(value))}
            ariaLabel={`Supply Order ${selectedOrderIndex! + 1} timeline stage`}
            options={[
              { value: "order", label: "S.O. dates" },
              ...stages.map((stage, stageIndex) => ({
                value: String(stageIndex),
                label: `Stage ${stageIndex + 1}`,
                status: getQuickStageStatusLabel(file, activeOrder, stage),
              })),
            ]}
          />
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {milestoneStatuses.map((milestone) => (
          <div
            key={milestone.label}
            className={
              "rounded-md border px-3 py-2 " +
              (milestone.status === "Current"
                ? "border-primary/35 bg-primary/10"
                : milestone.status === "Completed"
                  ? "border-success/35 bg-success/10"
                  : "border-border bg-muted/45")
            }
          >
            <div className="text-sm font-medium">{milestone.label}</div>
            <div className="mt-1 text-xs text-muted-foreground">{milestone.status}</div>
          </div>
        ))}
      </div>
      {selectedStage && activeOrder ? (
        <div className="mt-3 rounded-md border border-border bg-card px-3 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-foreground">Stage {activeStageIndex! + 1}</span>
            <span
              className={getQuickTimelineStatusTextClass(
                getQuickDeliveryScheduleStatus(
                  file,
                  activeOrder,
                  String(selectedStage.revisedDp || selectedStage.dpDate || ""),
                  selectedStage,
                ),
              )}
            >
              {selectedStage.revisedDp || selectedStage.dpDate
                ? `D.P.: ${formatDate(selectedStage.revisedDp || selectedStage.dpDate)}`
                : "D.P. not recorded"}
            </span>
            <span className="text-muted-foreground">
              {isJobCompletionWorkflow(file) ? "Actual job completion" : "Material receipt"}:{" "}
              {formatDate(getQuickDeliveryCompletionDate(file, selectedStage)) || "Not recorded"}
            </span>
          </div>
        </div>
      ) : null}
      <div className="mt-3 max-h-[520px] overflow-auto pr-1">
        {items.length ? (
          <ol className="relative space-y-0">
            <span className="absolute left-[5.75rem] top-2 bottom-2 w-px bg-border" />
            {items.map((item, index) => {
              const currentDate = parseDate(item.date);
              const previousDate = parseDate(items[index - 1]?.date);
              const stageGap = daysBetween(previousDate, currentDate);
              const cumulativeGap = daysBetween(firstDate, currentDate);
              const statusText = getQuickTimelineStatusText(item);
              return (
                <li key={`${item.label}:${item.date}:${index}`} className="relative pb-4 last:pb-0">
                  <div className="grid grid-cols-[4.5rem_1.5rem_minmax(0,1fr)] items-start gap-2">
                    <div className="pt-0.5 text-right text-[0.6875rem] font-medium text-muted-foreground">
                      {formatDays(stageGap)}
                    </div>
                    <div className="relative flex h-5 justify-center">
                      <span
                        role={statusText ? "img" : undefined}
                        aria-label={statusText}
                        title={statusText}
                        className={`mt-1.5 size-3 rounded-full border-2 border-card ${getQuickTimelineDotClass(item.deliveryStatus)}`}
                      />
                    </div>
                    <div className="rounded-md border border-border bg-muted/45 px-3 py-2.5">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0 text-sm font-medium">{item.label}</div>
                        <div className="shrink-0 text-right text-[0.6875rem] font-medium text-muted-foreground">
                          {formatDays(cumulativeGap)}
                        </div>
                      </div>
                      <div
                        className={`text-xs ${getQuickTimelineStatusTextClass(item.deliveryStatus)}`}
                      >
                        {formatDate(item.date)}
                      </div>
                      {statusText ? (
                        <div
                          className={`mt-0.5 text-[0.625rem] ${getQuickTimelineStatusTextClass(item.deliveryStatus)}`}
                        >
                          {statusText}
                        </div>
                      ) : null}
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

function getQuickViewerMilestoneStatuses(file: FileRecord) {
  const current = normalizeQuickEntryMilestone(file.currentMilestone ?? "");
  const completed = new Set((file.completedMilestones ?? []).map(normalizeQuickEntryMilestone));
  const definitions = getQuickViewerMilestoneDefinitions(file);
  const paymentProgress = getQuickViewerFilePaymentProgress(file);
  return definitions
    .filter((definition) => definition.applicable)
    .map((definition) => {
      const label = definition.label;
      const matchKeys = [
        normalizeQuickEntryMilestone(label),
        ...(definition.matchKeys ?? []).map(normalizeQuickEntryMilestone),
      ];
      const key = normalizeQuickEntryMilestone(label);
      return {
        label,
        date: definition.date,
        status:
          key === "payment" && paymentProgress?.includesStagePayments
            ? formatPaymentProgressStatus(
                paymentProgress.paid,
                paymentProgress.total,
                "payment items",
              )
            : matchKeys.includes(current)
              ? "Current"
              : matchKeys.some((key) => completed.has(key)) ||
                  hasDate(getQuickMilestoneCompletionDate(definition))
                ? "Completed"
                : "Pending",
      };
    });
}

function getQuickViewerOrderMilestoneStatuses(
  file: FileRecord,
  order: SupplyOrderDetail,
  selectedStage?: StageDeliveryDetail,
) {
  const current = normalizeQuickEntryMilestone(getEffectiveQuickEntryOrderMilestone(file, order));
  const completed = new Set((order.completedMilestones ?? []).map(normalizeQuickEntryMilestone));
  const hasSo = hasDate(order.soDate);
  const hasDeliveryEvidence =
    hasDate(order.dpDate) ||
    hasDate(order.revisedDp) ||
    hasDate(order.materialReceiptDate) ||
    hasDate(order.jobCompletionDate);
  const hasIrEvidence = hasDate(order.irPreparationDate) || hasDate(order.irReceiptDate);
  const hasBillEvidence =
    hasDate(order.billPreparationDate) || hasDate(order.billSentForPaymentDate);
  const paymentProgress = getQuickViewerOrderPaymentProgress(order);
  const hasPaymentEvidence = paymentProgress.paid > 0;
  const definitions = [
    { label: "Financial Sanction", applicable: true, date: order.financialSanctionDate },
    { label: "Supply Order", applicable: true, date: order.soDate },
    {
      label: "Delivery Period",
      applicable: hasSo || hasDeliveryEvidence,
      date: order.revisedDp || order.dpDate,
    },
    {
      label: "PSB",
      applicable: isBgMilestoneApplicable(file, order, "psb"),
      date: order.psbBgReceivedDate,
    },
    {
      label: "PWB",
      applicable: isBgMilestoneApplicable(file, order, "pwb"),
      date: order.pwbBgReceivedDate,
    },
    {
      label: "PSB+PWB",
      applicable: isBgMilestoneApplicable(file, order, "psbpwb"),
      date: order.combinedBgReceivedDate,
    },
    {
      label: isJobCompletionWorkflow(file) ? "Job Completion" : "Delivery",
      applicable: hasSo || hasDeliveryEvidence,
      date: isJobCompletionWorkflow(file) ? order.jobCompletionDate : order.materialReceiptDate,
    },
    {
      label: "IR Preparation",
      applicable: isYes(file.ir) || hasIrEvidence,
      date: order.irPreparationDate,
    },
    {
      label: "IR Receipt",
      applicable: isYes(file.ir) || hasIrEvidence,
      date: order.irReceiptDate,
    },
    {
      label: "Bill preparation",
      applicable: hasSo || hasBillEvidence || hasPaymentEvidence,
      date: order.billPreparationDate,
    },
    {
      label: "Bill sent for payment",
      applicable: hasSo || hasBillEvidence || hasPaymentEvidence,
      date: order.billSentForPaymentDate,
    },
    {
      label: "Payment",
      applicable: hasSo || hasPaymentEvidence,
      date: order.paymentDate,
    },
    {
      label: "Advance Payment",
      applicable: isYes(order.advancePayment),
      date: (order.advancePaymentDetail as { paymentDate?: string } | undefined)?.paymentDate,
    },
  ];

  return definitions
    .filter(
      (definition) =>
        definition.applicable &&
        normalizeQuickEntryMilestone(definition.label) !== "deliveryperiod",
    )
    .map((definition) => {
      const key = normalizeQuickEntryMilestone(definition.label);
      const stageFields: Record<string, keyof StageDeliveryDetail> = {
        irpreparation: "irPreparationDate",
        irreceipt: "irReceiptDate",
        billpreparation: "billPreparationDate",
        billsentforpayment: "billSentForPaymentDate",
      };
      const stageField = stageFields[key];
      const stageScoped =
        stageField &&
        isYes(order.stageDelivery) &&
        (!key.startsWith("bill") || isYes(order.stagePayment));
      if (stageScoped) {
        const stages = selectedStage ? [selectedStage] : getQuickStatusStages(order);
        if (stages.length) {
          const completedStages = stages.filter(
            (stage) =>
              hasDate(stage[stageField]) ||
              stage.completedMilestones?.some(
                (value) => normalizeQuickEntryMilestone(value) === key,
              ),
          );
          const allComplete = completedStages.length === stages.length;
          const date = allComplete
            ? stages
                .map((stage) => String(stage[stageField] ?? ""))
                .filter(hasDate)
                .sort()
                .at(-1)
            : undefined;
          return {
            label: definition.label,
            date,
            status: allComplete
              ? "Completed"
              : selectedStage &&
                  normalizeQuickEntryMilestone(selectedStage.currentMilestone ?? "") === key
                ? "Current"
                : completedStages.length
                  ? `${completedStages.length} of ${stages.length} stages complete`
                  : "Pending",
          };
        }
      }
      return {
        label: definition.label,
        date: definition.date,
        status:
          key === "payment" && paymentProgress.includesStagePayments
            ? formatPaymentProgressStatus(paymentProgress.paid, paymentProgress.total, "stages")
            : key === current
              ? "Current"
              : completed.has(key) || hasDate(getQuickMilestoneCompletionDate(definition))
                ? "Completed"
                : "Pending",
      };
    });
}

type QuickViewerPaymentProgress = {
  paid: number;
  total: number;
  includesStagePayments: boolean;
};

function getQuickViewerOrderPaymentProgress(order: SupplyOrderDetail): QuickViewerPaymentProgress {
  if (isYes(order.stageDelivery) && isYes(order.stagePayment)) {
    const stages = getQuickStatusStages(order);
    const paid = stages.filter(
      (stage) =>
        hasDate(stage.paymentDate) ||
        (stage.completedMilestones ?? []).some(
          (milestone) => normalizeQuickEntryMilestone(milestone) === "payment",
        ),
    ).length;
    return { paid, total: stages.length, includesStagePayments: true };
  }

  const completed = (order.completedMilestones ?? []).some(
    (milestone) => normalizeQuickEntryMilestone(milestone) === "payment",
  );
  return {
    paid: hasDate(order.paymentDate) || completed ? 1 : 0,
    total: 1,
    includesStagePayments: false,
  };
}

function getQuickViewerFilePaymentProgress(
  file: FileRecord,
): QuickViewerPaymentProgress | undefined {
  const orders = rawSupplyOrders(file);
  const relevantOrders = orders
    .map((order) => ({ order, progress: getQuickViewerOrderPaymentProgress(order) }))
    .filter(({ order, progress }) => hasDate(order.soDate) || progress.paid > 0);
  const includesStagePayments = relevantOrders.some(
    ({ progress }) => progress.includesStagePayments,
  );
  if (!includesStagePayments) return undefined;

  const progress = relevantOrders.reduce(
    (total, entry) => {
      total.paid += entry.progress.paid;
      total.total += entry.progress.total;
      return total;
    },
    { paid: 0, total: 0 },
  );

  return { ...progress, includesStagePayments: true };
}

function formatPaymentProgressStatus(
  paid: number,
  total: number,
  unit: "stages" | "payment items",
) {
  if (total > 0 && paid >= total) return "Completed";
  if (paid > 0) return `${paid} of ${total} ${unit} paid`;
  return "Pending";
}

function getQuickMilestoneCompletionDate(definition: {
  date?: unknown;
  completionDate?: unknown;
}) {
  return Object.prototype.hasOwnProperty.call(definition, "completionDate")
    ? definition.completionDate
    : definition.date;
}

function getQuickViewerMilestoneDefinitions(file: FileRecord) {
  const orders = rawSupplyOrders(file);
  const currentMilestone = normalizeQuickEntryMilestone(file.currentMilestone ?? "");
  const completedMilestones = new Set(
    (file.completedMilestones ?? []).map(normalizeQuickEntryMilestone),
  );
  const hasOrder = orders.length > 0 || hasDate(file.soDate);
  const hasFinancialSanction = orders.some((order) => hasDate(order.financialSanctionDate));
  const hasSo = orders.some((order) => hasDate(order.soDate)) || hasDate(file.soDate);
  const hasDeliveryEvidence = orders.some(
    (order) =>
      hasDate(order.dpDate) ||
      hasDate(order.revisedDp) ||
      hasDate(order.materialReceiptDate) ||
      hasDate(order.jobCompletionDate),
  );
  const hasIrEvidence = orders.some(
    (order) => hasDate(order.irPreparationDate) || hasDate(order.irReceiptDate),
  );
  const hasBillEvidence = orders.some(
    (order) => hasDate(order.billPreparationDate) || hasDate(order.billSentForPaymentDate),
  );
  const hasPaymentEvidence = orders.some(
    (order) => getQuickViewerOrderPaymentProgress(order).paid > 0,
  );
  const hasAdvanceEvidence = orders.some((order) => isYes(order.advancePayment));

  return [
    {
      label: "Scrutiny",
      applicable: true,
      date: file.scrutinyCompletionDate,
    },
    {
      label: "High Value",
      applicable: isYes(file.highValue) || hasDate(file.highValueMeetingDate),
      date: file.highValueMinutesDate,
    },
    {
      label: "Pre-TCEC",
      applicable: isYes(file.tcec) || hasDate(file.preTcecDate),
      date: file.preTcecMinutesDate,
    },
    {
      label: "AD",
      applicable: isYes(file.ad) || hasDate(file.adSentDate) || hasDate(file.adVettingDate),
      date: file.adVettingDate,
    },
    {
      label: "R&QA",
      applicable: isYes(file.rqa) || hasDate(file.rqaSentDate) || hasDate(file.rqaApprovalDate),
      date: file.rqaApprovalDate,
    },
    {
      label: "Controlled",
      matchKeys: ["Controlling", "Control"],
      applicable: true,
      date: file.immsDate,
    },
    {
      label: "IFA",
      applicable: isYes(file.ifa) || hasDate(file.ifaSentDate) || hasDate(file.ifaFinalDate),
      date: file.ifaFinalDate,
    },
    { label: "CFA", applicable: true, date: file.cfaDate },
    {
      label: "Pre-Bid Meeting",
      applicable: isYes(file.preBidMeeting) || hasDate(file.preBidMeetingDate),
      date: file.preBidMeetingDate,
      completionDate: isDateOnOrBeforeToday(file.preBidMeetingDate)
        ? file.preBidMeetingDate
        : undefined,
    },
    {
      label: "Bidding",
      applicable:
        isBiddingApplicableForFile(file) ||
        hasDate(file.bidDate) ||
        hasDate(file.bidOpeningDate) ||
        isYes(file.tenderLive),
      date: isYes(file.biddingStageOver) ? file.bidOpeningDate || file.bidDate : file.bidDate,
      completionDate: isYes(file.biddingStageOver)
        ? file.bidOpeningDate || file.bidDate
        : undefined,
    },
    {
      label: "Post-TCEC",
      applicable: isYes(file.tcec) || hasDate(file.postTcecDate),
      date: file.postTcecMinutesDate,
    },
    {
      label: "Refloat Pre-Bid Meeting",
      applicable:
        isYes(file.refloat) &&
        (isYes(file.refloatPreBidMeeting) || hasDate(file.refloatPreBidMeetingDate)),
      date: file.refloatPreBidMeetingDate,
      completionDate: isDateOnOrBeforeToday(file.refloatPreBidMeetingDate)
        ? file.refloatPreBidMeetingDate
        : undefined,
    },
    {
      label: "Refloat Bidding",
      applicable:
        isYes(file.refloat) &&
        (isRefloatBiddingApplicableForFile(file) ||
          hasDate(file.refloatBiddingDate) ||
          hasDate(file.refloatBidOpeningDate) ||
          isYes(file.refloatTenderLive) ||
          isYes(file.refloatBidOpened) ||
          isYes(file.refloatBiddingStageOver) ||
          currentMilestone === "refloatbidding" ||
          completedMilestones.has("refloatbidding")),
      date: isYes(file.refloatBiddingStageOver)
        ? file.refloatBidOpeningDate || file.refloatBiddingDate
        : file.refloatBiddingDate,
      completionDate: isYes(file.refloatBiddingStageOver)
        ? file.refloatBidOpeningDate || file.refloatBiddingDate
        : undefined,
    },
    {
      label: "Refloat Post-TCEC",
      applicable:
        isYes(file.refloat) &&
        ((isYes(file.tcec) && isRefloatBiddingApplicableForFile(file)) ||
          hasDate(file.refloatPostTcecDate) ||
          hasDate(file.refloatPostTcecMinutesDate) ||
          currentMilestone === "refloatposttcec" ||
          completedMilestones.has("refloatposttcec")),
      date: file.refloatPostTcecMinutesDate,
    },
    {
      label: "CNC",
      applicable:
        hasDate(file.cncDate) ||
        hasDate(file.cncApprovalDate) ||
        currentMilestone === "cnc" ||
        completedMilestones.has("cnc") ||
        isTcecPostTcecCncPath(file),
      date: file.cncApprovalDate,
    },
    {
      label: "Financial Sanction",
      applicable: hasOrder || isFinancialSanctionReached(file) || hasFinancialSanction,
      date: getFirstOrderDate(orders, "financialSanctionDate"),
    },
    {
      label: "Supply Order",
      applicable: hasOrder || hasFinancialSanction,
      date: getFirstOrderDate(orders, "soDate") || file.soDate,
    },
    {
      label: "Delivery Period",
      applicable: hasSo || hasDeliveryEvidence,
      date:
        getFirstOrderDate(orders, "revisedDp") ||
        getFirstOrderDate(orders, "dpDate") ||
        file.dpDate,
    },
    {
      label: "PSB",
      applicable: orders.some((order) => isBgMilestoneApplicable(file, order, "psb")),
      date: getFirstOrderDate(orders, "psbBgReceivedDate"),
    },
    {
      label: "PWB",
      applicable: orders.some((order) => isBgMilestoneApplicable(file, order, "pwb")),
      date: getFirstOrderDate(orders, "pwbBgReceivedDate"),
    },
    {
      label: "PSB+PWB",
      applicable: orders.some((order) => isBgMilestoneApplicable(file, order, "psbpwb")),
      date: getFirstOrderDate(orders, "combinedBgReceivedDate"),
    },
    {
      label: isJobCompletionWorkflow(file) ? "Job Completion" : "Delivery",
      applicable: hasSo || hasDeliveryEvidence,
      date: isJobCompletionWorkflow(file)
        ? getFirstOrderDate(orders, "jobCompletionDate")
        : getFirstOrderDate(orders, "materialReceiptDate"),
    },
    {
      label: "IR Preparation",
      applicable: isYes(file.ir) || hasIrEvidence,
      date: getFirstOrderDate(orders, "irPreparationDate"),
    },
    {
      label: "IR Receipt",
      applicable: isYes(file.ir) || hasIrEvidence,
      date: getFirstOrderDate(orders, "irReceiptDate"),
    },
    {
      label: "Bill preparation",
      applicable: hasSo || hasBillEvidence || hasPaymentEvidence,
      date: getFirstOrderDate(orders, "billPreparationDate"),
    },
    {
      label: "Bill sent for payment",
      applicable: hasSo || hasBillEvidence || hasPaymentEvidence,
      date: getFirstOrderDate(orders, "billSentForPaymentDate"),
    },
    {
      label: "Payment",
      applicable: hasSo || hasPaymentEvidence,
      date: getFirstOrderDate(orders, "paymentDate"),
    },
    {
      label: "Advance Payment",
      applicable: hasAdvanceEvidence,
      date: getFirstAdvancePaymentDate(orders),
    },
    {
      label: "File Closed",
      applicable:
        hasDate(file.fileClosureDate) ||
        normalizeQuickEntryMilestone(file.currentMilestone) === "fileclosed",
      date: file.fileClosureDate,
    },
  ];
}

function isTcecPostTcecCncPath(file: FileRecord) {
  const currentMilestone = normalizeQuickEntryMilestone(file.currentMilestone);
  const completedMilestones = new Set(
    (file.completedMilestones ?? []).map(normalizeQuickEntryMilestone),
  );
  return (
    isYes(file.tcec) &&
    (hasDate(file.postTcecDate) ||
      hasDate(file.postTcecMinutesDate) ||
      currentMilestone === "posttcec" ||
      (isYes(file.refloat) &&
        (hasDate(file.refloatPostTcecDate) ||
          hasDate(file.refloatPostTcecMinutesDate) ||
          currentMilestone === "refloatposttcec" ||
          completedMilestones.has("refloatposttcec"))) ||
      currentMilestone === "cnc")
  );
}

function getFirstOrderDate(orders: Array<{ [key: string]: unknown }>, key: string) {
  return orders
    .map((order) => String(order[key] ?? ""))
    .filter(hasDate)
    .sort()[0];
}

function getFirstAdvancePaymentDate(orders: Array<{ [key: string]: unknown }>) {
  return orders
    .map((order) => {
      const detail = order.advancePaymentDetail as { paymentDate?: unknown } | undefined;
      return String(detail?.paymentDate ?? "");
    })
    .filter(hasDate)
    .sort()[0];
}

function isBgMilestoneApplicable(
  file: FileRecord,
  order: { [key: string]: unknown },
  kind: string,
) {
  if (kind === "psb") {
    return (
      isYes(order.psbApplicable) &&
      ["PSB", "PSB and PWB separately"].includes(String(order.bgCoverageType ?? ""))
    );
  }
  if (kind === "pwb") {
    return (
      isYes(file.bg) &&
      ["PWB", "PSB and PWB separately"].includes(String(order.bgCoverageType ?? ""))
    );
  }
  return isYes(file.bg) && String(order.bgCoverageType ?? "") === "PSB+PWB";
}

function StatusHistoryPanel({
  statuses,
  editingStatusId,
  editingStatusText,
  onEdit,
  onCancel,
  onChange,
  onSave,
  saving = false,
}: {
  statuses: FileStatusUpdate[];
  editingStatusId: string;
  editingStatusText: string;
  onEdit: (status: FileStatusUpdate) => void;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSave: (statusId: string) => void;
  saving?: boolean;
}) {
  const sortedStatuses = [...statuses].sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <h3 className="text-sm font-semibold">File Status history</h3>
      <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
        {sortedStatuses.length ? (
          sortedStatuses.map((status) => {
            const editing = editingStatusId === status.id;
            const words = countWords(editing ? editingStatusText : status.text);
            return (
              <div key={status.id} className="rounded-md bg-muted/45 p-2">
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
                          disabled={saving || !editingStatusText.trim() || words > 50}
                          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary/80 px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
      returnToQuickEntry: true,
    },
  });
}

function getQuickStatusFileTimelineItems(file: FileRecord) {
  return sortQuickStatusTimelineItems([
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
    ["Refloat GeM undertaking date", file.refloatGemUndertakingDate],
    ["Refloat recommendation date for Non-TCEC cases", file.refloatRecommendationDate],
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
  ]);
}

function getQuickStatusOrderTimelineItems(file: FileRecord, order: SupplyOrderDetail) {
  return sortQuickStatusTimelineItems([
    ["Financial Sanction", order.financialSanctionDate],
    ["S.O. date", order.soDate],
    ["D.P.", order.dpDate, getQuickDeliveryScheduleStatus(file, order, order.dpDate ?? "")],
    [
      "Revised D.P.",
      order.revisedDp,
      getQuickDeliveryScheduleStatus(file, order, order.revisedDp ?? ""),
    ],
    ["Material receipt", order.materialReceiptDate],
    ["Actual job completion", order.actualJobCompletionDate],
    ["Job Completion Received Date", order.jobCompletionDate],
    ["IR Preparation", order.irPreparationDate],
    ["IR Receipt", order.irReceiptDate],
    ["Bill preparation", order.billPreparationDate],
    ["Bill sent for payment", order.billSentForPaymentDate],
    ["Payment", order.paymentDate],
    ["S.O. cancellation", order.soCancelledDate],
    ["Shortclosure", order.shortclosureDate],
  ]);
}

function getQuickStatusStageTimelineItems(
  file: FileRecord,
  order: SupplyOrderDetail,
  stage: StageDeliveryDetail,
) {
  return sortQuickStatusTimelineItems([
    ["Period start", stage.deliveryPeriodStartDate],
    ["D.P.", stage.dpDate, getQuickDeliveryScheduleStatus(file, order, stage.dpDate ?? "", stage)],
    [
      "Revised D.P.",
      stage.revisedDp,
      getQuickDeliveryScheduleStatus(file, order, stage.revisedDp ?? "", stage),
    ],
    ["Material receipt", stage.materialReceiptDate],
    ["Actual job completion", stage.actualJobCompletionDate],
    ["Job Completion Received Date", stage.jobCompletionDate],
    ["IR Preparation", stage.irPreparationDate],
    ["IR Receipt", stage.irReceiptDate],
    ["Bill preparation", stage.billPreparationDate],
    ["Bill sent for payment", stage.billSentForPaymentDate],
    ["Payment", stage.paymentDate],
  ]);
}

function sortQuickStatusTimelineItems(
  items: Array<[string, unknown, QuickTimelineStatus?]>,
): QuickTimelineItem[] {
  return items
    .filter((item): item is [string, string, QuickTimelineStatus?] => hasDate(item[1]))
    .sort((a, b) => (parseDate(a[1])?.getTime() ?? 0) - (parseDate(b[1])?.getTime() ?? 0))
    .map(([label, date, deliveryStatus]) => ({ label, date, deliveryStatus }));
}

function getQuickStatusStages(order: SupplyOrderDetail): StageDeliveryDetail[] {
  if (!isYes(order.stageDelivery)) return [];
  const recordedStages = order.stageDeliveries ?? [];
  const parsedCount = Number.parseInt(String(order.stageDeliveryCount ?? ""), 10);
  const declaredCount = Number.isFinite(parsedCount) ? Math.max(1, parsedCount) : 1;
  const count = Math.min(50, Math.max(declaredCount, recordedStages.length));
  return Array.from({ length: count }, (_, index) => recordedStages[index] ?? {});
}

function getQuickDeliveryScheduleStatus(
  file: FileRecord,
  order: SupplyOrderDetail,
  dueDateValue: string,
  stage?: StageDeliveryDetail,
): QuickTimelineStatus | undefined {
  const dueDate = parseDate(dueDateValue);
  if (!dueDate) return undefined;

  const today = parseDate(getQuickTodayIsoDate());
  if (!today) return undefined;

  const complete = stage
    ? isQuickDeliveryCompleteByToday(file, stage, today)
    : isYes(order.stageDelivery)
      ? getQuickStatusStages(order).length > 0 &&
        getQuickStatusStages(order).every((item) =>
          isQuickDeliveryCompleteByToday(file, item, today),
        )
      : isQuickDeliveryCompleteByToday(file, order, today);
  if (complete) return "complete";
  if (isQuickDeliveryFollowUpStopped(order)) return "inactive";
  if (dueDate.getTime() > today.getTime()) return "upcoming";
  return dueDate.getTime() === today.getTime() ? "due" : "overdue";
}

function isQuickDeliveryCompleteByToday(
  file: FileRecord,
  delivery:
    | Pick<SupplyOrderDetail, "materialReceiptDate" | "actualJobCompletionDate">
    | Pick<StageDeliveryDetail, "materialReceiptDate" | "actualJobCompletionDate">,
  today = parseDate(getQuickTodayIsoDate()),
) {
  const completionDate = getQuickDeliveryCompletionDate(file, delivery);
  const parsedCompletionDate = parseDate(completionDate);
  return Boolean(
    today && parsedCompletionDate && parsedCompletionDate.getTime() <= today.getTime(),
  );
}

function getQuickDeliveryCompletionDate(
  file: FileRecord,
  delivery:
    | Pick<SupplyOrderDetail, "materialReceiptDate" | "actualJobCompletionDate">
    | Pick<StageDeliveryDetail, "materialReceiptDate" | "actualJobCompletionDate">,
) {
  return isJobCompletionWorkflow(file)
    ? delivery.actualJobCompletionDate
    : delivery.materialReceiptDate;
}

function isQuickDeliveryFollowUpStopped(order: SupplyOrderDetail) {
  return isYes(order.soCancelled) || isYes(order.shortclosure) || isYes(order.noFurtherAction);
}

function getQuickStageDeliveryProgress(
  file: FileRecord,
  order: SupplyOrderDetail,
  stages: StageDeliveryDetail[],
) {
  const today = parseDate(getQuickTodayIsoDate());
  const progress = {
    total: stages.length,
    completed: 0,
    overdue: 0,
    dueToday: 0,
    upcoming: 0,
    unscheduled: 0,
    stopped: 0,
  };
  for (const stage of stages) {
    if (isQuickDeliveryCompleteByToday(file, stage, today)) {
      progress.completed += 1;
      continue;
    }
    if (isQuickDeliveryFollowUpStopped(order)) {
      progress.stopped += 1;
      continue;
    }
    const dueDateValue = stage.revisedDp || stage.dpDate;
    const dueDate = parseDate(dueDateValue);
    if (!dueDate) {
      progress.unscheduled += 1;
    } else if (today && dueDate.getTime() > today.getTime()) {
      progress.upcoming += 1;
    } else if (today && dueDate.getTime() === today.getTime()) {
      progress.dueToday += 1;
    } else {
      progress.overdue += 1;
    }
  }
  return progress;
}

function getQuickStageStatusLabel(
  file: FileRecord,
  order: SupplyOrderDetail,
  stage: StageDeliveryDetail,
) {
  if (isQuickDeliveryCompleteByToday(file, stage)) return "Complete";
  if (isQuickDeliveryFollowUpStopped(order)) return "Stopped";
  const status = getQuickDeliveryScheduleStatus(
    file,
    order,
    String(stage.revisedDp || stage.dpDate || ""),
    stage,
  );
  if (!status) return "No D.P.";
  if (status === "upcoming") return "Upcoming";
  if (status === "due") return "Due today";
  if (status === "overdue") return "Overdue";
  return status === "complete" ? "Complete" : "Stopped";
}

function getQuickTimelineDotClass(status: QuickTimelineStatus | undefined) {
  if (status === "upcoming") return "bg-destructive";
  if (status === "due" || status === "overdue") return "bg-warning";
  if (status === "inactive") return "bg-muted-foreground/50";
  return "bg-success shadow-[0_0_0_3px_var(--color-success)]/10";
}

function getQuickTimelineStatusTextClass(status: QuickTimelineStatus | undefined) {
  if (status === "upcoming") return "text-destructive";
  if (status === "due" || status === "overdue") return "text-warning";
  if (status === "complete") return "text-success";
  return "text-muted-foreground";
}

function getQuickTimelineStatusText(item: QuickTimelineItem) {
  if (item.deliveryStatus === "upcoming") {
    const dueIn = daysBetween(parseDate(getQuickTodayIsoDate()), parseDate(item.date));
    return dueIn === undefined ? "Future D.P." : `Future D.P. · Due in ${formatDays(dueIn)}`;
  }
  if (item.deliveryStatus === "due") return "D.P. due today; delivery incomplete";
  if (item.deliveryStatus === "overdue") {
    const overdueDays = daysBetween(parseDate(item.date), parseDate(getQuickTodayIsoDate()));
    return overdueDays === undefined
      ? "D.P. passed; delivery incomplete"
      : `D.P. passed; ${formatDays(overdueDays)} overdue`;
  }
  if (item.deliveryStatus === "complete") return "Delivery complete";
  if (item.deliveryStatus === "inactive") return "Delivery follow-up stopped";
  return undefined;
}

function getQuickTodayIsoDate() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function normalizeQuickEntryCode(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function getQuickEntryStageForCurrentMilestone(
  file: FileRecord,
): QuickEntryDestination | undefined {
  const orderMilestone = getCurrentSupplyOrderMilestone(file);
  const current = orderMilestone?.milestone ?? normalizeQuickEntryMilestone(file.currentMilestone);
  if (!current) return getQuickEntryStageForLastFilledDate(file);
  const stage = quickEntryStageSections.find((item) =>
    item.milestones.some((milestone) => normalizeQuickEntryMilestone(milestone) === current),
  );
  if (!stage) return undefined;
  return {
    ...stage,
    focusTarget: orderMilestone
      ? getQuickEntryOrderFocusTarget(current, orderMilestone.orderIndex, orderMilestone.stageIndex)
      : isSupplyOrderQuickEntryMilestone(current)
        ? `${current}:current`
        : undefined,
  };
}

function getQuickEntryStageForLastFilledDate(file: FileRecord): QuickEntryDestination | undefined {
  const datedStages: { title: string; date: unknown; focusTarget?: string }[] = [
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
    { title: "Bidding details", date: file.refloatGemUndertakingDate },
    { title: "Bidding details", date: file.refloatRecommendationDate },
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
    ...rawSupplyOrders(file).flatMap((order, orderIndex) => {
      const orderDates: Array<[unknown, string?]> = [
        [order.financialSanctionDate, "financialsanction"],
        [order.soDate, "supplyorder"],
        [order.dpDate, "deliveryperiod"],
        [order.revisedDp, "deliveryperiod"],
        [order.materialReceiptDate, isJobCompletionWorkflow(file) ? "jobcompletion" : "delivery"],
        [order.jobCompletionDate, "jobcompletion"],
        [order.irPreparationDate, "irpreparation"],
        [order.irReceiptDate, "irreceipt"],
        [order.psbBgReceivedDate, "psb"],
        [order.pwbBgReceivedDate, "pwb"],
        [order.combinedBgReceivedDate, "psbpwb"],
        [order.billPreparationDate, "billpreparation"],
        [order.billSentForPaymentDate, "billsentforpayment"],
        [order.paymentDate, "payment"],
        [order.soCancelledDate],
        [order.shortclosureDate],
      ];
      const stageDates: Array<{ date: unknown; milestone: string; stageIndex: number }> = (
        order.stageDeliveries ?? []
      ).flatMap((stage, stageIndex) => [
        ...[stage.deliveryPeriodStartDate, stage.dpDate, stage.revisedDp].map((date) => ({
          date,
          milestone: "deliveryperiod",
          stageIndex,
        })),
        {
          date: stage.materialReceiptDate,
          milestone: isJobCompletionWorkflow(file) ? "jobcompletion" : "delivery",
          stageIndex,
        },
        ...[stage.actualJobCompletionDate, stage.jobCompletionDate].map((date) => ({
          date,
          milestone: "jobcompletion",
          stageIndex,
        })),
        { date: stage.irPreparationDate, milestone: "irpreparation", stageIndex },
        { date: stage.irReceiptDate, milestone: "irreceipt", stageIndex },
        { date: stage.billPreparationDate, milestone: "billpreparation", stageIndex },
        { date: stage.billSentForPaymentDate, milestone: "billsentforpayment", stageIndex },
        { date: stage.paymentDate, milestone: "payment", stageIndex },
      ]);

      return [
        ...orderDates.map(([date, milestone]) => ({
          title: "Supply order and payment",
          date,
          focusTarget: milestone ? getQuickEntryOrderFocusTarget(milestone, orderIndex) : undefined,
        })),
        ...stageDates.map(({ date, milestone, stageIndex }) => ({
          title: "Supply order and payment",
          date,
          focusTarget: getQuickEntryOrderFocusTarget(milestone, orderIndex, stageIndex),
        })),
      ];
    }),
  ];

  const latest = datedStages
    .map((stage, index) => ({ ...stage, index, parsedDate: parseDate(stage.date) }))
    .filter((stage): stage is typeof stage & { parsedDate: Date } => Boolean(stage.parsedDate))
    .sort((a, b) => {
      const dateDiff = b.parsedDate.getTime() - a.parsedDate.getTime();
      return dateDiff || b.index - a.index;
    })[0];
  return latest ? { title: latest.title, focusTarget: latest.focusTarget } : undefined;
}

function getCurrentSupplyOrderMilestone(file: FileRecord): QuickEntryOrderMilestone | undefined {
  const candidates: QuickEntryOrderMilestone[] = rawSupplyOrders(file).flatMap(
    (order, orderIndex) => {
      const orderMilestone = normalizeQuickEntryMilestone(
        getEffectiveQuickEntryOrderMilestone(file, order),
      );
      const orderCandidate = isSupplyOrderQuickEntryMilestone(orderMilestone)
        ? [
            {
              milestone: orderMilestone,
              orderIndex,
              latestDate: getLatestQuickEntryDate(order),
              isStage: false,
              hasExplicitMilestone: Boolean(String(order.currentMilestone ?? "").trim()),
            },
          ]
        : [];
      const stageCandidates = (order.stageDeliveries ?? []).flatMap((stage, stageIndex) => {
        const hasStageActivity =
          Boolean(String(stage.currentMilestone ?? "").trim()) ||
          getLatestQuickEntryDate(stage) !== undefined;
        if (!hasStageActivity) return [];
        const stageMilestone = normalizeQuickEntryMilestone(
          getEffectiveQuickEntryOrderMilestone(file, {
            ...order,
            ...stage,
            currentMilestone: stage.currentMilestone ?? "",
          }),
        );
        if (!isSupplyOrderQuickEntryMilestone(stageMilestone)) return [];
        return [
          {
            milestone: stageMilestone,
            orderIndex,
            stageIndex,
            latestDate: getLatestQuickEntryDate(stage) ?? getLatestQuickEntryDate(order),
            isStage: true,
            hasExplicitMilestone: Boolean(String(stage.currentMilestone ?? "").trim()),
          },
        ];
      });
      return [...orderCandidate, ...stageCandidates];
    },
  );
  return candidates.sort((a, b) => {
    const dateDiff = (b.latestDate ?? 0) - (a.latestDate ?? 0);
    if (dateDiff) return dateDiff;
    if (a.hasExplicitMilestone !== b.hasExplicitMilestone) {
      return Number(b.hasExplicitMilestone) - Number(a.hasExplicitMilestone);
    }
    if (a.isStage !== b.isStage) return Number(b.isStage) - Number(a.isStage);
    return b.orderIndex - a.orderIndex || (b.stageIndex ?? -1) - (a.stageIndex ?? -1);
  })[0];
}

function getLatestQuickEntryDate(record: object) {
  const dateValues = Object.values(record).filter((value) => hasDate(value));
  return dateValues.map((value) => parseDate(value)?.getTime() ?? 0).sort((a, b) => b - a)[0];
}

function getQuickEntryOrderFocusTarget(milestone: string, orderIndex: number, stageIndex?: number) {
  const stageDrivenMilestones = new Set([
    "deliveryperiod",
    "delivery",
    "jobcompletion",
    "irpreparation",
    "irreceipt",
    "billpreparation",
    "billsentforpayment",
    "billreturnedforcorrection",
    "payment",
    "actualpayment",
    "dpextension",
    "ld",
  ]);
  const target = `${milestone}:current:${orderIndex}`;
  return stageIndex !== undefined && stageDrivenMilestones.has(milestone)
    ? `${target}:${stageIndex}`
    : target;
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
    !isYes(file.demandCancelled) &&
    (isBiddingApplicableForFile(file)
      ? isYes(isYes(file.refloat) ? file.refloatBiddingStageOver : file.biddingStageOver)
      : hasDate(file.cfaDate)) &&
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

function isDateOnOrBeforeToday(value: unknown) {
  const date = parseDate(value);
  const today = parseDate(getQuickTodayIsoDate());
  return Boolean(date && today && date.getTime() <= today.getTime());
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
