import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  store,
  type FileRecord,
  type FirmDetail,
  type SupplyOrderDetail,
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
import { formatThousandsAndLakhs, getInrAmount, parseAmount } from "@/lib/money";
import { validateMilestoneCompletionConsistency } from "@/lib/milestone-validation";
import type { TableFieldPreset } from "@/lib/table-field-presets";

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>) => ({
    dashboardFilter:
      typeof search.dashboardFilter === "string" ? search.dashboardFilter : undefined,
    division: typeof search.division === "string" ? search.division : undefined,
  }),
  component: SearchPage,
});

type FileKey = Exclude<
  keyof FileRecord,
  "id" | "createdAt" | "invitedFirms" | "bidderFirms" | "supplyOrders" | "completedMilestones"
>;

type FieldDef = {
  key: FileKey;
  label: string;
  type?: "date" | "number" | "textarea";
  options?: string[];
};

const tcecDisabledKeys: FileKey[] = [
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
  "refloatPostTcecMinutesDate",
  "refloatPostTcecCommitteeNo",
  "tcecRemark1",
  "tcecRemark2",
  "cncDate",
  "cncApprovalDate",
];

const gemDisabledKeys: FileKey[] = ["gemUndertakingDate", "gemSoNo"];
const rfpVettingDisabledKeys: FileKey[] = ["rfpVettingInitiationDate", "rfpVettingApprovalDate"];
const highValueDisabledKeys: FileKey[] = ["highValueMeetingDate", "highValueMinutesDate"];
const rqaDisabledKeys: FileKey[] = ["rqaApprovalDate"];
const ifaDisabledKeys: FileKey[] = ["ifaSentDate", "ifaFinalDate"];
const bgDisabledKeys: FileKey[] = ["bgValidityDate", "bgReturnDate"];
const refloatDisabledKeys: FileKey[] = ["refloatBiddingDate", "refloatBidOpeningDate"];
const tcecCommitteeKeys: FileKey[] = [
  "preTcecCommitteeNo",
  "postTcecCommitteeNumber",
  "refloatPostTcecCommitteeNo",
];

const yesNo = ["Yes", "No"];
const yesNoCaps = ["YES", "NO"];
const modeOptions = ["OBM", "PBM", "SBM", "LBM", "LPC"];
const fileTypeOptions = ["General", "AMC", "MPC"];
const paymentModeOptions = ["Online", "Offline"];
const defaultMilestones = [
  "Scrutiny",
  "High Value",
  "Pre-TCEC",
  "AD",
  "R&QA",
  "Controlled",
  "IFA",
  "CFA",
  "Bidding",
  "Post-TCEC",
  "CNC",
  "Supply Order",
  "Delivery Period",
  "Bank Guarantee",
  "Delivery",
  "Payment",
];
const defaultNoKeys: FileKey[] = [
  "dpExtension",
  "gte",
  "rfpVetting",
  "tenderLive",
  "refloat",
  "rst",
  "biddingStageOver",
  "demandCancelled",
  "soCancelled",
];
type SortDirection = "asc" | "desc";
type SupplyOrderKey = keyof SupplyOrderDetail;
const supplyOrderKeys: FileKey[] = [
  "soNo",
  "gemSoNo",
  "soDate",
  "soValueCapital",
  "soValueRevenue",
  "dpDate",
  "firm",
  "bgValidityDate",
  "dpExtension",
  "dpExtensionCount",
  "ld",
  "revisedDp",
  "materialReceiptDate",
  "paymentDate",
  "paymentMode",
  "bgReturnDate",
  "demandCancelled",
  "soCancelled",
  "supplyOrderRemark1",
  "supplyOrderRemark2",
];

