import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { store, useActiveUser, useSettings, type FileRecord } from "@/lib/files-store";
import { formatIndiaMonth } from "@/lib/india-date";
import { delayMilestoneOptions } from "@/lib/delay-status-options";
import { MonthlyCountCalendar, type MonthlyCalendarDay } from "@/components/monthly-count-calendar";
import { QuickEntryExcelExportList } from "@/components/quick-entry-excel";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BellRing,
  CalendarClock,
  CircleAlert,
  FileSpreadsheet,
  Maximize2,
  MonitorPlay,
  Pause,
  Play,
  Timer,
  X,
} from "lucide-react";

type PickerItem = { id: string; label: string; group: string };
type AccessItem = PickerItem & { href: string };
type BoardItem = AccessItem & { focus?: string };
type BoardFrameSlot = { itemId: string; src: string; loaded: boolean } | null;
type NoticeViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};
type SharedQuickAccessPatch = Partial<ReturnType<typeof store.getSettings>["sharedQuickAccess"]>;
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
  expectedCashOutgoDays?: number;
  dailyFileInflow?: DailyCount[];
  dailySupplyOrder?: DailyCount[];
  dailyBgExpiry?: DailyCount[];
  dailyPaymentDue?: DailyCount[];
  dailyPaymentCompleted?: DailyCount[];
  dailyDeliverySchedule?: DeliveryDay[];
  preBidMeetingDailyRows?: PreBidDay[];
};
type WatchboardNotice = {
  id: string;
  label: string;
  dropdownLabel?: string;
  count: string;
  unit: string;
  detail: string;
  timing: string;
  tone: "urgent" | "attention" | "neutral";
  rows: { record: string; detail: string; division: string; timing: string }[];
};

const watchboardPreviewNotices: WatchboardNotice[] = [
  {
    id: "bg-expiry",
    label: "BGs expiring soon",
    count: "3",
    unit: "BGs",
    detail: "expire within 15 days · 1 within 5 days",
    timing: "Nearest expiry in 4 days",
    tone: "urgent",
    rows: [
      { record: "DEMO-1042 · S.O. 1", detail: "PWB BG · expires 26 Oct", division: "Trial", timing: "4 days left" },
      { record: "DEMO-1088 · Stage 2", detail: "Combined BG · expires 30 Oct", division: "Systems", timing: "8 days left" },
      { record: "DEMO-1121 · S.O. 1", detail: "PSB BG · expires 5 Nov", division: "Electronics", timing: "14 days left" },
    ],
  },
  {
    id: "scrutiny-pending",
    label: "Scrutiny pending",
    count: "12",
    unit: "files",
    detail: "4 pending beyond 7 days",
    timing: "Oldest pending 18 days",
    tone: "attention",
    rows: [
      { record: "DEMO-2031", detail: "Scrutiny · received 4 Oct", division: "Trial", timing: "18 days" },
      { record: "DEMO-2056", detail: "Scrutiny · received 9 Oct", division: "Systems", timing: "13 days" },
      { record: "DEMO-2094", detail: "Scrutiny · received 14 Oct", division: "Electronics", timing: "8 days" },
    ],
  },
  {
    id: "returned-bills",
    label: "Returned bills awaiting resubmission",
    count: "4",
    unit: "bills",
    detail: "latest return cycle remains open",
    timing: "Oldest return 9 days ago",
    tone: "attention",
    rows: [
      { record: "DEMO-3012 · Stage 1", detail: "Bill 1 · returned 13 Oct", division: "Trial", timing: "9 days" },
      { record: "DEMO-3077 · S.O. 1", detail: "Regular bill · returned 16 Oct", division: "Systems", timing: "6 days" },
      { record: "DEMO-3115 · Supplementary 2", detail: "Bill 2 · returned 19 Oct", division: "Electronics", timing: "3 days" },
    ],
  },
  {
    id: "payment-overdue",
    label: "Payments overdue",
    count: "6",
    unit: "payment cases",
    detail: "sample total ₹12.4 lakh",
    timing: "Oldest due 11 days ago",
    tone: "urgent",
    rows: [
      { record: "DEMO-4018 · Stage 2", detail: "Stage payment · due 11 Oct", division: "Trial", timing: "11 days overdue" },
      { record: "DEMO-4053 · S.O. 1", detail: "Regular payment · due 16 Oct", division: "Systems", timing: "6 days overdue" },
      { record: "DEMO-4099 · Supplementary 1", detail: "Supplementary · due 20 Oct", division: "Electronics", timing: "2 days overdue" },
    ],
  },
  {
    id: "bg-receipt-delay",
    label: "BG receipt overdue",
    count: "5",
    unit: "BGs",
    detail: "applicable guarantees not yet received",
    timing: "Oldest trigger 21 days ago",
    tone: "attention",
    rows: [
      { record: "DEMO-5024 · S.O. 1", detail: "PWB BG · trigger 1 Oct", division: "Trial", timing: "21 days" },
      { record: "DEMO-5066 · Stage 1", detail: "PSB BG · trigger 7 Oct", division: "Systems", timing: "15 days" },
      { record: "DEMO-5098 · S.O. 2", detail: "Combined BG · trigger 12 Oct", division: "Electronics", timing: "10 days" },
    ],
  },
  {
    id: "delivery-bill-pending",
    label: "Work completed · bill preparation pending",
    count: "7",
    unit: "orders / stages",
    detail: "completion recorded, bill preparation not recorded",
    timing: "Oldest completion 16 days ago",
    tone: "attention",
    rows: [
      { record: "DEMO-6021 · Stage 2", detail: "Actual completion · 6 Oct", division: "Trial", timing: "16 days" },
      { record: "DEMO-6085 · S.O. 1", detail: "Material received · 11 Oct", division: "Systems", timing: "11 days" },
      { record: "DEMO-6129 · Stage 1", detail: "Actual completion · 14 Oct", division: "Electronics", timing: "8 days" },
    ],
  },
  {
    id: "dp-expired-incomplete",
    label: "D.P. expired · work incomplete",
    count: "5",
    unit: "orders / stages",
    detail: "effective D.P. passed without qualifying completion",
    timing: "Oldest expired 24 days ago",
    tone: "urgent",
    rows: [
      { record: "DEMO-7014 · S.O. 1", detail: "Effective D.P. · 30 Sep", division: "Trial", timing: "24 days overdue" },
      { record: "DEMO-7048 · Stage 3", detail: "Effective D.P. · 8 Oct", division: "Systems", timing: "16 days overdue" },
      { record: "DEMO-7092 · Stage 1", detail: "Effective D.P. · 15 Oct", division: "Electronics", timing: "9 days overdue" },
    ],
  },
  {
    id: "prebid-upcoming",
    label: "Pre-Bid meetings coming up",
    count: "4",
    unit: "meetings",
    detail: "scheduled within the next 7 days",
    timing: "Next meeting in 2 days",
    tone: "neutral",
    rows: [
      { record: "DEMO-8017", detail: "Pre-Bid · 24 Oct", division: "Trial", timing: "2 days" },
      { record: "DEMO-8055", detail: "Pre-Bid · 27 Oct", division: "Systems", timing: "5 days" },
      { record: "DEMO-8091", detail: "Refloat Pre-Bid · 29 Oct", division: "Electronics", timing: "7 days" },
    ],
  },
  {
    id: "pending-pre-tcec",
    label: "Pre-TCEC pending",
    dropdownLabel: "Pre-TCEC",
    count: "5",
    unit: "files",
    detail: "4 pending beyond 7 days",
    timing: "Oldest pending 14 days",
    tone: "attention",
    rows: [
      { record: "DEMO-9011", detail: "Pre-TCEC pending · since 9 Oct", division: "Trial", timing: "14 days" },
      { record: "DEMO-9043", detail: "Pre-TCEC pending · since 12 Oct", division: "Systems", timing: "11 days" },
      { record: "DEMO-9087", detail: "Pre-TCEC pending · since 16 Oct", division: "Electronics", timing: "7 days" },
    ],
  },
  {
    id: "pending-rqa",
    label: "R&QA pending",
    dropdownLabel: "R&QA",
    count: "3",
    unit: "files",
    detail: "2 pending beyond 7 days",
    timing: "Oldest pending 12 days",
    tone: "attention",
    rows: [
      { record: "DEMO-9112", detail: "R&QA pending · since 11 Oct", division: "Trial", timing: "12 days" },
      { record: "DEMO-9144", detail: "R&QA pending · since 15 Oct", division: "Systems", timing: "8 days" },
      { record: "DEMO-9180", detail: "R&QA pending · since 19 Oct", division: "Electronics", timing: "4 days" },
    ],
  },
  {
    id: "pending-ifa",
    label: "IFA pending",
    dropdownLabel: "IFA",
    count: "6",
    unit: "files",
    detail: "3 pending beyond 10 days",
    timing: "Oldest pending 19 days",
    tone: "urgent",
    rows: [
      { record: "DEMO-9213", detail: "IFA sent · 4 Oct", division: "Trial", timing: "19 days" },
      { record: "DEMO-9247", detail: "IFA sent · 9 Oct", division: "Systems", timing: "14 days" },
      { record: "DEMO-9291", detail: "IFA sent · 13 Oct", division: "Electronics", timing: "10 days" },
    ],
  },
  {
    id: "pending-cfa",
    label: "CFA pending",
    dropdownLabel: "CFA",
    count: "4",
    unit: "files",
    detail: "2 pending beyond 10 days",
    timing: "Oldest pending 16 days",
    tone: "attention",
    rows: [
      { record: "DEMO-9310", detail: "CFA sent · 7 Oct", division: "Trial", timing: "16 days" },
      { record: "DEMO-9342", detail: "CFA sent · 12 Oct", division: "Systems", timing: "11 days" },
      { record: "DEMO-9386", detail: "CFA sent · 18 Oct", division: "Electronics", timing: "5 days" },
    ],
  },
  {
    id: "pending-bidding",
    label: "Bidding stage pending",
    dropdownLabel: "Bidding",
    count: "7",
    unit: "files",
    detail: "3 beyond the configured age threshold",
    timing: "Oldest pending 22 days",
    tone: "attention",
    rows: [
      { record: "DEMO-9415", detail: "Bidding · since 1 Oct", division: "Trial", timing: "22 days" },
      { record: "DEMO-9449", detail: "Bidding · since 8 Oct", division: "Systems", timing: "15 days" },
      { record: "DEMO-9493", detail: "Bidding · since 15 Oct", division: "Electronics", timing: "8 days" },
    ],
  },
  {
    id: "pending-cnc",
    label: "CNC pending",
    dropdownLabel: "CNC",
    count: "2",
    unit: "files",
    detail: "1 pending beyond 10 days",
    timing: "Oldest pending 13 days",
    tone: "attention",
    rows: [
      { record: "DEMO-9518", detail: "CNC pending · since 10 Oct", division: "Trial", timing: "13 days" },
      { record: "DEMO-9552", detail: "CNC pending · since 17 Oct", division: "Systems", timing: "6 days" },
    ],
  },
  {
    id: "pending-financial-sanction",
    label: "Financial Sanction pending",
    dropdownLabel: "Financial Sanction",
    count: "2",
    unit: "S.O. cases",
    detail: "sanction date not yet recorded",
    timing: "Oldest pending 17 days",
    tone: "urgent",
    rows: [
      { record: "DEMO-9611 · Expected S.O.", detail: "Financial Sanction pending · since 6 Oct", division: "Trial", timing: "17 days" },
      { record: "DEMO-9655 · Expected S.O.", detail: "Financial Sanction pending · since 13 Oct", division: "Systems", timing: "10 days" },
    ],
  },
];

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
    ["BG Expiry", "monthWiseBgExpiry"],
    ["BG receipt delay", "bgReceiptDelay"],
    ["Warranty / BG mismatch", "warrantyBgMismatch"],
    ["Delay Status", "delayStatus"],
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
  "report-soPaymentMatrix": "paymentDue",
  "report-paymentCompletedMatrix": "paymentCompleted",
};
const twoMonthCalendarIds = new Set([
  "deliverySchedule",
  "bgExpiry",
  "paymentDue",
  "paymentCompleted",
]);

