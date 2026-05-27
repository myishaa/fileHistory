import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  store,
  type FileRecord,
  useAccessibleDivisions,
  useAccessibleFiles,
  useSettings,
} from "@/lib/files-store";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  FileSpreadsheet,
  Filter,
  Printer,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { requestDeletionPassword } from "@/lib/delete-password";

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>) => ({
    dashboardFilter:
      typeof search.dashboardFilter === "string" ? search.dashboardFilter : undefined,
    division: typeof search.division === "string" ? search.division : undefined,
  }),
  component: SearchPage,
});

type FileKey = Exclude<keyof FileRecord, "id" | "createdAt">;

type FieldDef = {
  key: FileKey;
  label: string;
  type?: "date" | "textarea";
  options?: string[];
};

const tcecDisabledKeys: FileKey[] = [
  "highValue",
  "highValueMeetingDate",
  "highValueMinutesDate",
  "preTcecDate",
  "preTcecMinutesDate",
  "preTcecCommitteeNo",
  "ad",
  "adVettingDate",
  "postTcecDate",
  "postTcecMinutesDate",
  "postTcecCommitteeNumber",
  "refloatPostTcecDate",
  "refloatPostTcecCommitteeNo",
  "cncDate",
  "cncApprovalDate",
];

const ifaDisabledKeys: FileKey[] = ["ifa", "ifaSentDate", "ifaFinalDate"];
const gemDisabledKeys: FileKey[] = ["gemUndertakingDate", "gemSoNo"];
const rqaDisabledKeys: FileKey[] = ["rqaApprovalDate"];
const bgDisabledKeys: FileKey[] = ["bgValidityDate", "bgReturnDate"];

const yesNo = ["Yes", "No"];
const yesNoCaps = ["YES", "NO"];
const modeOptions = ["OBM", "PBM", "SBM", "LBM", "LPC"];
const paymentModeOptions = ["Online", "Offline"];
const defaultNoKeys: FileKey[] = ["dpExtension", "tenderLive", "refloat", "rst"];
type SortDirection = "asc" | "desc";

const fieldSections: { title: string; fields: FieldDef[] }[] = [
  {
    title: "File details",
    fields: [
      { key: "division", label: "Division" },
      { key: "imms", label: "IMMS Number" },
      { key: "year", label: "Year" },
      { key: "uniqueCode", label: "Unique code" },
      { key: "receivedDate", label: "Received date", type: "date" },
      { key: "scrutinyDate", label: "Scrutiny date", type: "date" },
      { key: "scrutinyResponseDate", label: "Scrutiny response date", type: "date" },
      { key: "scrutinyCompletionDate", label: "Scrutiny completion date", type: "date" },
      { key: "immsDate", label: "IMMS Date", type: "date" },
      { key: "fileNo", label: "File no" },
      { key: "indentor", label: "Indentor" },
      { key: "demandDescription", label: "Demand description", type: "textarea" },
      { key: "valueCapital", label: "Value (Capital)" },
      { key: "valueRevenue", label: "Value (Revenue)" },
      { key: "fileDetailsRemark1", label: "File details Remark-1", type: "textarea" },
      { key: "fileDetailsRemark2", label: "File details Remark-2", type: "textarea" },
    ],
  },
  {
    title: "Scrutiny and IMMS",
    fields: [
      { key: "scrutinyRemark1", label: "Scrutiny Remark-1", type: "textarea" },
      { key: "scrutinyRemark2", label: "Scrutiny Remark-2", type: "textarea" },
    ],
  },
  {
    title: "Approvals and tender",
    fields: [
      { key: "tcec", label: "TCEC (YES/NO)", options: yesNoCaps },
      { key: "mode", label: "Mode (OBM/PBM/SBM/LBM/LPC)", options: modeOptions },
      { key: "gem", label: "GeM (yes/no)", options: yesNo },
      { key: "highValue", label: "High value (Yes/No)", options: yesNo },
      { key: "ad", label: "AD (Yes/No)", options: yesNo },
      { key: "rqa", label: "R&QA (Yes/No)", options: yesNo },
      { key: "ifa", label: "IFA (Yes/No)", options: yesNo },
      { key: "bg", label: "BG (Yes/No)", options: yesNo },
      { key: "highValueMeetingDate", label: "High value meeting date", type: "date" },
      { key: "highValueMinutesDate", label: "High value minutes date", type: "date" },
      { key: "preTcecDate", label: "Pre-TCEC Date", type: "date" },
      { key: "preTcecMinutesDate", label: "Pre-TCEC minutes date", type: "date" },
      { key: "preTcecCommitteeNo", label: "Pre-TCEC Committee no." },
      { key: "tcecRemark1", label: "TCEC Remark-1", type: "textarea" },
      { key: "tcecRemark2", label: "TCEC Remark-2", type: "textarea" },
      { key: "adVettingDate", label: "AD Vetting date", type: "date" },
      { key: "rqaApprovalDate", label: "R&QA approval date", type: "date" },
      { key: "ifaSentDate", label: "IFA sent date", type: "date" },
      { key: "ifaFinalDate", label: "IFA final date", type: "date" },
      { key: "cfaDate", label: "CFA date", type: "date" },
      { key: "approvalRemark1", label: "Approval Remark-1", type: "textarea" },
      { key: "approvalRemark2", label: "Approval Remark-2", type: "textarea" },
      { key: "gemUndertakingDate", label: "GeM undertaking date", type: "date" },
      { key: "tenderLive", label: "Tender Live (Yes/No)", options: yesNo },
      { key: "bidDate", label: "Bid date", type: "date" },
      { key: "bidOpeningDate", label: "Bid opening Date", type: "date" },
      { key: "bidOpened", label: "Bid opened (YES/NO)", options: yesNoCaps },
      { key: "refloat", label: "Refloat (Yes/No)", options: yesNo },
      { key: "postTcecDate", label: "Post-TCEC date", type: "date" },
      { key: "postTcecMinutesDate", label: "Post TCEC minutes date", type: "date" },
      { key: "postTcecCommitteeNumber", label: "Post TCEC committee number" },
      { key: "refloatBiddingDate", label: "Refloat bidding date", type: "date" },
      { key: "refloatBidOpeningDate", label: "Refloat Bid opening date", type: "date" },
      { key: "refloatPostTcecDate", label: "Refloat Post-TCEC date", type: "date" },
      { key: "refloatPostTcecCommitteeNo", label: "Refloat Post-TCEC Committee no" },
      { key: "rst", label: "RST (Yes/No)", options: yesNo },
      { key: "cncDate", label: "CNC date", type: "date" },
      { key: "cncApprovalDate", label: "CNC approval date", type: "date" },
      { key: "biddingRemark1", label: "Bidding Remark-1", type: "textarea" },
      { key: "biddingRemark2", label: "Bidding Remark-2", type: "textarea" },
    ],
  },
  {
    title: "Supply order and payment",
    fields: [
      { key: "soNo", label: "S.O. No." },
      { key: "gemSoNo", label: "GeM S.O. No." },
      { key: "soDate", label: "S.O. date", type: "date" },
      { key: "soValueCapital", label: "S.O value(Capital)" },
      { key: "soValueRevenue", label: "S.O. value (Revenue)" },
      { key: "dpDate", label: "D.P. date", type: "date" },
      { key: "firm", label: "Firm" },
      { key: "bgValidityDate", label: "BG validity date", type: "date" },
      { key: "dpExtension", label: "DP extension (Yes/No)", options: yesNo },
      { key: "revisedDp", label: "Revised D.P.", type: "date" },
      { key: "materialReceiptDate", label: "Material receipt date", type: "date" },
      { key: "paymentDate", label: "Payment Date", type: "date" },
      { key: "paymentMode", label: "Payment mode(Online/Offline)", options: paymentModeOptions },
      { key: "bgReturnDate", label: "BG return date", type: "date" },
      { key: "demandCancelled", label: "Demand cancelled (Yes/No)", options: yesNo },
      { key: "soCancelled", label: "S.O. Cancelled (Yes/No)", options: yesNo },
      { key: "supplyOrderRemark1", label: "Supply order Remark-1", type: "textarea" },
      { key: "supplyOrderRemark2", label: "Supply order Remark-2", type: "textarea" },
    ],
  },
];

