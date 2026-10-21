import { useEffect, useMemo, useState } from "react";
import { useActiveUser, useSettings, type FileRecord } from "@/lib/files-store";
import { MonthlyCountCalendar, type MonthlyCalendarDay } from "@/components/monthly-count-calendar";
import { QuickEntryExcelExportList } from "@/components/quick-entry-excel";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ExternalLink,
  FileSpreadsheet,
  LayoutGrid,
  Maximize2,
  MonitorPlay,
  Pause,
  Play,
  X,
} from "lucide-react";

type PickerItem = { id: string; label: string; group: string };
type AccessItem = PickerItem & { href: string };
type BoardItem = AccessItem & { focus?: string };
type DailyCount = { date: string; monthKey: string; count: number };
type DeliveryDay = {
  date: string;
  monthKey: string;
  grossCount: number;
  netCount: number;
  completedCount: number;
};
type PreBidDay = { date: string; monthKey: string; count: number };
type NoticeSummary = {
  dailyFileInflow?: DailyCount[];
  dailySupplyOrder?: DailyCount[];
  dailyBgExpiry?: DailyCount[];
  dailyDeliverySchedule?: DeliveryDay[];
  preBidMeetingDailyRows?: PreBidDay[];
};

const favoriteCatalog: AccessItem[] = [
  { id: "quick-entry", label: "Quick Entry", href: "/quick-entry", group: "Quick Entry" },
  { id: "add-file", label: "Add File", href: "/add", group: "Add File" },
  { id: "search-files", label: "Search Files", href: "/search", group: "Search Files" },
  { id: "dashboard", label: "Dashboard", href: "/dashboard", group: "Dashboard" },
  ...[
    ["Status-1", "status"],
    ["Status-2", "liveStatus"],
    ["Status-3", "status3"],
    ["Status-4", "status4"],
    ["Snapshot", "snapshot"],
    ["Analytics", "analytics"],
    ["FY Activity", "fyActivity"],
    ["FY Snapshot", "finance1"],
  ].map(([label, tab]) => ({
    id: `dashboard-${tab}`,
    label,
    href: `/dashboard?tab=${tab}`,
    group: tab === "fyActivity" ? "FY Activity" : tab === "finance1" ? "FY Snapshot" : "Dashboard",
  })),
  ...[
    ["MMG Summary", "mmgSummary"],
    ["Demand processing analysis", "demandProcessingAnalysis"],
    ["Firm Performance", "firmDatabase"],
    ["MER Data", "merData"],
    ["MER vs Recorded Payments", "merComparison"],
    ["Cash Out Go Plan", "cashOutGoPlan"],
    ["Pre-S.O. based expected cash outgo", "preSoExpectedCashOutgo"],
    ["Month-wise Payment due Matrix", "soPaymentMatrix"],
    ["Month-wise Payment completed Matrix", "paymentCompletedMatrix"],
    ["Delivery / D.P. Done, Bill Preparation Pending", "itemsDeliveredBillsPending"],
    ["Delivery / D.P. Done, Bill Prepared", "itemsDeliveredBillsPrepared"],
    ["Bills Submitted, Payment Pending", "billsSubmitted"],
    ["Expected Cash Outgo by D.P.", "expectedCashOutgoFy"],
    ["Actual Cash Outgo as on Date", "spentTillDateFy"],
    ["Bills Paid in Selected Month", "billsPaidInMonth"],
    ["Pending returned bills", "pendingReturnedBills"],
    ["Returned bills resubmitted and unpaid", "returnedBillsResubmitted"],
    ["Returned bills paid", "returnedBillsPaid"],
    ["Supplementary bills submitted, payment pending", "supplementaryBillsSubmitted"],
    ["Supplementary bills paid", "supplementaryBillsPaid"],
    ["Pending returned supplementary bills", "supplementaryPendingReturnedBills"],
    ["Returned supplementary bills resubmitted", "supplementaryReturnedBillsResubmitted"],
    ["Returned supplementary bills paid", "supplementaryReturnedBillsPaid"],
    ["Expected cash outgo exclusively for selected month", "cashOutgoForMonth"],
    ["Expected Expenditure Up to Selected Month", "expectedExpenditureTillMonth"],
    ["Cumulative Liability Up to Month", "currentMonthLiability"],
    ["Monthly file inflow", "monthlyFileInflow"],
    ["Month-wise Supply Order", "monthWiseSupplyOrder"],
    ["Month-wise Delivery / Contract Period Schedule", "monthWiseDeliverySchedule"],
    ["BG Tracking", "monthWiseBgExpiry"],
    ["BG receipt delay", "bgReceiptDelay"],
    ["Warranty / BG mismatch", "warrantyBgMismatch"],
    ["Delay Status", "delayStatus"],
    ["Pending Liabilities", "pendingLiabilityAgeing"],
  ].map(([label, mode]) => ({
    id: `report-${mode}`,
    label,
    href: `/reports?mode=${mode}`,
    group: "Reports",
  })),
  ...[
    ["Pre-Bid Meetings", "preBidMeetings"],
    ["TCEC summary", "tcecStatus"],
    ["CNC summary", "cncSummary"],
    ["Delay status", "delayStatus"],
    ["Firm Performance", "firmPerformance"],
    ["Milestone Clearing Ranking", "milestoneClearingTable"],
    ["Division Ranking by Files and S.O.", "divisionFiles"],
    ["Division ranking by value", "divisionValue"],
    ["Division ranking by total value", "divisionTotalValue"],
    ["Division turnaround ranking", "divisionTurnaround"],
    ["Firms ranking by S.O. value", "topFirms"],
    ["Firm Analysis", "firmAnalysis"],
    ["Indentor–Firm", "indentorFirmLinkage"],
    ["Top Indentors by Files and S.O.", "indentorsByFiles"],
    ["Top indentors by value", "indentorsByValue"],
    ["Bidding mode mix", "biddingMode"],
    ["Count and Value analysis", "fileValueThresholds"],
    ["Payment pending by division", "paymentPending"],
    ["Demand processing analysis", "demandProcessingAnalysis"],
    ["Suspected anomaly", "suspectedAnomaly"],
  ].map(([label, panel]) => ({
    id: `analytics-${panel}`,
    label,
    href: `/dashboard?tab=analytics&analyticsPanel=${panel}`,
    group: "Analytics",
  })),
  { id: "settings", label: "Settings", href: "/settings", group: "Settings" },
];