function getCalendarBoardId(item: BoardItem | undefined) {
  if (!item) return undefined;
  const mappedId = boardCalendarIds[item.id] ?? item.id;
  if (calendarBoardIds.has(mappedId)) return mappedId;
  if (!item.href) return undefined;

  const mode = new URL(item.href, "http://notice-board.local").searchParams.get("mode");
  return {
    monthWiseDeliverySchedule: "deliverySchedule",
    monthWiseBgExpiry: "bgExpiry",
    soPaymentMatrix: "paymentDue",
    paymentCompletedMatrix: "paymentCompleted",
  }[mode as "monthWiseDeliverySchedule" | "monthWiseBgExpiry" | "soPaymentMatrix" | "paymentCompletedMatrix"];
}

const boardCatalog: BoardItem[] = [
  ...favoriteCatalog
    .filter((item) => item.id !== "dashboard")
    .flatMap((item) =>
      item.id === "analytics-tcecStatus"
        ? [
            {
              ...item,
              id: "analytics-preTcecMonthly",
              label: "Pre-TCEC · Monthwise distribution",
              href: "/dashboard?tab=analytics&analyticsPanel=tcecStatus&tcecStage=pre&tcecView=monthly",
            },
            {
              ...item,
              id: "analytics-preTcecCommittee",
              label: "Pre-TCEC · Committee-wise distribution",
              href: "/dashboard?tab=analytics&analyticsPanel=tcecStatus&tcecStage=pre&tcecView=committee",
            },
            {
              ...item,
              id: "analytics-postTcecMonthly",
              label: "Post-TCEC · Monthwise distribution",
              href: "/dashboard?tab=analytics&analyticsPanel=tcecStatus&tcecStage=post&tcecView=monthly",
            },
            {
              ...item,
              id: "analytics-postTcecCommittee",
              label: "Post-TCEC · Committee-wise distribution",
              href: "/dashboard?tab=analytics&analyticsPanel=tcecStatus&tcecStage=post&tcecView=committee",
            },
          ]
        : item.id === "analytics-fileValueThresholds"
          ? [
              ["Demand Value", "demandValue"],
              ["S.O. Value", "soValue"],
              ["Count-Demand value", "countDemandValue"],
              ["Count-S.O. value", "countSoValue"],
              ["Count-Demand Value (%)", "countDemandValuePercent"],
              ["Count-S.O. Value (%)", "countSoValuePercent"],
            ].map(([label, mode]) => ({
              ...item,
              id: `analytics-count-value-${mode}`,
              label,
              href: `/dashboard?tab=analytics&analyticsPanel=fileValueThresholds&boardMetric=${mode}`,
            }))
          : item.id === "analytics-biddingMode"
            ? [{ ...item, label: "Bidding Mode Mix" }]
            : item.id === "report-cashOutGoPlan"
              ? [{ ...item, href: `${item.href}&noticeBoardSummary=1` }]
              : item.id === "fy-snapshot-financial-position"
                ? [{ ...item, label: "FY Snapshot · Financial Position (Running FY)" }]
                : item.id === "fy-activity-orders-and-closures"
                  ? [
                      {
                        ...item,
                        label: "FY Activity · Orders, Payments & Carry Forward (Running FY)",
                      },
                    ]
                  : [{ ...item, id: boardCalendarIds[item.id] ?? item.id }],
    ),
  ...[
    { key: "all", label: "All milestones" },
    ...delayMilestoneOptions,
  ].map((item) => ({
    id: `notice-delay-status-${item.key}`,
    label: item.label,
    group: "Delay Status",
    href: `/reports?mode=delayStatus&delayMilestone=${encodeURIComponent(item.key)}`,
  })),
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

const screenshotSourceIds = [
  "analytics-preTcecMonthly",
  "analytics-preTcecCommittee",
  "analytics-postTcecMonthly",
  "analytics-postTcecCommittee",
  "analytics-cncSummary",
  "analytics-biddingMode",
  "analytics-delayStatus",
  "analytics-paymentPending",
  "analytics-divisionTurnaround",
  "analytics-count-value-demandValue",
  "analytics-count-value-soValue",
  "analytics-count-value-countDemandValue",
  "analytics-count-value-countSoValue",
  "analytics-count-value-countDemandValuePercent",
  "analytics-count-value-countSoValuePercent",
  "fy-snapshot-financial-position",
  "fy-activity-orders-and-closures",
  "deliverySchedule",
  "bgExpiry",
  "report-bgReceiptDelay",
  "report-warrantyBgMismatch",
  "report-soPaymentMatrix",
  "report-paymentCompletedMatrix",
  "report-cashOutGoPlan",
  "analytics-indentorsByValue",
  "analytics-indentorsByFiles",
  "analytics-divisionTotalValue",
  "analytics-divisionFiles",
];

function getNoticeBoardEmbedHref(href: string) {
  const url = new URL(href, "http://notice-board.local");
  if (
    url.pathname === "/reports" ||
    (url.pathname === "/dashboard" &&
      ["analytics", "finance1", "fyActivity"].includes(url.searchParams.get("tab") ?? ""))
  ) {
    url.searchParams.set("noticeBoardEmbed", "1");
  }
  if (url.pathname === "/dashboard" && url.searchParams.get("tab") === "finance1") {
    url.searchParams.set("noticeBoardView", "financialPosition");
  }
  if (url.pathname === "/dashboard" && url.searchParams.get("tab") === "fyActivity") {
    url.searchParams.set("noticeBoardView", "fyActivitySummary");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

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
  personalBoardSelection: (userId: string) => `recordkeeper.noticeBoard.user.${userId}.sourceSelection.v1`,
  personalInterval: (userId: string) => `recordkeeper.noticeBoard.user.${userId}.interval.v1`,
  personalTransitionDuration: (userId: string, key: string) =>
    `recordkeeper.noticeBoard.user.${userId}.${key}.v1`,
  personalTransitionEffect: (userId: string) =>
    `recordkeeper.noticeBoard.user.${userId}.transitionEffect.v1`,
  adminInterval: "recordkeeper.noticeBoard.admin.interval.v1",
  sharedImportComplete: "recordkeeper.sharedQuickAccess.legacyImported.v1",
};

const noticeBoardTransitionFields = [
  { key: "noticeBoardSlideDurationMs", label: "Horizontal slide", defaultMs: 1200 },
  { key: "noticeBoardFadeOutDurationMs", label: "Fade out", defaultMs: 1400 },
  { key: "noticeBoardFadeInDurationMs", label: "Fade in", defaultMs: 900 },
  { key: "noticeBoardVerticalScrollDurationMs", label: "Vertical scroll", defaultMs: 2800 },
] as const;
type NoticeBoardTransitionKey = (typeof noticeBoardTransitionFields)[number]["key"];
type NoticeBoardTransitionEffect = "slide" | "fade" | "vertical-scroll" | "none";
const noticeBoardTransitionEffects: { value: NoticeBoardTransitionEffect; label: string }[] = [
  { value: "slide", label: "Horizontal slide" },
  { value: "fade", label: "Fade" },
  { value: "vertical-scroll", label: "Vertical scroll" },
  { value: "none", label: "None" },
];
type NoticeBoardTransitionSettings = Pick<
  ReturnType<typeof store.getSettings>["sharedQuickAccess"],
  NoticeBoardTransitionKey
>;

function readTransitionDuration(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const stored = Number(window.localStorage.getItem(key));
  return Number.isInteger(stored) ? Math.min(30000, Math.max(100, stored)) : fallback;
}

function readTransitionEffect(key: string): NoticeBoardTransitionEffect {
  if (typeof window === "undefined") return "slide";
  const stored = window.localStorage.getItem(key);
  return noticeBoardTransitionEffects.some((effect) => effect.value === stored)
    ? (stored as NoticeBoardTransitionEffect)
    : "slide";
}

function transitionDurationDefaults() {
  return Object.fromEntries(
    noticeBoardTransitionFields.map(({ key, defaultMs }) => [key, String(defaultMs / 1000)]),
  ) as Record<NoticeBoardTransitionKey, string>;
}

function parseTransitionDuration(value: string, fallback: number) {
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.round(Math.min(30, Math.max(0.1, seconds)) * 1000)
    : fallback;
}

let sharedQuickAccessSaveQueue: Promise<unknown> = Promise.resolve();

function saveSharedQuickAccess(patch: SharedQuickAccessPatch) {
  const save = sharedQuickAccessSaveQueue.catch(() => undefined).then(() => {
    const current = store.getSettings().sharedQuickAccess;
    return store.saveSettings({
      sharedQuickAccess: { ...current, ...patch, initialized: true },
    });
  });
  sharedQuickAccessSaveQueue = save;
  return save;
}

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

function useLegacySharedQuickAccessMigration(admin: boolean) {
  const settings = useSettings();
  useEffect(() => {
    if (!admin || window.localStorage.getItem(storageKeys.sharedImportComplete) === "true") return;
    const current = settings.sharedQuickAccess;
    if (current.initialized) {
      window.localStorage.setItem(storageKeys.sharedImportComplete, "true");
      return;
    }
    const favorites = readArray<AccessItem>(storageKeys.adminFavorites).map((item) => item.id);
    const noticeBoardItems = readArray<BoardItem>(storageKeys.adminBoard).map((item) => item.id);
    const interval = readInterval(storageKeys.adminInterval);
    if (!favorites.length && !noticeBoardItems.length && interval === 15) return;
    void saveSharedQuickAccess({ favorites, noticeBoardItems, noticeBoardIntervalSeconds: interval })
      .then(() => {
        window.localStorage.setItem(storageKeys.sharedImportComplete, "true");
      })
      .catch((error: unknown) => console.error("Legacy shared Quick Access import failed.", error));
  }, [admin, settings.sharedQuickAccess]);
}

function addUnique<T extends { id: string }>(items: T[], item: T) {
  return items.some((existing) => existing.id === item.id) ? items : [...items, item];
}

function QuickAccessScope({ personal }: { personal: boolean }) {
  return (
    <p className="text-xs">
      <span className="font-semibold text-foreground">
        {personal ? "Only for your account" : "Shared with all users"}
      </span>
      <span className="ml-3 text-muted-foreground">
        Can be edited by: {personal ? "You" : "Administrators"}
      </span>
    </p>
  );
}

function FavoriteEditor({ admin }: { admin: boolean }) {
  const user = useActiveUser();
  const settings = useSettings();
  const personalKey = storageKeys.personalFavorites(user?.id ?? "anonymous");
  const [personal, setPersonal] = useState(() => readArray<AccessItem>(personalKey));
  const sharedIds = new Set(settings.sharedQuickAccess.favorites);
  const shared = favoriteCatalog.filter((item) => sharedIds.has(item.id));
  const [saveError, setSaveError] = useState("");
  const personalHasChanges = JSON.stringify(personal) !== JSON.stringify(readArray<AccessItem>(personalKey));
  const updateFavorites = (target: "shared" | "personal", next: AccessItem[]) => {
    if (target === "shared") {
      setSaveError("");
      void saveSharedQuickAccess({ favorites: next.map((item) => item.id) }).catch((error: unknown) =>
        setSaveError(error instanceof Error ? error.message : "Shared shortcuts could not be saved."),
      );
    } else {
      setSaveError("");
      setPersonal(next);
    }
  };
  const savePersonalFavorites = () => {
    try {
      saveArray(personalKey, personal);
      setSaveError("");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Your shortcuts could not be saved.");
    }
  };
  const cancelPersonalFavorites = () => {
    if (personalHasChanges && !window.confirm("Discard your unsaved shortcut changes?")) return;
    setPersonal(readArray<AccessItem>(personalKey));
    setSaveError("");
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
        <div className="space-y-2">
          <QuickAccessScope personal={false} />
          <OptionPicker
            title="Administrator shortcuts"
            catalog={favoriteCatalog}
            assigned={shared}
            onAssign={(items) => addFavorites("shared", items)}
            onReturn={(ids) => returnFavorites("shared", ids)}
          />
        </div>
      ) : null}
      <div className="space-y-2">
        <QuickAccessScope personal />
        <OptionPicker
          title="Your shortcuts"
          catalog={favoriteCatalog}
          assigned={personal}
          onAssign={(items) => addFavorites("personal", items)}
          onReturn={(ids) => returnFavorites("personal", ids)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={cancelPersonalFavorites}
          disabled={!personalHasChanges}
          className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={savePersonalFavorites}
          disabled={!personalHasChanges}
          className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Save changes
        </button>
      </div>
      {saveError ? (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      ) : null}
    </div>
  );
}

function NoticeBoardEditor() {
  const user = useActiveUser();
  const settings = useSettings();
  const userId = user?.id ?? "anonymous";
  const [personalInterval, setPersonalInterval] = useState(() =>
    readInterval(storageKeys.personalInterval(userId)),
  );
  const [personalTransitionDrafts, setPersonalTransitionDrafts] = useState(() =>
    Object.fromEntries(
      noticeBoardTransitionFields.map(({ key, defaultMs }) => [
        key,
        String(readTransitionDuration(storageKeys.personalTransitionDuration(userId, key), defaultMs) / 1000),
      ]),
    ) as Record<NoticeBoardTransitionKey, string>,
  );
  const [personalTransitionEffect, setPersonalTransitionEffect] = useState(() =>
    readTransitionEffect(storageKeys.personalTransitionEffect(userId)),
  );
  const [saveError, setSaveError] = useState("");
  const personalHasChanges =
    personalInterval !== readInterval(storageKeys.personalInterval(userId)) ||
    personalTransitionEffect !== readTransitionEffect(storageKeys.personalTransitionEffect(userId)) ||
    noticeBoardTransitionFields.some(({ key, defaultMs }) =>
      parseTransitionDuration(personalTransitionDrafts[key] ?? "", defaultMs) !==
      readTransitionDuration(storageKeys.personalTransitionDuration(userId, key), defaultMs),
    );
  useEffect(
    () => {
      setPersonalTransitionDrafts(
        Object.fromEntries(
          noticeBoardTransitionFields.map(({ key, defaultMs }) => [
            key,
            String(readTransitionDuration(storageKeys.personalTransitionDuration(userId, key), defaultMs) / 1000),
          ]),
        ) as Record<NoticeBoardTransitionKey, string>,
      );
      setPersonalTransitionEffect(readTransitionEffect(storageKeys.personalTransitionEffect(userId)));
    },
    [userId],
  );
  const setInterval = (value: number) => {
    const next = Math.min(120, Math.max(5, value || 15));
    setPersonalInterval(next);
  };
  const setTransitionDraft = (key: NoticeBoardTransitionKey, value: string) => {
    setPersonalTransitionDrafts((current) => ({ ...current, [key]: value }));
  };
  const savePersonalSettings = () => {
    try {
      window.localStorage.setItem(storageKeys.personalInterval(userId), String(personalInterval));
      window.localStorage.setItem(storageKeys.personalTransitionEffect(userId), personalTransitionEffect);
      for (const { key, defaultMs } of noticeBoardTransitionFields) {
        const milliseconds = parseTransitionDuration(personalTransitionDrafts[key], defaultMs);
        window.localStorage.setItem(storageKeys.personalTransitionDuration(userId, key), String(milliseconds));
        setTransitionDraft(key, String(milliseconds / 1000));
      }
      setSaveError("");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Notice Board preferences could not be saved.");
    }
  };
  const cancelPersonalSettings = () => {
    if (personalHasChanges && !window.confirm("Discard your unsaved Notice Board changes?")) return;
    setPersonalInterval(readInterval(storageKeys.personalInterval(userId)));
    setPersonalTransitionEffect(readTransitionEffect(storageKeys.personalTransitionEffect(userId)));
    setPersonalTransitionDrafts(
      Object.fromEntries(
        noticeBoardTransitionFields.map(({ key, defaultMs }) => [
          key,
          String(readTransitionDuration(storageKeys.personalTransitionDuration(userId, key), defaultMs) / 1000),
        ]),
      ) as Record<NoticeBoardTransitionKey, string>,
    );
    setSaveError("");
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-6 border-t border-border pt-4">
        <div className="w-full"><QuickAccessScope personal /></div>
        <label className="text-xs font-medium">
          View hold duration (seconds)
          <input
            type="number"
            min={5}
            max={120}
            value={personalInterval}
            onChange={(event) => setInterval(Number(event.target.value))}
            className="mt-1 block h-9 w-32 rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
      </div>
      <div className="space-y-4 border-t border-border pt-4">
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-semibold">Your transition settings</legend>
          <label className="block max-w-xs text-xs font-medium">
            Default transition
            <select
              value={personalTransitionEffect}
              onChange={(event) => {
                const effect = event.target.value as NoticeBoardTransitionEffect;
                setPersonalTransitionEffect(effect);
              }}
              className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {noticeBoardTransitionEffects.map((effect) => (
                <option key={effect.value} value={effect.value}>{effect.label}</option>
              ))}
            </select>
          </label>
          <p className="text-xs font-medium text-muted-foreground">Transition durations (seconds)</p>
          <div className="flex flex-wrap gap-4">
            {noticeBoardTransitionFields.map(({ key, label }) => (
              <label key={key} className="text-xs font-medium">
                {label}
                <input
                  type="number"
                  min={0.1}
                  max={30}
                  step={0.1}
                  value={personalTransitionDrafts[key]}
                  onChange={(event) => setTransitionDraft(key, event.target.value)}
                  className="mt-1 block h-9 w-32 rounded-md border border-input bg-background px-2 text-sm"
                />
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={cancelPersonalSettings}
          disabled={!personalHasChanges}
          className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={savePersonalSettings}
          disabled={!personalHasChanges}
          className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Save changes
        </button>
      </div>
      {saveError ? (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      ) : null}
    </div>
  );
}

export function QuickAccessSettings({ section }: { section: "favorites" | "noticeBoard" }) {
  const admin = useActiveUser()?.role === "admin";
  useLegacySharedQuickAccessMigration(admin);
  return section === "favorites" ? (
    <FavoriteEditor admin={admin} />
  ) : (
    <NoticeBoardEditor />
  );
}

export function QuickEntryAccess() {
  const user = useActiveUser();
  useLegacySharedQuickAccessMigration(user?.role === "admin");
  const userId = user?.id ?? "anonymous";
  const delay = readInterval(storageKeys.personalInterval(userId));
  const transitionDurations = Object.fromEntries(
    noticeBoardTransitionFields.map(({ key, defaultMs }) => [
      key,
      readTransitionDuration(storageKeys.personalTransitionDuration(userId, key), defaultMs),
    ]),
  ) as NoticeBoardTransitionSettings;
  const transitionEffect = readTransitionEffect(storageKeys.personalTransitionEffect(userId));
  type QuickEntryTab = "noticeBoard" | "excelExports";
  const [activeTab, setActiveTab] = useState<QuickEntryTab>("noticeBoard");
  return (
    <>
      <section className="rounded-md border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="overflow-x-auto border-b border-border bg-primary/10">
          <div className="flex min-w-max p-1" role="tablist" aria-label="Quick Entry tools">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "noticeBoard"}
              onClick={() => setActiveTab("noticeBoard")}
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors ${activeTab === "noticeBoard" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <MonitorPlay className="size-4" /> Notice Board
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "excelExports"}
              onClick={() => setActiveTab("excelExports")}
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors ${activeTab === "excelExports" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <FileSpreadsheet className="size-4" /> Excel Exports
            </button>
          </div>
        </div>
        {activeTab === "noticeBoard" ? (
          <section role="tabpanel" className="relative p-5">
            <LiveSourceBoard
              userId={userId}
              delaySeconds={delay}
              transitionDurations={transitionDurations}
              transitionEffect={transitionEffect}
            />
          </section>
        ) : (
          <QuickEntryExcelExportList />
        )}
      </section>
    </>
  );
}

function LiveSourceBoard({
  userId,
  delaySeconds,
  transitionDurations,
  transitionEffect,
}: {
  userId: string;
  delaySeconds: number;
  transitionDurations: NoticeBoardTransitionSettings;
  transitionEffect: NoticeBoardTransitionEffect;
}) {
  const settings = useSettings();
  const sourceItems = useMemo(
    () => boardCatalog.filter((item) => screenshotSourceIds.includes(item.id)),
    [],
  );
  const selectionDropdownRef = useRef<HTMLDetailsElement>(null);
  const sequenceDropdownRef = useRef<HTMLDetailsElement>(null);
  const selectionKey = storageKeys.personalBoardSelection(userId);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem(selectionKey);
        if (saved !== null) {
          const parsed: unknown = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const expanded = parsed.flatMap((id) => {
              if (id === "analytics-preTcecSummary")
                return ["analytics-preTcecMonthly", "analytics-preTcecCommittee"];
              if (id === "analytics-postTcecSummary")
                return ["analytics-postTcecMonthly", "analytics-postTcecCommittee"];
              if (id === "analytics-tcecStatus")
                return [
                  "analytics-preTcecMonthly",
                  "analytics-preTcecCommittee",
                  "analytics-postTcecMonthly",
                  "analytics-postTcecCommittee",
                ];
              return [id];
            });
            return expanded.filter((id): id is string =>
              typeof id === "string" && sourceItems.some((item) => item.id === id),
            );
          }
        }
      } catch {
        // Use the shared screenshot set if the saved selection is unreadable.
      }
    }
    return screenshotSourceIds;
  });
  const selectedItems = useMemo(
    () => selectedIds.flatMap((id) => {
      const item = sourceItems.find((candidate) => candidate.id === id);
      return item ? [item] : [];
    }),
    [selectedIds, sourceItems],
  );
  const [activeId, setActiveId] = useState(selectedItems[0]?.id ?? "");
  const [rotationOpen, setRotationOpen] = useState(false);
  const activeItem = selectedItems.find((item) => item.id === activeId) ?? selectedItems[0];
  const activeCalendarId = getCalendarBoardId(activeItem);
  const [summary, setSummary] = useState<NoticeSummary>();
  const [summaryError, setSummaryError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams({
      division: "all",
      selectedYear: settings.financialYear,
      delayDays: "0",
      delayMilestone: "all",
    });
    const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    let cancelled = false;
    fetch(`${baseUrl}/api/reports/summary?${params}`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Notice Board data could not be loaded.");
        return (await response.json()) as { summary: NoticeSummary };
      })
      .then((result) => {
        if (!cancelled) {
          setSummary(result.summary);
          setSummaryError("");
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setSummaryError(
            reason instanceof Error ? reason.message : "Notice Board data could not be loaded.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settings.financialYear, settings.selectedYear]);
  const activeCalendarDays = useMemo(
    () => getBoardDays(activeCalendarId, summary),
    [activeCalendarId, summary],
  );
  const currentMonthKey = formatIndiaMonth();
  const nextMonthKey = getNextMonthKey(currentMonthKey);

  useEffect(() => {
    window.localStorage.setItem(selectionKey, JSON.stringify(selectedIds));
  }, [selectedIds, selectionKey]);

  useEffect(() => {
    if (!selectedItems.some((item) => item.id === activeId))
      setActiveId(selectedItems[0]?.id ?? "");
  }, [activeId, selectedItems]);

  useEffect(() => {
    const closeDropdowns = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      for (const dropdown of [selectionDropdownRef.current, sequenceDropdownRef.current]) {
        if (dropdown?.open && !dropdown.contains(target)) dropdown.open = false;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      for (const dropdown of [selectionDropdownRef.current, sequenceDropdownRef.current]) {
        if (dropdown?.open) dropdown.open = false;
      }
    };
    document.addEventListener("pointerdown", closeDropdowns);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeDropdowns);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const toggleSource = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((selected) => selected !== id) : [...current, id],
    );
  };
  const moveSource = (id: string, offset: -1 | 1) => {
    setSelectedIds((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Live information</h2>
          <p className="text-sm text-muted-foreground">Choose source sections to show here.</p>
        </div>
        <div className="flex items-center gap-2">
          <details ref={selectionDropdownRef} className="group relative">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-border bg-background px-3 text-sm [&::-webkit-details-marker]:hidden">
              Select sections <span className="text-muted-foreground">{selectedIds.length} selected</span>
            </summary>
            <div className="absolute right-0 z-30 mt-1 max-h-[70vh] w-80 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-md border border-border bg-popover p-3 shadow-lg">
              <div className="mb-2 flex justify-end gap-3 border-b border-border pb-2 text-xs">
                <button type="button" onClick={() => setSelectedIds(screenshotSourceIds)} className="font-medium text-primary">Select all</button>
                <button type="button" onClick={() => setSelectedIds([])} className="font-medium text-primary">Clear</button>
              </div>
              {sourceItems.map((item) => (
                <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-sm px-2 py-2 text-sm hover:bg-accent">
                  <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSource(item.id)} className="mt-0.5 size-4 shrink-0 accent-primary" />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </details>
          <details ref={sequenceDropdownRef} className="group relative">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-border bg-background px-3 text-sm [&::-webkit-details-marker]:hidden">
              Sequence <span className="text-muted-foreground">{selectedItems.length}</span>
            </summary>
            <div className="absolute right-0 z-30 mt-1 max-h-[70vh] w-80 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-md border border-border bg-popover p-3 shadow-lg">
              {selectedItems.length ? (
                selectedItems.map((item, index) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-sm px-2 py-1.5">
                    <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}.</span>
                    <span className="min-w-0 flex-1 text-sm">{item.label}</span>
                    <button
                      type="button"
                      onClick={() => moveSource(item.id, -1)}
                      disabled={index === 0}
                      className="grid size-7 shrink-0 place-items-center rounded-sm hover:bg-accent disabled:opacity-35"
                      aria-label={`Move ${item.label} up in sequence`}
                      title="Move up"
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSource(item.id, 1)}
                      disabled={index === selectedItems.length - 1}
                      className="grid size-7 shrink-0 place-items-center rounded-sm hover:bg-accent disabled:opacity-35"
                      aria-label={`Move ${item.label} down in sequence`}
                      title="Move down"
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="px-2 py-3 text-sm text-muted-foreground">No sections selected.</p>
              )}
            </div>
          </details>
          <button
            type="button"
            onClick={() => setRotationOpen(true)}
            disabled={!selectedItems.length}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm hover:bg-accent disabled:opacity-50"
            title="Show selected sections in full-screen rotation"
          >
            <Maximize2 className="size-4" /> Start rotation
          </button>
        </div>
      </div>

      {selectedItems.length ? (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {selectedItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveId(item.id)}
                aria-pressed={item.id === activeItem?.id}
                className={`shrink-0 rounded-md border px-3 py-2 text-sm ${item.id === activeItem?.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {activeItem?.href ? (
            <div className="overflow-hidden rounded-md border border-border bg-background">
              <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                <h3 className="text-sm font-medium">{activeItem.label}</h3>
                <span className="text-xs text-muted-foreground">{selectedItems.findIndex((item) => item.id === activeItem.id) + 1} of {selectedItems.length}</span>
              </div>
              {activeCalendarId ? (
                summaryError ? (
                  <p role="alert" className="p-6 text-center text-sm text-destructive">{summaryError}</p>
                ) : !summary ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">Loading calendar...</p>
                ) : twoMonthCalendarIds.has(activeCalendarId) ? (
                  <div className="grid grid-cols-1 items-start gap-4 p-4 xl:grid-cols-2">
                    {[currentMonthKey, nextMonthKey].map((monthKey) => (
                      <MonthlyCountCalendar
                        key={monthKey}
                        monthKey={monthKey}
                        days={activeCalendarDays}
                        onClose={() => undefined}
                        showClose={false}
                      />
                    ))}
                  </div>
                ) : (
                  <iframe
                    key={activeItem.id}
                    src={getNoticeBoardEmbedHref(activeItem.href)}
                    title={activeItem.label}
                    className="h-[min(72vh,900px)] min-h-[520px] w-full border-0 bg-background"
                  />
                )
              ) : (
                <iframe
                  key={activeItem.id}
                  src={getNoticeBoardEmbedHref(activeItem.href)}
                  title={activeItem.label}
                  className="h-[min(72vh,900px)] min-h-[520px] w-full border-0 bg-background"
                />
              )}
            </div>
          ) : null}
        </>
      ) : (
        <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Select at least one section to display live information.
        </div>
      )}
      {rotationOpen ? (
        <NoticeBoard
          items={selectedItems}
          delaySeconds={delaySeconds}
          transitionDurations={transitionDurations}
          transitionEffect={transitionEffect}
          initialIndex={Math.max(0, selectedItems.findIndex((item) => item.id === activeItem?.id))}
          onClose={() => setRotationOpen(false)}
        />
      ) : null}
    </div>
  );
}

function OperationalWatchboardPreview() {
  const [selectedIds, setSelectedIds] = useState(() => watchboardPreviewNotices.slice(0, 4).map((item) => item.id));
  const selectedNotices = useMemo(
    () => watchboardPreviewNotices.filter((item) => selectedIds.includes(item.id)),
    [selectedIds],
  );
  const [activeId, setActiveId] = useState(watchboardPreviewNotices[0].id);
  const [rotating, setRotating] = useState(false);
  const noticePickerRef = useRef<HTMLDetailsElement>(null);
  const activeIndex = Math.max(
    0,
    selectedNotices.findIndex((notice) => notice.id === activeId),
  );
  const notice = selectedNotices[activeIndex];

  useEffect(() => {
    if (!selectedNotices.length) {
      setActiveId("");
      setRotating(false);
    } else if (!selectedNotices.some((item) => item.id === activeId)) {
      setActiveId(selectedNotices[0].id);
    }
  }, [activeId, selectedNotices]);

  useEffect(() => {
    if (!rotating || selectedNotices.length < 2) return;
    const timer = window.setInterval(() => {
      setActiveId((current) => {
        const index = selectedNotices.findIndex((item) => item.id === current);
        return selectedNotices[(index + 1) % selectedNotices.length].id;
      });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [rotating, selectedNotices]);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      const picker = noticePickerRef.current;
      if (picker?.open && !picker.contains(event.target as Node)) picker.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const picker = noticePickerRef.current;
      if (event.key !== "Escape" || !picker?.open) return;
      event.preventDefault();
      picker.open = false;
      picker.querySelector<HTMLElement>("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const toggleNotice = (id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current, id];
    });
    setActiveId(id);
  };

  return (
    <section className="mb-6 rounded-md border border-border bg-background p-4 sm:p-5" aria-label="Operational watchboard preview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-md border border-primary/20 bg-primary/5 text-primary">
            <BellRing className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Operational watchboard</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              UI preview only · sample counts and records, not live data
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <details ref={noticePickerRef} className="group relative">
            <summary className="flex h-8 min-w-52 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-input bg-background px-3 text-xs font-medium [&::-webkit-details-marker]:hidden">
              <span>Select notices</span>
              <span className="text-muted-foreground">{selectedIds.length} selected</span>
            </summary>
            <div className="absolute right-0 top-full z-30 mt-1 max-h-80 w-80 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-md">
              <div className="flex items-center justify-between border-b border-border px-2 pb-2">
                <span className="text-xs text-muted-foreground">Notice options</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedIds(watchboardPreviewNotices.map((item) => item.id))}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedIds([]); setRotating(false); }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              {watchboardPreviewNotices.map((item) => (
                <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-sm px-2 py-2 text-xs hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleNotice(item.id)}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 font-medium">{item.dropdownLabel ?? item.label}</span>
                </label>
              ))}
            </div>
          </details>
          <button
            type="button"
            onClick={() => setActiveId(selectedNotices[(activeIndex - 1 + selectedNotices.length) % selectedNotices.length]?.id ?? "")}
            disabled={selectedNotices.length < 2}
            className="grid size-8 place-items-center rounded-md hover:bg-accent"
            aria-label="Previous sample notice"
            title="Previous notice"
          >
            <ArrowLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setRotating((value) => !value)}
            disabled={selectedNotices.length < 2}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent"
            aria-label={rotating ? "Pause sample rotation" : "Start sample rotation"}
          >
            {rotating ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {rotating ? "Pause" : "Rotate"}
          </button>
          <button
            type="button"
            onClick={() => setActiveId(selectedNotices[(activeIndex + 1) % selectedNotices.length]?.id ?? "")}
            disabled={selectedNotices.length < 2}
            className="grid size-8 place-items-center rounded-md hover:bg-accent"
            aria-label="Next sample notice"
            title="Next notice"
          >
            <ArrowRight className="size-4" />
          </button>
        </div>
      </div>

      {selectedNotices.length > 0 && notice ? (
        <>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {selectedNotices.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveId(item.id)}
            aria-pressed={item.id === activeId}
            className={`min-w-0 rounded-md border border-l-4 bg-card p-3 text-left transition-colors hover:bg-accent/50 ${
              item.tone === "urgent"
                ? "border-l-destructive"
                : item.tone === "attention"
                  ? "border-l-amber-500"
                  : "border-l-primary"
            } ${item.id === activeId ? "ring-1 ring-primary/30" : ""}`}
          >
            <span className="block text-xs font-medium text-muted-foreground">{item.label}</span>
            <span className="mt-1 block text-xl font-semibold leading-tight">
              {item.count} <span className="text-sm font-medium">{item.unit}</span>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-md border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {notice?.tone === "urgent" ? (
              <CircleAlert className="size-4 shrink-0 text-destructive" />
            ) : (
              <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
            )}
            <h4 className="truncate text-sm font-semibold">{notice.label}</h4>
            <span className="text-xs text-muted-foreground">· {notice.timing}</span>
          </div>
          <span className="text-xs text-muted-foreground">Sample scope: all divisions · selected FY</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-xs">
            <thead className="bg-muted/20 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">File / related record</th>
                <th className="px-3 py-2 font-medium">Notice detail</th>
                <th className="px-3 py-2 font-medium">Division</th>
                <th className="px-3 py-2 text-right font-medium">Age / deadline</th>
              </tr>
            </thead>
            <tbody>
              {notice.rows.map((row) => (
                <tr key={row.record} className="border-t border-border">
                  <td className="px-3 py-2.5 font-medium">{row.record}</td>
                  <td className="px-3 py-2.5">{row.detail}</td>
                  <td className="px-3 py-2.5">{row.division}</td>
                  <td className="px-3 py-2.5 text-right">{row.timing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span>Select a notice above to preview its matching row format.</span>
          <span>{activeIndex + 1} of {selectedNotices.length} · {rotating ? "rotates every 15s" : "paused"}</span>
        </div>
      </div>
        </>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No notices selected. Choose one or more options from the dropdown.
        </div>
      )}
    </section>
  );
}

function NoticeBoard({
  items,
  delaySeconds,
  transitionDurations,
  transitionEffect: initialTransitionEffect,
  initialIndex,
  onClose,
}: {
  items: BoardItem[];
  delaySeconds: number;
  transitionDurations: NoticeBoardTransitionSettings;
  transitionEffect: NoticeBoardTransitionEffect;
  initialIndex: number;
  onClose: () => void;
}) {
  const settings = useSettings();
  const user = useActiveUser();
  const [summary, setSummary] = useState<NoticeSummary>();
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [displayIndex, setDisplayIndex] = useState(initialIndex);
  const [playing, setPlaying] = useState(true);
  const [durationDraft, setDurationDraft] = useState(String(delaySeconds));
  const [transitionEffect, setTransitionEffect] = useState<NoticeBoardTransitionEffect>(initialTransitionEffect);
  const [error, setError] = useState("");
  const slideFrameRefs = useRef<[HTMLIFrameElement | null, HTMLIFrameElement | null]>([null, null]);
  const [visibleFrameSlot, setVisibleFrameSlot] = useState(0);
  const [frameSlots, setFrameSlots] = useState<[BoardFrameSlot, BoardFrameSlot]>(() => {
    const createSlot = (index: number): BoardFrameSlot => {
      const item = items[index];
      return item?.href ? { itemId: item.id, src: getNoticeBoardEmbedHref(item.href), loaded: false } : null;
    };
    return [createSlot(initialIndex), createSlot((initialIndex + 1) % items.length)];
  });
  const slideContentRef = useRef<HTMLElement>(null);
  const slideDirectionRef = useRef<"next" | "previous">("next");
  const viewTransitionGenerationRef = useRef(0);
  const previousIndexRef = useRef(displayIndex);
  const parsedDuration = Number(durationDraft);
  const activeDelaySeconds = Number.isFinite(parsedDuration) && parsedDuration >= 5
    ? Math.min(120, parsedDuration)
    : delaySeconds;
  const transitionDurationSeconds = transitionEffect === "slide"
    ? transitionDurations.noticeBoardSlideDurationMs / 1000
    : transitionEffect === "vertical-scroll"
      ? transitionDurations.noticeBoardVerticalScrollDurationMs / 1000
      : transitionEffect === "fade"
        ? Math.max(
            transitionDurations.noticeBoardFadeOutDurationMs,
            transitionDurations.noticeBoardFadeInDurationMs,
          ) / 1000
        : 0;
  const rotationIntervalSeconds = activeDelaySeconds + transitionDurationSeconds;
  const navigateBy = useCallback((direction: "next" | "previous") => {
    slideDirectionRef.current = direction;
    setActiveIndex((index) =>
      direction === "previous"
        ? (index - 1 + items.length) % items.length
        : (index + 1) % items.length,
    );
  }, [items.length]);
  const revealSlide = useCallback((index: number, frameSlot?: number) => {
    const generation = ++viewTransitionGenerationRef.current;
    const update = () => {
      if (frameSlot !== undefined) setVisibleFrameSlot(frameSlot);
      setDisplayIndex(index);
    };
    const startViewTransition = (document as NoticeViewTransitionDocument).startViewTransition;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reducedMotion && transitionEffect !== "none" && startViewTransition) {
      document.documentElement.dataset.noticeBoardDirection = slideDirectionRef.current;
      document.documentElement.dataset.noticeBoardEffect = transitionEffect;
      document.documentElement.style.setProperty("--notice-board-slide-duration", `${transitionDurations.noticeBoardSlideDurationMs}ms`);
      document.documentElement.style.setProperty("--notice-board-fade-out-duration", `${transitionDurations.noticeBoardFadeOutDurationMs}ms`);
      document.documentElement.style.setProperty("--notice-board-fade-in-duration", `${transitionDurations.noticeBoardFadeInDurationMs}ms`);
      document.documentElement.style.setProperty("--notice-board-vertical-duration", `${transitionDurations.noticeBoardVerticalScrollDurationMs}ms`);
      document.documentElement.style.setProperty("--notice-board-transition-duration", `${transitionDurationSeconds * 1000}ms`);
      const clearTransitionProperties = () => {
        if (generation !== viewTransitionGenerationRef.current) return;
        delete document.documentElement.dataset.noticeBoardDirection;
        delete document.documentElement.dataset.noticeBoardEffect;
        for (const property of [
          "--notice-board-slide-duration",
          "--notice-board-fade-out-duration",
          "--notice-board-fade-in-duration",
          "--notice-board-vertical-duration",
          "--notice-board-transition-duration",
        ]) document.documentElement.style.removeProperty(property);
      };
      const transition = startViewTransition.call(document, update);
      void transition.finished.then(
        clearTransitionProperties,
        clearTransitionProperties,
      );
      return;
    }
    update();
  }, [transitionDurationSeconds, transitionDurations, transitionEffect]);
  useEffect(() => {
    const params = new URLSearchParams({
      division: "all",
      selectedYear: settings.financialYear,
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
    const target = items[activeIndex];
    if (!target?.href) {
      if (displayIndex !== activeIndex) revealSlide(activeIndex);
      return;
    }
    const src = getNoticeBoardEmbedHref(target.href);
    const existingSlot = frameSlots.findIndex((slot) => slot?.itemId === target.id && slot.src === src);
    if (existingSlot >= 0) {
      const slot = frameSlots[existingSlot];
      if (slot?.loaded) {
        if (displayIndex !== activeIndex || visibleFrameSlot !== existingSlot) {
          revealSlide(activeIndex, existingSlot);
        }
      }
      return;
    }
    const preloadSlot = visibleFrameSlot === 0 ? 1 : 0;
    setFrameSlots((slots) => {
      if (slots[preloadSlot]?.itemId === target.id && slots[preloadSlot]?.src === src) return slots;
      const next: [BoardFrameSlot, BoardFrameSlot] = [...slots];
      next[preloadSlot] = { itemId: target.id, src, loaded: false };
      return next;
    });
  }, [activeIndex, displayIndex, frameSlots, items, revealSlide, visibleFrameSlot]);
  useEffect(() => {
    if (activeIndex !== displayIndex) return;
    const nextItem = items[(displayIndex + 1) % items.length];
    if (!nextItem?.href || frameSlots.some((slot) => slot?.itemId === nextItem.id)) return;
    const preloadSlot = visibleFrameSlot === 0 ? 1 : 0;
    const src = getNoticeBoardEmbedHref(nextItem.href);
    setFrameSlots((slots) => {
      const next: [BoardFrameSlot, BoardFrameSlot] = [...slots];
      next[preloadSlot] = { itemId: nextItem.id, src, loaded: false };
      return next;
    });
  }, [activeIndex, displayIndex, frameSlots, items, visibleFrameSlot]);
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      ::view-transition-group(notice-board-slide) { animation-duration: var(--notice-board-transition-duration, 1200ms); }
      ::view-transition-old(notice-board-slide) { animation: notice-board-exit-left var(--notice-board-slide-duration, 1200ms) linear both; }
      ::view-transition-new(notice-board-slide) { animation: notice-board-enter-right var(--notice-board-slide-duration, 1200ms) linear both; }
      html[data-notice-board-effect="fade"]::view-transition-old(notice-board-slide) { animation: notice-board-fade-out var(--notice-board-fade-out-duration, 1400ms) ease both; }
      html[data-notice-board-effect="fade"]::view-transition-new(notice-board-slide) { animation: notice-board-fade-in var(--notice-board-fade-in-duration, 900ms) ease-out both; }
      html[data-notice-board-direction="previous"]::view-transition-old(notice-board-slide) { animation-name: notice-board-exit-right; }
      html[data-notice-board-direction="previous"]::view-transition-new(notice-board-slide) { animation-name: notice-board-enter-left; }
      html[data-notice-board-effect="vertical-scroll"]::view-transition-old(notice-board-slide) { animation: notice-board-exit-up var(--notice-board-vertical-duration, 2800ms) linear both; }
      html[data-notice-board-effect="vertical-scroll"]::view-transition-new(notice-board-slide) { animation: notice-board-enter-bottom var(--notice-board-vertical-duration, 2800ms) linear both; }
      html[data-notice-board-direction="previous"][data-notice-board-effect="vertical-scroll"]::view-transition-old(notice-board-slide) { animation-name: notice-board-exit-down; }
      html[data-notice-board-direction="previous"][data-notice-board-effect="vertical-scroll"]::view-transition-new(notice-board-slide) { animation-name: notice-board-enter-top; }
      @keyframes notice-board-exit-left { from { transform: translateX(0); } to { transform: translateX(-100%); } }
      @keyframes notice-board-enter-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
      @keyframes notice-board-exit-right { from { transform: translateX(0); } to { transform: translateX(100%); } }
      @keyframes notice-board-enter-left { from { transform: translateX(-100%); } to { transform: translateX(0); } }
      @keyframes notice-board-exit-up { to { transform: translateY(-100%); } }
      @keyframes notice-board-enter-bottom { from { transform: translateY(100%); } to { transform: translateY(0); } }
      @keyframes notice-board-exit-down { to { transform: translateY(100%); } }
      @keyframes notice-board-enter-top { from { transform: translateY(-100%); } to { transform: translateY(0); } }
      @keyframes notice-board-fade-out { from { opacity: 1; } to { opacity: 0; } }
      @keyframes notice-board-fade-in { from { opacity: 0; } to { opacity: 1; } }
    `;
    document.head.append(style);
    return () => style.remove();
  }, []);
  useEffect(() => {
    if (!playing || items.length < 2 || activeIndex !== displayIndex) return;
    const timer = window.setTimeout(
      () => navigateBy("next"),
      rotationIntervalSeconds * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [activeIndex, displayIndex, items.length, navigateBy, playing, rotationIntervalSeconds]);
  useEffect(() => {
    if (previousIndexRef.current === displayIndex) return;
    previousIndexRef.current = displayIndex;
    const node = slideContentRef.current;
    if (!node || transitionEffect === "none" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if ((transitionEffect === "slide" || transitionEffect === "fade" || transitionEffect === "vertical-scroll") && (document as NoticeViewTransitionDocument).startViewTransition) return;
    const enteringFrom = slideDirectionRef.current === "next" ? "100%" : "-100%";
    const keyframes: Keyframe[] = transitionEffect === "fade"
      ? [{ opacity: 0 }, { opacity: 1 }]
      : transitionEffect === "vertical-scroll"
          ? [{ transform: `translateY(${slideDirectionRef.current === "next" ? "100%" : "-100%"})` }, { transform: "translateY(0)" }]
        : [{ transform: `translateX(${enteringFrom})` }, { transform: "translateX(0)" }];
    const animation = node.animate(keyframes, {
      duration: transitionEffect === "vertical-scroll"
        ? transitionDurations.noticeBoardVerticalScrollDurationMs
        : transitionEffect === "fade"
          ? transitionDurations.noticeBoardFadeInDurationMs
          : transitionDurations.noticeBoardSlideDurationMs,
      easing: transitionEffect === "vertical-scroll" ? "linear" : "cubic-bezier(0.4, 0, 0.2, 1)",
    });
    return () => animation.cancel();
  }, [displayIndex, transitionDurations, transitionEffect]);
  const handleBoardKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.closest("input, textarea, select, [role='textbox'], [role='combobox'], [contenteditable='true']")
      ) {
        return;
      }

      if (event.code === "Space" || event.key === " ") {
        if (target?.closest("button, a, summary, [role='checkbox'], [role='switch'], [role='radio']")) return;
        if (event.repeat || items.length < 2) return;
        event.preventDefault();
        setPlaying((current) => !current);
        return;
      }
      const verticalNavigation = transitionEffect === "vertical-scroll";
      const previousKey = verticalNavigation ? "ArrowUp" : "ArrowLeft";
      const nextKey = verticalNavigation ? "ArrowDown" : "ArrowRight";
      if (items.length < 2 || (event.key !== previousKey && event.key !== nextKey)) return;

      event.preventDefault();
      navigateBy(event.key === previousKey ? "previous" : "next");
    },
    [items.length, navigateBy, onClose, setPlaying, transitionEffect],
  );
  useEffect(() => {
    const slideWindow = slideFrameRefs.current[visibleFrameSlot]?.contentWindow;
    window.addEventListener("keydown", handleBoardKeyDown, true);
    slideWindow?.addEventListener("keydown", handleBoardKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleBoardKeyDown, true);
      slideWindow?.removeEventListener("keydown", handleBoardKeyDown, true);
    };
  }, [activeIndex, handleBoardKeyDown, visibleFrameSlot]);
  const activeItem = items[displayIndex];
  const activeCalendarId = getCalendarBoardId(activeItem);
  const getDisplayLabel = (item: BoardItem | undefined) =>
    item?.id === "paymentDue" && summary?.expectedCashOutgoDays !== undefined
      ? `Month-wise Payment due Matrix with ${summary.expectedCashOutgoDays} offset days`
      : item?.label;
  const days = useMemo(() => getBoardDays(activeCalendarId, summary), [activeCalendarId, summary]);
  const monthKey = chooseBoardMonth(days);
  const currentMonthKey = formatIndiaMonth();
  const nextMonthKey = getNextMonthKey(currentMonthKey);
  const showEmbeddedFrame = Boolean(activeItem?.href) && !activeCalendarId;
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
          <h2 className="text-lg font-semibold">{getDisplayLabel(activeItem) ?? "Notice Board"}</h2>
        </div>
        <div className="flex items-center gap-1">
          <label className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Timer className="size-4" aria-hidden="true" />
            Hold
            <input
              type="number"
              min={5}
              max={120}
              step={1}
              value={durationDraft}
              onChange={(event) => setDurationDraft(event.target.value)}
              onBlur={() => {
                const next = Math.min(120, Math.max(5, Number(durationDraft) || delaySeconds));
                setDurationDraft(String(next));
              }}
              aria-label="Slide duration in seconds"
              title="Choose how long each view stays before transitioning"
              className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm text-foreground tabular-nums"
            />
            sec
          </label>
          <label className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            Transition
            <select
              value={transitionEffect}
              onChange={(event) => setTransitionEffect(event.target.value as typeof transitionEffect)}
              aria-label="Notice Board transition effect"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              {noticeBoardTransitionEffects.map((effect) => (
                <option key={effect.value} value={effect.value}>{effect.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => navigateBy("previous")}
            className="grid size-9 place-items-center rounded-md hover:bg-accent"
            title="Previous display (Left Arrow)"
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
            onClick={() => navigateBy("next")}
            className="grid size-9 place-items-center rounded-md hover:bg-accent"
            title="Next display (Right Arrow)"
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
      <main ref={slideContentRef} style={{ viewTransitionName: "notice-board-slide" }} className="relative flex min-h-0 flex-1 flex-col justify-center overflow-auto py-4">
        {activeCalendarId && error ? (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        ) : activeCalendarId && !summary ? (
          <p className="text-center text-sm text-muted-foreground">Loading display data...</p>
        ) : twoMonthCalendarIds.has(activeCalendarId ?? "") ? (
          <div className="mx-auto grid w-full max-w-[1600px] grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {[currentMonthKey, nextMonthKey].map((key) => (
              <MonthlyCountCalendar
                key={key}
                monthKey={key}
                days={days}
                onClose={onClose}
                showClose={false}
              />
            ))}
            <div className="sr-only" aria-live="polite">
              {getDisplayLabel(activeItem)}, current and next month
            </div>
          </div>
        ) : activeCalendarId && days.length && monthKey ? (
          <div className="mx-auto w-full max-w-7xl">
            <MonthlyCountCalendar monthKey={monthKey} days={days} onClose={onClose} />
            <div className="sr-only" aria-live="polite">
              {getDisplayLabel(activeItem)}
            </div>
          </div>
        ) : activeItem?.href ? null : (
          <p className="text-center text-sm text-muted-foreground">
            This display has no available content.
          </p>
        )}
        <div className={`absolute inset-0 min-h-[60vh] overflow-hidden ${showEmbeddedFrame ? "visible" : "invisible pointer-events-none"}`}>
          {frameSlots.map((slot, slotIndex) => slot && (
            <iframe
              key={slot.itemId}
              ref={(element) => { slideFrameRefs.current[slotIndex] = element; }}
              src={slot.src}
              title={items.find((item) => item.id === slot.itemId)?.label ?? "Notice Board display"}
              aria-hidden={!showEmbeddedFrame || slotIndex !== visibleFrameSlot}
              tabIndex={showEmbeddedFrame && slotIndex === visibleFrameSlot ? 0 : -1}
              className={`absolute inset-0 size-full border-0 bg-background ${showEmbeddedFrame && slotIndex === visibleFrameSlot ? "visible" : "invisible pointer-events-none"}`}
              onLoad={(event) => {
                const item = items.find((candidate) => candidate.id === slot.itemId);
                setFrameSlots((slots) => {
                  const current = slots[slotIndex];
                  if (current?.itemId !== slot.itemId || current.src !== slot.src || current.loaded) return slots;
                  const next: [BoardFrameSlot, BoardFrameSlot] = [...slots];
                  next[slotIndex] = { ...current, loaded: true };
                  return next;
                });
                const focus = item?.focus?.trim().toLowerCase();
                const frameDocument = event.currentTarget.contentDocument;
                if (!focus || !frameDocument) return;
                let attempts = 0;
                const focusSection = () => {
                  const headings = Array.from(frameDocument.querySelectorAll("h1, h2, h3, h4, [role='heading']"));
                  const target = headings.find((element) =>
                    (element.textContent?.trim().toLowerCase() ?? "").includes(focus),
                  ) ?? Array.from(frameDocument.querySelectorAll("div, span"))
                    .filter((element) => (element.textContent?.trim().toLowerCase() ?? "").includes(focus))
                    .sort((left, right) => (left.textContent?.length ?? Infinity) - (right.textContent?.length ?? Infinity))[0];
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
          ))}
        </div>
      </main>
      <footer className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>{items.length ? `${displayIndex + 1} of ${items.length}` : "No displays"}</span>
        <div className="flex gap-1">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                slideDirectionRef.current = index >= activeIndex ? "next" : "previous";
                setActiveIndex(index);
              }}
              title={getDisplayLabel(item) ?? item.label}
              aria-label={`Show ${getDisplayLabel(item) ?? item.label}`}
              className={`h-1.5 w-6 rounded-full ${index === displayIndex ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
        <span>{playing ? `Holds for ${activeDelaySeconds}s` : "Paused"}</span>
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
  const rows = {
    preBidMeetings: summary.preBidMeetingDailyRows,
    monthlyFileInflow: summary.dailyFileInflow,
    supplyOrders: summary.dailySupplyOrder,
    bgExpiry: summary.dailyBgExpiry,
    paymentDue: summary.dailyPaymentDue,
    paymentCompleted: summary.dailyPaymentCompleted,
  }[id as "preBidMeetings" | "monthlyFileInflow" | "supplyOrders" | "bgExpiry" | "paymentDue" | "paymentCompleted"];
  return (rows ?? []).map((row) => ({
    date: row.date,
    metrics: [{
      label: id === "paymentDue" ? "Due" : id === "paymentCompleted" ? "Completed" : "Total",
      value: row.count,
      color: id === "paymentDue" ? "red" : id === "paymentCompleted" ? "green" : "blue",
      hideLabel: true,
    }],
  }));
}

function chooseBoardMonth(days: MonthlyCalendarDay[]) {
  if (!days.length) return "";
  const current = formatIndiaMonth();
  if (days.some((day) => day.date.startsWith(current))) return current;
  const monthKeys = [...new Set(days.map((day) => day.date.slice(0, 7)))].sort();
  return monthKeys.find((month) => month >= current) ?? monthKeys.at(-1) ?? "";
}

function getNextMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  const nextMonth = new Date(Date.UTC(year, month, 1));
  return `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}`;
}