const editableFields = fieldSections.flatMap((section) => section.fields);

const remarkFields: { key: FileKey; label: string }[] = [
  { key: "remark1", label: "Old Remark-1" },
  { key: "remark2", label: "Old Remark-2" },
  { key: "remark3", label: "Old Remark-3" },
  { key: "remark4", label: "Old Remark-4" },
  { key: "remark5", label: "Old Remark-5" },
  { key: "remark6", label: "Old Remark-6" },
  { key: "remark7", label: "Old Remark-7" },
  { key: "remark8", label: "Old Remark-8" },
  { key: "remark9", label: "Old Remark-9" },
  { key: "fileDetailsRemark1", label: "File details Remark-1" },
  { key: "fileDetailsRemark2", label: "File details Remark-2" },
  { key: "scrutinyRemark1", label: "Scrutiny Remark-1" },
  { key: "scrutinyRemark2", label: "Scrutiny Remark-2" },
  { key: "tcecRemark1", label: "TCEC Remark-1" },
  { key: "tcecRemark2", label: "TCEC Remark-2" },
  { key: "approvalRemark1", label: "Approval Remark-1" },
  { key: "approvalRemark2", label: "Approval Remark-2" },
  { key: "biddingRemark1", label: "Bidding Remark-1" },
  { key: "biddingRemark2", label: "Bidding Remark-2" },
  { key: "supplyOrderRemark1", label: "Supply order Remark-1" },
  { key: "supplyOrderRemark2", label: "Supply order Remark-2" },
];

type PrintColumn = {
  key: string;
  label: string;
  getValue: (file: FileRecord) => string;
};

const sortCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const printColumns: PrintColumn[] = [
  ...editableFields.map((field) => ({
    key: field.key,
    label: field.label,
    getValue: (file: FileRecord) => String(file[field.key] ?? ""),
  })),
];

const printColumnGroups = [
  ...fieldSections.map((section) => ({
    title: section.title,
    columns: section.fields
      .map((field) => printColumns.find((column) => column.key === field.key))
      .filter((column): column is PrintColumn => Boolean(column)),
  })),
].filter((group) => group.columns.length > 0);

const allTableColumnKeys = printColumns.map((column) => column.key);
const TABLE_FIELDS_DEFAULT_KEY_PREFIX = "ofms.searchTableDefaultFields.v2";

function tableDefaultStorageKey(userId: string | undefined) {
  return `${TABLE_FIELDS_DEFAULT_KEY_PREFIX}.${userId || "no-active-user"}`;
}

function readDefaultTableColumnKeys(userId: string | undefined) {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(tableDefaultStorageKey(userId));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return null;
    const validKeys = new Set(printColumns.map((column) => column.key));
    const filtered = saved.filter(
      (key): key is string => typeof key === "string" && validKeys.has(key),
    );
    return filtered.length > 0 ? filtered : null;
  } catch {
    return null;
  }
}

