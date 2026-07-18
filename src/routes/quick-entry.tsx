import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, ScanLine } from "lucide-react";
import { fileSupplyOrders, rawSupplyOrders } from "@/lib/effective-deliveries";
import { fetchFilesByUniqueCode, type FileRecord, useActiveUser } from "@/lib/files-store";

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
      "Delivery Period",
      "Bank Guarantee",
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

type QuickEntryError = { tone: "error"; text: string };

function QuickEntryPage() {
  const activeUser = useActiveUser();
  const canEditFiles =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    activeUser?.role === "editor";
  if (!canEditFiles) {
    return (
      <div className="max-w-xl rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <h1 className="text-sm font-semibold">Quick Entry unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your account can view records only.</p>
      </div>
    );
  }

  return <QuickEntryEditor />;
}

function QuickEntryEditor() {
  const navigate = useNavigate();
  const [uniqueCode, setUniqueCode] = useState("");
  const [message, setMessage] = useState<QuickEntryError | null>(null);
  const [milestoneFileId, setMilestoneFileId] = useState("");
  const [loading, setLoading] = useState(false);

  const findFile = async () => {
    const code = normalizeQuickEntryCode(uniqueCode);
    if (!code) {
      setMessage({ tone: "error", text: "Scan or enter the Unique code first." });
      return undefined;
    }

    setLoading(true);
    const matches = await fetchFilesByUniqueCode(code)
      .then((result) => result.files)
      .catch((error) => {
        console.error(error);
        setMessage({ tone: "error", text: "File lookup failed. Please try again." });
        return [];
      })
      .finally(() => setLoading(false));
    if (matches.length === 0) {
      setMessage({
        tone: "error",
        text: "No accessible file was found for this Unique code.",
      });
      return undefined;
    }
    if (matches.length > 1) {
      setMessage({
        tone: "error",
        text: "More than one accessible file has this Unique code. Please correct duplicate codes before using Quick Entry.",
      });
      return undefined;
    }
    return matches[0];
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
          : "Current status is not selected for this file. Please select it under Milestones.",
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

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="mb-5 flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-secondary">
            <ScanLine className="size-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Quick Entry</h2>
            <p className="text-xs text-muted-foreground">
              Scan the file barcode to open the currently running stage and focus the first unfilled
              field.
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
                if (event.key === "Enter") {
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
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-1.5 self-end rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
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
    </div>
  );
}

function normalizeQuickEntryCode(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function getQuickEntryStageForCurrentMilestone(file: FileRecord) {
  const current = getEffectiveQuickEntryMilestone(file);
  if (!current) return undefined;
  const stage = quickEntryStageSections.find((item) =>
    item.milestones.some((milestone) => normalizeQuickEntryMilestone(milestone) === current),
  );
  if (!stage) return undefined;
  return {
    ...stage,
    focusTarget: isSupplyOrderQuickEntryMilestone(current) ? `${current}:current` : undefined,
  };
}

function getEffectiveQuickEntryMilestone(file: FileRecord) {
  const orderCurrent = getCurrentSupplyOrderMilestone(file);
  if (orderCurrent) return orderCurrent;
  return normalizeQuickEntryMilestone(file.currentMilestone);
}

function getCurrentSupplyOrderMilestone(file: FileRecord) {
  const currentMilestones = [
    ...rawSupplyOrders(file).map((order) => order.currentMilestone),
    ...fileSupplyOrders(file).map((order) => order.currentMilestone),
  ];
  return (
    currentMilestones
      .map(normalizeQuickEntryMilestone)
      .find((milestone) => milestone && isSupplyOrderQuickEntryMilestone(milestone)) ?? ""
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

const supplyOrderQuickEntryMilestones = new Set(
  quickEntryStageSections
    .find((stage) => stage.title === "Supply order and payment")!
    .milestones.map(normalizeQuickEntryMilestone),
);