const fieldSections: { title: string; fields: FieldDef[] }[] = [
  {
    title: "File details",
    fields: [
      { key: "division", label: "Division" },
      { key: "year", label: "Year" },
      { key: "uniqueCode", label: "Unique code" },
      { key: "receivedDate", label: "Received date", type: "date" },
      { key: "scrutinyDate", label: "Scrutiny date", type: "date" },
      { key: "scrutinyResponseDate", label: "Scrutiny response date", type: "date" },
      { key: "scrutinyCompletionDate", label: "Scrutiny completion date", type: "date" },
      { key: "imms", label: "Control number" },
      { key: "immsDate", label: "Control date", type: "date" },
      { key: "fileNo", label: "File no" },
      { key: "indentor", label: "Indentor" },
      { key: "demandDescription", label: "Demand description", type: "textarea" },
      { key: "valueCapital", label: "Value (Capital)" },
      { key: "valueRevenue", label: "Value (Revenue)" },
      { key: "currency", label: "Currency" },
      { key: "exchangeRate", label: "Exchange rate", type: "number" },
      { key: "gte", label: "GTE", options: yesNo },
      { key: "mode", label: "Mode", options: modeOptions },
      { key: "fileType", label: "File type", options: fileTypeOptions },
      { key: "tcec", label: "TCEC (YES/NO)", options: yesNoCaps },
      { key: "gem", label: "GeM (yes/no)", options: yesNo },
      { key: "highValue", label: "High value (Yes/No)", options: yesNo },
      { key: "rqa", label: "R&QA (Yes/No)", options: yesNo },
      { key: "ifa", label: "IFA (Yes/No)", options: yesNo },
      { key: "psb", label: "PSB (Yes/No)", options: yesNo },
      { key: "bg", label: "BG (Yes/No)", options: yesNo },
      { key: "rfpVetting", label: "RFP vetting", options: yesNo },
      { key: "fileDetailsRemark1", label: "File details Remark-1", type: "textarea" },
      { key: "fileDetailsRemark2", label: "File details Remark-2", type: "textarea" },
    ],
  },
  {
    title: "Scrutiny and control",
    fields: [
      { key: "scrutinyRemark1", label: "Scrutiny Remark-1", type: "textarea" },
      { key: "scrutinyRemark2", label: "Scrutiny Remark-2", type: "textarea" },
    ],
  },
  {
    title: "TCEC block",
    fields: [
      { key: "preTcecDate", label: "Pre-TCEC Date", type: "date" },
      { key: "preTcecMinutesDate", label: "Pre-TCEC minutes date", type: "date" },
      { key: "preTcecCommitteeNo", label: "Pre-TCEC" },
      { key: "tcecRemark1", label: "TCEC Remark-1", type: "textarea" },
      { key: "tcecRemark2", label: "TCEC Remark-2", type: "textarea" },
      { key: "postTcecDate", label: "Post-TCEC date", type: "date" },
      { key: "postTcecMinutesDate", label: "Post-TCEC minutes date", type: "date" },
      { key: "postTcecCommitteeNumber", label: "Post-TCEC committee" },
      { key: "refloatPostTcecDate", label: "Refloat Post-TCEC date", type: "date" },
      {
        key: "refloatPostTcecMinutesDate",
        label: "Refloat Post-TCEC minutes date",
        type: "date",
      },
      { key: "refloatPostTcecCommitteeNo", label: "Refloat Post-TCEC Committee no" },
    ],
  },
  {
    title: "Approval block",
    fields: [
      { key: "ad", label: "AD (Yes/No)", options: yesNo },
      { key: "highValueMeetingDate", label: "High value meeting date", type: "date" },
      { key: "highValueMinutesDate", label: "High value minutes date", type: "date" },
      { key: "adVettingDate", label: "AD Vetting date", type: "date" },
      { key: "rqaApprovalDate", label: "R&QA approval date", type: "date" },
      { key: "ifaSentDate", label: "IFA sent date", type: "date" },
      { key: "ifaFinalDate", label: "IFA final date", type: "date" },
      { key: "cfaSentDate", label: "CFA sent date", type: "date" },
      { key: "cfaDate", label: "CFA approval date", type: "date" },
      { key: "approvalRemark1", label: "Approval Remark-1", type: "textarea" },
      { key: "approvalRemark2", label: "Approval Remark-2", type: "textarea" },
    ],
  },
  {
    title: "Bidding details",
    fields: [
      { key: "gemUndertakingDate", label: "GeM undertaking date", type: "date" },
      { key: "rfpVettingInitiationDate", label: "RFP vetting initiation", type: "date" },
      { key: "rfpVettingApprovalDate", label: "RFP vetting approval", type: "date" },
      { key: "tenderLive", label: "Tender Live (Yes/No)", options: yesNo },
      { key: "bidDate", label: "Bid date", type: "date" },
      { key: "bidOpeningDate", label: "Bid opening Date", type: "date" },
      { key: "bidOpened", label: "Bid opened (YES/NO)", options: yesNoCaps },
      { key: "refloat", label: "Refloat (Yes/No)", options: yesNo },
      { key: "refloatBiddingDate", label: "Refloat bidding date", type: "date" },
      { key: "refloatBidOpeningDate", label: "Refloat Bid opening date", type: "date" },
      { key: "rst", label: "RST (Yes/No)", options: yesNo },
      { key: "biddingStageOver", label: "Bidding stage over", options: yesNo },
      { key: "cncDate", label: "CNC date", type: "date" },
      { key: "cncApprovalDate", label: "CNC approval date", type: "date" },
      { key: "biddingRemark1", label: "Bidding Remark-1", type: "textarea" },
      { key: "biddingRemark2", label: "Bidding Remark-2", type: "textarea" },
    ],
  },
  {
    title: "Supply order and payment",
    fields: [
      { key: "noOfSo", label: "No. of S.O.", type: "number" },
      { key: "soNo", label: "S.O. No." },
      { key: "gemSoNo", label: "GeM S.O. No." },
      { key: "soDate", label: "S.O. date", type: "date" },
      { key: "soValueCapital", label: "S.O value(Capital)" },
      { key: "soValueRevenue", label: "S.O. value (Revenue)" },
      { key: "dpDate", label: "D.P. date", type: "date" },
      { key: "firm", label: "Firm" },
      { key: "bgValidityDate", label: "BG validity date", type: "date" },
      { key: "dpExtension", label: "DP extension (Yes/No)", options: yesNo },
      { key: "dpExtensionCount", label: "Extension count", type: "number" },
      { key: "ld", label: "LD", options: yesNo },
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

const firmDetailColumns: PrintColumn[] = [
  {
    key: "invitedFirms",
    label: "Invited firms",
    getValue: (file: FileRecord) => String(getFirmCount(file.invitedFirms)),
  },
  {
    key: "bidderFirms",
    label: "Bidders",
    getValue: (file: FileRecord) => String(getFirmCount(file.bidderFirms)),
  },
];

const sortCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const printColumns: PrintColumn[] = [
  ...editableFields.map((field) => ({
    key: field.key,
    label: field.label,
    getValue: (file: FileRecord) =>
      field.key === "noOfSo"
        ? getNoOfSo(file)
        : supplyOrderKeys.includes(field.key)
          ? getSupplyOrderFieldValue(file, field.key as SupplyOrderKey)
          : field.key === "valueCapital" || field.key === "valueRevenue"
            ? getFileAmountFieldValue(file, field.key)
            : field.key === "soValueCapital" || field.key === "soValueRevenue"
              ? getFileAmountFieldValue(file, field.key)
              : String(file[field.key] ?? ""),
  })),
  ...firmDetailColumns,
];

const printColumnGroups = [
  ...fieldSections.map((section) => ({
    title: section.title,
    columns: section.fields
      .map((field) => printColumns.find((column) => column.key === field.key))
      .filter((column): column is PrintColumn => Boolean(column)),
  })),
  {
    title: "Firm details",
    columns: firmDetailColumns,
  },
].filter((group) => group.columns.length > 0);

const allTableColumnKeys = printColumns.map((column) => column.key);
const manualTablePresetId = "manual";
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

function getValidTableColumnKeys(keys: string[]) {
  const validKeys = new Set(printColumns.map((column) => column.key));
  return keys.filter((key) => validKeys.has(key));
}

function sameStringList(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
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
  const [indentor, setIndentor] = useState("");
  const [divisionFilter, setDivisionFilter] = useState(search.division ?? "");
  const [valueFrom, setValueFrom] = useState("");
  const [valueTo, setValueTo] = useState("");
  const [capitalOnly, setCapitalOnly] = useState(false);
  const [revenueOnly, setRevenueOnly] = useState(false);
  const [description, setDescription] = useState("");
  const [firm, setFirm] = useState("");
  const [selectedModes, setSelectedModes] = useState<string[]>([]);
  const [selectedFileTypes, setSelectedFileTypes] = useState<string[]>([]);
  const [highValue, setHighValue] = useState(false);
  const [gte, setGte] = useState(false);
  const [ad, setAd] = useState(false);
  const [rqa, setRqa] = useState(false);
  const [ifaFilter, setIfaFilter] = useState(false);
  const [psbFilter, setPsbFilter] = useState(false);
  const [bgFilter, setBgFilter] = useState(false);
  const [rfpVettingFilter, setRfpVettingFilter] = useState(false);
  const [refloat, setRefloat] = useState(false);
  const [cnc, setCnc] = useState(false);
  const [tcec, setTcec] = useState(false);
  const [dpFrom, setDpFrom] = useState("");
  const [dpTo, setDpTo] = useState("");
  const [rstFilter, setRstFilter] = useState(false);
  const [demandCancelledFilter, setDemandCancelledFilter] = useState(false);
  const [soCancelledFilter, setSoCancelledFilter] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [freeDate, setFreeDate] = useState("");
  const [sortColumnKey, setSortColumnKey] = useState("none");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [divisionWiseSort, setDivisionWiseSort] = useState(false);
  const [showTableOptions, setShowTableOptions] = useState(false);
  const [activeTablePresetId, setActiveTablePresetId] = useState(manualTablePresetId);
  const [defaultTableColumnKeys, setDefaultTableColumnKeys] = useState<string[] | null>(() =>
    readDefaultTableColumnKeys(settings.activeUserId),
  );
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [selectedTableColumnKeys, setSelectedTableColumnKeys] = useState<string[]>(
    () => defaultTableColumnKeys ?? allTableColumnKeys,
  );
  const tableFieldPresetSignature = JSON.stringify(settings.tableFieldPresets ?? []);
  const tableFieldPresets = useMemo(() => {
    try {
      return JSON.parse(tableFieldPresetSignature) as TableFieldPreset[];
    } catch {
      return [];
    }
  }, [tableFieldPresetSignature]);
  const selectedTablePreset = tableFieldPresets.find((preset) => preset.id === activeTablePresetId);
  const manualTableFieldsSelected = activeTablePresetId === manualTablePresetId;
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
    if (activeTablePresetId === manualTablePresetId) {
      setSelectedTableColumnKeys(userDefault ?? allTableColumnKeys);
    }
  }, [activeTablePresetId, settings.activeUserId]);

  useEffect(() => {
    if (activeTablePresetId === manualTablePresetId) return;
    const preset = tableFieldPresets.find((item) => item.id === activeTablePresetId);
    if (!preset) {
      setActiveTablePresetId(manualTablePresetId);
      setSelectedTableColumnKeys(defaultTableColumnKeys ?? allTableColumnKeys);
      return;
    }
    const nextKeys = getValidTableColumnKeys(preset.fieldKeys);
    setSelectedTableColumnKeys((current) =>
      sameStringList(current, nextKeys) ? current : nextKeys,
    );
  }, [activeTablePresetId, defaultTableColumnKeys, tableFieldPresets]);

  useEffect(() => {
    if (search.division) setDivisionFilter(search.division);
  }, [search.division]);

  const hasFilters =
    yearFilter ||
    indentor ||
    divisionFilter ||
    valueFrom ||
    valueTo ||
    capitalOnly ||
    revenueOnly ||
    description ||
    firm ||
    selectedModes.length > 0 ||
    selectedFileTypes.length > 0 ||
    highValue ||
    gte ||
    ad ||
    rqa ||
    ifaFilter ||
    psbFilter ||
    bgFilter ||
    rfpVettingFilter ||
    refloat ||
    cnc ||
    tcec ||
    dpFrom ||
    dpTo ||
    rstFilter ||
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
      if (indentor && !includesText(file.indentor, indentor)) return false;
      if (divisionFilter && !includesText(file.division, divisionFilter)) return false;
      if (description && !includesText(file.demandDescription, description)) return false;
      if (firm && !fileSupplyOrders(file).some((order) => includesText(order.firm, firm)))
        return false;
      if (
        selectedModes.length > 0 &&
        !selectedModes.includes((file.mode ?? "").trim().toUpperCase())
      )
        return false;
      if (selectedFileTypes.length > 0 && !selectedFileTypes.includes((file.fileType ?? "").trim()))
        return false;
      if (highValue && !isYes(file.highValue)) return false;
      if (gte && !isYes(file.gte)) return false;
      if (ad && !isYes(file.ad)) return false;
      if (rqa && !isYes(file.rqa)) return false;
      if (ifaFilter && !isYes(file.ifa)) return false;
      if (psbFilter && !isYes(file.psb)) return false;
      if (bgFilter && !isYes(file.bg)) return false;
      if (rfpVettingFilter && !isYes(file.rfpVetting)) return false;
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
      if (rstFilter && !isYes(file.rst)) return false;
      if (
        demandCancelledFilter &&
        !fileSupplyOrders(file).some((order) => isYes(order.demandCancelled))
      )
        return false;
      if (soCancelledFilter && !fileSupplyOrders(file).some((order) => isYes(order.soCancelled)))
        return false;
      if (!matchesValueType(file, capitalOnly, revenueOnly)) return false;
      if (!matchesValueRange(file, minValue, maxValue)) return false;
      if (!fileSupplyOrders(file).some((order) => matchesDateRange(order.dpDate, dpFrom, dpTo)))
        return false;
      if (freeText && !allSearchText(file).includes(freeText.trim().toLowerCase())) return false;
      if (
        freeDate &&
        !editableFields.some((field) => {
          if (field.type !== "date") return false;
          if (supplyOrderKeys.includes(field.key)) {
            return fileSupplyOrders(file).some(
              (order) => order[field.key as SupplyOrderKey] === freeDate,
            );
          }
          return file[field.key] === freeDate;
        })
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
    indentor,
    divisionFilter,
    valueFrom,
    valueTo,
    capitalOnly,
    revenueOnly,
    description,
    firm,
    selectedModes,
    selectedFileTypes,
    highValue,
    gte,
    ad,
    rqa,
    ifaFilter,
    psbFilter,
    bgFilter,
    rfpVettingFilter,
    refloat,
    cnc,
    tcec,
    dpFrom,
    dpTo,
    rstFilter,
    demandCancelledFilter,
    soCancelledFilter,
    freeText,
    freeDate,
  ]);

  const valueTotals = useMemo(() => getValueTotals(results), [results]);
  const allValueTotals = useMemo(() => getValueTotals(files), [files]);
  const selectedResultFiles = results.filter((file) => selectedFileIds.includes(file.id));
  const allVisibleRowsSelected =
    results.length > 0 && results.every((file) => selectedFileIds.includes(file.id));
  const toggleFileSelection = (fileId: string) => {
    setSelectedFileIds((current) =>
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId],
    );
  };
  const toggleVisibleRowsSelection = () => {
    setSelectedFileIds((current) => {
      const visibleIds = results.map((file) => file.id);
      if (visibleIds.length === 0) return current;
      if (visibleIds.every((id) => current.includes(id))) {
        return current.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...current, ...visibleIds]));
    });
  };
  const toggleTableColumn = (key: string) => {
    setSelectedTableColumnKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };
  const applyTablePreset = (presetId: string) => {
    setActiveTablePresetId(presetId);
    if (presetId === manualTablePresetId) {
      setSelectedTableColumnKeys(defaultTableColumnKeys ?? allTableColumnKeys);
      return;
    }
    const preset = tableFieldPresets.find((item) => item.id === presetId);
    setSelectedTableColumnKeys(preset ? getValidTableColumnKeys(preset.fieldKeys) : []);
  };
  const toggleModeFilter = (mode: string, checked: boolean) => {
    setSelectedModes((current) =>
      checked ? Array.from(new Set([...current, mode])) : current.filter((item) => item !== mode),
    );
  };
  const toggleFileTypeFilter = (fileType: string, checked: boolean) => {
    setSelectedFileTypes((current) =>
      checked
        ? Array.from(new Set([...current, fileType]))
        : current.filter((item) => item !== fileType),
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
    setIndentor("");
    setDivisionFilter("");
    setValueFrom("");
    setValueTo("");
    setCapitalOnly(false);
    setRevenueOnly(false);
    setDescription("");
    setFirm("");
    setSelectedModes([]);
    setSelectedFileTypes([]);
    setHighValue(false);
    setGte(false);
    setAd(false);
    setRqa(false);
    setIfaFilter(false);
    setPsbFilter(false);
    setBgFilter(false);
    setRfpVettingFilter(false);
    setRefloat(false);
    setCnc(false);
    setTcec(false);
    setDpFrom("");
    setDpTo("");
    setRstFilter(false);
    setDemandCancelledFilter(false);
    setSoCancelledFilter(false);
    setFreeText("");
    setFreeDate("");
    setSortColumnKey("none");
    setSortDirection("asc");
    setDivisionWiseSort(false);
    if (search.dashboardFilter || search.division) {
      navigate({ to: "/search", search: { dashboardFilter: undefined, division: undefined } });
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
              Total INR value:{" "}
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
            <div className="flex items-center gap-2 text-sm font-bold">
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

          <FilterGroup label="Bidding mode">
            <div className="grid grid-cols-2 gap-2">
              {modeOptions.map((mode) => (
                <CheckFilter
                  key={mode}
                  label={mode}
                  checked={selectedModes.includes(mode)}
                  onChange={(checked) => toggleModeFilter(mode, checked)}
                />
              ))}
            </div>
          </FilterGroup>

          <FilterGroup label="File type">
            <div className="grid grid-cols-2 gap-2">
              {fileTypeOptions.map((fileType) => (
                <CheckFilter
                  key={fileType}
                  label={fileType}
                  checked={selectedFileTypes.includes(fileType)}
                  onChange={(checked) => toggleFileTypeFilter(fileType, checked)}
                />
              ))}
            </div>
          </FilterGroup>

          <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
            <CheckFilter label="High Value" checked={highValue} onChange={setHighValue} />
            <CheckFilter label="GTE" checked={gte} onChange={setGte} />
            <CheckFilter label="AD" checked={ad} onChange={setAd} />
            <CheckFilter label="R&QA" checked={rqa} onChange={setRqa} />
            <CheckFilter label="IFA" checked={ifaFilter} onChange={setIfaFilter} />
            <CheckFilter label="PSB" checked={psbFilter} onChange={setPsbFilter} />
            <CheckFilter label="BG" checked={bgFilter} onChange={setBgFilter} />
            <CheckFilter
              label="RFP vetting"
              checked={rfpVettingFilter}
              onChange={setRfpVettingFilter}
            />
            <CheckFilter label="Refloat" checked={refloat} onChange={setRefloat} />
            <CheckFilter label="CNC" checked={cnc} onChange={setCnc} />
            <CheckFilter label="TCEC" checked={tcec} onChange={setTcec} />
            <CheckFilter label="RST" checked={rstFilter} onChange={setRstFilter} />
          </div>

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
                Capital INR:{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(valueTotals.capital)}
                </span>
              </span>
              <span>
                Revenue INR:{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(valueTotals.revenue)}
                </span>
              </span>
              <span>
                Total INR value:{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(valueTotals.total)}
                </span>
              </span>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <label className="inline-flex items-center gap-2">
                <span>Preset fields</span>
                <select
                  value={activeTablePresetId}
                  onChange={(event) => applyTablePreset(event.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                >
                  <option value={manualTablePresetId}>Manual</option>
                  {tableFieldPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name || "Unnamed preset"}
                    </option>
                  ))}
                </select>
              </label>
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
                onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
                disabled={activeSortColumnKey === "none"}
                title={
                  sortDirection === "asc" ? "Switch to descending sort" : "Switch to ascending sort"
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
                onClick={() =>
                  printSearchList(
                    selectedResultFiles.length ? selectedResultFiles : results,
                    selectedTableColumns,
                  )
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                <Printer className="size-3.5" />{" "}
                {selectedResultFiles.length ? "Print selected" : "Print list"}
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
                disabled={!manualTableFieldsSelected}
                title={
                  manualTableFieldsSelected
                    ? "Choose manual table fields"
                    : `Using ${selectedTablePreset?.name || "preset"} fields`
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                <SlidersHorizontal className="size-3.5" /> Table fields
              </button>
            </div>
          </div>

          {showTableOptions && manualTableFieldsSelected && (
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
                style={{ minWidth: Math.max(880, selectedTableColumns.length * 150 + 280) }}
              >
                <thead className="bg-secondary text-sm text-muted-foreground">
                  <tr>
                    <th className="w-12 px-4 py-2.5 text-left">
                      <input
                        type="checkbox"
                        checked={allVisibleRowsSelected}
                        onChange={toggleVisibleRowsSelection}
                        aria-label="Select all visible files"
                        className="size-4 rounded border-input"
                      />
                    </th>
                    {selectedTableColumns.map((column) => (
                      <th key={column.key} className="text-left font-bold px-4 py-2.5">
                        {column.label}
                      </th>
                    ))}
                    <th className="text-right font-bold px-4 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {results.length === 0 && (
                    <tr>
                      <td
                        colSpan={selectedTableColumns.length + 2}
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
                      <td className="w-12 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedFileIds.includes(file.id)}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => toggleFileSelection(file.id)}
                          aria-label={`Select ${file.uniqueCode || file.imms || file.id}`}
                          className="size-4 rounded border-input"
                        />
                      </td>
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
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        {label}
      </div>
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
        onChange(decimalOnly ? formatDecimalInput(event.target.value) : event.target.value)
      }
      placeholder={placeholder}
      className="w-full h-9 px-2.5 rounded-md border border-input bg-background text-sm"
    />
  );
}

function formatDecimalInput(value: string) {
  const digitsAndDots = value.replace(/[^\d.]/g, "");
  const [first, ...rest] = digitsAndDots.split(".");
  const decimalPart = rest.join("");
  const formattedInteger = formatInputThousandsAndLakhs(first);
  return rest.length > 0 ? `${formattedInteger}.${decimalPart}` : formattedInteger;
}

function formatInputThousandsAndLakhs(integerPart: string) {
  const lastThree = integerPart.slice(-3);
  const beforeThousands = integerPart.slice(0, -3);

  if (!beforeThousands) return integerPart;

  const lastTwoBeforeThousands = beforeThousands.slice(-2);
  const lakhPart = beforeThousands.slice(0, -2);
  return [lakhPart, lastTwoBeforeThousands, lastThree].filter(Boolean).join(",");
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
      String(file[field.key] ?? getDefaultFieldValue(field.key)),
    ]);
    return applyConditionalRules({
      ...(Object.fromEntries(entries) as Record<FileKey, string>),
      year: settings.financialYear,
    });
  });

  const formWithLockedYear = { ...form, year: settings.financialYear };
  const tcecIsNo = isNo(formWithLockedYear.tcec);
  const gemIsNo = isNo(formWithLockedYear.gem);
  const highValueIsNo = isNo(formWithLockedYear.highValue);
  const rqaIsNo = isNo(formWithLockedYear.rqa);
  const ifaIsNo = isNo(formWithLockedYear.ifa);
  const bgIsNo = isNo(formWithLockedYear.bg);
  const rfpVettingIsNo = isNo(formWithLockedYear.rfpVetting);
  const refloatIsNo = isNo(formWithLockedYear.refloat);
  const update = (key: FileKey, value: string) => {
    if (key === "year") return;
    setForm((current) => {
      const patch: Partial<Record<FileKey, string>> = { [key]: value };
      if (key === "valueCapital" && hasNonZeroAmount(value)) {
        patch.valueRevenue = "";
      }
      if (key === "valueRevenue" && hasNonZeroAmount(value)) {
        patch.valueCapital = "";
      }
      if (key === "soValueCapital" && hasNonZeroAmount(value)) {
        patch.soValueRevenue = "";
      }
      if (key === "soValueRevenue" && hasNonZeroAmount(value)) {
        patch.soValueCapital = "";
      }
      if (key === "currency" && isInr(value)) {
        patch.exchangeRate = "1";
      }
      if (key === "gem" && isYes(value)) {
        patch.paymentMode = "Online";
      }
      return applyConditionalRules({ ...current, ...patch });
    });
  };

  const save = () => {
    const patch = toFilePatch(applyConditionalRules(formWithLockedYear));
    const nextFile = { ...file, ...patch };
    const milestoneErrors = validateMilestoneCompletionConsistency(
      nextFile,
      getConfiguredMilestones(settings.milestones),
    );
    if (milestoneErrors.length) {
      alert(["Please fix milestone status before saving:", ...milestoneErrors].join("\n"));
      return;
    }
    store.updateFile(file.id, patch);
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
      <p className="mb-4 text-xs text-black">Click Save to save, else data will be lost.</p>
      <div className="space-y-6">
        {fieldSections.map((section) => (
          <section key={section.title}>
            <h4 className="text-sm font-semibold border-b border-border pb-2 mb-4">
              {section.title}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {section.fields.map((field) => {
                const renderedField =
                  field.key === "division"
                    ? { ...field, options: divisions }
                    : tcecCommitteeKeys.includes(field.key)
                      ? {
                          ...field,
                          options: getTcecCommitteeOptions(
                            settings.tcecCommittees,
                            formWithLockedYear[field.key],
                          ),
                        }
                      : field;
                return (
                  <EditField
                    key={field.key}
                    field={renderedField}
                    value={formWithLockedYear[field.key]}
                    disabled={
                      field.key === "year" ||
                      field.key === "tenderLive" ||
                      (tcecIsNo && tcecDisabledKeys.includes(field.key)) ||
                      (gemIsNo && gemDisabledKeys.includes(field.key)) ||
                      (highValueIsNo && highValueDisabledKeys.includes(field.key)) ||
                      (rqaIsNo && rqaDisabledKeys.includes(field.key)) ||
                      (ifaIsNo && ifaDisabledKeys.includes(field.key)) ||
                      (bgIsNo && bgDisabledKeys.includes(field.key)) ||
                      (rfpVettingIsNo && rfpVettingDisabledKeys.includes(field.key)) ||
                      (refloatIsNo && refloatDisabledKeys.includes(field.key))
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
  const amountField = isAmountField(field.key);

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
        type={amountField ? "text" : (field.type ?? "text")}
        value={value}
        onChange={(event) =>
          onChange(amountField ? formatDecimalInput(event.target.value) : event.target.value)
        }
        disabled={disabled}
        min={field.type === "number" ? 0 : undefined}
        step={field.type === "number" ? 1 : undefined}
        inputMode={amountField ? "decimal" : undefined}
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

function getDefaultFieldValue(key: FileKey) {
  if (key === "currency") return "INR";
  return defaultNoKeys.includes(key) ? "No" : "";
}

function applyConditionalRules(form: Record<FileKey, string>) {
  let next = form;
  if (isInr(next.currency) && !next.exchangeRate) {
    next = {
      ...next,
      exchangeRate: "1",
    };
  }
  if (hasNonZeroAmount(next.valueCapital)) {
    next = {
      ...next,
      valueRevenue: "",
    };
  } else if (hasNonZeroAmount(next.valueRevenue)) {
    next = {
      ...next,
      valueCapital: "",
    };
  }
  if (hasNonZeroAmount(next.soValueCapital)) {
    next = {
      ...next,
      soValueRevenue: "",
    };
  } else if (hasNonZeroAmount(next.soValueRevenue)) {
    next = {
      ...next,
      soValueCapital: "",
    };
  }
  if (isNo(next.tcec)) {
    next = {
      ...next,
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
      refloatPostTcecMinutesDate: "",
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
  if (isNo(next.highValue)) {
    next = {
      ...next,
      highValueMeetingDate: "",
      highValueMinutesDate: "",
    };
  }
  if (isYes(next.gem) && !next.paymentMode) {
    next = {
      ...next,
      paymentMode: "Online",
    };
  }
  if (isNo(next.rqa)) {
    next = {
      ...next,
      rqaApprovalDate: "",
    };
  }
  if (isNo(next.ifa)) {
    next = {
      ...next,
      ifaSentDate: "",
      ifaFinalDate: "",
    };
  }
  if (isNo(next.bg)) {
    next = {
      ...next,
      bgValidityDate: "",
      bgReturnDate: "",
    };
  }
  if (isNo(next.rfpVetting)) {
    next = {
      ...next,
      rfpVettingInitiationDate: "",
      rfpVettingApprovalDate: "",
    };
  }
  if (isNo(next.refloat)) {
    next = {
      ...next,
      refloatBiddingDate: "",
      refloatBidOpeningDate: "",
    };
  }
  if (isYes(next.dpExtension)) {
    next = {
      ...next,
      dpExtensionCount: getInitialExtensionCount(next.dpExtensionCount),
    };
  }
  if (isNo(next.dpExtension)) {
    next = {
      ...next,
      dpExtensionCount: "",
    };
  }
  next = {
    ...next,
    tenderLive: getAutoTenderLive(next),
  };
  if (isYes(next.tenderLive)) {
    next = {
      ...next,
      bidOpened: "NO",
    };
  }
  return next;
}

function isNo(value: string | undefined) {
  return (value ?? "").trim().toLowerCase() === "no";
}

function getInitialExtensionCount(value: string | undefined) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? (value ?? "") : "1";
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

function normalizeFirmRows(rows: FirmDetail[] | undefined) {
  return (
    rows
      ?.map((row) => ({
        firmName: row.firmName?.trim() || "",
        city: row.city?.trim() || "",
        emailId: row.emailId?.trim() || "",
      }))
      .filter((row) => row.firmName || row.city || row.emailId) ?? []
  );
}

function getFirmCount(rows: FirmDetail[] | undefined) {
  return normalizeFirmRows(rows).length;
}

function getTcecCommitteeOptions(committees: string[] | undefined, currentValue: string) {
  const values = (committees ?? []).filter(Boolean);
  return currentValue && !values.includes(currentValue) ? [...values, currentValue] : values;
}

function matchesFirmCount(rows: FirmDetail[] | undefined, query: string) {
  const expected = Number.parseInt(query, 10);
  if (!Number.isFinite(expected)) return true;
  return getFirmCount(rows) === expected;
}

function isYes(value: string | undefined) {
  return ["yes", "y"].includes((value ?? "").trim().toLowerCase());
}

function isInr(value: string | undefined) {
  return (value ?? "").trim().toUpperCase() === "INR";
}

function hasNonZeroAmount(value: string | undefined) {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return false;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount !== 0;
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
    paymentDate: file.paymentDate,
    paymentMode: file.paymentMode,
    bgReturnDate: file.bgReturnDate,
    demandCancelled: file.demandCancelled,
    soCancelled: file.soCancelled,
    supplyOrderRemark1: file.supplyOrderRemark1,
    supplyOrderRemark2: file.supplyOrderRemark2,
  };
  return Object.values(legacy).some((value) => Boolean(String(value ?? "").trim())) ? [legacy] : [];
}

function getNoOfSo(file: FileRecord) {
  return String(fileSupplyOrders(file).filter(hasSupplyOrderDate).length);
}

function hasSupplyOrderDate(order: SupplyOrderDetail) {
  return hasFilledString(order.soDate);
}

function getSupplyOrderFieldValue(file: FileRecord, key: SupplyOrderKey) {
  const rows = fileSupplyOrders(file);
  return rows
    .map((order, index) => {
      const value =
        key === "soValueCapital" || key === "soValueRevenue"
          ? getSupplyOrderAmountFieldValue(order, key)
          : String(order[key] ?? "");
      if (!value.trim()) return "";
      return rows.length > 1 ? `${index + 1}. ${value}` : value;
    })
    .filter(Boolean)
    .join("; ");
}

function hasAny(file: FileRecord, keys: FileKey[]) {
  return keys.some((key) =>
    supplyOrderKeys.includes(key)
      ? fileSupplyOrders(file).some((order) => Boolean(order[key as SupplyOrderKey]))
      : Boolean(file[key]),
  );
}

const milestoneDefinitions = [
  {
    key: "scrutiny",
    previous: "receivedDate",
    reviewed: "scrutinyDate",
    current: "scrutinyCompletionDate",
  },
  {
    key: "highValue",
    previous: "scrutinyCompletionDate",
    reviewed: "highValueMeetingDate",
    current: "highValueMinutesDate",
    applies: (file) => isYes(file.highValue),
  },
  {
    key: "tcec",
    previous: "highValueMinutesDate",
    reviewed: "preTcecDate",
    current: "preTcecMinutesDate",
    applies: (file) => isYes(file.tcec),
  },
  {
    key: "ad",
    previous: "preTcecMinutesDate",
    current: "adVettingDate",
    applies: (file) => isYes(file.ad),
  },
  {
    key: "rqa",
    previous: "adVettingDate",
    current: "rqaApprovalDate",
    applies: (file) => isYes(file.rqa),
  },
  { key: "control", previous: "rqaApprovalDate", current: "immsDate" },
  {
    key: "ifa",
    previous: "immsDate",
    reviewed: "ifaSentDate",
    current: "ifaFinalDate",
    applies: (file) => isYes(file.ifa),
  },
  { key: "cfa", previous: "ifaFinalDate", reviewed: "cfaSentDate", current: "cfaDate" },
  { key: "bidding", previous: "cfaDate", current: "biddingStageOver" },
  {
    key: "postTcec",
    previous: "biddingStageOver",
    reviewed: "postTcecDate",
    current: "postTcecMinutesDate",
    applies: (file) => isYes(file.tcec),
  },
  {
    key: "cnc",
    previous: "postTcecMinutesDate",
    reviewed: "cncDate",
    current: "cncApprovalDate",
    applies: (file) => isYes(file.tcec),
  },
  { key: "supplyOrder", previous: "postTcecMinutesDate", current: "soDate" },
  {
    key: "bankGuarantee",
    previous: "soDate",
    current: "bgValidityDate",
    applies: (file) => isYes(file.bg),
  },
  { key: "payment", previous: "bgValidityDate", current: "paymentDate" },
] satisfies Array<{
  key: string;
  previous: FileKey | SupplyOrderKey;
  reviewed?: FileKey | SupplyOrderKey;
  current: FileKey | SupplyOrderKey;
  applies?: (file: FileRecord) => boolean;
}>;

function getConfiguredMilestones(milestones: string[] | undefined) {
  const values = (milestones ?? []).map((item) => item.trim()).filter(Boolean);
  return values.length ? values : defaultMilestones;
}

function isPendingMilestone(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (milestone.reviewed) {
    return (
      isManualActiveMilestone(file, milestone) &&
      !hasMilestoneDate(file, milestone.reviewed) &&
      !isMilestoneComplete(file, milestone)
    );
  }

  return isManualActiveMilestone(file, milestone) && !isMilestoneComplete(file, milestone);
}

function isClearedMilestone(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  return isEligibleMilestone(file, milestone) && isMilestoneComplete(file, milestone);
}

function isEligibleMilestone(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  return (
    isMilestoneApplicable(file, milestone) && isPreviousApplicableMilestoneComplete(file, milestone)
  );
}

function isMilestoneApplicable(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  return milestone.applies ? milestone.applies(file) : true;
}

function isPreviousApplicableMilestoneComplete(
  file: FileRecord,
  milestone: (typeof milestoneDefinitions)[number],
) {
  if (milestone.key === "bankGuarantee") {
    return isSupplyOrderPlaced(file);
  }

  let previousMilestone: (typeof milestoneDefinitions)[number] | undefined;
  for (const item of milestoneDefinitions) {
    if (item.key === milestone.key) break;
    if (isMilestoneApplicable(file, item)) {
      previousMilestone = item;
    }
  }
  return previousMilestone
    ? isMilestoneComplete(file, previousMilestone)
    : hasMilestoneDate(file, "receivedDate");
}

function isMilestoneComplete(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (milestone.key === "bidding") {
    return isYes(file.biddingStageOver);
  }
  return hasMilestoneDate(file, milestone.current);
}

function isMilestoneReviewed(file: FileRecord, milestone: (typeof milestoneDefinitions)[number]) {
  if (!milestone.reviewed) return false;
  return (
    isManualActiveMilestone(file, milestone) &&
    hasMilestoneDate(file, milestone.reviewed) &&
    !isMilestoneComplete(file, milestone)
  );
}

function isManualActiveMilestone(
  file: FileRecord,
  milestone: (typeof milestoneDefinitions)[number],
) {
  const current = normalizeMilestoneName(file.currentMilestone);
  return getMilestoneLabelAliases(milestone.key).some(
    (label) => current === normalizeMilestoneName(label),
  );
}

function getMilestoneLabelAliases(key: string) {
  const labels: Record<string, string> = {
    scrutiny: "Scrutiny",
    highValue: "High Value",
    tcec: "Pre-TCEC",
    ad: "AD",
    rqa: "R&QA",
    control: "Controlling",
    ifa: "IFA",
    cfa: "CFA",
    bidding: "Bidding",
    postTcec: "Post-TCEC",
    cnc: "CNC",
    supplyOrder: "Supply Order",
    bankGuarantee: "Bank Guarantee",
    payment: "Payment",
  };
  return key === "control" ? [labels[key], "Controlled"] : [labels[key] ?? key];
}

function normalizeMilestoneName(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function hasMilestoneDate(file: FileRecord, key: FileKey | SupplyOrderKey) {
  return supplyOrderDateKeys.has(key as SupplyOrderKey)
    ? fileSupplyOrders(file).some((order) => hasFilledString(order[key as SupplyOrderKey]))
    : hasFilledString(file[key as FileKey]);
}

const supplyOrderDateKeys = new Set<SupplyOrderKey>(["soDate", "bgValidityDate", "paymentDate"]);

function hasFilledString(value: string | undefined) {
  return Boolean(value?.trim());
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

function isLiveSupplyOrder(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) =>
      hasSupplyOrderDate(order) &&
      !hasFilledString(order.materialReceiptDate) &&
      !isYes(order.soCancelled),
  );
}

function isBgToBeReceived(file: FileRecord) {
  return isYes(file.bg) && hasAny(file, ["soDate"]) && !hasAny(file, ["bgValidityDate"]);
}

function isBgToBeReturned(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) =>
      isYes(file.bg) &&
      Boolean(order.bgValidityDate) &&
      isDateBeforeToday(order.bgValidityDate) &&
      !order.bgReturnDate,
  );
}

function isDpExpired(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) => isDateBeforeToday(order.dpDate) && !order.revisedDp,
  );
}

function isDeliveryOverdue(file: FileRecord) {
  return fileSupplyOrders(file).some((order) => {
    const deliveryDate = order.revisedDp || order.dpDate;
    return isDateBeforeToday(deliveryDate);
  });
}

function isDeliveryCompleted(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isCompletedDeliveryOrder);
}

function isDeliveryDue(file: FileRecord) {
  return isDeliveryActive(file) && fileSupplyOrders(file).some(isDueDeliveryOrder);
}

function isDeliveryActive(file: FileRecord) {
  return isSupplyOrderPlaced(file);
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

function getDeliveryDueDate(order: SupplyOrderDetail) {
  return hasFilledString(order.revisedDp) ? order.revisedDp : order.dpDate;
}

function isDeliveryPeriodValid(file: FileRecord) {
  return isDeliveryPeriodActive(file) && fileSupplyOrders(file).some(isValidDeliveryPeriodOrder);
}

function isDeliveryPeriodExpired(file: FileRecord) {
  return isDeliveryPeriodActive(file) && fileSupplyOrders(file).some(isExpiredDeliveryPeriodOrder);
}

function isDeliveryPeriodExtended(file: FileRecord) {
  return isDeliveryPeriodActive(file) && fileSupplyOrders(file).some(isExtendedDeliveryPeriodOrder);
}

function isDeliveryPeriodActive(file: FileRecord) {
  return isSupplyOrderPlaced(file);
}

function isSupplyOrderPlaced(file: FileRecord) {
  const supplyOrderMilestone = milestoneDefinitions.find(
    (milestone) => milestone.key === "supplyOrder",
  );
  return supplyOrderMilestone ? isMilestoneComplete(file, supplyOrderMilestone) : false;
}

function isBankGuaranteeEligible(file: FileRecord) {
  return (
    isYes(file.bg) &&
    fileSupplyOrders(file).some((order) => hasSupplyOrderDate(order) && !isYes(order.soCancelled))
  );
}

function isValidDeliveryPeriodOrder(order: SupplyOrderDetail) {
  return (
    hasSupplyOrderDate(order) &&
    !hasFilledString(order.revisedDp) &&
    isDateAfterToday(order.dpDate) &&
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
  return (
    hasSupplyOrderDate(order) &&
    hasFilledString(order.revisedDp) &&
    isDateAfterToday(order.revisedDp) &&
    !hasFilledString(order.materialReceiptDate)
  );
}

function getDeliveryPeriodDate(order: SupplyOrderDetail) {
  return hasFilledString(order.revisedDp) ? order.revisedDp : order.dpDate;
}

function isPaymentDue(file: FileRecord) {
  return fileSupplyOrders(file).some(
    (order) => Boolean(order.materialReceiptDate) && !order.paymentDate,
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
  if (filter.startsWith("attribute:")) {
    const [, key, value] = filter.split(":");
    const fieldValue = String(file[key as keyof FileRecord] ?? "");
    if (value === "yes") return isYes(fieldValue);
    if (value === "no") return isNo(fieldValue);
  }
  if (filter.startsWith("mode:")) return (file.mode ?? "").trim().toUpperCase() === filter.slice(5);
  if (filter.startsWith("fileType:")) return (file.fileType ?? "").trim() === filter.slice(9);
  if (filter.startsWith("manualMilestoneCurrent:")) {
    return file.currentMilestone === filter.slice("manualMilestoneCurrent:".length);
  }
  if (filter.startsWith("manualMilestoneCompleted:")) {
    return Boolean(
      file.completedMilestones?.includes(filter.slice("manualMilestoneCompleted:".length)),
    );
  }
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
  if (filter === "dpExtension") return isYes(file.dpExtension);
  if (filter === "dpExpired") return isDpExpired(file);
  if (filter === "deliveryOverdue") return isDeliveryOverdue(file);
  if (filter === "deliveryCompleted") return isDeliveryCompleted(file);
  if (filter === "deliveryDue") return isDeliveryDue(file);
  if (filter === "deliveryPeriodValid") return isDeliveryPeriodValid(file);
  if (filter === "deliveryPeriodExpired") return isDeliveryPeriodExpired(file);
  if (filter === "deliveryPeriodExtended") return isDeliveryPeriodExtended(file);
  if (filter === "paymentDue") return isPaymentDue(file);
  if (filter === "miscLd") return fileSupplyOrders(file).some((order) => isYes(order.ld));
  if (filter === "miscDemandCancelled") {
    return fileSupplyOrders(file).some((order) => isYes(order.demandCancelled));
  }
  if (filter === "miscSoCancelled") {
    return fileSupplyOrders(file).some((order) => isYes(order.soCancelled));
  }
  if (filter === "miscMultipleSupplyOrders") return fileSupplyOrders(file).length > 1;
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
  if (filter.startsWith("milestoneTotal:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(15));
    if (!milestone) return true;
    return milestone.key === "bankGuarantee"
      ? isBankGuaranteeEligible(file)
      : isMilestoneApplicable(file, milestone);
  }
  if (filter.startsWith("milestoneUnderProcess:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(22));
    return milestone
      ? isMilestoneApplicable(file, milestone) && !isEligibleMilestone(file, milestone)
      : true;
  }
  if (filter.startsWith("milestoneActive:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(16));
    if (!milestone) return true;
    if (milestone.key === "bidding") {
      return isManualActiveMilestone(file, milestone) && !isFileTenderLive(file);
    }
    return isManualActiveMilestone(file, milestone);
  }
  if (filter.startsWith("milestone:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(10));
    return milestone ? isPendingMilestone(file, milestone) : true;
  }
  if (filter.startsWith("milestoneReviewed:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(18));
    return milestone ? isMilestoneReviewed(file, milestone) : true;
  }
  if (filter.startsWith("milestonePending:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(17));
    return milestone ? isPendingMilestone(file, milestone) : true;
  }
  if (filter.startsWith("milestoneCleared:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(17));
    if (!milestone) return true;
    return milestone.key === "bankGuarantee"
      ? isBankGuaranteeEligible(file) && hasMilestoneDate(file, milestone.current)
      : isClearedMilestone(file, milestone);
  }
  if (filter.startsWith("milestoneEligible:")) {
    const milestone = milestoneDefinitions.find((item) => item.key === filter.slice(18));
    return milestone ? isEligibleMilestone(file, milestone) : true;
  }
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

function formatAmountValue(value: string | undefined) {
  const amount = parseAmount(value);
  if (amount === undefined) return value ?? "";
  return formatThousandsAndLakhs(amount);
}

function getFileAmountFieldValue(
  file: FileRecord,
  key: "valueCapital" | "valueRevenue" | "soValueCapital" | "soValueRevenue",
) {
  const pairedKey = getPairedAmountKey(key);
  if (!hasNonZeroAmount(file[key]) && hasNonZeroAmount(file[pairedKey])) return "-";
  return key === "valueCapital" || key === "valueRevenue"
    ? formatInrAmountValue(file[key], file)
    : formatAmountValue(file[key]);
}

function getSupplyOrderAmountFieldValue(
  order: SupplyOrderDetail,
  key: "soValueCapital" | "soValueRevenue",
) {
  const pairedKey = key === "soValueCapital" ? "soValueRevenue" : "soValueCapital";
  if (!hasNonZeroAmount(order[key]) && hasNonZeroAmount(order[pairedKey])) return "-";
  return formatAmountValue(order[key]);
}

function getPairedAmountKey(
  key: "valueCapital" | "valueRevenue" | "soValueCapital" | "soValueRevenue",
): "valueCapital" | "valueRevenue" | "soValueCapital" | "soValueRevenue" {
  if (key === "valueCapital") return "valueRevenue";
  if (key === "valueRevenue") return "valueCapital";
  if (key === "soValueCapital") return "soValueRevenue";
  return "soValueCapital";
}

function formatInrAmountValue(value: string | undefined, file: FileRecord) {
  const amount = getInrAmount(value, file);
  if (amount === undefined) return "";
  return formatThousandsAndLakhs(amount);
}

function isAmountField(key: string) {
  return [
    "valueCapital",
    "valueRevenue",
    "soValueCapital",
    "soValueRevenue",
    "exchangeRate",
  ].includes(key);
}

function matchesValueRange(
  file: FileRecord,
  minValue: number | undefined,
  maxValue: number | undefined,
) {
  if (minValue === undefined && maxValue === undefined) return true;
  const amounts = [
    getInrAmount(file.valueCapital, file),
    getInrAmount(file.valueRevenue, file),
  ].filter((amount): amount is number => amount !== undefined);
  if (amounts.length === 0) return false;
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (minValue !== undefined && total < minValue) return false;
  if (maxValue !== undefined && total > maxValue) return false;
  return true;
}

function matchesValueType(file: FileRecord, capitalOnly: boolean, revenueOnly: boolean) {
  if (!capitalOnly && !revenueOnly) return true;
  const hasCapital = hasNonZeroAmount(file.valueCapital);
  const hasRevenue = hasNonZeroAmount(file.valueRevenue);
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
        getSortColumnValue(a.file, sortColumnKey),
        getSortColumnValue(b.file, sortColumnKey),
      );
      if (columnCompare !== 0) return sortDirection === "asc" ? columnCompare : -columnCompare;
    }

    return a.index - b.index;
  });

  return sorted.map(({ file }) => file);
}

function getSortColumnValue(file: FileRecord, key: string) {
  const column = printColumns.find((item) => item.key === key);
  if (column) return column.getValue(file);
  const fileKey = key as FileKey;
  return supplyOrderKeys.includes(fileKey)
    ? getSupplyOrderFieldValue(file, fileKey as SupplyOrderKey)
    : file[fileKey];
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
  const directText = editableFields
    .map((field) =>
      supplyOrderKeys.includes(field.key)
        ? getSupplyOrderFieldValue(file, field.key as SupplyOrderKey)
        : file[field.key],
    )
    .filter(Boolean)
    .join(" ");
  const supplyOrderText = fileSupplyOrders(file)
    .flatMap((order) => Object.values(order))
    .filter(Boolean)
    .join(" ");
  const firmText = [getFirmCount(file.invitedFirms), getFirmCount(file.bidderFirms)].join(" ");
  return `${directText} ${supplyOrderText} ${firmText}`.toLowerCase();
}

function getRecentRemarks(file: FileRecord) {
  return remarkFields
    .map((field) => ({
      label: field.label,
      value: supplyOrderKeys.includes(field.key)
        ? getSupplyOrderFieldValue(file, field.key as SupplyOrderKey)
        : file[field.key],
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
                  const value = printColumns
                    .find((column) => column.key === field.key)
                    ?.getValue(file);
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
      current.capital += getInrAmount(file.valueCapital, file) ?? 0;
      current.revenue += getInrAmount(file.valueRevenue, file) ?? 0;
      return current;
    },
    { capital: 0, revenue: 0 },
  );
  return { ...totals, total: totals.capital + totals.revenue };
}

function formatCurrency(value: number) {
  return formatThousandsAndLakhs(value);
}