const boardCalendarIds: Record<string, string> = {
  "analytics-preBidMeetings": "preBidMeetings",
  "report-monthlyFileInflow": "monthlyFileInflow",
  "report-monthWiseSupplyOrder": "supplyOrders",
  "report-monthWiseDeliverySchedule": "deliverySchedule",
  "report-monthWiseBgExpiry": "bgExpiry",
};

const boardCatalog: BoardItem[] = [
  ...favoriteCatalog
    .filter((item) => item.id !== "dashboard")
    .map((item) => ({ ...item, id: boardCalendarIds[item.id] ?? item.id })),
  ...[
    ["Allocated", "allocated", "Allocated"],
    ["Intended", "intended", "Intended"],
    ["Booked", "booked", "Booked"],
    ["Committed", "committed", "Committed"],
    ["Paid Till Date", "paid-till-date", "Paid Till Date"],
    ["S.O.s placed and files closed", "orders-and-closures", "S.O.s placed and files closed"],
    ["Payments in selected FY", "payments", "Payments in"],
    [
      "Balance Carry Forward from previous FYs",
      "carry-forward-previous",
      "Balance Carry Forward from previous FYs",
    ],
    ["Cleared Carry Forward in selected FY", "carry-forward-cleared", "Cleared Carry Forward in"],
    ["Balance Carry Forward of selected FY", "carry-forward-current", "Balance Carry Forward of"],
    ["Carry Forward cleared later", "carry-forward-later", "Carry Forward cleared later"],
    ["Firm Type Distribution", "firm-type-distribution", "Firm Type Distribution"],
  ].map(([label, id, focus]) => ({
    id: `fy-activity-${id}`,
    label,
    group: "FY Activity",
    href: "/dashboard?tab=fyActivity",
    focus,
  })),
  ...[
    ["Financial Position", "financial-position", "Financial Position"],
    ["Capital and Revenue comparison", "capital-revenue", "Capital and Revenue comparison"],
    ["Payments recorded during FY", "payments", "Payments recorded during FY"],
    ["File Type Distribution", "file-type", "File Type Distribution"],
    ["Firm Type Distribution", "firm-type", "Firm Type Distribution"],
  ].map(([label, id, focus]) => ({
    id: `fy-snapshot-${id}`,
    label,
    group: "FY Snapshot",
    href: "/dashboard?tab=finance1",
    focus,
  })),
];

