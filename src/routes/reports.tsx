import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import {
  type FileRecord,
  type SupplyOrderDetail,
  useAccessibleDivisions,
  useSettings,
} from "@/lib/files-store";
import { downloadBackendExport } from "@/lib/export-download";
import { formatThousandsAndLakhs, getInrAmount } from "@/lib/money";
import { isCancelledFile } from "@/lib/year-filter";

export const Route = createFileRoute("/reports")({
  component: ReportsPage,
});

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

type ReportsSummaryPayload = {
  activeDivision: string;
  reportFileCount: number;
  statusSummaryGroups: StatusSummaryTableGroup[];
  expectedCashOutgoDpRows: ExpectedCashOutgoRow[];
  expectedCashOutgoReceiptRows: ExpectedCashOutgoRow[];
  actualCashOutgoRows: ExpectedCashOutgoRow[];
  delayRows: DelayStatusRow[];
  delaySummary: ReturnType<typeof getDelayStatusSummary>;
};

async function fetchReportsSummary(query: string, signal: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}/api/reports/summary?${query}`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `Reports request failed: ${response.status}`);
  }
  return (await response.json()) as { summary: ReportsSummaryPayload };
}

function ReportsPage() {
  const divisions = useAccessibleDivisions();
  const settings = useSettings();
  const navigate = useNavigate();
  const [selectedDivision, setSelectedDivision] = useState("all");
  const [reportMode, setReportMode] = useState<ReportMode>("delayStatus");
  const [delayDays, setDelayDays] = useState("5");
  const [expectedCashOutgoDays, setExpectedCashOutgoDays] = useState("0");
  const [delayMilestoneKey, setDelayMilestoneKey] = useState("all");
  const [reportsSummary, setReportsSummary] = useState<ReportsSummaryPayload | undefined>();
  const [reportsLoading, setReportsLoading] = useState(false);
  const [hasLoadedReports, setHasLoadedReports] = useState(false);
  const [reportsError, setReportsError] = useState<string | undefined>();
  const hasLoadedReportsRef = useRef(false);
  const selectedDivisionIsAccessible =
    selectedDivision === "all" || divisions.some((division) => division.name === selectedDivision);
  const activeDivision = selectedDivisionIsAccessible ? selectedDivision : "all";
  const delayThresholdDays = getDelayThresholdDays(delayDays);
  const expectedCashOutgoOffsetDays = getDelayThresholdDays(expectedCashOutgoDays) || 0;
  const reportsQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("division", activeDivision);
    params.set("delayDays", String(delayThresholdDays));
    params.set("expectedCashOutgoDays", String(expectedCashOutgoOffsetDays));
    params.set("delayMilestone", delayMilestoneKey);
    params.set("selectedYear", settings.selectedYear);
    return params.toString();
  }, [
    activeDivision,
    delayThresholdDays,
    delayMilestoneKey,
    expectedCashOutgoOffsetDays,
    settings.selectedYear,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    const delay = hasLoadedReportsRef.current ? 180 : 0;
    const timeoutId = window.setTimeout(() => {
      setReportsLoading(true);
      setReportsError(undefined);
      fetchReportsSummary(reportsQuery, controller.signal)
        .then((payload) => {
          setReportsSummary(payload.summary);
          setHasLoadedReports(true);
          hasLoadedReportsRef.current = true;
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.error(error);
          setReportsError(error instanceof Error ? error.message : "Reports request failed.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setReportsLoading(false);
        });
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [reportsQuery]);

  const expectedCashOutgoDpRows = reportsSummary?.expectedCashOutgoDpRows ?? [];
  const expectedCashOutgoReceiptRows =
    reportsSummary?.expectedCashOutgoReceiptRows ?? [];
  const actualCashOutgoRows = reportsSummary?.actualCashOutgoRows ?? [];
  const currentLiabilityRows = getCurrentMonthLiabilityRows(expectedCashOutgoReceiptRows);
  const delayRows = reportsSummary?.delayRows ?? [];
  const delaySummary = reportsSummary?.delaySummary ?? getDelayStatusSummary([]);
  const selectedCashOutgoRows =
    reportMode === "currentMonthLiability"
      ? currentLiabilityRows
      : reportMode === "actualCashOutgo"
      ? actualCashOutgoRows
      : reportMode === "expectedCashOutgoByReceipt"
        ? expectedCashOutgoReceiptRows
        : expectedCashOutgoDpRows;
  const expectedCashOutgoDpReportTitle =
    activeDivision === "all"
      ? "Expected cash outgo by DP date - All divisions"
      : `Expected cash outgo by DP date - ${activeDivision}`;
  const expectedCashOutgoReceiptReportTitle =
    activeDivision === "all"
      ? "Expected cash outgo by receipt date - All divisions"
      : `Expected cash outgo by receipt date - ${activeDivision}`;
  const actualCashOutgoReportTitle =
    activeDivision === "all"
      ? "Actual cash outgo monthly - All divisions"
      : `Actual cash outgo monthly - ${activeDivision}`;
  const currentLiabilityReportTitle =
    activeDivision === "all"
      ? "Current month liability - All divisions"
      : `Current month liability - ${activeDivision}`;
  const cashOutgoReportTitle =
    reportMode === "currentMonthLiability"
      ? currentLiabilityReportTitle
      : reportMode === "actualCashOutgo"
      ? actualCashOutgoReportTitle
      : reportMode === "expectedCashOutgoByReceipt"
        ? expectedCashOutgoReceiptReportTitle
        : expectedCashOutgoDpReportTitle;
  const delayReportTitle =
    activeDivision === "all"
      ? `Delay status - More than ${delayThresholdDays} days`
      : `Delay status - More than ${delayThresholdDays} days - ${activeDivision}`;
  const reportTitle = reportMode === "delayStatus" ? delayReportTitle : cashOutgoReportTitle;
  const selectedReportMode =
    reportModes.find((mode) => mode.key === reportMode) ?? reportModes[0];
  const openDelaySearch = (milestoneKey = delayMilestoneKey) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter: getDelayStatusDashboardFilter(delayThresholdDays, milestoneKey),
        division: activeDivision === "all" ? undefined : activeDivision,
      },
    });
  };
  const openDelayFile = (fileId: string) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter: `delayFile:${fileId}`,
        division: activeDivision === "all" ? undefined : activeDivision,
      },
    });
  };
  const openCashOutgoSearch = (mode: CashOutgoFilterMode, monthKey: string) => {
    navigate({
      to: "/search",
      search: {
        dashboardFilter: getCashOutgoDashboardFilter(mode, monthKey, expectedCashOutgoOffsetDays),
        division: activeDivision === "all" ? undefined : activeDivision,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="space-y-1">
            {reportModes.map((mode) => {
              const selected = reportMode === mode.key;
              return (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => setReportMode(mode.key)}
                  className={
                    "w-full rounded-md px-3 py-2 text-left text-sm font-medium transition " +
                    (selected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground")
                  }
                >
                  {mode.label}
                </button>
              );
            })}
          </div>
        </aside>
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{selectedReportMode.label}</h2>
              <p className="text-xs text-muted-foreground">{reportTitle}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-[220px] flex-col gap-1 text-xs text-muted-foreground">
                <span>Division</span>
                <select
                  value={activeDivision}
                  onChange={(event) => setSelectedDivision(event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                >
                  <option value="all">All accessible divisions</option>
                  {divisions.map((division) => (
                    <option key={division.id} value={division.name}>
                      {division.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() =>
                  reportMode === "delayStatus"
                    ? printDelayStatusToPdf(delayRows, reportTitle)
                    : reportMode === "currentMonthLiability"
                      ? printCurrentLiabilityToPdf(selectedCashOutgoRows, reportTitle)
                      : reportMode === "actualCashOutgo"
                      ? printActualCashOutgoToPdf(selectedCashOutgoRows, reportTitle)
                      : printExpectedCashOutgoToPdf(
                          selectedCashOutgoRows,
                          reportTitle,
                          expectedCashOutgoOffsetDays,
                          reportMode === "expectedCashOutgoByReceipt" ? "receipt" : "dp",
                        )
                }
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
              >
                <FileText className="size-4" />
                PDF
              </button>
              <button
                type="button"
                onClick={() =>
                  reportMode === "delayStatus"
                    ? exportDelayStatusToExcel(delayRows, reportTitle)
                    : reportMode === "currentMonthLiability"
                      ? exportCurrentLiabilityToExcel(selectedCashOutgoRows, reportTitle)
                      : reportMode === "actualCashOutgo"
                      ? exportActualCashOutgoToExcel(selectedCashOutgoRows, reportTitle)
                      : exportExpectedCashOutgoToExcel(selectedCashOutgoRows, reportTitle)
                }
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
              >
                <FileSpreadsheet className="size-4" />
                Excel
              </button>
            </div>
          </div>

          {reportsError || (reportsLoading && !hasLoadedReports) ? (
            <div
              className={
                "rounded-md border px-3 py-2 text-xs " +
                (reportsError
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border bg-secondary/30 text-muted-foreground")
              }
            >
              {reportsError
                ? `Reports API unavailable, showing local fallback: ${reportsError}`
                : "Updating reports..."}
            </div>
          ) : null}

          {reportMode === "delayStatus" ? (
            <DelayStatusReport
              rows={delayRows}
              thresholdDays={delayThresholdDays}
              selectedDays={delayDays}
              selectedMilestoneKey={delayMilestoneKey}
              summary={delaySummary}
              onDaysChange={setDelayDays}
              onMilestoneChange={setDelayMilestoneKey}
              onOpenFile={openDelayFile}
              onOpenSearch={() => openDelaySearch()}
              onOpenMilestone={(milestoneKey) => openDelaySearch(milestoneKey)}
            />
          ) : reportMode === "currentMonthLiability" ? (
            <CurrentMonthLiabilityReport
              rows={currentLiabilityRows}
              selectedDays={expectedCashOutgoDays}
              offsetDays={expectedCashOutgoOffsetDays}
              onDaysChange={setExpectedCashOutgoDays}
            />
          ) : reportMode === "actualCashOutgo" ? (
            <ActualCashOutgoReport
              rows={actualCashOutgoRows}
              onOpenMonth={(monthKey) => openCashOutgoSearch("actual", monthKey)}
            />
          ) : reportMode === "expectedCashOutgoByReceipt" ? (
            <ExpectedCashOutgoReport
              rows={expectedCashOutgoReceiptRows}
              base="receipt"
              selectedDays={expectedCashOutgoDays}
              offsetDays={expectedCashOutgoOffsetDays}
              onDaysChange={setExpectedCashOutgoDays}
              onOpenMonth={(monthKey) => openCashOutgoSearch("expectedReceipt", monthKey)}
            />
          ) : (
            <ExpectedCashOutgoReport
              rows={expectedCashOutgoDpRows}
              base="dp"
              selectedDays={expectedCashOutgoDays}
              offsetDays={expectedCashOutgoOffsetDays}
              onDaysChange={setExpectedCashOutgoDays}
              onOpenMonth={(monthKey) => openCashOutgoSearch("expectedDp", monthKey)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type ReportMode =
  | "expectedCashOutgoByDp"
  | "expectedCashOutgoByReceipt"
  | "currentMonthLiability"
  | "actualCashOutgo"
  | "delayStatus";
type CashOutgoFilterMode = "expectedDp" | "expectedReceipt" | "actual";

const reportModes = [
  { key: "expectedCashOutgoByDp", label: "Expected cash outgo by DP date" },
  { key: "expectedCashOutgoByReceipt", label: "Expected cash outgo by receipt date" },
  { key: "currentMonthLiability", label: "Current month liability" },
  { key: "actualCashOutgo", label: "Actual cash out go" },
  { key: "delayStatus", label: "Delay status" },
] satisfies Array<{ key: ReportMode; label: string }>;
const fileClosedMilestone = "File Closed";
const delayStatusPageSizeOptions = [25, 50, 100] as const;

function ExpectedCashOutgoReport({
  rows,
  base,
  selectedDays,
  offsetDays,
  onDaysChange,
  onOpenMonth,
}: {
  rows: ExpectedCashOutgoRow[];
  base: "dp" | "receipt";
  selectedDays: string;
  offsetDays: number;
  onDaysChange: (value: string) => void;
  onOpenMonth: (monthKey: string) => void;
}) {
  const isReceipt = base === "receipt";
  return (
    <CashOutgoReport
      rows={rows}
      title={isReceipt ? "Expected cash outgo by receipt date" : "Expected cash outgo by DP date"}
      description={
        isReceipt
          ? `Uses material receipt date plus ${offsetDays} days, excluding rows with payment date filled.`
          : `Uses revised DP date when filled, otherwise DP date, plus ${offsetDays} days, excluding S.O. cancelled rows and rows with material receipt date or payment date filled.`
      }
      emptyMessage="No expected cash outgo rows found."
      onOpenMonth={onOpenMonth}
      controls={
        <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
          <span>Days after base date</span>
          <input
            type="number"
            min="0"
            value={selectedDays}
            onChange={(event) => onDaysChange(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
          />
        </label>
      }
    />
  );
}

function ActualCashOutgoReport({
  rows,
  onOpenMonth,
}: {
  rows: ExpectedCashOutgoRow[];
  onOpenMonth: (monthKey: string) => void;
}) {
  return (
    <CashOutgoReport
      rows={rows}
      title="Actual cash out go monthly"
      description="Uses payment date, excluding S.O. cancelled rows only when cancellation date is filled."
      emptyMessage="No actual cash out go rows found."
      onOpenMonth={onOpenMonth}
    />
  );
}

function CurrentMonthLiabilityReport({
  rows,
  selectedDays,
  offsetDays,
  onDaysChange,
}: {
  rows: ExpectedCashOutgoRow[];
  selectedDays: string;
  offsetDays: number;
  onDaysChange: (value: string) => void;
}) {
  return (
    <CashOutgoReport
      rows={rows}
      title="Current month liability"
      description={`Uses material receipt date plus ${offsetDays} days, carrying forward unpaid amounts from previous months into the current month.`}
      emptyMessage="No unpaid liability found for the current month."
      controls={
        <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
          <span>Days after base date</span>
          <input
            type="number"
            min="0"
            value={selectedDays}
            onChange={(event) => onDaysChange(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
          />
        </label>
      }
    />
  );
}

function CashOutgoReport({
  rows,
  title,
  description,
  emptyMessage,
  controls,
  onOpenMonth,
}: {
  rows: ExpectedCashOutgoRow[];
  title: string;
  description: string;
  emptyMessage: string;
  controls?: ReactNode;
  onOpenMonth?: (monthKey: string) => void;
}) {
  const totals = getExpectedCashOutgoTotals(rows);

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {controls}
        <div className="grid grid-cols-2 gap-2 text-right text-xs">
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
            <div className="text-muted-foreground">Total Capital</div>
            <div className="font-semibold tabular-nums">{formatCurrency(totals.capital)}</div>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
            <div className="text-muted-foreground">Total Revenue</div>
            <div className="font-semibold tabular-nums">{formatCurrency(totals.revenue)}</div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
                {cashOutgoColumns.map((column) => (
                  <th
                    key={column.key}
                    className={
                      "px-3 py-2.5 font-semibold " +
                      (column.align === "right" ? "text-right" : "text-left")
                    }
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row, index) => (
                  <tr
                    key={row.monthKey}
                    className={
                      "border-b border-border/60 last:border-0 " +
                      (index % 2 === 0 ? "bg-card" : "bg-secondary/15")
                    }
                  >
                    {cashOutgoColumns.map((column) => (
                      <td
                        key={column.key}
                        className={
                          "px-3 py-2.5 tabular-nums " +
                          (column.align === "right" ? "text-right" : "text-left")
                        }
                      >
                        {column.key === "month" ? (
                          onOpenMonth ? (
                            <button
                              type="button"
                              onClick={() => onOpenMonth(row.monthKey)}
                              className="font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {getCashOutgoDisplayValue(row, column.key, index)}
                            </button>
                          ) : (
                            <span className="font-medium">
                              {getCashOutgoDisplayValue(row, column.key, index)}
                            </span>
                          )
                        ) : (
                          getCashOutgoDisplayValue(row, column.key, index)
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={cashOutgoColumns.length}
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length ? (
              <tfoot>
                <CashOutgoTotalsRow totals={totals} />
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );
}

function CashOutgoTable({
  rows,
  emptyMessage,
}: {
  rows: ExpectedCashOutgoRow[];
  emptyMessage: string;
}) {
  const totals = getExpectedCashOutgoTotals(rows);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
              {cashOutgoColumns.map((column) => (
                <th
                  key={column.key}
                  className={
                    "px-3 py-2.5 font-semibold " +
                    (column.align === "right" ? "text-right" : "text-left")
                  }
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr
                  key={row.monthKey}
                  className={
                    "border-b border-border/60 last:border-0 " +
                    (index % 2 === 0 ? "bg-card" : "bg-secondary/15")
                  }
                >
                  {cashOutgoColumns.map((column) => (
                    <td
                      key={column.key}
                      className={
                        "px-3 py-2.5 tabular-nums " +
                        (column.align === "right" ? "text-right" : "text-left")
                      }
                    >
                      {getCashOutgoDisplayValue(row, column.key, index)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={cashOutgoColumns.length}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length ? (
            <tfoot>
              <CashOutgoTotalsRow totals={totals} />
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function CashOutgoTotalsRow({ totals }: { totals: Pick<ExpectedCashOutgoRow, "capital" | "revenue"> }) {
  return (
    <tr className="border-t border-border bg-muted/40 font-semibold">
      <td className="px-3 py-2.5 text-right tabular-nums" />
      <td className="px-3 py-2.5 text-left">Total</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(totals.capital)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(totals.revenue)}</td>
    </tr>
  );
}

function StatusCountValue({
  value,
  onClick,
}: {
  value: number | string | undefined;
  onClick?: () => void;
}) {
  if (value === undefined || value === "") {
    return <span className="text-muted-foreground/40">-</span>;
  }

  if (value === "-") {
    return <span className="text-muted-foreground">-</span>;
  }

  const isZero = value === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex min-w-8 justify-center rounded px-2 py-0.5 text-xs font-semibold transition hover:ring-2 hover:ring-ring/30 " +
        (isZero ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-foreground")
      }
    >
      {value}
    </button>
  );
}

function DelayStatusReport({
  rows,
  summary,
  thresholdDays,
  selectedDays,
  selectedMilestoneKey,
  onDaysChange,
  onMilestoneChange,
  onOpenFile,
  onOpenSearch,
  onOpenMilestone,
}: {
  rows: DelayStatusRow[];
  summary: ReturnType<typeof getDelayStatusSummary>;
  thresholdDays: number;
  selectedDays: string;
  selectedMilestoneKey: string;
  onDaysChange: (value: string) => void;
  onMilestoneChange: (value: string) => void;
  onOpenFile: (fileId: string) => void;
  onOpenSearch: () => void;
  onOpenMilestone: (milestoneKey: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof delayStatusPageSizeOptions)[number]>(25);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = rows.length ? (safePage - 1) * pageSize : 0;
  const pageEnd = Math.min(pageStart + pageSize, rows.length);
  const visibleRows = rows.slice(pageStart, pageEnd);
  const pageNumbers = getPaginationPages(safePage, totalPages);

  useEffect(() => {
    setPage(1);
  }, [selectedDays, selectedMilestoneKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Delay status</h2>
          <p className="text-xs text-muted-foreground">
            Files stuck in their current milestone for more than {thresholdDays} days.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex w-28 flex-col gap-1 text-xs text-muted-foreground">
            <span>Days</span>
            <input
              type="number"
              min="0"
              value={selectedDays}
              onChange={(event) => onDaysChange(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="flex min-w-[220px] flex-col gap-1 text-xs text-muted-foreground">
            <span>Milestone</span>
            <select
              value={selectedMilestoneKey}
              onChange={(event) => onMilestoneChange(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="all">All milestones</option>
              {delayMilestoneOptions.map((milestone) => (
                <option key={milestone.key} value={milestone.key}>
                  {milestone.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <button
          type="button"
          onClick={onOpenSearch}
          className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-left hover:bg-accent"
        >
          <div className="text-muted-foreground">Delayed files</div>
          <div className="font-semibold tabular-nums">{rows.length}</div>
        </button>
        <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
          <div className="text-muted-foreground">Average days</div>
          <div className="font-semibold tabular-nums">
            {summary.averageDays ? `${summary.averageDays} days` : "-"}
          </div>
        </div>
        <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
          <div className="text-muted-foreground">Longest delay</div>
          <div className="font-semibold tabular-nums">
            {summary.longestDays ? `${summary.longestDays} days` : "-"}
          </div>
        </div>
      </div>

      {selectedMilestoneKey === "all" && summary.byMilestone.length ? (
        <div className="mb-5 flex flex-wrap gap-2">
          {summary.byMilestone.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onOpenMilestone(item.key)}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="text-muted-foreground">{item.label}</span>{" "}
              <span className="font-semibold tabular-nums">{item.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div>
          {rows.length
            ? `Showing ${pageStart + 1}-${pageEnd} of ${rows.length} delayed files`
            : "No delayed files"}
        </div>
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value) as typeof pageSize);
              setPage(1);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
          >
            {delayStatusPageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
                {delayStatusColumns.map((column) => (
                  <th
                    key={column.key}
                    className={
                      "px-3 py-2.5 font-semibold " +
                      (column.align === "right" ? "text-right" : "text-left")
                    }
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length ? (
                visibleRows.map((row, index) => {
                  const absoluteIndex = pageStart + index;
                  return (
                    <tr
                      key={row.fileId}
                      className={
                        "border-b border-border/60 last:border-0 " +
                        (index % 2 === 0 ? "bg-card" : "bg-secondary/15")
                      }
                    >
                      {delayStatusColumns.map((column) => (
                        <td
                          key={column.key}
                          className={
                            "px-3 py-2.5 " +
                            (column.align === "right" ? "text-right tabular-nums" : "text-left")
                          }
                        >
                          {column.key === "action" ? (
                            <button
                              type="button"
                              onClick={() => onOpenFile(row.fileId)}
                              className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-accent"
                            >
                              Open
                            </button>
                          ) : (
                            getDelayStatusDisplayValue(row, column.key, absoluteIndex)
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={delayStatusColumns.length}
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    No delayed files found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="text-xs text-muted-foreground">
            Page {safePage} of {totalPages}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage === 1}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              Previous
            </button>
            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                className={
                  "h-8 min-w-8 rounded-md border px-2 text-xs font-medium " +
                  (pageNumber === safePage
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-accent")
                }
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage === totalPages}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getPaginationPages(currentPage: number, totalPages: number) {
  const firstPage = Math.max(1, currentPage - 2);
  const lastPage = Math.min(totalPages, firstPage + 4);
  const startPage = Math.max(1, lastPage - 4);
  return Array.from({ length: lastPage - startPage + 1 }, (_, index) => startPage + index);
}

function exportDelayStatusToExcel(rows: DelayStatusRow[], title: string) {
  void downloadDelayStatus(rows, title, "excel");
}

function printDelayStatusToPdf(rows: DelayStatusRow[], title: string) {
  void downloadDelayStatus(rows, title, "pdf");
}

async function downloadDelayStatus(
  rows: DelayStatusRow[],
  title: string,
  format: "excel" | "pdf",
) {
  const exportColumns = delayStatusColumns.filter((column) => column.key !== "action");
  await downloadBackendExport({
    format,
    title,
    description: "Files whose current milestone has remained open beyond the selected threshold.",
    tables: [
      {
        headers: exportColumns.map((column) => column.label),
        rows: rows.map((row, index) =>
          exportColumns.map((column) => getDelayStatusDisplayValue(row, column.key, index)),
        ),
      },
    ],
  });
}

function getDelayStatusTableHtml(rows: DelayStatusRow[]) {
  const exportColumns = delayStatusColumns.filter((column) => column.key !== "action");
  return `
    <table>
      <thead>
        <tr>
          ${exportColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? rows
                .map(
                  (row, index) => `
                    <tr>
                      ${exportColumns
                        .map(
                          (column) =>
                            `<td>${escapeHtml(getDelayStatusDisplayValue(row, column.key, index))}</td>`,
                        )
                        .join("")}
                    </tr>
                  `,
                )
                .join("")
            : `<tr><td colspan="${exportColumns.length}">No delayed files found.</td></tr>`
        }
      </tbody>
    </table>
  `;
}

function getExportFileName(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function exportExpectedCashOutgoToExcel(rows: ExpectedCashOutgoRow[], title: string) {
  exportCashOutgoToExcel(rows, title, "No expected cash outgo rows found.");
}

function exportActualCashOutgoToExcel(rows: ExpectedCashOutgoRow[], title: string) {
  exportCashOutgoToExcel(rows, title, "No actual cash out go rows found.");
}

function exportCurrentLiabilityToExcel(rows: ExpectedCashOutgoRow[], title: string) {
  exportCashOutgoToExcel(rows, title, "No unpaid liability found for the current month.");
}

function exportCashOutgoToExcel(rows: ExpectedCashOutgoRow[], title: string, emptyMessage: string) {
  void downloadCashOutgo(rows, title, emptyMessage, undefined, "excel");
}

function printExpectedCashOutgoToPdf(
  rows: ExpectedCashOutgoRow[],
  title: string,
  offsetDays: number,
  base: "dp" | "receipt",
) {
  printCashOutgoToPdf(
    rows,
    title,
    base === "receipt"
      ? `Cash outgo month is material receipt date plus ${offsetDays} days. Rows with payment date filled are excluded.`
      : `Cash outgo month is revised DP date when filled, otherwise DP date, plus ${offsetDays} days. S.O. cancelled rows and rows with material receipt date or payment date filled are excluded.`,
    "No expected cash outgo rows found.",
  );
}

function printActualCashOutgoToPdf(rows: ExpectedCashOutgoRow[], title: string) {
  printCashOutgoToPdf(
    rows,
    title,
    "Cash outgo month is payment date. Rows are excluded when S.O. cancelled is Yes and S.O. cancelled date is filled.",
    "No actual cash out go rows found.",
  );
}

function printCurrentLiabilityToPdf(rows: ExpectedCashOutgoRow[], title: string) {
  printCashOutgoToPdf(
    rows,
    title,
    "Shows unpaid liability up to the current month, carrying forward unpaid amounts from previous months.",
    "No unpaid liability found for the current month.",
  );
}

function printCashOutgoToPdf(
  rows: ExpectedCashOutgoRow[],
  title: string,
  description: string,
  emptyMessage: string,
) {
  void downloadCashOutgo(rows, title, emptyMessage, description, "pdf");
}

async function downloadCashOutgo(
  rows: ExpectedCashOutgoRow[],
  title: string,
  emptyMessage: string,
  description: string | undefined,
  format: "excel" | "pdf",
) {
  await downloadBackendExport({
    format,
    title,
    description,
    tables: [
      {
        headers: cashOutgoColumns.map((column) => column.label),
        rows: rows.length
          ? [
              ...rows.map((row, index) =>
                cashOutgoColumns.map((column) => getCashOutgoDisplayValue(row, column.key, index)),
              ),
              getCashOutgoTotalsExportRow(rows),
            ]
          : [[emptyMessage]],
      },
    ],
  });
}

function getCashOutgoTableHtml(rows: ExpectedCashOutgoRow[], emptyMessage: string) {
  const totals = getExpectedCashOutgoTotals(rows);

  return `
    <table>
      <thead>
        <tr>
          ${cashOutgoColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? rows
                .map(
                  (row, index) => `
                    <tr>
                      ${cashOutgoColumns
                        .map(
                          (column) =>
                            `<td>${escapeHtml(getCashOutgoDisplayValue(row, column.key, index))}</td>`,
                        )
                        .join("")}
                    </tr>
                  `,
                )
                .join("")
            : `<tr><td colspan="${cashOutgoColumns.length}">${escapeHtml(emptyMessage)}</td></tr>`
        }
      </tbody>
      ${
        rows.length
          ? `<tfoot>
              <tr>
                <td></td>
                <td>Total</td>
                <td>${escapeHtml(formatCurrency(totals.capital))}</td>
                <td>${escapeHtml(formatCurrency(totals.revenue))}</td>
              </tr>
            </tfoot>`
          : ""
      }
    </table>
  `;
}

function escapeHtml(value: string | number | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type ExpectedCashOutgoRow = {
  monthKey: string;
  month: string;
  capital: number;
  revenue: number;
  total: number;
};

type DelayStatusRow = {
  fileId: string;
  fileRef: string;
  division: string;
  indentor: string;
  description: string;
  milestoneKey: string;
  milestone: string;
  stageStartDate: string;
  daysInStage: number;
  lastFilledDate: string;
};

type CashOutgoColumnKey = "serial" | "month" | "capital" | "revenue";
type DelayStatusColumnKey =
  | "serial"
  | "fileRef"
  | "division"
  | "indentor"
  | "description"
  | "milestone"
  | "stageStartDate"
  | "daysInStage"
  | "lastFilledDate"
  | "action";

const cashOutgoColumns = [
  { key: "serial", label: "S.No.", align: "right" },
  { key: "month", label: "Month", align: "left" },
  { key: "capital", label: "Capital", align: "right" },
  { key: "revenue", label: "Revenue", align: "right" },
] satisfies Array<{ key: CashOutgoColumnKey; label: string; align: "left" | "right" }>;

const delayStatusColumns = [
  { key: "serial", label: "S.No.", align: "right" },
  { key: "fileRef", label: "File", align: "left" },
  { key: "division", label: "Division", align: "left" },
  { key: "indentor", label: "Indentor", align: "left" },
  { key: "description", label: "Description", align: "left" },
  { key: "milestone", label: "Current milestone", align: "left" },
  { key: "stageStartDate", label: "Stage start date", align: "left" },
  { key: "daysInStage", label: "Days", align: "right" },
  { key: "lastFilledDate", label: "Last filled date", align: "left" },
  { key: "action", label: "Search", align: "left" },
] satisfies Array<{ key: DelayStatusColumnKey; label: string; align: "left" | "right" }>;

function getExpectedCashOutgoByDpRows(
  files: FileRecord[],
  offsetDays = 0,
): ExpectedCashOutgoRow[] {
  const totals = new Map<string, ExpectedCashOutgoRow>();

  files.forEach((file) => {
    if (isCancelledFile(file)) return;
    fileSupplyOrders(file).forEach((order) => {
      const deliveryPeriodDate = getDeliveryPeriodDate(order);
      if (!hasFilledString(deliveryPeriodDate) || isYes(order.soCancelled)) return;
      if (hasFilledString(order.materialReceiptDate)) return;
      if (hasFilledString(order.paymentDate)) return;
      const cashOutgoDate = addDays(deliveryPeriodDate, offsetDays);
      if (!cashOutgoDate) return;

      addCashOutgoTotal(totals, cashOutgoDate, file, order);
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getExpectedCashOutgoByReceiptRows(
  files: FileRecord[],
  offsetDays = 0,
): ExpectedCashOutgoRow[] {
  const totals = new Map<string, ExpectedCashOutgoRow>();

  files.forEach((file) => {
    if (isCancelledFile(file)) return;
    fileSupplyOrders(file).forEach((order) => {
      if (!hasFilledString(order.materialReceiptDate)) return;
      if (hasFilledString(order.paymentDate)) return;
      const cashOutgoDate = addDays(order.materialReceiptDate, offsetDays);
      if (!cashOutgoDate) return;

      addCashOutgoTotal(totals, cashOutgoDate, file, order);
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getActualCashOutgoRows(files: FileRecord[]): ExpectedCashOutgoRow[] {
  const totals = new Map<string, ExpectedCashOutgoRow>();

  files.forEach((file) => {
    if (isCancelledFile(file)) return;
    fileSupplyOrders(file).forEach((order) => {
      if (!hasFilledString(order.paymentDate) || isSoCancelledWithDate(order)) return;

      addCashOutgoTotal(totals, order.paymentDate, file, order);
    });
  });

  return finalizeCashOutgoRows(totals);
}

function getCurrentMonthLiabilityRows(rows: ExpectedCashOutgoRow[]) {
  const currentMonthKey = getCurrentMonthKey();
  const totals = rows
    .filter((row) => row.monthKey <= currentMonthKey)
    .reduce(
      (sum, row) => ({
        capital: sum.capital + row.capital,
        revenue: sum.revenue + row.revenue,
      }),
      { capital: 0, revenue: 0 },
    );

  if (totals.capital === 0 && totals.revenue === 0) return [];

  return [
    {
      monthKey: currentMonthKey,
      month: formatMonthLabel(`${currentMonthKey}-01`),
      capital: Math.round(totals.capital),
      revenue: Math.round(totals.revenue),
      total: Math.round(totals.capital + totals.revenue),
    },
  ];
}

function getCurrentMonthKey() {
  return formatLocalDate(new Date()).slice(0, 7);
}

function addCashOutgoTotal(
  totals: Map<string, ExpectedCashOutgoRow>,
  cashOutgoDate: string,
  file: FileRecord,
  order: SupplyOrderDetail,
) {
  const monthKey = cashOutgoDate.slice(0, 7);
  const current = totals.get(monthKey) ?? {
    monthKey,
    month: formatMonthLabel(cashOutgoDate),
    capital: 0,
    revenue: 0,
    total: 0,
  };
  const capital = getInrAmount(order.soValueCapital, file) ?? 0;
  const revenue = getInrAmount(order.soValueRevenue, file) ?? 0;
  current.capital += capital;
  current.revenue += revenue;
  current.total += capital + revenue;
  totals.set(monthKey, current);
}

function finalizeCashOutgoRows(totals: Map<string, ExpectedCashOutgoRow>) {
  return Array.from(totals.values())
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .map((row) => ({
      ...row,
      capital: Math.round(row.capital),
      revenue: Math.round(row.revenue),
      total: Math.round(row.total),
    }));
}

function isSoCancelledWithDate(order: SupplyOrderDetail) {
  return isYes(order.soCancelled) && hasFilledString(order.soCancelledDate);
}

function getDelayStatusRows(
  files: FileRecord[],
  thresholdDays: number,
  milestoneKey: string,
): DelayStatusRow[] {
  return files
    .map((file) => getCurrentMilestoneDelay(file, thresholdDays, milestoneKey))
    .filter((row): row is DelayStatusRow => Boolean(row))
    .sort((a, b) => b.daysInStage - a.daysInStage || a.milestone.localeCompare(b.milestone));
}

function getCurrentMilestoneDelay(
  file: FileRecord,
  thresholdDays: number,
  selectedMilestoneKey: string,
) {
  const milestone = getActiveDelayMilestone(file);
  if (!milestone) return undefined;
  if (selectedMilestoneKey !== "all" && milestone.key !== selectedMilestoneKey) return undefined;
  if (isMilestoneComplete(file, milestone)) return undefined;

  const stageStartDate = getMilestoneStageStartDate(file, milestone);
  const daysInStage = getDaysSinceDate(stageStartDate);
  if (daysInStage === undefined || daysInStage <= thresholdDays) return undefined;

  return {
    fileId: file.id,
    fileRef: getFileReference(file),
    division: file.division ?? "",
    indentor: file.indentor ?? "",
    description: file.demandDescription ?? "",
    milestoneKey: milestone.key,
    milestone: milestone.label,
    stageStartDate,
    daysInStage,
    lastFilledDate: getLastFilledDateValue(file) ?? "",
  };
}

function getActiveDelayMilestone(file: FileRecord) {
  return delayMilestoneOptions.find((milestone) => isManualActiveMilestone(file, milestone));
}

function getMilestoneStageStartDate(file: FileRecord, milestone: MilestoneDefinition) {
  if (milestone.reviewed) {
    const reviewedDate = getFieldDateValue(file, milestone.reviewed);
    if (reviewedDate) return reviewedDate;
  }

  const previousMilestone = getPreviousApplicableMilestone(file, milestone);
  if (previousMilestone) return getFieldDateValue(file, previousMilestone.current);
  return getFieldDateValue(file, "receivedDate") ?? getFieldDateValue(file, "date");
}

function getPreviousApplicableMilestone(file: FileRecord, milestone: MilestoneDefinition) {
  let previousMilestone: MilestoneDefinition | undefined;
  for (const item of milestoneDefinitions) {
    if (item.key === milestone.key) break;
    if (isMilestoneApplicable(file, item)) previousMilestone = item;
  }
  return previousMilestone;
}

function getFieldDateValue(file: FileRecord, key: keyof FileRecord | keyof SupplyOrderDetail) {
  if (supplyOrderDateKeys.has(key as keyof SupplyOrderDetail)) {
    return getEarliestSupplyOrderDate(file, key as keyof SupplyOrderDetail);
  }
  const value = file[key as keyof FileRecord];
  return typeof value === "string" && hasDate(value) ? value : undefined;
}

function getEarliestSupplyOrderDate(file: FileRecord, key: keyof SupplyOrderDetail) {
  return fileSupplyOrders(file)
    .map((order) => String(order[key] ?? ""))
    .filter(hasDate)
    .sort((a, b) => a.localeCompare(b))[0];
}

function getDaysSinceDate(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));
  if (dateTime === undefined || todayTime === undefined) return undefined;
  return Math.floor((todayTime - dateTime) / 86_400_000);
}

function getLastFilledDateValue(file: FileRecord) {
  return [
    file.receivedDate,
    file.scrutinyDate,
    file.scrutinyResponseDate,
    file.scrutinyCompletionDate,
    file.immsDate,
    file.highValueMeetingDate,
    file.highValueMinutesDate,
    file.preTcecDate,
    file.preTcecMinutesDate,
    file.adVettingDate,
    file.rqaApprovalDate,
    file.ifaSentDate,
    file.ifaFinalDate,
    file.cfaSentDate,
    file.cfaDate,
    file.gemUndertakingDate,
    file.rfpVettingInitiationDate,
    file.rfpVettingApprovalDate,
    file.bidDate,
    file.bidOpeningDate,
    file.refloatBiddingDate,
    file.refloatBidOpeningDate,
    file.postTcecDate,
    file.postTcecMinutesDate,
    file.refloatPostTcecDate,
    file.refloatPostTcecMinutesDate,
    file.cncDate,
    file.cncApprovalDate,
    ...fileSupplyOrders(file).flatMap((order) => [
      order.soDate,
      order.dpDate,
      order.bgValidityDate,
      order.revisedDp,
      order.materialReceiptDate,
      order.billSentForPaymentDate,
      order.paymentDate,
      order.bgReturnDate,
      order.soCancelledDate,
    ]),
  ]
    .filter((value): value is string => hasDate(value))
    .sort((a, b) => b.localeCompare(a))[0];
}

function getFileReference(file: FileRecord) {
  return file.fileNo || file.uniqueCode || file.title || file.id;
}

function getDelayThresholdDays(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function getDelayStatusDashboardFilter(days: number, milestoneKey: string) {
  return `delayStatus:${days}:${milestoneKey || "all"}`;
}

function getCashOutgoDashboardFilter(
  mode: CashOutgoFilterMode,
  monthKey: string,
  offsetDays: number,
) {
  return `cashOutgo:${mode}:${encodeURIComponent(monthKey)}:${offsetDays}`;
}

function getDelayStatusSummary(rows: DelayStatusRow[]) {
  const totalDays = rows.reduce((sum, row) => sum + row.daysInStage, 0);
  const counts = new Map<string, { key: string; label: string; count: number }>();
  rows.forEach((row) => {
    const current = counts.get(row.milestoneKey) ?? {
      key: row.milestoneKey,
      label: row.milestone,
      count: 0,
    };
    current.count += 1;
    counts.set(row.milestoneKey, current);
  });

  return {
    averageDays: rows.length ? Math.round(totalDays / rows.length) : 0,
    longestDays: rows.reduce((max, row) => Math.max(max, row.daysInStage), 0),
    byMilestone: Array.from(counts.values()).sort((a, b) => b.count - a.count),
  };
}

function getDelayStatusDisplayValue(row: DelayStatusRow, key: DelayStatusColumnKey, index: number) {
  if (key === "serial") return String(index + 1);
  if (key === "action") return "";
  if (key === "daysInStage") return String(row.daysInStage);
  return row[key];
}

function getExpectedCashOutgoTotals(rows: ExpectedCashOutgoRow[]) {
  return rows.reduce(
    (totals, row) => ({
      capital: totals.capital + row.capital,
      revenue: totals.revenue + row.revenue,
    }),
    { capital: 0, revenue: 0 },
  );
}

function getCashOutgoTotalsExportRow(rows: ExpectedCashOutgoRow[]) {
  const totals = getExpectedCashOutgoTotals(rows);
  return ["", "Total", formatCurrency(totals.capital), formatCurrency(totals.revenue)];
}

function getCashOutgoDisplayValue(
  row: ExpectedCashOutgoRow,
  key: CashOutgoColumnKey,
  index: number,
) {
  if (key === "serial") return String(index + 1);
  if (key === "month") return row.month;
  return formatCurrency(row[key]);
}

function addDays(date: string | undefined, days: number) {
  const time = parseLocalDateTime(date ?? "");
  if (time === undefined) return undefined;
  const next = new Date(time);
  next.setDate(next.getDate() + days);
  return formatLocalDate(next);
}

function formatMonthLabel(date: string) {
  const time = parseLocalDateTime(date);
  if (time === undefined) return date;
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(
    new Date(time),
  );
}

function formatCurrency(value: number) {
  return `${formatThousandsAndLakhs(value / 100_000, 2)} Lakh`;
}

type MilestoneDefinition = {
  key: string;
  label: string;
  completedLabel?: string;
  totalLabel?: string;
  pendingLabel?: string;
  reviewed?: keyof FileRecord | keyof SupplyOrderDetail;
  current: keyof FileRecord | keyof SupplyOrderDetail;
  applies?: (file: FileRecord) => boolean;
};

type StatusSummaryRow = {
  milestone: string;
  stage: string;
  count: number;
};

type StatusSummaryTableRow = {
  milestone: string;
  counts: Partial<Record<StatusSummaryDisplayColumn, number | string>>;
};

type StatusSummaryTableGroup = {
  key: string;
  title: string;
  columns: StatusSummaryDisplayColumn[];
  rows: StatusSummaryTableRow[];
};

const commonStatusColumns = ["Total", "In process", "Pending", "Completed"] as const;

const statusSummaryColumns = [
  "Total files",
  "Total cases",
  "Placed",
  "Received",
  "Reviewed",
  "Pending",
  "In process",
  "Opening overdue",
  "Live",
  "Completed",
  "Valid",
  "Expired",
  "Extended",
] as const;

type StatusSummaryColumn = (typeof statusSummaryColumns)[number];
type CommonStatusColumn = (typeof commonStatusColumns)[number];
type StatusSummaryDisplayColumn = StatusSummaryColumn | CommonStatusColumn;

const milestoneDefinitions = [
  {
    key: "scrutiny",
    label: "Scrutiny",
    totalLabel: "Total files",
    reviewed: "scrutinyDate",
    current: "scrutinyCompletionDate",
  },
  {
    key: "highValue",
    label: "High Value",
    totalLabel: "Total cases",
    reviewed: "highValueMeetingDate",
    current: "highValueMinutesDate",
    applies: (file) => isYes(file.highValue),
  },
  {
    key: "tcec",
    label: "Pre-TCEC",
    totalLabel: "Total cases",
    reviewed: "preTcecDate",
    current: "preTcecMinutesDate",
    applies: (file) => isYes(file.tcec),
  },
  {
    key: "ad",
    label: "AD",
    totalLabel: "Total cases",
    current: "adVettingDate",
    applies: (file) => isYes(file.ad),
  },
  {
    key: "rqa",
    label: "R&QA",
    totalLabel: "Total cases",
    current: "rqaApprovalDate",
    applies: (file) => isYes(file.rqa),
  },
  { key: "control", label: "Controlling", totalLabel: "Total files", current: "immsDate" },
  {
    key: "ifa",
    label: "IFA",
    totalLabel: "Total cases",
    reviewed: "ifaSentDate",
    current: "ifaFinalDate",
    applies: (file) => isYes(file.ifa),
  },
  {
    key: "cfa",
    label: "CFA",
    totalLabel: "Total files",
    reviewed: "cfaSentDate",
    current: "cfaDate",
  },
  {
    key: "bidding",
    label: "Bidding",
    totalLabel: "Total files",
    current: "biddingStageOver",
  },
  {
    key: "postTcec",
    label: "Post-TCEC",
    totalLabel: "Total cases",
    reviewed: "postTcecDate",
    current: "postTcecMinutesDate",
    applies: (file) => isYes(file.tcec),
  },
  {
    key: "cnc",
    label: "CNC",
    totalLabel: "Total cases",
    reviewed: "cncDate",
    current: "cncApprovalDate",
    applies: (file) => isYes(file.tcec),
  },
  {
    key: "supplyOrder",
    label: "Supply Order",
    completedLabel: "Placed",
    totalLabel: "Total files",
    current: "soDate",
  },
  {
    key: "bankGuarantee",
    label: "Bank Guarantee",
    completedLabel: "Received",
    totalLabel: "Total files",
    current: "bgValidityDate",
    applies: (file) => isYes(file.bg),
  },
  { key: "payment", label: "Payment", totalLabel: "Total files", current: "paymentDate" },
] satisfies MilestoneDefinition[];

const delayMilestoneOptions = milestoneDefinitions;

function getStatusSummaryTableGroups(files: FileRecord[]): StatusSummaryTableGroup[] {
  const byMilestone = new Map<string, StatusSummaryTableRow & { columns: StatusSummaryColumn[] }>();

  getStatusSummaryRows(files).forEach((row) => {
    if (!isStatusSummaryColumn(row.stage)) return;
    const tableRow = byMilestone.get(row.milestone) ?? {
      milestone: row.milestone,
      counts: {},
      columns: [],
    };
    tableRow.counts[row.stage] = row.count;
    if (!tableRow.columns.includes(row.stage)) tableRow.columns.push(row.stage);
    byMilestone.set(row.milestone, tableRow);
  });

  const commonGroup: StatusSummaryTableGroup = {
    key: "common",
    title: "Common milestone status",
    columns: [...commonStatusColumns],
    rows: [],
  };
  const groups = new Map<string, StatusSummaryTableGroup>();
  Array.from(byMilestone.values()).forEach((row) => {
    const columns = getStatusSummaryColumnsForRow(row.columns);
    if (isCommonStatusRow(row)) {
      commonGroup.rows.push({
        milestone: row.milestone,
        counts: {
          Total: row.counts["Total files"] ?? row.counts["Total cases"],
          "In process": row.counts["In process"],
          Completed: row.counts.Completed,
          Pending: row.counts.Pending ?? "-",
        },
      });
      return;
    }

    const key = columns.join("|");
    const group = groups.get(key) ?? {
      key,
      title: getStatusSummaryGroupTitle(columns),
      columns,
      rows: [],
    };
    group.rows.push({ milestone: row.milestone, counts: row.counts });
    groups.set(key, group);
  });

  return [...(commonGroup.rows.length ? [commonGroup] : []), ...Array.from(groups.values())];
}

function isStatusSummaryColumn(stage: string): stage is StatusSummaryColumn {
  return statusSummaryColumns.includes(stage as StatusSummaryColumn);
}

function getStatusSummaryColumnsForRow(columns: StatusSummaryColumn[]) {
  if (columns.includes("Opening overdue")) {
    return ["Live", "In process", "Opening overdue", "Completed"].filter((column) =>
      columns.includes(column as StatusSummaryColumn),
    ) as StatusSummaryColumn[];
  }

  return statusSummaryColumns.filter((column) => columns.includes(column));
}

function isCommonStatusRow(row: StatusSummaryTableRow & { columns: StatusSummaryColumn[] }) {
  return (
    (row.columns.includes("Total files") || row.columns.includes("Total cases")) &&
    row.columns.includes("In process") &&
    row.columns.includes("Completed")
  );
}

function getStatusSummaryGroupTitle(columns: StatusSummaryDisplayColumn[]) {
  if (columns.includes("Total cases")) return "Case approval milestones";
  if (columns.includes("Reviewed")) return "File approval milestones";
  if (columns.includes("Opening overdue")) return "Bidding";
  if (columns.includes("Placed")) return "Supply Order";
  if (columns.includes("Received")) return "Bank Guarantee";
  if (columns.includes("Valid")) return "Delivery Period";
  if (columns.length === 2 && columns.includes("Completed") && columns.includes("Pending")) {
    return "Delivery";
  }
  if (columns.length === 3 && columns.includes("Pending")) return "Payment";
  return "Other milestones";
}

function getStatusSummaryRows(files: FileRecord[]): StatusSummaryRow[] {
  const rows = milestoneDefinitions.flatMap((milestone) =>
    getMilestoneStatusRows(files, milestone),
  );

  const supplyOrderIndex = rows.findIndex((row) => row.milestone === "Supply Order");
  const deliveryPeriodRows = [
    {
      milestone: "Delivery Period",
      stage: "Valid",
      count: files.filter(isDeliveryPeriodValid).length,
    },
    {
      milestone: "Delivery Period",
      stage: "Expired",
      count: files.filter(isDeliveryPeriodExpired).length,
    },
    {
      milestone: "Delivery Period",
      stage: "Extended",
      count: files.filter(isDeliveryPeriodExtended).length,
    },
  ];
  const withDeliveryPeriod =
    supplyOrderIndex === -1
      ? [...rows, ...deliveryPeriodRows]
      : [
          ...rows.slice(0, supplyOrderIndex + 4),
          ...deliveryPeriodRows,
          ...rows.slice(supplyOrderIndex + 4),
        ];

  const bankGuaranteeIndex = withDeliveryPeriod.findIndex(
    (row) => row.milestone === "Bank Guarantee",
  );
  const deliveryRows = [
    { milestone: "Delivery", stage: "Completed", count: files.filter(isDeliveryCompleted).length },
    { milestone: "Delivery", stage: "Pending", count: files.filter(isDeliveryDue).length },
  ];

  if (bankGuaranteeIndex === -1) return [...withDeliveryPeriod, ...deliveryRows];
  return [
    ...withDeliveryPeriod.slice(0, bankGuaranteeIndex + 4),
    ...deliveryRows,
    ...withDeliveryPeriod.slice(bankGuaranteeIndex + 4),
  ];
}

function getMilestoneStatusRows(
  files: FileRecord[],
  milestone: MilestoneDefinition,
): StatusSummaryRow[] {
  const applicableFiles = files.filter((file) => isMilestoneApplicable(file, milestone));
  const processFiles = applicableFiles.filter((file) => !isCancelledFile(file));
  const reachedFiles = processFiles.filter((file) => isEligibleMilestone(file, milestone));
  const activeFiles = processFiles.filter((file) => isManualActiveMilestone(file, milestone));
  const reviewedFiles = activeFiles.filter((file) => isMilestoneReviewed(file, milestone));
  const pendingFiles = activeFiles.filter((file) => isPendingMilestone(file, milestone));
  const clearedFiles = processFiles.filter((file) => isMilestoneComplete(file, milestone));
  const base = (stage: string, count: number) => ({
    milestone: milestone.label,
    stage,
    count,
  });

  if (milestone.key === "bankGuarantee") {
    const eligibleBgFiles = processFiles.filter(isBankGuaranteeEligible);
    const activeBgFiles = eligibleBgFiles.filter((file) =>
      isManualActiveMilestone(file, milestone),
    );
    return [
      base(
        "Received",
        eligibleBgFiles.filter((file) => hasMilestoneDate(file, milestone.current)).length,
      ),
      base(
        "Pending",
        activeBgFiles.filter((file) => !hasMilestoneDate(file, milestone.current)).length,
      ),
      base(
        "At previous stage",
        processFiles.filter((file) => !isEligibleMilestone(file, milestone)).length,
      ),
    ];
  }

  if (milestone.key === "payment") {
    return [
      base("Completed", clearedFiles.length),
      base("Pending", pendingFiles.length),
      base("At previous stage", Math.max(0, processFiles.length - reachedFiles.length)),
    ];
  }

  if (milestone.key === "bidding") {
    return [
      base("Completed", clearedFiles.length),
      base(
        "In process",
        activeFiles.filter((file) => !isFileTenderLive(file) && !isBidOverdue(file)).length,
      ),
      base("Opening overdue", applicableFiles.filter(isBidOverdue).length),
      base("Live", applicableFiles.filter(isFileTenderLive).length),
      base("At previous stages", Math.max(0, applicableFiles.length - reachedFiles.length)),
    ];
  }

  if (milestone.key === "supplyOrder") {
    return [
      base("Placed", clearedFiles.length),
      base("Live", applicableFiles.filter(isLiveSupplyOrder).length),
      base("Pending", pendingFiles.length),
      base("At previous stages", Math.max(0, applicableFiles.length - reachedFiles.length)),
    ];
  }

  if (milestone.key === "scrutiny" || milestone.key === "cfa") {
    return [
      base("In process", activeFiles.length),
      base("Reviewed", reviewedFiles.length),
      base("Pending", pendingFiles.length),
      base("Total files", applicableFiles.length),
      base("Completed", clearedFiles.length),
    ];
  }

  if (["highValue", "tcec", "ifa", "postTcec", "cnc"].includes(milestone.key)) {
    return [
      base(milestone.totalLabel ?? "Total", applicableFiles.length),
      base("Completed", clearedFiles.length),
      base("At previous stage", Math.max(0, applicableFiles.length - reachedFiles.length)),
      base("In process", activeFiles.length),
      base("Reviewed", reviewedFiles.length),
      base("Pending", pendingFiles.length),
    ];
  }

  return [
    base(milestone.totalLabel ?? "Total", applicableFiles.length),
    base("Completed", clearedFiles.length),
    base("In process", activeFiles.length),
    base("At previous stage", Math.max(0, applicableFiles.length - reachedFiles.length)),
  ];
}

function isMilestoneApplicable(file: FileRecord, milestone: MilestoneDefinition) {
  return milestone.applies ? milestone.applies(file) : true;
}

function isEligibleMilestone(file: FileRecord, milestone: MilestoneDefinition) {
  if (isCancelledFile(file)) return false;
  return (
    isMilestoneApplicable(file, milestone) && isPreviousApplicableMilestoneComplete(file, milestone)
  );
}

function isPreviousApplicableMilestoneComplete(file: FileRecord, milestone: MilestoneDefinition) {
  if (milestone.key === "bankGuarantee") return isSupplyOrderPlaced(file);

  let previousMilestone: MilestoneDefinition | undefined;
  for (const item of milestoneDefinitions) {
    if (item.key === milestone.key) break;
    if (isMilestoneApplicable(file, item)) previousMilestone = item;
  }
  return previousMilestone
    ? isMilestoneComplete(file, previousMilestone)
    : hasMilestoneDate(file, "receivedDate");
}

function isMilestoneComplete(file: FileRecord, milestone: MilestoneDefinition) {
  if (milestone.key === "bidding") return isYes(file.biddingStageOver);
  return hasMilestoneDate(file, milestone.current);
}

function isMilestoneReviewed(file: FileRecord, milestone: MilestoneDefinition) {
  if (isCancelledFile(file)) return false;
  if (!milestone.reviewed) return false;
  return (
    isManualActiveMilestone(file, milestone) &&
    hasMilestoneDate(file, milestone.reviewed) &&
    !isMilestoneComplete(file, milestone)
  );
}

function isPendingMilestone(file: FileRecord, milestone: MilestoneDefinition) {
  if (isCancelledFile(file)) return false;
  if (milestone.reviewed) {
    return (
      isManualActiveMilestone(file, milestone) &&
      !hasMilestoneDate(file, milestone.reviewed) &&
      !isMilestoneComplete(file, milestone)
    );
  }
  return isManualActiveMilestone(file, milestone) && !isMilestoneComplete(file, milestone);
}

function isManualActiveMilestone(file: FileRecord, milestone: MilestoneDefinition) {
  if (isCancelledFile(file) || isFileClosed(file)) return false;
  const current = normalizeMilestoneName(file.currentMilestone);
  return getMilestoneNameAliases(milestone).some(
    (name) => current === normalizeMilestoneName(name),
  );
}

function isFileClosed(file: Pick<FileRecord, "completedMilestones">) {
  return Boolean(
    file.completedMilestones?.some(
      (milestone) =>
        normalizeMilestoneName(milestone) === normalizeMilestoneName(fileClosedMilestone),
    ),
  );
}

function getMilestoneNameAliases(milestone: MilestoneDefinition) {
  return milestone.key === "control" ? [milestone.label, "Controlled"] : [milestone.label];
}

function normalizeMilestoneName(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const supplyOrderDateKeys = new Set<keyof SupplyOrderDetail>([
  "soDate",
  "bgValidityDate",
  "billSentForPaymentDate",
  "paymentDate",
  "soCancelledDate",
]);

function hasMilestoneDate(file: FileRecord, key: keyof FileRecord | keyof SupplyOrderDetail) {
  return supplyOrderDateKeys.has(key as keyof SupplyOrderDetail)
    ? fileSupplyOrders(file).some((order) => hasFilledString(order[key as keyof SupplyOrderDetail]))
    : hasFilledField(file, key as keyof FileRecord);
}

function hasFilledField(file: FileRecord, key: keyof FileRecord) {
  const value = file[key];
  return typeof value === "string" ? hasFilledString(value) : Boolean(value);
}

function fileSupplyOrders(file: FileRecord) {
  const rows =
    file.supplyOrders
      ?.map((row) => ({ ...row }))
      .filter((row) => Object.values(row).some((value) => Boolean(String(value ?? "").trim()))) ??
    [];
  if (rows.length) return rows;

  const legacy: SupplyOrderDetail = {
    soNo: file.soNo,
    gemSoNo: file.gemSoNo,
    soDate: file.soDate,
    soValueCapital: file.soValueCapital,
    soValueRevenue: file.soValueRevenue,
    dpDate: file.dpDate,
    firm: file.firm,
    bgValidityDate: file.bgValidityDate,
    dpExtension: file.dpExtension,
    dpExtensionCount: file.dpExtensionCount,
    ld: file.ld,
    revisedDp: file.revisedDp,
    materialReceiptDate: file.materialReceiptDate,
    billSentForPaymentDate: file.billSentForPaymentDate,
    paymentDate: file.paymentDate,
    paymentMode: file.paymentMode,
    bgReturnDate: file.bgReturnDate,
    demandCancelled: file.demandCancelled,
    soCancelled: file.soCancelled,
    soCancelledDate: file.soCancelledDate,
  };
  return Object.values(legacy).some((value) => Boolean(String(value ?? "").trim())) ? [legacy] : [];
}

function isSupplyOrderPlaced(file: FileRecord) {
  const supplyOrderMilestone = milestoneDefinitions.find(
    (milestone) => milestone.key === "supplyOrder",
  );
  return supplyOrderMilestone ? isMilestoneComplete(file, supplyOrderMilestone) : false;
}

function isBankGuaranteeEligible(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return (
    isYes(file.bg) &&
    fileSupplyOrders(file).some((order) => hasSupplyOrderDate(order) && !isYes(order.soCancelled))
  );
}

function isLiveSupplyOrder(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) =>
      hasSupplyOrderDate(order) &&
      !hasFilledString(order.materialReceiptDate) &&
      !isYes(order.soCancelled),
  );
}

function isDeliveryCompleted(file: FileRecord) {
  return isSupplyOrderPlaced(file) && fileSupplyOrders(file).some(isCompletedDeliveryOrder);
}

function isDeliveryDue(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return isSupplyOrderPlaced(file) && fileSupplyOrders(file).some(isDueDeliveryOrder);
}

function isCompletedDeliveryOrder(order: SupplyOrderDetail) {
  return hasSupplyOrderDate(order) && hasFilledString(order.materialReceiptDate);
}

function isDueDeliveryOrder(order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    !hasFilledString(order.materialReceiptDate) &&
    !isYes(order.soCancelled)
  );
}

function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return getLaterDate(order.dpDate, order.revisedDp);
}

function isDeliveryPeriodValid(file: FileRecord) {
  return isSupplyOrderPlaced(file) && fileSupplyOrders(file).some(isValidDeliveryPeriodOrder);
}

function isDeliveryPeriodExpired(file: FileRecord) {
  if (isCancelledFile(file)) return false;
  return isSupplyOrderPlaced(file) && fileSupplyOrders(file).some(isExpiredDeliveryPeriodOrder);
}

function isDeliveryPeriodExtended(file: FileRecord) {
  return isSupplyOrderPlaced(file) && fileSupplyOrders(file).some(isExtendedDeliveryPeriodOrder);
}

function isValidDeliveryPeriodOrder(order: SupplyOrderDetail) {
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    hasSupplyOrderDate(order) &&
    Boolean(deliveryPeriodDate) &&
    isDateAfterToday(deliveryPeriodDate) &&
    !hasFilledString(order.materialReceiptDate)
  );
}

function isExpiredDeliveryPeriodOrder(order: SupplyOrderDetail) {
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    hasSupplyOrderDate(order) &&
    Boolean(deliveryPeriodDate) &&
    isDateBeforeToday(deliveryPeriodDate) &&
    !hasFilledString(order.materialReceiptDate)
  );
}

function isExtendedDeliveryPeriodOrder(order: SupplyOrderDetail) {
  const deliveryPeriodDate = getDeliveryPeriodDate(order);
  return (
    hasSupplyOrderDate(order) &&
    hasFilledString(order.revisedDp) &&
    Boolean(deliveryPeriodDate) &&
    isDateAfterToday(deliveryPeriodDate) &&
    !hasFilledString(order.materialReceiptDate)
  );
}

function getLaterDate(first: string | undefined, second: string | undefined) {
  const firstTime = parseLocalDateTime(first ?? "");
  const secondTime = parseLocalDateTime(second ?? "");
  if (firstTime === undefined) return second;
  if (secondTime === undefined) return first;
  return secondTime > firstTime ? second : first;
}

function isFileTenderLive(file: FileRecord) {
  return isYes(file.tenderLive);
}

function isBidOverdue(file: FileRecord) {
  return (
    isNo(file.bidOpened) &&
    (isDateBeforeToday(file.bidOpeningDate) || isDateBeforeToday(file.refloatBidOpeningDate))
  );
}

function hasSupplyOrderDate(order: SupplyOrderDetail) {
  return hasFilledString(order.soDate);
}

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
}

function isYes(value: string | undefined) {
  return value?.trim().toLowerCase() === "yes";
}

function isNo(value: string | undefined) {
  return value?.trim().toLowerCase() === "no";
}

function isDateBeforeToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));
  if (dateTime === undefined || todayTime === undefined) return false;
  return dateTime < todayTime;
}

function isDateAfterToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));
  if (dateTime === undefined || todayTime === undefined) return false;
  return dateTime > todayTime;
}

function hasDate(date: string | undefined) {
  return parseLocalDateTime(date ?? "") !== undefined;
}

function parseLocalDateTime(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00`);
  const time = parsed.getTime();
  return Number.isNaN(time) ? undefined : time;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
