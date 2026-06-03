import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { ArrowRight, ScanLine } from "lucide-react";
import { type FileRecord, useAccessibleFiles } from "@/lib/files-store";

export const Route = createFileRoute("/quick-entry")({
  component: QuickEntryPage,
});

const quickEntryStages = [
  {
    number: "1",
    title: "Scrutiny and control",
    fields: [
      "scrutinyDate",
      "scrutinyResponseDate",
      "scrutinyCompletionDate",
      "imms",
      "immsDate",
      "fileNo",
      "scrutinyRemark1",
      "scrutinyRemark2",
    ],
  },
  {
    number: "2",
    title: "TCEC block",
    fields: [
      "preTcecCommitteeNo",
      "preTcecDate",
      "preTcecMinutesDate",
      "postTcecCommitteeNumber",
      "postTcecDate",
      "postTcecMinutesDate",
      "refloatPostTcecCommitteeNo",
      "refloatPostTcecDate",
      "refloatPostTcecMinutesDate",
      "tcecRemark1",
      "tcecRemark2",
    ],
  },
  {
    number: "3",
    title: "Approval block",
    fields: [
      "highValueMeetingDate",
      "highValueMinutesDate",
      "adVettingDate",
      "rqaApprovalDate",
      "ifaSentDate",
      "ifaFinalDate",
      "cfaSentDate",
      "cfaDate",
      "approvalRemark1",
      "approvalRemark2",
    ],
  },
  {
    number: "4",
    title: "Bidding details",
    fields: [
      "gemUndertakingDate",
      "rfpVettingInitiationDate",
      "rfpVettingApprovalDate",
      "tenderLive",
      "bidDate",
      "bidOpeningDate",
      "bidOpened",
      "refloat",
      "refloatBiddingDate",
      "refloatBidOpeningDate",
      "rst",
      "biddingStageOver",
      "cncDate",
      "cncApprovalDate",
      "biddingRemark1",
      "biddingRemark2",
    ],
  },
  {
    number: "5",
    title: "Supply order and payment",
    fields: ["noOfSo", "soNo", "soDate", "firm", "dpDate", "materialReceiptDate", "paymentDate"],
  },
  {
    number: "6",
    title: "Firm details",
    fields: [],
  },
];

type QuickEntryError = { tone: "error" | "warning"; text: string };

function QuickEntryPage() {
  const files = useAccessibleFiles();
  const navigate = useNavigate();
  const [uniqueCode, setUniqueCode] = useState("");
  const [stageNumber, setStageNumber] = useState("");
  const [message, setMessage] = useState<QuickEntryError | null>(null);
  const stageInputRef = useRef<HTMLInputElement>(null);

  const filesByUniqueCode = useMemo(() => {
    const map = new Map<string, FileRecord[]>();
    files.forEach((file) => {
      const code = normalizeQuickEntryCode(file.uniqueCode);
      if (!code) return;
      map.set(code, [...(map.get(code) ?? []), file]);
    });
    return map;
  }, [files]);

  const findFile = () => {
    const code = normalizeQuickEntryCode(uniqueCode);
    if (!code) {
      setMessage({ tone: "error", text: "Scan or enter the Unique code first." });
      return undefined;
    }

    const matches = filesByUniqueCode.get(code) ?? [];
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

  const continueToStage = (allowCompletedSection = false) => {
    const file = findFile();
    if (!file) return;

    const stage = quickEntryStages.find((item) => item.number === stageNumber.trim());
    if (!stage) {
      setMessage({ tone: "error", text: "Enter a valid stage number from 1 to 6." });
      return;
    }

    if (!allowCompletedSection && isQuickEntryStageComplete(file, stage)) {
      setMessage({
        tone: "warning",
        text: `${stage.title} appears fully completed for this file. Press Open anyway if you still want to review it.`,
      });
      return;
    }

    navigate({
      to: "/add",
      search: { fileId: file.id, section: stage.title, quickFocus: true },
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
              Scan the file barcode, enter a stage number, and jump to the first unfilled field.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_180px_auto]">
          <label className="block">
            <div className="mb-1.5 text-xs font-medium">Unique code</div>
            <input
              value={uniqueCode}
              onChange={(event) => {
                setUniqueCode(event.target.value);
                setMessage(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  stageInputRef.current?.focus();
                }
              }}
              autoFocus
              placeholder="Scan barcode or type Unique code"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="block">
            <div className="mb-1.5 text-xs font-medium">Stage number</div>
            <input
              ref={stageInputRef}
              value={stageNumber}
              onChange={(event) => {
                setStageNumber(event.target.value.replace(/\D/g, "").slice(0, 1));
                setMessage(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  continueToStage();
                }
              }}
              inputMode="numeric"
              placeholder="1 to 6"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <button
            type="button"
            onClick={() => continueToStage()}
            className="inline-flex h-10 items-center justify-center gap-1.5 self-end rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Open <ArrowRight className="size-4" />
          </button>
        </div>

        {message ? (
          <div
            className={
              "mt-4 rounded-md border px-3 py-2 text-sm " +
              (message.tone === "warning"
                ? "border-warning/40 bg-warning/10 text-foreground"
                : "border-destructive/40 bg-destructive/10 text-destructive")
            }
          >
            <div>{message.text}</div>
            {message.tone === "warning" ? (
              <button
                type="button"
                onClick={() => continueToStage(true)}
                className="mt-2 h-8 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
              >
                Open anyway
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <h3 className="mb-3 text-sm font-semibold">Stages</h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {quickEntryStages.map((stage) => (
            <button
              key={stage.number}
              type="button"
              onClick={() => {
                setStageNumber(stage.number);
                setMessage(null);
                stageInputRef.current?.focus();
              }}
              className={
                "flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent " +
                (stageNumber === stage.number
                  ? "border-primary bg-primary/10"
                  : "border-border bg-secondary/25")
              }
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
                {stage.number}
              </span>
              <span className="font-medium">{stage.title}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function normalizeQuickEntryCode(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isQuickEntryStageComplete(file: FileRecord, stage: (typeof quickEntryStages)[number]) {
  if (stage.title === "Firm details") {
    return Boolean(file.invitedFirms?.length || file.bidderFirms?.length);
  }

  if (stage.title === "Supply order and payment") {
    const orders = file.supplyOrders?.length
      ? file.supplyOrders
      : file.soNo || file.soDate || file.firm || file.paymentDate
        ? [file]
        : [];
    return Boolean(
      file.noOfSo &&
      orders.length > 0 &&
      orders.every((order) => order.soNo && order.soDate && order.firm && order.paymentDate),
    );
  }

  return stage.fields.every((field) =>
    Boolean(String((file as Record<string, unknown>)[field] ?? "").trim()),
  );
}