function SearchPage() {
  const files = useAccessibleFiles();
  const divisions = useAccessibleDivisions();
  const settings = useSettings();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const divisionOptions = divisions.map((division) => division.name);
  const years = useMemo(
    () => Array.from(new Set(files.map((file) => file.year).filter(Boolean))).sort() as string[],
    [files],
  );

  const [yearFilter, setYearFilter] = useState("");
  const [imms, setImms] = useState("");
  const [immsFilled, setImmsFilled] = useState(false);
  const [indentor, setIndentor] = useState("");
  const [divisionFilter, setDivisionFilter] = useState(search.division ?? "");
  const [valueFrom, setValueFrom] = useState("");
  const [valueTo, setValueTo] = useState("");
  const [capitalOnly, setCapitalOnly] = useState(false);
  const [revenueOnly, setRevenueOnly] = useState(false);
  const [description, setDescription] = useState("");
  const [firm, setFirm] = useState("");
  const [highValue, setHighValue] = useState(false);
  const [ad, setAd] = useState(false);
  const [rqa, setRqa] = useState(false);
  const [refloat, setRefloat] = useState(false);
  const [cnc, setCnc] = useState(false);
  const [tcec, setTcec] = useState(false);
  const [tenderLive, setTenderLive] = useState(false);
  const [soNo, setSoNo] = useState("");
  const [gemSoNo, setGemSoNo] = useState("");
  const [dpFrom, setDpFrom] = useState("");
  const [dpTo, setDpTo] = useState("");
  const [dpExtension, setDpExtension] = useState(false);
  const [demandCancelledFilter, setDemandCancelledFilter] = useState(false);
  const [soCancelledFilter, setSoCancelledFilter] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [freeDate, setFreeDate] = useState("");
  const [sortColumnKey, setSortColumnKey] = useState("none");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [divisionWiseSort, setDivisionWiseSort] = useState(false);
  const [showTableOptions, setShowTableOptions] = useState(false);
  const [defaultTableColumnKeys, setDefaultTableColumnKeys] = useState<string[] | null>(() =>
    readDefaultTableColumnKeys(settings.activeUserId),
  );
  const [selectedTableColumnKeys, setSelectedTableColumnKeys] = useState<string[]>(
    () => defaultTableColumnKeys ?? allTableColumnKeys,
  );
  const selectedTableColumns = printColumns.filter((column) =>
    selectedTableColumnKeys.includes(column.key),
  );
  const sortColumns = selectedTableColumns.filter((column) => column.key !== "division");
  const activeSortColumnKey = sortColumns.some((column) => column.key === sortColumnKey)
    ? sortColumnKey
    : "none";
  const openTimeline = (file: FileRecord) => {
    navigate({ to: "/add", search: { fileId: file.id, section: "Timeline" } });
  };

  useEffect(() => {
    const userDefault = readDefaultTableColumnKeys(settings.activeUserId);
    setDefaultTableColumnKeys(userDefault);
    setSelectedTableColumnKeys(userDefault ?? allTableColumnKeys);
  }, [settings.activeUserId]);

  useEffect(() => {
    if (search.division) setDivisionFilter(search.division);
  }, [search.division]);

  const hasFilters =
    yearFilter ||
    imms ||
    immsFilled ||
    indentor ||
    divisionFilter ||
    valueFrom ||
    valueTo ||
    capitalOnly ||
    revenueOnly ||
    description ||
    firm ||
    highValue ||
    ad ||
    rqa ||
    refloat ||
    cnc ||
    tcec ||
    tenderLive ||
    soNo ||
    gemSoNo ||
    dpFrom ||
    dpTo ||
    dpExtension ||
    demandCancelledFilter ||
    soCancelledFilter ||
    freeText ||
    freeDate ||
    search.dashboardFilter;

  const results = useMemo(() => {
    const minValue = parseAmount(valueFrom);
    const maxValue = parseAmount(valueTo);

    const filtered = files.filter((file) => {
      if (yearFilter && !includesText(file.year, yearFilter)) return false;
      if (search.dashboardFilter && !matchesDashboardFilter(file, search.dashboardFilter))
        return false;
      if (imms && !includesText(file.imms, imms)) return false;
      if (immsFilled && !hasAny(file, ["imms"])) return false;
      if (indentor && !includesText(file.indentor, indentor)) return false;
      if (divisionFilter && !includesText(file.division, divisionFilter)) return false;
      if (description && !includesText(file.demandDescription, description)) return false;
      if (firm && !includesText(file.firm, firm)) return false;
      if (highValue && !isYes(file.highValue)) return false;
      if (ad && !isYes(file.ad)) return false;
      if (rqa && !isYes(file.rqa)) return false;
      if (
        refloat &&
        !isYes(file.refloat) &&
        !hasAny(file, [
          "refloatBiddingDate",
          "refloatBidOpeningDate",
          "refloatPostTcecDate",
          "refloatPostTcecCommitteeNo",
        ])
      )
        return false;
      if (cnc && !hasAny(file, ["cncDate", "cncApprovalDate"])) return false;
      if (tcec && !isTcecFile(file)) return false;
      if (tenderLive && !isYes(file.tenderLive)) return false;
      if (soNo && !includesText(file.soNo, soNo)) return false;
      if (gemSoNo && !includesText(file.gemSoNo, gemSoNo)) return false;
      if (dpExtension && !isYes(file.dpExtension)) return false;
      if (demandCancelledFilter && !isYes(file.demandCancelled)) return false;
      if (soCancelledFilter && !isYes(file.soCancelled)) return false;
      if (!matchesValueType(file, capitalOnly, revenueOnly)) return false;
      if (!matchesValueRange(file, minValue, maxValue)) return false;
      if (!matchesDateRange(file.dpDate, dpFrom, dpTo)) return false;
      if (freeText && !allSearchText(file).includes(freeText.trim().toLowerCase())) return false;
      if (
        freeDate &&
        !editableFields.some((field) => field.type === "date" && file[field.key] === freeDate)
      )
        return false;
      return true;
    });

    return sortFiles(filtered, activeSortColumnKey, divisionWiseSort, sortDirection);
  }, [
    activeSortColumnKey,
    sortDirection,
    divisionWiseSort,
    files,
    yearFilter,
    search.dashboardFilter,
    imms,
    immsFilled,
    indentor,
    divisionFilter,
    valueFrom,
    valueTo,
    capitalOnly,
    revenueOnly,
    description,
    firm,
    highValue,
    ad,
    rqa,
    refloat,
    cnc,
    tcec,
    tenderLive,
    soNo,
    gemSoNo,
    dpFrom,
    dpTo,
    dpExtension,
    demandCancelledFilter,
    soCancelledFilter,
    freeText,
    freeDate,
  ]);

  const valueTotals = useMemo(() => getValueTotals(results), [results]);
  const allValueTotals = useMemo(() => getValueTotals(files), [files]);
  const toggleTableColumn = (key: string) => {
    setSelectedTableColumnKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };
  const saveTableDefaultFields = () => {
    if (selectedTableColumnKeys.length === 0) {
      alert("Select at least one table field to save as default.");
      return;
    }
    setDefaultTableColumnKeys(selectedTableColumnKeys);
    localStorage.setItem(
      tableDefaultStorageKey(settings.activeUserId),
      JSON.stringify(selectedTableColumnKeys),
    );
  };
  const applyTableDefaultFields = () => {
    if (!defaultTableColumnKeys) {
      alert("No table field default has been saved for this user.");
      return;
    }
    setSelectedTableColumnKeys(defaultTableColumnKeys);
  };
  const clearTableDefaultFields = () => {
    setDefaultTableColumnKeys(null);
    setSelectedTableColumnKeys(allTableColumnKeys);
    localStorage.removeItem(tableDefaultStorageKey(settings.activeUserId));
  };

  const clearAll = () => {
    setYearFilter("");
    setImms("");
    setImmsFilled(false);
    setIndentor("");
    setDivisionFilter("");
    setValueFrom("");
    setValueTo("");
    setCapitalOnly(false);
    setRevenueOnly(false);
    setDescription("");
    setFirm("");
    setHighValue(false);
    setAd(false);
    setRqa(false);
    setRefloat(false);
    setCnc(false);
    setTcec(false);
    setTenderLive(false);
    setSoNo("");
    setGemSoNo("");
    setDpFrom("");
    setDpTo("");
    setDpExtension(false);
    setDemandCancelledFilter(false);
    setSoCancelledFilter(false);
    setFreeText("");
    setFreeDate("");
    setSortColumnKey("none");
    setSortDirection("asc");
    setDivisionWiseSort(false);
    if (search.dashboardFilter || search.division) {
      navigate({ to: "/search", search: {} });
    }
  };

  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Search Files</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Find records, open timelines, print file sheets, or edit file details.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border border-border bg-secondary/50 px-3 py-2">
              <span className="font-medium text-foreground">{files.length}</span> records
            </span>
            <span className="rounded-md border border-border bg-secondary/50 px-3 py-2">
              Total value:{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(allValueTotals.total)}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-md p-2.5 shadow-[var(--shadow-card)] flex min-w-0 items-center gap-2">
        <Search className="size-4 text-muted-foreground ml-2" />
        <input
          value={freeText}
          onChange={(event) => setFreeText(event.target.value)}
          placeholder="Free search"
          className="flex-1 h-10 bg-transparent outline-none text-sm"
        />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <aside className="bg-card border border-border rounded-md p-4 shadow-[var(--shadow-card)] h-fit min-w-0 space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <SlidersHorizontal className="size-4 text-muted-foreground" /> Filters
            </div>
            <button
              type="button"
              onClick={clearAll}
              disabled={!hasFilters}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground px-2 py-1 rounded-md hover:bg-accent disabled:hover:bg-transparent"
            >
              <X className="size-3.5" /> Reset filters
            </button>
          </div>

          <FilterGroup label="Year">
            <FilterInput
              value={yearFilter}
              onChange={setYearFilter}
              placeholder="All years"
              listId="year-filter-options"
            />
            <datalist id="year-filter-options">
              {years.map((year) => (
                <option key={year} value={year} />
              ))}
            </datalist>
          </FilterGroup>

          <FilterGroup label="IMMS">
            <FilterInput value={imms} onChange={setImms} placeholder="IMMS no." />
            <div className="mt-2">
              <CheckFilter label="IMMS" checked={immsFilled} onChange={setImmsFilled} />
            </div>
          </FilterGroup>

          <FilterGroup label="Indentor">
            <FilterInput value={indentor} onChange={setIndentor} placeholder="Indentor" />
          </FilterGroup>

          <FilterGroup label="Division">
            <FilterInput
              value={divisionFilter}
              onChange={setDivisionFilter}
              placeholder="All divisions"
              listId="division-filter-options"
            />
            <datalist id="division-filter-options">
              {divisionOptions.map((division) => (
                <option key={division} value={division} />
              ))}
            </datalist>
          </FilterGroup>

          <FilterGroup label="Value">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <FilterInput
                value={valueFrom}
                onChange={setValueFrom}
                placeholder="From"
                decimalOnly
              />
              <FilterInput value={valueTo} onChange={setValueTo} placeholder="To" decimalOnly />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <CheckFilter label="Capital" checked={capitalOnly} onChange={setCapitalOnly} />
              <CheckFilter label="Revenue" checked={revenueOnly} onChange={setRevenueOnly} />
            </div>
          </FilterGroup>

          <FilterGroup label="Description">
            <FilterInput
              value={description}
              onChange={setDescription}
              placeholder="Demand description"
            />
          </FilterGroup>

          <FilterGroup label="Firm">
            <FilterInput value={firm} onChange={setFirm} placeholder="Firm" />
          </FilterGroup>

          <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
            <CheckFilter label="High Value" checked={highValue} onChange={setHighValue} />
            <CheckFilter label="AD" checked={ad} onChange={setAd} />
            <CheckFilter label="R&QA" checked={rqa} onChange={setRqa} />
            <CheckFilter label="Refloat" checked={refloat} onChange={setRefloat} />
            <CheckFilter label="CNC" checked={cnc} onChange={setCnc} />
            <CheckFilter label="TCEC" checked={tcec} onChange={setTcec} />
            <CheckFilter label="Tender live" checked={tenderLive} onChange={setTenderLive} />
            <CheckFilter label="DP extension" checked={dpExtension} onChange={setDpExtension} />
          </div>

          <FilterGroup label="S.O. No.">
            <FilterInput value={soNo} onChange={setSoNo} placeholder="S.O. No." />
          </FilterGroup>

          <FilterGroup label="GeM S.O. No.">
            <FilterInput value={gemSoNo} onChange={setGemSoNo} placeholder="GeM S.O. No." />
          </FilterGroup>

          <FilterGroup label="D.P. period">
            <div className="grid grid-cols-2 gap-2">
              <FilterInput type="date" value={dpFrom} onChange={setDpFrom} />
              <FilterInput type="date" value={dpTo} onChange={setDpTo} />
            </div>
          </FilterGroup>

          <FilterGroup label="Free search date">
            <FilterInput type="date" value={freeDate} onChange={setFreeDate} />
          </FilterGroup>

          <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
            <CheckFilter
              label="Cancelled demand"
              checked={demandCancelledFilter}
              onChange={setDemandCancelledFilter}
            />
            <CheckFilter
              label="Cancelled S.O."
              checked={soCancelledFilter}
              onChange={setSoCancelledFilter}
            />
          </div>
        </aside>

        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <Filter className="size-3.5" />
                <span className="font-medium text-foreground">{results.length}</span> result
                {results.length !== 1 && "s"}
              </span>
              <span>
                Capital:{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(valueTotals.capital)}
                </span>
              </span>
              <span>
                Revenue:{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(valueTotals.revenue)}
                </span>
              </span>
              <span>
                Total value:{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(valueTotals.total)}
                </span>
              </span>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <label className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={divisionWiseSort}
                  onChange={(event) => setDivisionWiseSort(event.target.checked)}
                  className="size-4 rounded border-input"
                />
                <span>Division wise</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <span>Sort by</span>
                <select
                  value={activeSortColumnKey}
                  onChange={(event) => setSortColumnKey(event.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                >
                  <option value="none">Default</option>
                  {sortColumns.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() =>
                  setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                }
                disabled={activeSortColumnKey === "none"}
                title={
                  sortDirection === "asc"
                    ? "Switch to descending sort"
                    : "Switch to ascending sort"
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card"
              >
                {sortDirection === "asc" ? (
                  <ArrowUpAZ className="size-3.5" />
                ) : (
                  <ArrowDownAZ className="size-3.5" />
                )}
                {sortDirection === "asc" ? "Ascending" : "Descending"}
              </button>
              <button
                type="button"
                onClick={() => printSearchList(results, selectedTableColumns)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                <Printer className="size-3.5" /> Print list
              </button>
              <button
                type="button"
                onClick={() => exportSearchList(results, selectedTableColumns)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                <FileSpreadsheet className="size-3.5" /> Export Excel
              </button>
              <button
                type="button"
                onClick={() => setShowTableOptions((current) => !current)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                <SlidersHorizontal className="size-3.5" /> Table fields
              </button>
            </div>
          </div>

          {showTableOptions && (
            <div className="ml-auto w-full max-w-5xl rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Search table fields</h3>
                  <p className="text-xs text-muted-foreground">
                    Choose which columns are visible in the search results table.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedTableColumnKeys(printColumns.map((field) => field.key))
                    }
                    className="h-8 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={applyTableDefaultFields}
                    className="h-8 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
                  >
                    My default
                  </button>
                  <button
                    type="button"
                    onClick={saveTableDefaultFields}
                    className="h-8 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
                  >
                    Save default
                  </button>
                  <button
                    type="button"
                    onClick={clearTableDefaultFields}
                    className="h-8 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
                  >
                    Clear default
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedTableColumnKeys([])}
                    className="h-8 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {printColumnGroups.map((group) => (
                  <section
                    key={group.title}
                    className="rounded-md border border-border bg-secondary/20 p-3"
                  >
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.title}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {group.columns.map((column) => (
                        <label
                          key={column.key}
                          className="flex min-h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedTableColumnKeys.includes(column.key)}
                            onChange={() => toggleTableColumn(column.key)}
                            className="size-4 rounded border-input"
                          />
                          <span>{column.label}</span>
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}

          <div className="min-w-0 overflow-hidden rounded-md border border-border bg-card shadow-[var(--shadow-card)]">
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                style={{ minWidth: Math.max(820, selectedTableColumns.length * 150 + 240) }}
              >
                <thead className="bg-secondary text-xs text-muted-foreground">
                  <tr>
                    {selectedTableColumns.map((column) => (
                      <th key={column.key} className="text-left font-medium px-4 py-2.5">
                        {column.label}
                      </th>
                    ))}
                    <th className="text-right font-medium px-4 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {results.length === 0 && (
                    <tr>
                      <td
                        colSpan={selectedTableColumns.length + 1}
                        className="text-center text-sm text-muted-foreground py-10"
                      >
                        No files match your filters.
                      </td>
                    </tr>
                  )}
                  {results.map((file) => (
                    <tr
                      key={file.id}
                      onClick={() => openTimeline(file)}
                      className="border-t border-border hover:bg-secondary/50 cursor-pointer"
                    >
                      {selectedTableColumns.map((column) => (
                        <td
                          key={column.key}
                          className="px-4 py-3 text-muted-foreground max-w-[240px] truncate"
                        >
                          {column.getValue(file) || missing}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              printVisibleFile(file, selectedTableColumns);
                            }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border bg-card text-foreground hover:bg-accent"
                          >
                            <Printer className="size-3.5" /> Print
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              printFile(file);
                            }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border bg-card text-foreground hover:bg-accent"
                          >
                            <Printer className="size-3.5" /> Print timeline
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

const missing = <span className="text-muted-foreground italic">Not set</span>;

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">{label}</div>
      {children}
    </div>
  );
}

function FilterInput({
  value,
  onChange,
  placeholder,
  type = "text",
  decimalOnly = false,
  listId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  decimalOnly?: boolean;
  listId?: string;
}) {
  return (
    <input
      type={type}
      inputMode={decimalOnly ? "decimal" : undefined}
      list={listId}
      value={value}
      onChange={(event) =>
        onChange(decimalOnly ? cleanDecimalInput(event.target.value) : event.target.value)
      }
      placeholder={placeholder}
      className="w-full h-9 px-2.5 rounded-md border border-input bg-background text-sm"
    />
  );
}

function cleanDecimalInput(value: string) {
  const digitsAndDots = value.replace(/[^\d.]/g, "");
  const [first, ...rest] = digitsAndDots.split(".");
  return rest.length > 0 ? `${first}.${rest.join("")}` : first;
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full h-9 px-2.5 rounded-md border border-input bg-background text-sm"
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function CheckFilter({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md border border-border bg-background px-2.5 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 rounded border-input"
      />
      {label}
    </label>
  );
}

function EditModal({
  file,
  onClose,
  divisions,
}: {
  file: FileRecord;
  onClose: () => void;
  divisions: string[];
}) {
  const settings = useSettings();
  const [form, setForm] = useState<Record<FileKey, string>>(() => {
    const entries = editableFields.map((field) => [
      field.key,
      String(file[field.key] ?? (defaultNoKeys.includes(field.key) ? "No" : "")),
    ]);
    return applyConditionalRules({
      ...(Object.fromEntries(entries) as Record<FileKey, string>),
      year: settings.financialYear,
    });
  });

  const formWithLockedYear = { ...form, year: settings.financialYear };
  const tcecIsNo = isNo(formWithLockedYear.tcec);
  const gemIsNo = isNo(formWithLockedYear.gem);
  const rqaIsNo = isNo(formWithLockedYear.rqa);
  const bgIsNo = isNo(formWithLockedYear.bg);
  const ifaDisabled = shouldDisableIfa(formWithLockedYear);
  const update = (key: FileKey, value: string) => {
    if (key === "year") return;
    setForm((current) => applyConditionalRules({ ...current, [key]: value }));
  };

  const save = () => {
    store.updateFile(file.id, toFilePatch(applyConditionalRules(formWithLockedYear)));
    onClose();
  };

  const del = () => {
    const label = file.uniqueCode || file.imms || file.demandDescription || "this file";
    if (!requestDeletionPassword(`delete ${label}`)) return;
    store.deleteFile(file.id);
    onClose();
  };

  return (
    <ModalShell title="File details" onClose={onClose}>
      <div className="space-y-6">
        {fieldSections.map((section) => (
          <section key={section.title}>
            <h4 className="text-sm font-semibold border-b border-border pb-2 mb-4">
              {section.title}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {section.fields.map((field) => {
                const renderedField =
                  field.key === "division" ? { ...field, options: divisions } : field;
                return (
                  <EditField
                    key={field.key}
                    field={renderedField}
                    value={formWithLockedYear[field.key]}
                    disabled={
                      field.key === "year" ||
                      field.key === "tenderLive" ||
                      field.key === "bidOpened" ||
                      (tcecIsNo && tcecDisabledKeys.includes(field.key)) ||
                      (gemIsNo && gemDisabledKeys.includes(field.key)) ||
                      (rqaIsNo && rqaDisabledKeys.includes(field.key)) ||
                      (bgIsNo && bgDisabledKeys.includes(field.key)) ||
                      (ifaDisabled && ifaDisabledKeys.includes(field.key))
                    }
                    onChange={(value) => update(field.key, value)}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="mt-6 flex justify-between">
        <button onClick={del} className="text-xs text-destructive hover:underline">
          Delete file
        </button>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-md border border-border bg-card text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-[var(--shadow-elevated)] w-full max-w-6xl max-h-[90vh] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="size-7 grid place-items-center rounded-md hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto max-h-[calc(90vh-4rem)]">{children}</div>
      </div>
    </div>
  );
}

function EditField({
  field,
  value,
  disabled = false,
  onChange,
}: {
  field: FieldDef;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  if (field.options && isYesNoOptions(field.options)) {
    return (
      <div className="block">
        <div className="text-xs font-medium mb-1.5">{field.label}</div>
        <div className={`grid grid-cols-2 gap-2 ${disabledCls(disabled)}`}>
          {field.options.map((option) => (
            <label
              key={option}
              className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"
            >
              <input
                type="radio"
                name={field.key}
                checked={value === option}
                disabled={disabled}
                onChange={() => onChange(option)}
                className="size-4 border-input"
              />
              {option}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (field.options) {
    return (
      <label className="block">
        <div className="text-xs font-medium mb-1.5">{field.label}</div>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={editInputCls + disabledCls(disabled)}
        >
          <option value="">—</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <label className="block md:col-span-2 xl:col-span-3">
        <div className="text-xs font-medium mb-1.5">{field.label}</div>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={
            "w-full min-h-20 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 resize-y" +
            disabledCls(disabled)
          }
        />
      </label>
    );
  }

  return (
    <label className="block">
      <div className="text-xs font-medium mb-1.5">{field.label}</div>
      <input
        type={field.type ?? "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={editInputCls + disabledCls(disabled)}
      />
    </label>
  );
}

const editInputCls =
  "w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40";

function toFilePatch(form: Record<FileKey, string>) {
  return Object.fromEntries(
    editableFields.map((field) => [field.key, form[field.key] || undefined]),
  ) as Partial<FileRecord>;
}

function applyConditionalRules(form: Record<FileKey, string>) {
  let next = form;
  if (isNo(next.tcec)) {
    next = {
      ...next,
      highValue: "No",
      highValueMeetingDate: "",
      highValueMinutesDate: "",
      preTcecDate: "",
      preTcecMinutesDate: "",
      preTcecCommitteeNo: "",
      ad: "No",
      adVettingDate: "",
      postTcecDate: "",
      postTcecMinutesDate: "",
      postTcecCommitteeNumber: "",
      refloatPostTcecDate: "",
      refloatPostTcecCommitteeNo: "",
      cncDate: "",
      cncApprovalDate: "",
    };
  }
  if (isNo(next.gem)) {
    next = {
      ...next,
      gemUndertakingDate: "",
      gemSoNo: "",
    };
  }
  if (isNo(next.rqa)) {
    next = {
      ...next,
      rqaApprovalDate: "",
    };
  }
  if (isNo(next.bg)) {
    next = {
      ...next,
      bgValidityDate: "",
      bgReturnDate: "",
    };
  }
  next = {
    ...next,
    tenderLive: getAutoTenderLive(next),
    bidOpened: getAutoBidOpened(next),
  };
  if (shouldDisableIfa(next)) {
    next = {
      ...next,
      ifa: "",
      ifaSentDate: "",
      ifaFinalDate: "",
    };
  }
  return next;
}

function isNo(value: string | undefined) {
  return (value ?? "").trim().toLowerCase() === "no";
}

function getAutoBidOpened(form: Record<FileKey, string>) {
  const activeOpeningDate = form.refloatBidOpeningDate || form.bidOpeningDate;
  return isDateOnOrAfterToday(activeOpeningDate) ? "YES" : "NO";
}

function getAutoTenderLive(form: Record<FileKey, string>) {
  if (hasDate(form.refloatBiddingDate) && hasDate(form.refloatBidOpeningDate)) {
    return isTenderLiveOnCalendarDate(form.refloatBiddingDate, form.refloatBidOpeningDate)
      ? "Yes"
      : "No";
  }

  return isTenderLiveOnCalendarDate(form.bidDate, form.bidOpeningDate) ? "Yes" : "No";
}

function isTenderLiveOnCalendarDate(
  bidDate: string | undefined,
  bidOpeningDate: string | undefined,
) {
  const bidTime = parseLocalDateTime(bidDate ?? "");
  const openingTime = parseLocalDateTime(bidOpeningDate ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));

  if (bidTime === undefined || openingTime === undefined || todayTime === undefined) {
    return false;
  }

  return bidTime <= todayTime && todayTime <= openingTime;
}

function hasDate(date: string | undefined) {
  return parseLocalDateTime(date ?? "") !== undefined;
}

function isDateOnOrAfterToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));

  if (dateTime === undefined || todayTime === undefined) {
    return false;
  }

  return todayTime >= dateTime;
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

function shouldDisableIfa(form: Record<FileKey, string>) {
  return isNo(form.tcec) && form.mode !== "PBM";
}

function disabledCls(disabled: boolean) {
  return disabled ? " opacity-60 cursor-not-allowed" : "";
}

function isYesNoOptions(options: string[]) {
  return (
    options.length === 2 && options[0].toLowerCase() === "yes" && options[1].toLowerCase() === "no"
  );
}

function includesText(value: string | undefined, query: string) {
  return (value ?? "").toLowerCase().includes(query.trim().toLowerCase());
}

function isYes(value: string | undefined) {
  return ["yes", "y"].includes((value ?? "").trim().toLowerCase());
}

function hasAny(file: FileRecord, keys: FileKey[]) {
  return keys.some((key) => Boolean(file[key]));
}

function isFileTenderLive(file: FileRecord) {
  if (hasDate(file.refloatBiddingDate) && hasDate(file.refloatBidOpeningDate)) {
    return isTenderLiveOnCalendarDate(file.refloatBiddingDate, file.refloatBidOpeningDate);
  }

  return isTenderLiveOnCalendarDate(file.bidDate, file.bidOpeningDate);
}

function isBidOverdue(file: FileRecord) {
  const activeOpeningDate = file.refloatBidOpeningDate || file.bidOpeningDate;
  return isNo(file.bidOpened) && isDateBeforeToday(activeOpeningDate);
}

function isLiveSupplyOrder(file: FileRecord) {
  return hasAny(file, ["soDate"]) && isDateAfterToday(file.dpDate);
}

function isBgToBeReceived(file: FileRecord) {
  return isYes(file.bg) && hasAny(file, ["soDate"]) && !hasAny(file, ["bgValidityDate"]);
}

function isBgToBeReturned(file: FileRecord) {
  return (
    isYes(file.bg) &&
    hasAny(file, ["bgValidityDate"]) &&
    isDateBeforeToday(file.bgValidityDate) &&
    !hasAny(file, ["bgReturnDate"])
  );
}

function isDateBeforeToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));

  if (dateTime === undefined || todayTime === undefined) {
    return false;
  }

  return dateTime < todayTime;
}

function isDateAfterToday(date: string | undefined) {
  const dateTime = parseLocalDateTime(date ?? "");
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));

  if (dateTime === undefined || todayTime === undefined) {
    return false;
  }

  return dateTime > todayTime;
}

function matchesDashboardFilter(file: FileRecord, filter: string) {
  if (filter.startsWith("mode:")) return (file.mode ?? "").trim().toUpperCase() === filter.slice(5);
  if (filter === "totalFiles") return true;
  if (filter === "demandsControlled") return hasAny(file, ["imms"]);
  if (filter === "tcecFiles") return isYes(file.tcec);
  if (filter === "nonTcecFiles") return isNo(file.tcec);
  if (filter === "highValueFiles") return isYes(file.highValue);
  if (filter === "adYes") return isYes(file.ad);
  if (filter === "rqaVetting") return isYes(file.rqa);
  if (filter === "ifaConcurrence") return isYes(file.ifa);
  if (filter === "liveBids") return isFileTenderLive(file);
  if (filter === "bidOverdue") return isBidOverdue(file);
  if (filter === "supplyOrders") return hasAny(file, ["soDate"]);
  if (filter === "liveSupplyOrders") return isLiveSupplyOrder(file);
  if (filter === "bgToBeReceived") return isBgToBeReceived(file);
  if (filter === "bgToBeReturned") return isBgToBeReturned(file);
  if (filter === "scrutinyCompleted") return hasAny(file, ["scrutinyCompletionDate"]);
  if (filter === "scrutinyUnderProgress") return !hasAny(file, ["scrutinyDate"]);
  if (filter === "preTcecCompleted")
    return isYes(file.tcec) && hasAny(file, ["preTcecMinutesDate"]);
  if (filter === "preTcecRemaining")
    return isYes(file.tcec) && !hasAny(file, ["preTcecMinutesDate"]);
  if (filter === "highValueCompleted") return hasAny(file, ["highValueMinutesDate"]);
  if (filter === "highValueRemaining") return hasAny(file, ["highValueMeetingDate"]);
  if (filter === "adCompleted") return hasAny(file, ["adVettingDate"]);
  if (filter === "adRemaining")
    return hasAny(file, ["preTcecDate"]) && !hasAny(file, ["adVettingDate"]);
  if (filter === "rqaCompleted") return hasAny(file, ["rqaApprovalDate"]);
  if (filter === "rqaRemaining") return isYes(file.rqa) && !hasAny(file, ["rqaApprovalDate"]);
  if (filter === "ifaCompleted") return hasAny(file, ["ifaFinalDate"]);
  if (filter === "ifaRemaining") return hasAny(file, ["ifaSentDate"]);
  if (filter === "cfaCompleted") return hasAny(file, ["cfaDate"]);
  if (filter === "soCompleted") return hasAny(file, ["soNo"]);
  if (filter === "soRemaining") return !hasAny(file, ["soNo"]);
  return true;
}

function isTcecFile(file: FileRecord) {
  return (
    isYes(file.tcec) ||
    hasAny(file, ["preTcecDate", "preTcecMinutesDate", "postTcecDate", "postTcecMinutesDate"])
  );
}

function parseAmount(value: string | undefined) {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function matchesValueRange(
  file: FileRecord,
  minValue: number | undefined,
  maxValue: number | undefined,
) {
  if (minValue === undefined && maxValue === undefined) return true;
  const amounts = [parseAmount(file.valueCapital), parseAmount(file.valueRevenue)].filter(
    (amount): amount is number => amount !== undefined,
  );
  if (amounts.length === 0) return false;
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (minValue !== undefined && total < minValue) return false;
  if (maxValue !== undefined && total > maxValue) return false;
  return true;
}

function matchesValueType(file: FileRecord, capitalOnly: boolean, revenueOnly: boolean) {
  if (!capitalOnly && !revenueOnly) return true;
  const hasCapital = parseAmount(file.valueCapital) !== undefined;
  const hasRevenue = parseAmount(file.valueRevenue) !== undefined;
  if (capitalOnly && revenueOnly) return hasCapital || hasRevenue;
  if (capitalOnly) return hasCapital;
  return hasRevenue;
}

function matchesDateRange(date: string | undefined, from: string, to: string) {
  if (!from && !to) return true;
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function sortFiles(
  files: FileRecord[],
  sortColumnKey: string,
  divisionWiseSort: boolean,
  sortDirection: SortDirection,
) {
  const indexed = files.map((file, index) => ({ file, index }));
  const sorted = [...indexed].sort((a, b) => {
    if (divisionWiseSort) {
      const divisionCompare = compareSortValues(a.file.division, b.file.division);
      if (divisionCompare !== 0) return divisionCompare;
    }

    if (sortColumnKey !== "none") {
      const columnCompare = compareSortValues(
        a.file[sortColumnKey as FileKey],
        b.file[sortColumnKey as FileKey],
      );
      if (columnCompare !== 0) return sortDirection === "asc" ? columnCompare : -columnCompare;
    }

    return a.index - b.index;
  });

  return sorted.map(({ file }) => file);
}

function compareSortValues(a: string | undefined, b: string | undefined) {
  const aValue = (a ?? "").trim();
  const bValue = (b ?? "").trim();
  if (!aValue && !bValue) return 0;
  if (!aValue) return 1;
  if (!bValue) return -1;
  return sortCollator.compare(aValue, bValue);
}

function allSearchText(file: FileRecord) {
  return editableFields
    .map((field) => file[field.key])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getRecentRemarks(file: FileRecord) {
  return remarkFields
    .map((field) => ({
      label: field.label,
      value: file[field.key],
    }))
    .filter((remark): remark is { label: string; value: string } => Boolean(remark.value?.trim()))
    .slice(-2)
    .reverse();
}

function printFile(file: FileRecord) {
  const printWindow = window.open("", "_blank", "width=960,height=720");
  if (!printWindow) {
    alert("Allow pop-ups to print this file.");
    return;
  }

  const title = file.uniqueCode || file.imms || "File record";
  const sections = fieldSections
    .map(
      (section) => `
        <section>
          <h2>${escapeHtml(section.title)}</h2>
          <table>
            <tbody>
              ${section.fields
                .map((field) => {
                  const value = file[field.key];
                  return `
                    <tr>
                      <th>${escapeHtml(field.label)}</th>
                      <td>${escapeHtml(value || "Not set")}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </section>
      `,
    )
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: Arial, sans-serif;
            color: #111;
            margin: 24px;
          }
          header {
            border-bottom: 2px solid #111;
            margin-bottom: 18px;
            padding-bottom: 10px;
          }
          h1 {
            font-size: 20px;
            margin: 0 0 4px;
          }
          .subtle {
            color: #555;
            font-size: 12px;
          }
          section {
            break-inside: avoid;
            margin: 18px 0;
          }
          h2 {
            font-size: 14px;
            margin: 0 0 8px;
            padding-bottom: 4px;
            border-bottom: 1px solid #bbb;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
          }
          th, td {
            border: 1px solid #ccc;
            padding: 7px 8px;
            text-align: left;
            vertical-align: top;
          }
          th {
            width: 34%;
            background: #f3f3f3;
            font-weight: 600;
          }
          @media print {
            body { margin: 12mm; }
          }
        </style>
      </head>
      <body>
        <header>
          <h1>FileHistory File Record</h1>
          <div class="subtle">Unique code: ${escapeHtml(file.uniqueCode || "Not set")}</div>
          <div class="subtle">Printed: ${escapeHtml(new Date().toLocaleString())}</div>
        </header>
        ${sections}
        <script>
          window.onload = () => {
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function printVisibleFile(file: FileRecord, columns: PrintColumn[]) {
  if (columns.length === 0) {
    alert("Select at least one table field to print.");
    return;
  }

  const printWindow = window.open("", "_blank", "width=960,height=720");
  if (!printWindow) {
    alert("Allow pop-ups to print this file.");
    return;
  }

  const title = file.uniqueCode || file.imms || "File record";
  const rows = columns
    .map(
      (column) => `
        <tr>
          <th>${escapeHtml(column.label)}</th>
          <td>${escapeHtml(column.getValue(file) || "Not set")}</td>
        </tr>
      `,
    )
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: Arial, sans-serif;
            color: #111;
            margin: 20px;
          }
          header {
            border-bottom: 2px solid #111;
            margin-bottom: 14px;
            padding-bottom: 10px;
          }
          h1 {
            font-size: 18px;
            margin: 0 0 5px;
          }
          .subtle {
            color: #555;
            font-size: 12px;
            line-height: 1.5;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
          }
          th, td {
            border: 1px solid #bbb;
            padding: 6px 7px;
            text-align: left;
            vertical-align: top;
          }
          th {
            width: 34%;
            background: #f3f3f3;
            font-weight: 600;
          }
          @media print {
            body { margin: 10mm; }
          }
        </style>
      </head>
      <body>
        <header>
          <h1>FileHistory File Record</h1>
          <div class="subtle">Unique code: ${escapeHtml(file.uniqueCode || "Not set")}</div>
          <div class="subtle">Printed: ${escapeHtml(new Date().toLocaleString())}</div>
        </header>
        <table>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <script>
          window.onload = () => {
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function printSearchList(files: FileRecord[], columns: PrintColumn[]) {
  if (files.length === 0) {
    alert("No searched files to print.");
    return;
  }

  if (columns.length === 0) {
    alert("Select at least one table field to print.");
    return;
  }

  const printWindow = window.open("", "_blank", "width=1100,height=760");
  if (!printWindow) {
    alert("Allow pop-ups to print this list.");
    return;
  }

  const headerCells = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const rows = files
    .map(
      (file, index) => `
        <tr>
          <td>${index + 1}</td>
          ${columns
            .map((column) => `<td>${escapeHtml(column.getValue(file) || "Not set")}</td>`)
            .join("")}
        </tr>
      `,
    )
    .join("");
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Search files list</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: Arial, sans-serif;
            color: #111;
            margin: 20px;
          }
          header {
            border-bottom: 2px solid #111;
            margin-bottom: 14px;
            padding-bottom: 10px;
          }
          h1 {
            font-size: 18px;
            margin: 0 0 5px;
          }
          .subtle {
            color: #555;
            font-size: 12px;
            line-height: 1.5;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
          }
          th, td {
            border: 1px solid #bbb;
            padding: 6px 7px;
            text-align: left;
            vertical-align: top;
          }
          th {
            background: #f3f3f3;
            font-weight: 600;
          }
          @media print {
            body { margin: 10mm; }
            thead { display: table-header-group; }
            tr { break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <header>
          <h1>FileHistory Search Results</h1>
          <div class="subtle">Files: ${files.length}</div>
          <div class="subtle">Printed: ${escapeHtml(new Date().toLocaleString())}</div>
        </header>
        <table>
          <thead>
            <tr>
              <th>S.No.</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <script>
          window.onload = () => {
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function exportSearchList(files: FileRecord[], columns: PrintColumn[]) {
  if (files.length === 0) {
    alert("No searched files to export.");
    return;
  }

  if (columns.length === 0) {
    alert("Select at least one table field to export.");
    return;
  }

  const headerCells = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const rows = files
    .map(
      (file, index) => `
        <tr>
          <td>${index + 1}</td>
          ${columns
            .map((column) => `<td>${escapeHtml(column.getValue(file) || "Not set")}</td>`)
            .join("")}
        </tr>
      `,
    )
    .join("");
  const workbook = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          table { border-collapse: collapse; }
          th, td { border: 1px solid #999; padding: 6px; text-align: left; }
          th { font-weight: 700; }
        </style>
      </head>
      <body>
        <table>
          <thead>
            <tr>
              <th>S.No.</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </body>
    </html>
  `;
  const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `filehistory-search-results-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getValueTotals(files: FileRecord[]) {
  const totals = files.reduce(
    (current, file) => {
      current.capital += parseAmount(file.valueCapital) ?? 0;
      current.revenue += parseAmount(file.valueRevenue) ?? 0;
      return current;
    },
    { capital: 0, revenue: 0 },
  );
  return { ...totals, total: totals.capital + totals.revenue };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(value);
}