const calendarBoardIds = new Set(Object.values(boardCalendarIds));

function OptionPicker({
  title,
  catalog,
  assigned,
  onAssign,
  onReturn,
}: {
  title: string;
  catalog: PickerItem[];
  assigned: PickerItem[];
  onAssign: (items: PickerItem[]) => void;
  onReturn: (ids: string[]) => void;
}) {
  const groups = [...new Set(catalog.map((item) => item.group))];
  const [group, setGroup] = useState("");
  const [availableChecked, setAvailableChecked] = useState<string[]>([]);
  const [assignedChecked, setAssignedChecked] = useState<string[]>([]);
  const available = catalog.filter(
    (item) => item.group === group && !assigned.some((chosen) => chosen.id === item.id),
  );
  const toggle = (ids: string[], id: string, setIds: (next: string[]) => void) => {
    setIds(ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  };
  const addChecked = () => {
    onAssign(available.filter((item) => availableChecked.includes(item.id)));
    setAvailableChecked([]);
  };
  const returnChecked = () => {
    onReturn(assignedChecked);
    setAssignedChecked([]);
  };

  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <label className="w-full text-xs font-medium sm:w-64">
          Main option
          <select
            value={group}
            onChange={(event) => {
              setGroup(event.target.value);
              setAvailableChecked([]);
            }}
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Choose a main option</option>
            {groups.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="min-w-0 rounded-md border border-border">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
            Available {group ? `· ${group}` : "options"}
          </div>
          <div className="max-h-64 min-h-32 overflow-y-auto p-2">
            {available.length ? (
              available.map((item) => (
                <label
                  key={item.id}
                  className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={availableChecked.includes(item.id)}
                    onChange={() => toggle(availableChecked, item.id, setAvailableChecked)}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 break-words">{item.label}</span>
                </label>
              ))
            ) : (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                {group ? "No available options in this section." : "Choose a main option."}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 md:flex-col">
          <button
            type="button"
            onClick={addChecked}
            disabled={!availableChecked.length}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
            aria-label="Add selected options"
          >
            <ArrowRight className="size-4" />
            <span className="md:sr-only">Add</span>
          </button>
          <button
            type="button"
            onClick={returnChecked}
            disabled={!assignedChecked.length}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm disabled:opacity-50"
            aria-label="Return selected options"
          >
            <ArrowLeft className="size-4" />
            <span className="md:sr-only">Return</span>
          </button>
        </div>
        <div className="min-w-0 rounded-md border border-border">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
            Selected options ({assigned.length})
          </div>
          <div className="max-h-64 min-h-32 overflow-y-auto p-2">
            {assigned.length ? (
              assigned.map((item) => (
                <label
                  key={item.id}
                  className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={assignedChecked.includes(item.id)}
                    onChange={() => toggle(assignedChecked, item.id, setAssignedChecked)}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 break-words">{item.label}</span>
                </label>
              ))
            ) : (
              <p className="px-2 py-3 text-sm text-muted-foreground">No options selected.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const storageKeys = {
  adminFavorites: "recordkeeper.quickAccess.adminFavorites.v1",
  adminBoard: "recordkeeper.noticeBoard.admin.v1",
  personalFavorites: (userId: string) => `recordkeeper.quickAccess.user.${userId}.favorites.v1`,
  personalBoard: (userId: string) => `recordkeeper.noticeBoard.user.${userId}.items.v1`,
  personalInterval: (userId: string) => `recordkeeper.noticeBoard.user.${userId}.interval.v1`,
  adminInterval: "recordkeeper.noticeBoard.admin.interval.v1",
};

function readArray<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function readInterval(key: string, fallback = 15) {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(key);
  if (stored === null) return fallback;
  const value = Number(stored);
  return Number.isFinite(value) ? Math.min(120, Math.max(5, value)) : fallback;
}

function saveArray<T>(key: string, value: T[]) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function addUnique<T extends { id: string }>(items: T[], item: T) {
  return items.some((existing) => existing.id === item.id) ? items : [...items, item];
}

function FavoriteEditor({ admin }: { admin: boolean }) {
  const user = useActiveUser();
  const personalKey = storageKeys.personalFavorites(user?.id ?? "anonymous");
  const [personal, setPersonal] = useState(() => readArray<AccessItem>(personalKey));
  const [shared, setShared] = useState(() => readArray<AccessItem>(storageKeys.adminFavorites));
  const updateFavorites = (target: "shared" | "personal", next: AccessItem[]) => {
    if (target === "shared") {
      setShared(next);
      saveArray(storageKeys.adminFavorites, next);
    } else {
      setPersonal(next);
      saveArray(personalKey, next);
    }
  };
  const addFavorites = (target: "shared" | "personal", items: PickerItem[]) => {
    const nextItems = items
      .map((item) => favoriteCatalog.find((candidate) => candidate.id === item.id))
      .filter((item): item is AccessItem => Boolean(item));
    const current = target === "shared" ? shared : personal;
    updateFavorites(
      target,
      nextItems.reduce((all, item) => addUnique(all, item), current),
    );
  };
  const returnFavorites = (target: "shared" | "personal", ids: string[]) => {
    const current = target === "shared" ? shared : personal;
    updateFavorites(
      target,
      current.filter((item) => !ids.includes(item.id)),
    );
  };
  return (
    <div className="space-y-6">
      {admin ? (
        <OptionPicker
          title="Administrator shortcuts"
          catalog={favoriteCatalog}
          assigned={shared}
          onAssign={(items) => addFavorites("shared", items)}
          onReturn={(ids) => returnFavorites("shared", ids)}
        />
      ) : null}
      <OptionPicker
        title="Your shortcuts"
        catalog={favoriteCatalog}
        assigned={personal}
        onAssign={(items) => addFavorites("personal", items)}
        onReturn={(ids) => returnFavorites("personal", ids)}
      />
    </div>
  );
}

function NoticeBoardEditor({ admin }: { admin: boolean }) {
  const user = useActiveUser();
  const userId = user?.id ?? "anonymous";
  const personalKey = storageKeys.personalBoard(userId);
  const [personal, setPersonal] = useState(() => readArray<BoardItem>(personalKey));
  const [shared, setShared] = useState(() => readArray<BoardItem>(storageKeys.adminBoard));
  const [personalInterval, setPersonalInterval] = useState(() =>
    readInterval(storageKeys.personalInterval(userId)),
  );
  const [sharedInterval, setSharedInterval] = useState(() =>
    readInterval(storageKeys.adminInterval),
  );
  const updateItems = (target: "shared" | "personal", next: BoardItem[]) => {
    if (target === "shared") {
      setShared(next);
      saveArray(storageKeys.adminBoard, next);
    } else {
      setPersonal(next);
      saveArray(personalKey, next);
    }
  };
  const addItems = (target: "shared" | "personal", items: PickerItem[]) => {
    const current = target === "shared" ? shared : personal;
    const nextItems = items
      .map((item) => boardCatalog.find((candidate) => candidate.id === item.id))
      .filter((item): item is BoardItem => Boolean(item));
    updateItems(
      target,
      nextItems.reduce((all, item) => addUnique(all, item), current),
    );
  };
  const returnItems = (target: "shared" | "personal", ids: string[]) => {
    const current = target === "shared" ? shared : personal;
    updateItems(
      target,
      current.filter((item) => !ids.includes(item.id)),
    );
  };
  const setInterval = (target: "shared" | "personal", value: number) => {
    const next = Math.min(120, Math.max(5, value || 15));
    if (target === "shared") {
      setSharedInterval(next);
      window.localStorage.setItem(storageKeys.adminInterval, String(next));
    } else {
      setPersonalInterval(next);
      window.localStorage.setItem(storageKeys.personalInterval(userId), String(next));
    }
  };
  return (
    <div className="space-y-6">
      {admin ? (
        <OptionPicker
          title="Administrator board items"
          catalog={boardCatalog}
          assigned={shared}
          onAssign={(items) => addItems("shared", items)}
          onReturn={(ids) => returnItems("shared", ids)}
        />
      ) : null}
      <OptionPicker
        title="Your board items"
        catalog={boardCatalog}
        assigned={personal}
        onAssign={(items) => addItems("personal", items)}
        onReturn={(ids) => returnItems("personal", ids)}
      />
      <div className="flex flex-wrap gap-6 border-t border-border pt-4">
        {admin ? (
          <label className="text-xs font-medium">
            Admin slide duration (seconds)
            <input
              type="number"
              min={5}
              max={120}
              value={sharedInterval}
              onChange={(event) => setInterval("shared", Number(event.target.value))}
              className="mt-1 block h-9 w-32 rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
        ) : null}
        <label className="text-xs font-medium">
          Your slide duration (seconds)
          <input
            type="number"
            min={5}
            max={120}
            value={personalInterval}
            onChange={(event) => setInterval("personal", Number(event.target.value))}
            className="mt-1 block h-9 w-32 rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
      </div>
    </div>
  );
}

export function QuickAccessSettings({ section }: { section: "favorites" | "noticeBoard" }) {
  const admin = useActiveUser()?.role === "admin";
  return section === "favorites" ? (
    <FavoriteEditor admin={admin} />
  ) : (
    <NoticeBoardEditor admin={admin} />
  );
}

export function QuickEntryAccess() {
  const user = useActiveUser();
  const personal = readArray<AccessItem>(storageKeys.personalFavorites(user?.id ?? "anonymous"));
  const shared = readArray<AccessItem>(storageKeys.adminFavorites);
  const favorites = useMemo(
    () => [
      ...shared,
      ...personal.filter((item) => !shared.some((sharedItem) => sharedItem.id === item.id)),
    ],
    [personal, shared],
  );
  const [boardOpen, setBoardOpen] = useState(false);
  const [boardStartIndex, setBoardStartIndex] = useState(0);
  const boardItems = [
    ...readArray<BoardItem>(storageKeys.adminBoard),
    ...readArray<BoardItem>(storageKeys.personalBoard(user?.id ?? "anonymous")),
  ].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
  const delay = readInterval(
    storageKeys.personalInterval(user?.id ?? "anonymous"),
    readInterval(storageKeys.adminInterval),
  );
  type QuickEntryTab = "favorites" | "noticeBoard" | "excelExports";
  const [activeTab, setActiveTab] = useState<QuickEntryTab>("favorites");
  return (
    <>
      <section className="overflow-hidden rounded-md border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="overflow-x-auto border-b border-border bg-muted/35">
          <div className="flex min-w-max p-1" role="tablist" aria-label="Quick Entry tools">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "favorites"}
              onClick={() => setActiveTab("favorites")}
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors ${activeTab === "favorites" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground"}`}
            >
              <LayoutGrid className="size-4" /> Quick Access
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "noticeBoard"}
              onClick={() => setActiveTab("noticeBoard")}
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors ${activeTab === "noticeBoard" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground"}`}
            >
              <MonitorPlay className="size-4" /> Notice Board
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "excelExports"}
              onClick={() => setActiveTab("excelExports")}
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors ${activeTab === "excelExports" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground"}`}
            >
              <FileSpreadsheet className="size-4" /> Excel Exports
            </button>
          </div>
        </div>
        {activeTab === "favorites" ? (
          <section
            role="tabpanel"
            className="relative overflow-hidden border-l-4 border-warning bg-warning/[0.035] p-5"
          >
            <div className="flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-md border border-warning/35 bg-warning/15">
                <LayoutGrid className="size-5 text-warning-foreground" />
              </div>
              <h2 className="text-base font-semibold">Quick Access</h2>
            </div>
            {favorites.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {favorites.map((item) => (
                  <a
                    key={item.id}
                    href={item.href}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-warning/35 bg-background/85 px-3 text-sm hover:border-warning/60 hover:bg-warning/10"
                  >
                    {item.label}
                    <ExternalLink className="size-3.5 text-muted-foreground" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No favourite shortcuts yet.</p>
            )}
          </section>
        ) : activeTab === "noticeBoard" ? (
          <section
            role="tabpanel"
            className="relative overflow-hidden border-l-4 border-chart-5 bg-chart-5/[0.035] p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-md border border-chart-5/30 bg-chart-5/10">
                  <MonitorPlay className="size-5 text-chart-5" />
                </div>
                <h2 className="text-base font-semibold">Notice Board</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setBoardStartIndex(0);
                  setBoardOpen(true);
                }}
                disabled={!boardItems.length}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-chart-5/35 bg-background/85 px-3 text-sm hover:bg-chart-5/10 disabled:opacity-50"
              >
                <Maximize2 className="size-4" /> Start rotation
              </button>
            </div>
            {boardItems.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {boardItems.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setBoardStartIndex(index);
                      setBoardOpen(true);
                    }}
                    className="inline-flex min-h-9 items-center gap-2 rounded-md border border-chart-5/30 bg-background/85 px-3 py-1.5 text-left text-sm hover:border-chart-5/55 hover:bg-chart-5/10"
                  >
                    <Play className="size-3.5 shrink-0 text-chart-5" />
                    {item.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No Notice Board options yet.</p>
            )}
          </section>
        ) : (
          <QuickEntryExcelExportList />
        )}
      </section>
      {boardOpen ? (
        <NoticeBoard
          items={boardItems}
          delaySeconds={delay}
          initialIndex={boardStartIndex}
          onClose={() => setBoardOpen(false)}
        />
      ) : null}
    </>
  );
}

function NoticeBoard({
  items,
  delaySeconds,
  initialIndex,
  onClose,
}: {
  items: BoardItem[];
  delaySeconds: number;
  initialIndex: number;
  onClose: () => void;
}) {
  const settings = useSettings();
  const user = useActiveUser();
  const [summary, setSummary] = useState<NoticeSummary>();
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [playing, setPlaying] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams({
      division: "all",
      selectedYear: settings.selectedYear || settings.financialYear,
      delayDays: "0",
      delayMilestone: "all",
    });
    const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(
      /\/$/,
      "",
    );
    let cancelled = false;
    fetch(`${baseUrl}/api/reports/summary?${params}`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Notice Board data could not be loaded.");
        return (await response.json()) as { summary: NoticeSummary };
      })
      .then((result) => {
        if (!cancelled) setSummary(result.summary);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : "Notice Board data could not be loaded.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [settings.financialYear, settings.selectedYear]);
  useEffect(() => {
    if (!playing || items.length < 2) return;
    const timer = window.setInterval(
      () => setActiveIndex((index) => (index + 1) % items.length),
      delaySeconds * 1000,
    );
    return () => window.clearInterval(timer);
  }, [delaySeconds, items.length, playing]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const activeItem = items[activeIndex];
  const days = useMemo(() => getBoardDays(activeItem?.id, summary), [activeItem?.id, summary]);
  const monthKey = chooseBoardMonth(days);
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-background p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Notice Board"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Notice Board</p>
          <h2 className="text-lg font-semibold">{activeItem?.label ?? "Notice Board"}</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveIndex((index) => (index - 1 + items.length) % items.length)}
            className="grid size-9 place-items-center rounded-md hover:bg-accent"
            title="Previous display"
            aria-label="Previous display"
          >
            <ArrowUp className="size-4 -rotate-90" />
          </button>
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            className="grid size-9 place-items-center rounded-md hover:bg-accent"
            title={playing ? "Pause rotation" : "Resume rotation"}
            aria-label={playing ? "Pause rotation" : "Resume rotation"}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <button
            type="button"
            onClick={() => setActiveIndex((index) => (index + 1) % items.length)}
            className="grid size-9 place-items-center rounded-md hover:bg-accent"
            title="Next display"
            aria-label="Next display"
          >
            <ArrowDown className="size-4 -rotate-90" />
          </button>
          <button
            type="button"
            onClick={() => {
              void document.documentElement.requestFullscreen?.();
            }}
            className="grid size-9 place-items-center rounded-md hover:bg-accent"
            title="Enter full screen"
            aria-label="Enter full screen"
          >
            <Maximize2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              onClose();
            }}
            className="grid size-9 place-items-center rounded-md hover:bg-accent"
            title="Close Notice Board"
            aria-label="Close Notice Board"
          >
            <X className="size-4" />
          </button>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col justify-center overflow-auto py-4">
        {calendarBoardIds.has(activeItem?.id ?? "") && error ? (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        ) : calendarBoardIds.has(activeItem?.id ?? "") && !summary ? (
          <p className="text-center text-sm text-muted-foreground">Loading display data...</p>
        ) : calendarBoardIds.has(activeItem?.id ?? "") && days.length && monthKey ? (
          <div className="mx-auto w-full max-w-7xl">
            <MonthlyCountCalendar monthKey={monthKey} days={days} onClose={onClose} />
            <div className="sr-only" aria-live="polite">
              {activeItem?.label}
            </div>
          </div>
        ) : activeItem?.href ? (
          <iframe
            key={activeItem.id}
            src={activeItem.href}
            title={activeItem.label}
            className="min-h-[60vh] w-full flex-1 border-0 bg-background"
            onLoad={(event) => {
              const focus = activeItem.focus?.trim().toLowerCase();
              const frameDocument = event.currentTarget.contentDocument;
              if (!focus || !frameDocument) return;
              let attempts = 0;
              const focusSection = () => {
                const headings = Array.from(
                  frameDocument.querySelectorAll("h1, h2, h3, h4, [role='heading']"),
                );
                const target =
                  headings.find((element) =>
                    (element.textContent?.trim().toLowerCase() ?? "").includes(focus),
                  ) ??
                  Array.from(frameDocument.querySelectorAll("div, span"))
                    .filter((element) =>
                      (element.textContent?.trim().toLowerCase() ?? "").includes(focus),
                    )
                    .sort(
                      (left, right) =>
                        (left.textContent?.length ?? Infinity) -
                        (right.textContent?.length ?? Infinity),
                    )[0];
                if (target) {
                  const frameWindow = frameDocument.defaultView;
                  const top = target.getBoundingClientRect().top + (frameWindow?.scrollY ?? 0) - 24;
                  frameWindow?.scrollTo({ top: Math.max(0, top), behavior: "auto" });
                  return;
                }
                if (attempts++ < 40) window.setTimeout(focusSection, 150);
              };
              focusSection();
            }}
          />
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            This display has no available content.
          </p>
        )}
      </main>
      <footer className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>{items.length ? `${activeIndex + 1} of ${items.length}` : "No displays"}</span>
        <div className="flex gap-1">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              title={item.label}
              aria-label={`Show ${item.label}`}
              className={`h-1.5 w-6 rounded-full ${index === activeIndex ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
        <span>{playing ? `Changes every ${delaySeconds}s` : "Paused"}</span>
      </footer>
    </div>
  );
}

function getBoardDays(
  id: string | undefined,
  summary: NoticeSummary | undefined,
): MonthlyCalendarDay[] {
  if (!summary || !id) return [];
  if (id === "deliverySchedule")
    return (summary.dailyDeliverySchedule ?? []).map((row) => ({
      date: row.date,
      metrics: [
        { label: "Pending", value: row.grossCount, color: "blue", hideLabel: true },
        { label: "Expired", value: row.netCount, color: "red", hideLabel: true },
        { label: "Completed", value: row.completedCount, color: "green", hideLabel: true },
      ],
    }));
  const rows =
    id === "preBidMeetings"
      ? summary.preBidMeetingDailyRows
      : id === "monthlyFileInflow"
        ? summary.dailyFileInflow
        : id === "supplyOrders"
          ? summary.dailySupplyOrder
          : id === "bgExpiry"
            ? summary.dailyBgExpiry
            : undefined;
  return (rows ?? []).map((row) => ({
    date: row.date,
    metrics: [{ label: "Total", value: row.count, color: "blue", hideLabel: true }],
  }));
}

function chooseBoardMonth(days: MonthlyCalendarDay[]) {
  if (!days.length) return "";
  const current = new Date().toISOString().slice(0, 7);
  if (days.some((day) => day.date.startsWith(current))) return current;
  const monthKeys = [...new Set(days.map((day) => day.date.slice(0, 7)))].sort();
  return monthKeys.find((month) => month >= current) ?? monthKeys.at(-1) ?? "";
}
