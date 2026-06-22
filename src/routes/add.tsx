import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchFile,
  fetchNextUniqueCode,
  fetchIndentors,
  store,
  type Division,
  type FileMessage,
  type FileRecord,
  type FileRemark,
  type FirmDetail,
  type SupplyOrderDetail,
  type ValueThresholdLevel,
  useAccessibleDivisions,
  useActiveUser,
  useDivisions,
  useMessages,
  useSettings,
} from "@/lib/files-store";
import { MessageSquare, Save, Eraser, Lock, Plus, Printer, Trash2, Unlock } from "lucide-react";
import { promptDeletionPassword } from "@/lib/delete-password";
import { downloadBackendExport, getExportFileName } from "@/lib/export-download";
import { validateMilestoneCompletionConsistency } from "@/lib/milestone-validation";
import { displayFinancialYearLabel } from "@/lib/year-filter";

export const Route = createFileRoute("/add")({
  validateSearch: (search: Record<string, unknown>) => ({
    fileId: typeof search.fileId === "string" ? search.fileId : undefined,
    section: typeof search.section === "string" ? search.section : undefined,
    quickFocus: search.quickFocus === true || search.quickFocus === "true",
  }),
  component: AddFilePage,
});

const empty = {
  title: "",
  division: "",
  officer: "",
  imms: "",
  date: "",
  year: "",
  uniqueCode: "",
  receivedDate: "",
  scrutinyDate: "",
  scrutinyResponseDate: "",
  scrutinyCompletionDate: "",
  immsDate: "",
  fileNo: "",
  indentor: "",
  demandDescription: "",
  valueCapital: "",
  valueRevenue: "",
  currency: "INR",
  exchangeRate: "1",
  gte: "No",
  valueCapitalSelected: "",
  valueRevenueSelected: "",
  tcec: "",
  mode: "",
  gem: "",
  highValue: "",
  ad: "",
  rqa: "",
  ifa: "",
  psb: "",
  bg: "",
  rfpVetting: "No",
  highValueMeetingDate: "",
  highValueMinutesDate: "",
  preTcecDate: "",
  preTcecMinutesDate: "",
  preTcecCommitteeNo: "",
  adVettingDate: "",
  rqaApprovalDate: "",
  ifaSentDate: "",
  ifaFinalDate: "",
  cfaSentDate: "",
  cfaDate: "",
  gemUndertakingDate: "",
  rfpVettingInitiationDate: "",
  rfpVettingApprovalDate: "",
  tenderLive: "No",
  bidNumber: "",
  bidDate: "",
  bidOpeningDate: "",
  bidOpened: "",
  refloat: "No",
  postTcecDate: "",
  postTcecMinutesDate: "",
  postTcecCommitteeNumber: "",
  refloatBiddingDate: "",
  refloatBidOpeningDate: "",
  rst: "No",
  biddingStageOver: "No",
  cncDate: "",
  cncApprovalDate: "",
  noOfSo: "1",
  soNo: "",
  gemSoNo: "",
  soDate: "",
  soValueCapital: "",
  soValueRevenue: "",
  dpDate: "",
  firm: "",
  bgValidityDate: "",
  dpExtension: "No",
  dpExtensionCount: "",
  ld: "No",
  revisedDp: "",
  materialReceiptDate: "",
  irPreparationDate: "",
  irReceiptDate: "",
  billPreparationDate: "",
  billSentForPaymentDate: "",
  paymentDate: "",
  paymentMode: "",
  bgReturnDate: "",
  demandCancelled: "No",
  soCancelled: "No",
  soCancelledDate: "",
};

const defaultMilestones = [
  "Scrutiny",
  "High Value",
  "Pre-TCEC",
  "AD",
  "R&QA",
  "Controlling",
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
  "File Closed",
];
const fileClosedMilestone = "File Closed";

type FormState = typeof empty;
type FieldKey = keyof FormState;
type SupplyOrderKey = keyof SupplyOrderDetail;

function createEmptyForm(financialYear: string): FormState {
  return { ...empty, year: financialYear };
}

const formKeys = Object.keys(empty) as FieldKey[];

function createFormFromFile(file: FileRecord, financialYear: string): FormState {
  const supplyOrderCount = normalizeSupplyOrderRows(file).length;
  return {
    ...createEmptyForm(financialYear),
    ...Object.fromEntries(
      formKeys.map((key) => [key, String((file as Record<string, unknown>)[key] ?? empty[key])]),
    ),
    valueCapitalSelected: hasNonZeroAmount(file.valueCapital) ? "Yes" : "",
    valueRevenueSelected: hasNonZeroAmount(file.valueRevenue) ? "Yes" : "",
    noOfSo: file.noOfSo ?? String(supplyOrderCount),
    year: file.year ?? financialYear,
  } as FormState;
}

function createFirmDetailsFromFile(file: FileRecord | undefined): FirmDetailsState {
  return {
    invitedFirms: normalizeFirmRows(file?.invitedFirms),
    bidderFirms: normalizeFirmRows(file?.bidderFirms),
  };
}

function normalizeCompletedMilestones(value: string[] | undefined) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeActiveYears(file: FileRecord | undefined, financialYear: string) {
  const years = file?.activeYears?.length ? file.activeYears : [file?.year ?? financialYear];
  return Array.from(new Set(years.filter(Boolean)));
}

function getLatestTwoYears(financialYear: string, financialYears: string[]) {
  return Array.from(new Set([financialYear, ...financialYears].filter(Boolean)))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 2);
}

function normalizeSelectableActiveYears(
  years: string[],
  options: string[],
  fallbackYear: string,
  locked: boolean,
) {
  if (locked) return [fallbackYear].filter(Boolean);
  const allowed = new Set(options);
  const selected = years.filter((year) => allowed.has(year));
  return selected.length ? [selected[0]] : [fallbackYear].filter(Boolean);
}

function getAutoCompletedMilestones(
  milestones: string[],
  applicableMilestones: Set<string>,
  form: FormState,
) {
  if (!isYes(form.biddingStageOver)) return [];
  const biddingMilestone = milestones.find(
    (milestone) =>
      normalizeMilestoneName(milestone) === "bidding" && applicableMilestones.has(milestone),
  );
  return biddingMilestone ? [biddingMilestone] : [];
}

function getCompletedMilestonesForSave(
  milestones: string[],
  applicableMilestones: Set<string>,
  completedMilestones: string[],
  form: FormState,
) {
  const autoCompleted = getAutoCompletedMilestones(milestones, applicableMilestones, form);
  const completedSet = new Set([...completedMilestones, ...autoCompleted]);
  return milestones.filter((milestone) => completedSet.has(milestone));
}

function createSupplyOrdersFromFile(file: FileRecord | undefined): SupplyOrderDetail[] {
  const rows = normalizeSupplyOrderRows(file);
  if (!file) return resizeSupplyOrders(rows, clampSupplyOrderCount(empty.noOfSo));
  const count = clampSupplyOrderCount(file?.noOfSo ?? String(rows.length));
  return resizeSupplyOrders(rows, count);
}

function normalizeFirmRows(rows: FirmDetail[] | undefined): Required<FirmDetail>[] {
  const normalized =
    rows
      ?.map((row) => ({
        firmName: row.firmName ?? "",
        city: row.city ?? "",
        emailId: row.emailId ?? "",
      }))
      .filter((row) => row.firmName || row.city || row.emailId) ?? [];
  return normalized;
}

type ExtraField = {
  key: FieldKey;
  label: string;
  type?: "date" | "number" | "textarea";
  options?: string[];
  placeholder?: string;
  typeahead?: boolean;
};

const tcecDisabledKeys: FieldKey[] = [
  "highValueMeetingDate",
  "highValueMinutesDate",
  "preTcecDate",
  "preTcecMinutesDate",
  "preTcecCommitteeNo",
  "adVettingDate",
  "postTcecDate",
  "postTcecMinutesDate",
  "postTcecCommitteeNumber",
  "cncDate",
  "cncApprovalDate",
];

const gemDisabledKeys: FieldKey[] = ["gemUndertakingDate", "gemSoNo"];
const rfpVettingDisabledKeys: FieldKey[] = ["rfpVettingInitiationDate", "rfpVettingApprovalDate"];
const highValueDisabledKeys: FieldKey[] = ["highValueMeetingDate", "highValueMinutesDate"];
const rqaDisabledKeys: FieldKey[] = ["rqaApprovalDate"];
const ifaDisabledKeys: FieldKey[] = ["ifaSentDate", "ifaFinalDate"];
const bgDisabledKeys: FieldKey[] = ["bgValidityDate", "bgReturnDate"];
const refloatDisabledKeys: FieldKey[] = ["refloatBiddingDate", "refloatBidOpeningDate"];
const supplyOrderBgDisabledKeys: SupplyOrderKey[] = ["bgValidityDate", "bgReturnDate"];
const tcecCommitteeKeys: FieldKey[] = [
  "preTcecCommitteeNo",
  "postTcecCommitteeNumber",
];

const yesNo = ["Yes", "No"];
const yesNoCaps = ["YES", "NO"];
const modeOptions = ["OBM", "PBM", "SBM", "LBM", "LPC"];
const paymentModeOptions = ["Online", "Offline"];
type FirmDetailsState = {
  invitedFirms: FirmDetail[];
  bidderFirms: FirmDetail[];
};

const emptyFirmDetail: Required<FirmDetail> = { firmName: "", city: "", emailId: "" };
const emptySupplyOrder: Required<SupplyOrderDetail> = {
  soNo: "",
  gemSoNo: "",
  soDate: "",
  soValueCapital: "",
  soValueRevenue: "",
  dpDate: "",
  firm: "",
  bgValidityDate: "",
  dpExtension: "No",
  dpExtensionCount: "",
  ld: "No",
  revisedDp: "",
  materialReceiptDate: "",
  irPreparationDate: "",
  irReceiptDate: "",
  billPreparationDate: "",
  billSentForPaymentDate: "",
  paymentDate: "",
  paymentMode: "",
  bgReturnDate: "",
  demandCancelled: "No",
  soCancelled: "No",
};

const supplyOrderFields: ExtraField[] = [
  { key: "soNo", label: "S.O. No." },
  { key: "gemSoNo", label: "GeM S.O. NO." },
  { key: "soDate", label: "S.O. date", type: "date" },
  { key: "soValueCapital", label: "S.O. value" },
  { key: "dpDate", label: "D.P. date", type: "date" },
  { key: "firm", label: "Firm" },
  { key: "bgValidityDate", label: "BG validity date", type: "date" },
  { key: "dpExtension", label: "DP extension (Yes/No)", options: yesNo },
  { key: "dpExtensionCount", label: "Extension count", type: "number" },
  { key: "ld", label: "LD", options: yesNo },
  { key: "revisedDp", label: "Revised D.P.", type: "date" },
  { key: "materialReceiptDate", label: "Material receipt date", type: "date" },
  { key: "irPreparationDate", label: "IR Preparation", type: "date" },
  { key: "irReceiptDate", label: "IR Receipt", type: "date" },
  { key: "billPreparationDate", label: "Bill preparation", type: "date" },
  { key: "billSentForPaymentDate", label: "Bill sent for payment", type: "date" },
  { key: "paymentDate", label: "Payment Date", type: "date" },
  { key: "paymentMode", label: "Payment mode(Online/Offline)", options: paymentModeOptions },
  { key: "bgReturnDate", label: "BG return date", type: "date" },
  { key: "demandCancelled", label: "Demand cancelled (Yes/No)", options: yesNo },
  { key: "soCancelled", label: "S.O. cancelled (Yes/No)", options: yesNo },
  { key: "soCancelledDate", label: "S.O. cancelled date", type: "date" },
];

const supplyOrderSubviewFields = {
  supplyOrder: ["soNo", "gemSoNo", "soDate", "soValueCapital", "firm"],
  bg: ["bgValidityDate", "bgReturnDate"],
  dp: ["dpDate", "dpExtension", "dpExtensionCount", "ld", "revisedDp"],
  delivery: ["materialReceiptDate", "irPreparationDate", "irReceiptDate"],
  payment: ["billPreparationDate", "billSentForPaymentDate", "paymentDate", "paymentMode"],
  miscellaneous: ["demandCancelled", "soCancelled", "soCancelledDate"],
} satisfies Record<string, SupplyOrderKey[]>;

const supplyOrderSubviewTabs = [
  { key: "supplyOrder", label: "Supply order" },
  { key: "bg", label: "BG" },
  { key: "dp", label: "D.P." },
  { key: "delivery", label: "Delivery & Inspection" },
  { key: "payment", label: "Payment" },
  { key: "miscellaneous", label: "Miscellaneous" },
] as const;

type SupplyOrderSubviewKey = (typeof supplyOrderSubviewTabs)[number]["key"];

const extraSections: { title: string; fields: ExtraField[] }[] = [
  {
    title: "File details",
    fields: [
      { key: "uniqueCode", label: "Unique code" },
      { key: "division", label: "Division" },
      { key: "indentor", label: "Indentor" },
      { key: "demandDescription", label: "Description", type: "textarea" },
      { key: "valueCapital", label: "Value" },
      { key: "currency", label: "Currency" },
      { key: "exchangeRate", label: "Exchange rate", type: "number" },
      { key: "gte", label: "GTE", options: yesNo },
      { key: "receivedDate", label: "Received date", type: "date" },
      { key: "mode", label: "Mode (OBM/PBM/SBM/LBM/LPC)", options: modeOptions },
      { key: "tcec", label: "TCEC (Yes/No)", options: yesNoCaps },
      { key: "gem", label: "GeM (Yes/No)", options: yesNo },
      { key: "highValue", label: "High value (Yes/No)", options: yesNo },
      { key: "ad", label: "AD (Yes/No)", options: yesNo },
      { key: "rqa", label: "R&QA (Yes/No)", options: yesNo },
      { key: "ifa", label: "IFA (Yes/No)", options: yesNo },
      { key: "psb", label: "PSB (Yes/No)", options: yesNo },
      { key: "bg", label: "BG (Yes/No)", options: yesNo },
      { key: "rfpVetting", label: "RFP vetting", options: yesNo },
    ],
  },
  {
    title: "Scrutiny and control",
    fields: [
      { key: "scrutinyDate", label: "Scrutiny date", type: "date" },
      { key: "scrutinyResponseDate", label: "Scrutiny response", type: "date" },
      { key: "scrutinyCompletionDate", label: "Scrutiny completion date", type: "date" },
      { key: "imms", label: "Control number" },
      { key: "immsDate", label: "Control date", type: "date" },
      { key: "fileNo", label: "File Number" },
    ],
  },
  {
    title: "TCEC block",
    fields: [
      { key: "preTcecCommitteeNo", label: "Pre-TCEC committee" },
      { key: "preTcecDate", label: "Pre-TCEC Date", type: "date" },
      { key: "preTcecMinutesDate", label: "Pre-TCEC minutes date", type: "date" },
      { key: "postTcecCommitteeNumber", label: "Post-TCEC committee" },
      { key: "postTcecDate", label: "Post-TCEC date", type: "date" },
      { key: "postTcecMinutesDate", label: "Post-TCEC minutes date", type: "date" },
    ],
  },
  {
    title: "Approval block",
    fields: [
      { key: "highValueMeetingDate", label: "High value meeting date", type: "date" },
      { key: "highValueMinutesDate", label: "High value minutes date", type: "date" },
      { key: "adVettingDate", label: "AD Vetting date", type: "date" },
      { key: "rqaApprovalDate", label: "R&QA approval date", type: "date" },
      { key: "ifaSentDate", label: "IFA sent date", type: "date" },
      { key: "ifaFinalDate", label: "IFA final date", type: "date" },
      { key: "cfaSentDate", label: "CFA sent date", type: "date" },
      { key: "cfaDate", label: "CFA approval date", type: "date" },
      { key: "cncDate", label: "CNC date", type: "date" },
      { key: "cncApprovalDate", label: "CNC approval date", type: "date" },
    ],
  },
  {
    title: "Bidding details",
    fields: [
      { key: "gemUndertakingDate", label: "GeM undertaking date", type: "date" },
      { key: "rfpVettingInitiationDate", label: "RFP vetting initiation", type: "date" },
      { key: "rfpVettingApprovalDate", label: "RFP vetting approval", type: "date" },
      { key: "bidNumber", label: "Bid number" },
      { key: "bidDate", label: "Bid date", type: "date" },
      { key: "bidOpeningDate", label: "Bid closing", type: "date" },
      { key: "tenderLive", label: "Tender live", options: yesNo },
      { key: "bidOpened", label: "Bid opened", options: yesNoCaps },
      { key: "refloat", label: "Refloat (Yes/No)", options: yesNo },
      { key: "refloatBiddingDate", label: "Refloat bidding date", type: "date" },
      { key: "refloatBidOpeningDate", label: "Refloat bid closing date", type: "date" },
      { key: "rst", label: "RST (Yes/No)", options: yesNo },
      { key: "biddingStageOver", label: "Bidding stage over", options: yesNo },
    ],
  },
  {
    title: "Supply order and payment",
    fields: [{ key: "noOfSo", label: "No. of S.O.", type: "number" }],
  },
  {
    title: "Firm details",
    fields: [],
  },
];

const timelineFields = extraSections
  .flatMap((section) => section.fields)
  .filter((field) => field.type === "date")
  .map((field) => ({ key: field.key, label: field.label }));

type TimelineItem = {
  label: string;
  date: string;
  order: number;
};

function AddFilePage() {
  const activeUser = useActiveUser();
  const { fileId } = Route.useSearch();
  const canEditFiles =
    activeUser?.role === "admin" ||
    activeUser?.role === "sub_admin" ||
    activeUser?.role === "editor";
  const canViewExistingFile = activeUser?.role === "viewer" && Boolean(fileId);
  if (!canEditFiles && !canViewExistingFile) {
    return (
      <div className="max-w-xl rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <h1 className="text-sm font-semibold">File editing unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your account can view records only.</p>
      </div>
    );
  }

  return <AddFileEditor readOnlyMode={!canEditFiles} />;
}

function AddFileEditor({ readOnlyMode = false }: { readOnlyMode?: boolean }) {
  const divisions = useAccessibleDivisions();
  const messages = useMessages();
  const activeUser = useActiveUser();
  const settings = useSettings();
  const { fileId, section, quickFocus } = Route.useSearch();
  const navigate = useNavigate();
  const [loadedFile, setLoadedFile] = useState<FileRecord | undefined>();
  const [fileLoadStatus, setFileLoadStatus] = useState<"idle" | "loading" | "loaded" | "error">(
    fileId ? "loading" : "idle",
  );
  const [serverUniqueCode, setServerUniqueCode] = useState("");
  const editingFile = loadedFile;
  const isEditing = Boolean(fileId && editingFile);
  const [form, setForm] = useState(() =>
    applyConditionalRules(
      editingFile
        ? createFormFromFile(editingFile, settings.financialYear)
        : createEmptyForm(settings.financialYear),
    ),
  );
  const [firmDetails, setFirmDetails] = useState<FirmDetailsState>(() =>
    createFirmDetailsFromFile(editingFile),
  );
  const [supplyOrders, setSupplyOrders] = useState<SupplyOrderDetail[]>(() =>
    createSupplyOrdersFromFile(editingFile),
  );
  const [fileRemarks, setFileRemarks] = useState<FileRemark[]>(() =>
    createRemarksFromFile(editingFile),
  );
  const [currentMilestone, setCurrentMilestone] = useState(editingFile?.currentMilestone ?? "");
  const [completedMilestones, setCompletedMilestones] = useState<string[]>(() =>
    normalizeCompletedMilestones(editingFile?.completedMilestones),
  );
  const [activeYears, setActiveYears] = useState<string[]>(() =>
    normalizeSelectableActiveYears(
      normalizeActiveYears(editingFile, settings.financialYear),
      getLatestTwoYears(settings.financialYear, settings.financialYears),
      settings.financialYear,
      settings.yearSelectionLocked,
    ),
  );
  const [saved, setSaved] = useState(false);
  const [unlockedSections, setUnlockedSections] = useState<Set<string>>(() => new Set());
  const [activeBoardSection, setActiveBoardSection] = useState(section ?? "File details");
  const quickFieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const quickFocusAppliedRef = useRef("");
  const skipMilestonePruneRef = useRef(false);
  useEffect(() => {
    if (!fileId) {
      setLoadedFile(undefined);
      setFileLoadStatus("idle");
      return;
    }

    let cancelled = false;
    setFileLoadStatus("loading");
    fetchFile(fileId)
      .then(({ file }) => {
        if (cancelled) return;
        setLoadedFile(file);
        setFileLoadStatus("loaded");
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setLoadedFile(undefined);
        setFileLoadStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [fileId]);
  const savedFormForLocks = useMemo(
    () =>
      editingFile
        ? applyConditionalRules(createFormFromFile(editingFile, settings.financialYear))
        : createEmptyForm(settings.financialYear),
    [editingFile, settings.financialYear],
  );
  const savedFirmDetailsForLocks = useMemo(
    () => createFirmDetailsFromFile(editingFile),
    [editingFile],
  );
  const savedSupplyOrdersForLocks = useMemo(
    () => createSupplyOrdersFromFile(editingFile),
    [editingFile],
  );
  const savedCompletedMilestonesForLocks = useMemo(
    () => normalizeCompletedMilestones(editingFile?.completedMilestones),
    [editingFile?.completedMilestones],
  );

  useEffect(() => {
    skipMilestonePruneRef.current = true;
    setForm(
      applyConditionalRules(
        editingFile
          ? createFormFromFile(editingFile, settings.financialYear)
          : createEmptyForm(settings.financialYear),
      ),
    );
    setFirmDetails(createFirmDetailsFromFile(editingFile));
    setSupplyOrders(createSupplyOrdersFromFile(editingFile));
    setFileRemarks(createRemarksFromFile(editingFile));
    setCurrentMilestone(editingFile?.currentMilestone ?? "");
    setCompletedMilestones(normalizeCompletedMilestones(editingFile?.completedMilestones));
    setActiveYears(
      normalizeSelectableActiveYears(
        normalizeActiveYears(editingFile, settings.financialYear),
        getLatestTwoYears(settings.financialYear, settings.financialYears),
        settings.financialYear,
        settings.yearSelectionLocked,
      ),
    );
    setUnlockedSections(new Set());
    // The file object is re-read from localStorage on each render; reset only when the edited id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editingFile?.id,
    settings.financialYear,
    settings.financialYears,
    settings.yearSelectionLocked,
  ]);

  useEffect(() => {
    setActiveBoardSection(section ?? "File details");
  }, [section, editingFile?.id]);

  useEffect(() => {
    if (isEditing) return;
    const financialYear = activeYears[0] || settings.financialYear;
    const division = form.division.trim();
    if (!financialYear || !division) {
      setServerUniqueCode("");
      return;
    }

    let cancelled = false;
    fetchNextUniqueCode({ financialYear, division })
      .then(({ uniqueCode }) => {
        if (!cancelled) setServerUniqueCode(uniqueCode);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setServerUniqueCode("");
      });
    return () => {
      cancelled = true;
    };
  }, [activeYears, form.division, isEditing, settings.financialYear]);

  const generatedUniqueCode = isEditing
    ? form.uniqueCode
    : serverUniqueCode;
  const originYear = isEditing
    ? form.year || editingFile?.year || settings.financialYear
    : activeYears[0] || settings.financialYear;
  const formWithLockedYear = useMemo(
    () => ({
      ...form,
      year: originYear,
      uniqueCode: generatedUniqueCode,
    }),
    [form, generatedUniqueCode, originYear],
  );
  const activeYearOptions = useMemo(
    () => getLatestTwoYears(settings.financialYear, settings.financialYears),
    [settings.financialYear, settings.financialYears],
  );
  const selectedDivision = divisions.find(
    (division) =>
      division.name.trim().toLowerCase() === formWithLockedYear.division.trim().toLowerCase(),
  );
  const [indentorOptions, setIndentorOptions] = useState<string[]>([]);
  useEffect(() => {
    if (!selectedDivision) {
      setIndentorOptions([]);
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      fetchIndentors({
        divisionId: selectedDivision.id,
        q: formWithLockedYear.indentor,
        page: 1,
        pageSize: 50,
      })
        .then((result) => {
          if (!controller.signal.aborted) {
            setIndentorOptions(result.indentors.map((indentor) => indentor.name));
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            console.error(error);
            setIndentorOptions([]);
          }
        });
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [selectedDivision, formWithLockedYear.indentor]);
  const tcecIsNo = isNo(formWithLockedYear.tcec);
  const gemIsNo = isNo(formWithLockedYear.gem);
  const highValueIsNo = isNo(formWithLockedYear.highValue);
  const rqaIsNo = isNo(formWithLockedYear.rqa);
  const ifaIsNo = isNo(formWithLockedYear.ifa);
  const bgIsNo = isNo(formWithLockedYear.bg);
  const rfpVettingIsNo = isNo(formWithLockedYear.rfpVetting);
  const refloatIsNo = isNo(formWithLockedYear.refloat);
  const adVettingDisabled = isDivisionAdNo(formWithLockedYear.division, divisions);
  const milestoneOptions = useMemo(
    () => getConfiguredMilestones(settings.milestones),
    [settings.milestones],
  );
  const applicableMilestones = getApplicableMilestones(
    milestoneOptions,
    formWithLockedYear,
    supplyOrders,
    divisions,
  );

  useEffect(() => {
    setActiveYears((current) =>
      normalizeSelectableActiveYears(
        current,
        activeYearOptions,
        settings.financialYear,
        settings.yearSelectionLocked,
      ),
    );
  }, [activeYearOptions, settings.financialYear, settings.yearSelectionLocked]);

  useEffect(() => {
    if (skipMilestonePruneRef.current) {
      skipMilestonePruneRef.current = false;
      return;
    }
    setCurrentMilestone((current) =>
      current && !applicableMilestones.has(current) ? "" : current,
    );
    setCompletedMilestones((current) => {
      const next = current.filter((item) => milestoneOptions.includes(item));
      return next.length === current.length ? current : next;
    });
  }, [applicableMilestones, milestoneOptions]);

  const activeSection = extraSections.find((section) => section.title === activeBoardSection);
  const activeSectionIndex = extraSections.findIndex(
    (section) => section.title === activeBoardSection,
  );
  const activeSectionMessages =
    editingFile && activeSection
      ? messages.filter(
          (message) => message.fileId === editingFile.id && message.section === activeSection.title,
        )
      : [];
  useEffect(() => {
    if (!quickFocus || !editingFile || !activeSection) return;

    if (!unlockedSections.has(activeSection.title)) {
      setUnlockedSections((current) => new Set([...current, activeSection.title]));
      return;
    }

    const focusKey = `${editingFile.id}:${activeSection.title}`;
    if (quickFocusAppliedRef.current === focusKey) return;

    window.setTimeout(() => {
      const firstUnfilledField = getUnfilledFieldKeys(
        activeSection,
        formWithLockedYear,
        divisions,
      ).find((fieldKey) => {
        const element = quickFieldRefs.current[fieldKey];
        return element && !("disabled" in element && element.disabled);
      });
      const target = firstUnfilledField ? quickFieldRefs.current[firstUnfilledField] : undefined;
      if (target) {
        quickFocusAppliedRef.current = focusKey;
        target.focus();
        if ("select" in target && typeof target.select === "function") target.select();
      }
    }, 100);
  }, [activeSection, divisions, editingFile, formWithLockedYear, quickFocus, unlockedSections]);

  const update = (k: keyof typeof form, v: string) => {
    if (readOnlyMode) return;
    if (k === "year") return;
    if (k === "noOfSo") {
      const count = clampSupplyOrderCount(v);
      setForm((f) => ({ ...f, noOfSo: String(count) }));
      setSupplyOrders((current) => resizeSupplyOrders(current, count));
      return;
    }
    if (k === "gem") {
      setSupplyOrders((current) =>
        current.map((order) =>
          isNo(v)
            ? { ...order, gemSoNo: "", paymentMode: "" }
            : { ...order, paymentMode: order.paymentMode || "Online" },
        ),
      );
    }
    if (k === "bg" && isNo(v)) {
      setSupplyOrders((current) =>
        current.map((order) => ({ ...order, bgValidityDate: "", bgReturnDate: "" })),
      );
    }
    if (k === "biddingStageOver" && isYes(v)) {
      const currentIsBidding = normalizeMilestoneName(currentMilestone) === "bidding";
      const currentNeedsSelection = !currentMilestone || currentIsBidding;
      if (currentIsBidding) {
        setCurrentMilestone("");
      }
      if (currentNeedsSelection) {
        setActiveBoardSection("Milestones");
        setUnlockedSections((current) => new Set([...current, "Milestones"]));
        window.setTimeout(() => {
          alert(
            "Bidding is now marked completed. Please select the next current status in Milestones.",
          );
        }, 100);
      }
    }
    setForm((f) => {
      const patch: Partial<FormState> = { [k]: v };
      if (k === "currency" && isInr(v)) {
        patch.exchangeRate = "1";
      }
      if (k === "gem" && isYes(v)) {
        patch.paymentMode = "Online";
      }
      if (k === "division") {
        if (f.division.trim().toLowerCase() !== v.trim().toLowerCase()) {
          patch.indentor = "";
        }
      }
      const next = applyConditionalRules({ ...f, ...patch });
      return isDivisionAdNo(next.division, divisions) ? { ...next, adVettingDate: "" } : next;
    });
  };
  const updateSupplyOrder = (index: number, key: SupplyOrderKey, value: string) => {
    if (readOnlyMode) return;
    setSupplyOrders((current) =>
      current.map((order, orderIndex) =>
        orderIndex === index
          ? applySupplyOrderRules(getSupplyOrderPatch(order, key, value), formWithLockedYear)
          : order,
      ),
    );
  };
  const toggleSectionLock = (sectionTitle: string) => {
    if (readOnlyMode) return;
    setUnlockedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionTitle)) {
        next.delete(sectionTitle);
      } else {
        next.add(sectionTitle);
      }
      return next;
    });
  };
  const updateFirmDetail = (
    group: keyof FirmDetailsState,
    index: number,
    key: keyof FirmDetail,
    value: string,
  ) => {
    if (readOnlyMode) return;
    setFirmDetails((current) => ({
      ...current,
      [group]: current[group].map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row,
      ),
    }));
  };
  const addFirmDetail = (group: keyof FirmDetailsState) => {
    if (readOnlyMode) return;
    setFirmDetails((current) => ({
      ...current,
      [group]: [...current[group], { ...emptyFirmDetail }],
    }));
  };
  const deleteFirmDetail = (group: keyof FirmDetailsState, index: number) => {
    if (readOnlyMode) return;
    setFirmDetails((current) => ({
      ...current,
      [group]: current[group].filter((_, rowIndex) => rowIndex !== index),
    }));
  };
  const deleteSelectedFirmDetails = (group: keyof FirmDetailsState, indexes: number[]) => {
    if (readOnlyMode) return;
    const selected = new Set(indexes);
    setFirmDetails((current) => ({
      ...current,
      [group]: current[group].filter((_, rowIndex) => !selected.has(rowIndex)),
    }));
  };
  const addRemark = (sectionTitle: string) => {
    if (readOnlyMode) return;
    setFileRemarks((current) => [
      ...current,
      {
        id: createRemarkId(),
        section: sectionTitle,
        text: "",
        createdAt: formatLocalDate(new Date()),
      },
    ]);
  };
  const updateRemark = (remarkId: string, text: string) => {
    if (readOnlyMode) return;
    setFileRemarks((current) =>
      current.map((remark) => (remark.id === remarkId ? { ...remark, text } : remark)),
    );
  };
  const updateRemarkDate = (remarkId: string, date: string) => {
    if (readOnlyMode) return;
    setFileRemarks((current) =>
      current.map((remark) => (remark.id === remarkId ? { ...remark, createdAt: date } : remark)),
    );
  };
  const deleteRemark = (remarkId: string) => {
    if (readOnlyMode) return;
    setFileRemarks((current) => current.filter((remark) => remark.id !== remarkId));
  };
  const firmDetailsLocked = isEditing && !unlockedSections.has("Firm details");
  const supplyOrdersLocked = isEditing && !unlockedSections.has("Supply order and payment");
  const milestonesLocked = isEditing && !unlockedSections.has("Milestones");
  const renderSectionUnlockButton = (sectionTitle: string) => {
    if (!isEditing || readOnlyMode) return null;

    return (
      <span className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => toggleSectionLock(sectionTitle)}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-background text-xs font-medium text-foreground border border-border hover:bg-accent"
        >
          {unlockedSections.has(sectionTitle) ? (
            <>
              <Unlock className="size-3.5" /> Unlocked
            </>
          ) : (
            <>
              <Lock className="size-3.5" /> Edit block
            </>
          )}
        </button>
        <span className="text-[11px] font-normal text-black">
          Click Update to save, else data will be lost.
        </span>
      </span>
    );
  };
  const renderSectionFields = (section: (typeof extraSections)[number]) => (
    <div className="grid grid-cols-1 gap-4">
      {section.fields.map((field) => {
        const renderedField =
          field.key === "division"
            ? {
                ...field,
                options: divisions.map((division) => division.name),
                placeholder: "Type or select division",
                typeahead: true,
              }
            : field.key === "indentor"
              ? {
                  ...field,
                  options: indentorOptions,
                  placeholder: selectedDivision
                    ? "Type or select indentor"
                    : "Select division first",
                  typeahead: true,
                }
              : tcecCommitteeKeys.includes(field.key)
                ? {
                    ...field,
                    options: getTcecCommitteeOptions(
                      settings.tcecCommittees,
                      formWithLockedYear[field.key],
                    ),
                  }
                : field;
        const lockFilledFields = isEditing && !unlockedSections.has(section.title);
        const fieldReadOnly = readOnlyMode;

        if (field.key === "valueCapital") {
          return (
            <ValueField
              key={field.key}
              capitalValue={formWithLockedYear.valueCapital}
              revenueValue={formWithLockedYear.valueRevenue}
              capitalSelected={formWithLockedYear.valueCapitalSelected === "Yes"}
              revenueSelected={formWithLockedYear.valueRevenueSelected === "Yes"}
              thresholdMatch={findValueThresholdMatch(
                settings.valueThresholdLevels,
                formWithLockedYear,
              )}
              disabled={fieldReadOnly}
              lockFilledFields={lockFilledFields}
              lockedSelectionFilled={
                hasFileValueForLock(savedFormForLocks, "valueCapital") ||
                hasFileValueForLock(savedFormForLocks, "valueRevenue")
              }
              lockedValueFilled={
                hasFileValueForLock(savedFormForLocks, "valueCapital") ||
                hasFileValueForLock(savedFormForLocks, "valueRevenue")
              }
              onChange={(patch) => {
                if (readOnlyMode) return;
                setForm((current) => applyConditionalRules({ ...current, ...patch }));
                setSupplyOrders((current) =>
                  current.map((order) => ({
                    ...order,
                    soValueCapital:
                      patch.valueCapitalSelected === "Yes" ? order.soValueCapital : "",
                    soValueRevenue:
                      patch.valueRevenueSelected === "Yes" ? order.soValueRevenue : "",
                  })),
                );
              }}
            />
          );
        }

        if (field.key === "soValueCapital") {
          return (
            <SoValueField
              key={field.key}
              capitalSelected={formWithLockedYear.valueCapitalSelected === "Yes"}
              revenueSelected={formWithLockedYear.valueRevenueSelected === "Yes"}
              capitalValue={formWithLockedYear.soValueCapital}
              revenueValue={formWithLockedYear.soValueRevenue}
              disabled={fieldReadOnly}
              lockFilledFields={lockFilledFields}
              lockedValueFilled={
                hasFileValueForLock(savedFormForLocks, "soValueCapital") ||
                hasFileValueForLock(savedFormForLocks, "soValueRevenue")
              }
              onChange={(patch) => {
                if (readOnlyMode) return;
                setForm((current) => applyConditionalRules({ ...current, ...patch }));
              }}
            />
          );
        }

        return (
          <DynamicField
            key={field.key}
            field={renderedField}
            value={formWithLockedYear[field.key]}
            disabled={
              field.key === "year" ||
              field.key === "uniqueCode" ||
              field.key === "tenderLive" ||
              fieldReadOnly ||
              (lockFilledFields && hasFileValueForLock(savedFormForLocks, field.key)) ||
              (field.key === "adVettingDate" && adVettingDisabled) ||
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
            inputRef={(element) => {
              quickFieldRefs.current[field.key] = element;
            }}
          />
        );
      })}
    </div>
  );

  const save = async (options?: { returnToQuickEntry?: boolean }) => {
    if (readOnlyMode) return;
    const supplyOrderCount = clampSupplyOrderCount(formWithLockedYear.noOfSo);
    const cleanedSupplyOrders = cleanSupplyOrderRows(
      resizeSupplyOrders(supplyOrders, supplyOrderCount),
    );
    const completedMilestonesForSave = getCompletedMilestonesForSave(
      milestoneOptions,
      applicableMilestones,
      completedMilestones,
      formWithLockedYear,
    );
    const payload = {
      ...toFilePayload(
        clearDivisionDisabledFields(applyConditionalRules(formWithLockedYear), divisions),
      ),
      ...legacySupplyOrderPatch(cleanedSupplyOrders),
      noOfSo: String(supplyOrderCount),
      supplyOrders: cleanedSupplyOrders,
      remarks: cleanFileRemarks(fileRemarks),
      activeYears,
      invitedFirms: cleanFirmRows(firmDetails.invitedFirms),
      bidderFirms: cleanFirmRows(firmDetails.bidderFirms),
      currentMilestone: currentMilestone || undefined,
      completedMilestones: completedMilestonesForSave,
    };
    const milestoneErrors = validateMilestoneCompletionConsistency(payload, milestoneOptions);
    if (milestoneErrors.length) {
      if (options?.returnToQuickEntry) {
        setActiveBoardSection("Milestones");
        setUnlockedSections((current) => new Set([...current, "Milestones"]));
        window.setTimeout(() => {
          alert(
            [
              "Milestone status needs to be updated before this Quick Entry can be saved.",
              "",
              ...milestoneErrors,
              "",
              "Please update the Milestones section, then click Update.",
            ].join("\n"),
          );
        }, 100);
        return;
      }
      alert(["Please fix milestone status before saving:", ...milestoneErrors].join("\n"));
      return;
    }
    if (editingFile) {
      const updatedFile = await store.updateFile(editingFile.id, payload);
      setLoadedFile(updatedFile);
      setUnlockedSections(new Set());
      setSaved(true);
      if (options?.returnToQuickEntry) {
        setTimeout(() => {
          navigate({ to: "/quick-entry" });
        }, 250);
        return;
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => setSaved(false), 1200);
      return;
    } else {
      await store.addFile(payload);
    }
    setSaved(true);
    setTimeout(() => {
      if (options?.returnToQuickEntry) {
        navigate({ to: "/quick-entry" });
        return;
      }
      navigate({ to: "/search", search: { dashboardFilter: undefined, division: undefined } });
    }, 700);
  };

  const handleQuickEntrySaveKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (readOnlyMode) return;
    if (!quickFocus || !isEditing || event.key !== "Enter" || event.metaKey || event.ctrlKey) {
      return;
    }

    const target = event.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    if (tagName === "button" || tagName === "a" || tagName === "select") return;
    if (tagName === "textarea" && event.shiftKey) return;
    if (
      target instanceof HTMLInputElement &&
      ["checkbox", "radio", "button", "submit"].includes(target.type)
    ) {
      return;
    }

    event.preventDefault();
    const confirmed = window.confirm(
      "Please verify the entry before saving.\n\nDo you want to save this update?",
    );
    if (!confirmed) return;

    save({ returnToQuickEntry: true });
  };

  const deleteFile = () => {
    if (readOnlyMode) return;
    if (!editingFile) return;
    const label =
      editingFile.uniqueCode || editingFile.imms || editingFile.demandDescription || "this file";
    const deletionPassword = promptDeletionPassword(`delete ${label}`);
    if (deletionPassword === null) return;
    store.deleteFile(editingFile.id, deletionPassword);
    navigate({ to: "/search", search: { dashboardFilter: undefined, division: undefined } });
  };

  if (fileId && fileLoadStatus === "loading") {
    return (
      <div className="w-full">
        <div className="bg-card border border-border rounded-md p-6 shadow-[var(--shadow-card)]">
          <h2 className="text-base font-semibold">Loading file...</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Fetching this file from the backend.
          </p>
        </div>
      </div>
    );
  }

  if (fileId && !editingFile) {
    return (
      <div className="w-full">
        <div className="bg-card border border-border rounded-md p-6 shadow-[var(--shadow-card)]">
          <h2 className="text-base font-semibold">File not available</h2>
          <p className="text-sm text-muted-foreground mt-1">
            This file is either missing or not assigned to the active user's divisions.
          </p>
          <button
            type="button"
            onClick={() =>
              navigate({
                to: "/search",
                search: { dashboardFilter: undefined, division: undefined },
              })
            }
            className="mt-4 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            Back to search
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full" onKeyDownCapture={handleQuickEntrySaveKey}>
      <div className="bg-card border border-border rounded-md shadow-[var(--shadow-card)] overflow-hidden">
        <div className="p-5 border-b border-border bg-secondary/30">
          <h2 className="text-base font-semibold">
            {readOnlyMode
              ? "View file details"
              : isEditing
                ? "Edit file details"
                : "Add a new file"}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {readOnlyMode
              ? "Viewer access is read-only. You can inspect milestones, dates, and file details."
              : isEditing
                ? "Update the filled and unfilled details for this file."
                : "All fields are optional — save now and complete missing details later."}
          </p>
        </div>

        <SectionBoard active={activeBoardSection} onOpen={setActiveBoardSection} />

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeBoardSection === "Timeline" && (
            <TimelineBlock
              form={formWithLockedYear}
              supplyOrders={supplyOrders}
              divisions={divisions}
            />
          )}
          {activeBoardSection === "Remarks Summary" && (
            <RemarksSummaryBlock form={formWithLockedYear} remarks={fileRemarks} />
          )}
          {activeBoardSection === "Milestones" && (
            <MilestonesBlock
              milestones={milestoneOptions}
              applicableMilestones={applicableMilestones}
              currentMilestone={currentMilestone}
              completedMilestones={completedMilestones}
              autoCompletedMilestones={getAutoCompletedMilestones(
                milestoneOptions,
                applicableMilestones,
                formWithLockedYear,
              )}
              lockedCurrentMilestone={editingFile?.currentMilestone ?? ""}
              lockedCompletedMilestones={savedCompletedMilestonesForLocks}
              disabled={readOnlyMode}
              lockFilledFields={milestonesLocked}
              lockControl={renderSectionUnlockButton("Milestones")}
              onCurrentChange={setCurrentMilestone}
              onCompletedChange={setCompletedMilestones}
            />
          )}

          {activeSection && (
            <section
              key={activeSection.title}
              id={sectionId(activeSection.title)}
              className={sectionBlockCls(activeSectionIndex)}
            >
              <h3 className="text-sm font-semibold border-b border-border pb-2 mb-4 flex items-center gap-2">
                <span className={sectionStripeCls(activeSectionIndex)} />
                <span className="min-w-0 flex-1">{activeSection.title}</span>
                {renderSectionUnlockButton(activeSection.title)}
              </h3>
              {activeSection.title === "Firm details" ? (
                <FirmDetailsBlock
                  details={firmDetails}
                  lockedDetails={savedFirmDetailsForLocks}
                  disabled={readOnlyMode}
                  lockFilledFields={firmDetailsLocked}
                  quickFocus={Boolean(quickFocus && activeSection.title === "Firm details")}
                  onAdd={addFirmDetail}
                  onChange={updateFirmDetail}
                  onDelete={deleteFirmDetail}
                  onDeleteSelected={deleteSelectedFirmDetails}
                />
              ) : activeSection.title === "Supply order and payment" ? (
                <SupplyOrdersBlock
                  form={formWithLockedYear}
                  lockedForm={savedFormForLocks}
                  orders={supplyOrders}
                  lockedOrders={savedSupplyOrdersForLocks}
                  disabled={readOnlyMode}
                  lockFilledFields={supplyOrdersLocked}
                  gemDisabled={gemIsNo}
                  bgDisabled={bgIsNo}
                  quickFocus={Boolean(
                    quickFocus && activeSection.title === "Supply order and payment",
                  )}
                  onCountChange={
                    supplyOrdersLocked && hasFileValueForLock(savedFormForLocks, "noOfSo")
                      ? () => undefined
                      : (value) => update("noOfSo", value)
                  }
                  onOrderChange={updateSupplyOrder}
                />
              ) : (
                <>
                  {activeSection.title === "File details" ? (
                    <ActiveYearsField
                      years={activeYearOptions}
                      selectedYears={activeYears}
                      originYear={formWithLockedYear.year}
                      locked={settings.yearSelectionLocked || readOnlyMode}
                      onChange={setActiveYears}
                    />
                  ) : null}
                  {renderSectionFields(activeSection)}
                </>
              )}
              <SectionRemarks
                sectionTitle={activeSection.title}
                remarks={fileRemarks.filter((remark) => remark.section === activeSection.title)}
                onAdd={() => addRemark(activeSection.title)}
                onChange={updateRemark}
                onDateChange={updateRemarkDate}
                onDelete={deleteRemark}
                disabled={readOnlyMode}
              />
              {editingFile ? (
                <SectionMessages
                  fileId={editingFile.id}
                  sectionTitle={activeSection.title}
                  messages={activeSectionMessages}
                  activeUserRole={activeUser?.role}
                  messagesEnabled={selectedDivision?.messagesEnabled !== false}
                />
              ) : null}
            </section>
          )}
        </div>
        <div className="px-5 py-4 border-t border-border bg-secondary/40 flex flex-wrap items-center justify-between gap-2">
          <div>
            {isEditing && !readOnlyMode && (
              <button
                type="button"
                onClick={deleteFile}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-destructive/30 bg-background text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-4" /> Delete file
              </button>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            {!isEditing && !readOnlyMode && (
              <button
                type="button"
                onClick={() => {
                  setForm(applyConditionalRules(createEmptyForm(settings.financialYear)));
                  setFileRemarks([]);
                  setActiveYears([settings.financialYear]);
                  setCurrentMilestone("");
                  setCompletedMilestones([]);
                }}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-sm hover:bg-accent"
              >
                <Eraser className="size-4" /> Clear
              </button>
            )}
            {!readOnlyMode ? (
              <button
                type="button"
                onClick={() =>
                  save({
                    returnToQuickEntry: Boolean(quickFocus),
                  })
                }
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
              >
                <Save className="size-4" /> {saved ? "Saved" : isEditing ? "Update" : "Save"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionBoard({
  active,
  onOpen,
}: {
  active: string;
  onOpen: (sectionTitle: string) => void;
}) {
  const links = [
    "Timeline",
    "Remarks Summary",
    "Milestones",
    ...extraSections.map((section) => section.title),
  ];

  return (
    <div className="border-b border-border bg-card px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Show section</span>
        {links.map((label) => (
          <button
            type="button"
            key={label}
            onClick={() => onOpen(label)}
            className={
              "inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium hover:bg-accent " +
              (active === label
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-secondary/50 text-foreground")
            }
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SectionRemarks({
  sectionTitle,
  remarks,
  onAdd,
  onChange,
  onDateChange,
  onDelete,
  disabled = false,
}: {
  sectionTitle: string;
  remarks: FileRemark[];
  onAdd: () => void;
  onChange: (remarkId: string, text: string) => void;
  onDateChange: (remarkId: string, date: string) => void;
  onDelete: (remarkId: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          {remarks.length ? `${remarks.length} remark${remarks.length === 1 ? "" : "s"}` : ""}
        </div>
        {!disabled ? (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            <Plus className="size-3.5" /> Add remark
          </button>
        ) : null}
      </div>

      {remarks.length ? (
        <div className="space-y-3">
          {remarks.map((remark) => (
            <div key={remark.id} className="rounded-md border border-border bg-secondary/20 p-3">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <label className="block">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Date</div>
                  <input
                    type="date"
                    value={getRemarkDateInputValue(remark.createdAt)}
                    onChange={(event) =>
                      onDateChange(remark.id, clampDateYearInput(event.target.value))
                    }
                    disabled={disabled}
                    max="9999-12-31"
                    className={
                      "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40" +
                      disabledCls(disabled)
                    }
                  />
                </label>
                {!disabled ? (
                  <button
                    type="button"
                    onClick={() => onDelete(remark.id)}
                    aria-label={`Delete remark from ${sectionTitle}`}
                    title="Delete remark"
                    className="inline-flex size-8 items-center justify-center rounded-md border border-destructive/30 bg-background text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </div>
              <textarea
                value={remark.text}
                onChange={(event) => onChange(remark.id, event.target.value)}
                placeholder="Type remark"
                disabled={disabled}
                className={textareaCls + disabledCls(disabled)}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SectionMessages({
  fileId,
  sectionTitle,
  messages,
  activeUserRole,
  messagesEnabled,
}: {
  fileId: string;
  sectionTitle: string;
  messages: FileMessage[];
  activeUserRole?: string;
  messagesEnabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [action, setAction] = useState("");
  const pendingMessages = messages.filter((message) => message.status === "pending");
  const resolvedMessages = messages.filter((message) => message.status === "resolved");
  const canCreate = activeUserRole === "viewer" || activeUserRole === "division_user";
  const canResolve =
    activeUserRole === "admin" || activeUserRole === "sub_admin" || activeUserRole === "editor";
  const canDelete = activeUserRole === "admin" || canCreate;
  const draftWords = countMessageWords(draft);

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || draftWords > 20) return;
    setAction("Sending...");
    try {
      await store.createMessage(fileId, sectionTitle, text);
      setDraft("");
      setAction("Message sent.");
    } catch (error) {
      setAction(error instanceof Error ? error.message : "Message could not be sent.");
    }
  };

  const replyToMessage = async (messageId: string) => {
    const text = replyDrafts[messageId]?.trim() ?? "";
    if (!text || countMessageWords(text) > 20) return;
    setAction("Saving reply...");
    try {
      await store.replyToMessage(messageId, text);
      setReplyDrafts((current) => ({ ...current, [messageId]: "" }));
      setAction("Reply saved.");
    } catch (error) {
      setAction(error instanceof Error ? error.message : "Reply could not be saved.");
    }
  };

  const resolveMessage = async (messageId: string) => {
    setAction("Resolving...");
    try {
      await store.resolveMessage(messageId);
      setAction("Message resolved.");
    } catch (error) {
      setAction(error instanceof Error ? error.message : "Message could not be resolved.");
    }
  };

  const deleteMessage = async (messageId: string) => {
    setAction("Deleting...");
    try {
      await store.deleteMessage(messageId);
      setAction("Message deleted.");
    } catch (error) {
      setAction(error instanceof Error ? error.message : "Message could not be deleted.");
    }
  };

  return (
    <div className="mt-5 rounded-md border border-border bg-secondary/20 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">Messages</div>
            <div className="text-xs text-muted-foreground">
              Pending {pendingMessages.length} · Resolved {resolvedMessages.length}
            </div>
          </div>
        </div>
        {!messagesEnabled ? (
          <span className="rounded-full bg-secondary px-2 py-1 text-xs font-medium">
            Disabled for division
          </span>
        ) : null}
      </div>

      {canCreate ? (
        <div className="mb-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!messagesEnabled}
            placeholder="Add message"
            className={textareaCls + disabledCls(!messagesEnabled)}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div
              className={
                draftWords > 20 ? "text-xs text-destructive" : "text-xs text-muted-foreground"
              }
            >
              {draftWords}/20 words
            </div>
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={!draft.trim() || draftWords > 20 || !messagesEnabled}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      ) : null}

      {messages.length ? (
        <div className="space-y-2">
          {messages.map((message) => {
            const replyDraft = replyDrafts[message.id] ?? "";
            const replyWords = countMessageWords(replyDraft);
            return (
              <div key={message.id} className="rounded-md border border-border bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold">
                      {message.createdByName} · {formatRemarkDate(message.createdAt)}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{message.text}</p>
                  </div>
                  <span className="rounded-full bg-secondary px-2 py-1 text-xs font-medium capitalize">
                    {message.status}
                  </span>
                </div>

                {message.resolvedByName ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Resolved by {message.resolvedByName}
                    {message.resolvedAt ? ` on ${formatRemarkDate(message.resolvedAt)}` : ""}
                  </div>
                ) : null}

                {message.replies.length ? (
                  <div className="mt-2 space-y-1 border-t border-border pt-2">
                    {message.replies.map((reply) => (
                      <div key={reply.id} className="rounded bg-secondary/40 p-2 text-sm">
                        <div className="text-xs font-medium">
                          {reply.createdByName} · {formatRemarkDate(reply.createdAt)}
                        </div>
                        <div className="mt-1 whitespace-pre-wrap">{reply.text}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {canResolve && message.status === "pending" ? (
                  <div className="mt-2 border-t border-border pt-2">
                    <textarea
                      value={replyDraft}
                      onChange={(event) =>
                        setReplyDrafts((current) => ({
                          ...current,
                          [message.id]: event.target.value,
                        }))
                      }
                      placeholder="Reply"
                      className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div
                        className={
                          replyWords > 20
                            ? "text-xs text-destructive"
                            : "text-xs text-muted-foreground"
                        }
                      >
                        {replyWords}/20 words
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void replyToMessage(message.id)}
                          disabled={!replyDraft.trim() || replyWords > 20}
                          className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
                        >
                          Reply
                        </button>
                        <button
                          type="button"
                          onClick={() => void resolveMessage(message.id)}
                          className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
                        >
                          Resolve
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {canDelete ? (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void deleteMessage(message.id)}
                      className="inline-flex h-8 items-center rounded-md border border-destructive/30 bg-background px-3 text-xs font-medium text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-background p-3 text-sm text-muted-foreground">
          No messages for this section.
        </div>
      )}
      {action ? <div className="mt-2 text-xs text-muted-foreground">{action}</div> : null}
    </div>
  );
}

function countMessageWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function ActiveYearsField({
  years,
  selectedYears,
  originYear,
  locked,
  onChange,
}: {
  years: string[];
  selectedYears: string[];
  originYear: string;
  locked: boolean;
  onChange: (years: string[]) => void;
}) {
  const toggleYear = (year: string) => {
    if (locked) return;
    onChange([year]);
  };

  return (
    <div className="rounded-md border border-border bg-secondary/20 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">Active year</div>
        {locked ? <div className="text-xs text-muted-foreground">Locked by admin</div> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {years.map((year) => (
          <label
            key={year}
            className={
              "inline-flex h-8 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm " +
              (locked ? "opacity-70" : "")
            }
          >
            <input
              type="radio"
              name="activeYear"
              checked={selectedYears.includes(year) || year === originYear}
              disabled={locked}
              onChange={() => toggleYear(year)}
              className="size-4 rounded border-input"
            />
            <span>{displayFinancialYearLabel(year)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function FirmDetailsBlock({
  details,
  lockedDetails,
  disabled,
  lockFilledFields,
  quickFocus,
  onAdd,
  onChange,
  onDelete,
  onDeleteSelected,
}: {
  details: FirmDetailsState;
  lockedDetails: FirmDetailsState;
  disabled: boolean;
  lockFilledFields: boolean;
  quickFocus?: boolean;
  onAdd: (group: keyof FirmDetailsState) => void;
  onChange: (
    group: keyof FirmDetailsState,
    index: number,
    key: keyof FirmDetail,
    value: string,
  ) => void;
  onDelete: (group: keyof FirmDetailsState, index: number) => void;
  onDeleteSelected: (group: keyof FirmDetailsState, indexes: number[]) => void;
}) {
  const [activeTab, setActiveTab] = useState<keyof FirmDetailsState>("invitedFirms");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());
  const tabs: { key: keyof FirmDetailsState; label: string }[] = [
    { key: "invitedFirms", label: "Invited" },
    { key: "bidderFirms", label: "Bidders" },
  ];
  const rows = details[activeTab];
  const firmInputRefs = useRef<Record<string, HTMLInputElement | HTMLButtonElement | null>>({});
  const firmQuickFocusAppliedRef = useRef("");
  const latestFirmRowsRef = useRef(rows);
  const firmCounts = {
    invitedFirms: details.invitedFirms.length,
    bidderFirms: details.bidderFirms.length,
  };
  const selectedIndexes = [...selectedRows].filter((index) => index < rows.length);

  useEffect(() => {
    setSelectedRows(new Set());
  }, [activeTab, rows.length]);

  useEffect(() => {
    latestFirmRowsRef.current = rows;
  });

  useEffect(() => {
    if (!quickFocus) return;
    const focusKey = `firm-details:${activeTab}`;
    if (firmQuickFocusAppliedRef.current === focusKey) return;

    window.setTimeout(() => {
      const currentRows = latestFirmRowsRef.current;
      if (currentRows.length === 0) {
        firmInputRefs.current.addFirm?.focus();
        firmQuickFocusAppliedRef.current = focusKey;
        return;
      }

      for (const [index, row] of currentRows.entries()) {
        for (const key of ["firmName", "city", "emailId"] as const) {
          if (!hasFilledValue(row[key])) {
            firmInputRefs.current[`${index}:${key}`]?.focus();
            firmQuickFocusAppliedRef.current = focusKey;
            return;
          }
        }
      }
    }, 100);
  }, [activeTab, quickFocus, rows.length]);

  const toggleSelectedRow = (index: number, checked: boolean) => {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
  };

  const deleteFirm = (index: number) => {
    onDelete(activeTab, index);
    setSelectedRows(new Set());
  };

  const deleteSelectedFirms = () => {
    if (!selectedIndexes.length) return;
    onDeleteSelected(activeTab, selectedIndexes);
    setSelectedRows(new Set());
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <div className="mb-1.5 text-xs font-medium">Invited firms</div>
          <input
            value={firmCounts.invitedFirms}
            readOnly
            disabled={disabled}
            className={inputCls + disabledCls(disabled)}
          />
        </label>
        <label className="block">
          <div className="mb-1.5 text-xs font-medium">Bidders</div>
          <input
            value={firmCounts.bidderFirms}
            readOnly
            disabled={disabled}
            className={inputCls + disabledCls(disabled)}
          />
        </label>
      </div>

      <div className="inline-flex rounded-lg border border-border bg-background p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={
              "h-8 rounded-md px-3 text-sm font-medium transition-colors " +
              (activeTab === tab.key
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground")
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{selectedIndexes.length} selected</div>
        <button
          type="button"
          onClick={deleteSelectedFirms}
          disabled={disabled || selectedIndexes.length === 0}
          className={
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/30 bg-background px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10" +
            disabledCls(disabled || selectedIndexes.length === 0)
          }
        >
          <Trash2 className="size-3.5" /> Delete selected
        </button>
      </div>

      <div className="space-y-3">
        {rows.map((row, index) => {
          const lockedRow = lockedDetails[activeTab][index];
          const rowHasValue =
            hasFilledValue(lockedRow?.firmName) ||
            hasFilledValue(lockedRow?.city) ||
            hasFilledValue(lockedRow?.emailId);
          const firmNameDisabled =
            disabled || (lockFilledFields && hasFilledValue(lockedRow?.firmName));
          const cityDisabled = disabled || (lockFilledFields && hasFilledValue(lockedRow?.city));
          const emailDisabled =
            disabled || (lockFilledFields && hasFilledValue(lockedRow?.emailId));
          const rowActionDisabled = disabled || (lockFilledFields && rowHasValue);
          return (
            <div
              key={index}
              className="grid grid-cols-1 gap-3 rounded-md border border-border bg-secondary/20 p-3 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <label className="flex items-center gap-2 md:pt-7">
                <input
                  type="checkbox"
                  checked={selectedRows.has(index)}
                  onChange={(event) => toggleSelectedRow(index, event.target.checked)}
                  disabled={rowActionDisabled}
                  className="size-4 rounded border-border accent-primary"
                />
                <span className="text-xs text-muted-foreground md:sr-only">Select firm</span>
              </label>
              <label className="block">
                <div className="mb-1.5 text-xs font-medium">Firm name</div>
                <input
                  ref={(element) => {
                    firmInputRefs.current[`${index}:firmName`] = element;
                  }}
                  value={row.firmName ?? ""}
                  onChange={(event) => onChange(activeTab, index, "firmName", event.target.value)}
                  disabled={firmNameDisabled}
                  className={inputCls + disabledCls(firmNameDisabled)}
                />
              </label>
              <label className="block">
                <div className="mb-1.5 text-xs font-medium">City</div>
                <input
                  ref={(element) => {
                    firmInputRefs.current[`${index}:city`] = element;
                  }}
                  value={row.city ?? ""}
                  onChange={(event) => onChange(activeTab, index, "city", event.target.value)}
                  disabled={cityDisabled}
                  className={inputCls + disabledCls(cityDisabled)}
                />
              </label>
              <label className="block">
                <div className="mb-1.5 text-xs font-medium">Email id</div>
                <input
                  ref={(element) => {
                    firmInputRefs.current[`${index}:emailId`] = element;
                  }}
                  type="email"
                  value={row.emailId ?? ""}
                  onChange={(event) => onChange(activeTab, index, "emailId", event.target.value)}
                  disabled={emailDisabled}
                  className={inputCls + disabledCls(emailDisabled)}
                />
              </label>
              <button
                type="button"
                onClick={() => deleteFirm(index)}
                disabled={rowActionDisabled}
                aria-label="Delete firm"
                title="Delete firm"
                className={
                  "inline-flex size-9 items-center justify-center rounded-md border border-destructive/30 bg-background text-destructive hover:bg-destructive/10 md:self-end" +
                  disabledCls(rowActionDisabled)
                }
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        ref={(element) => {
          firmInputRefs.current.addFirm = element;
        }}
        type="button"
        onClick={() => onAdd(activeTab)}
        disabled={disabled}
        className={
          "h-9 rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-accent" +
          disabledCls(disabled)
        }
      >
        Add firm
      </button>
    </div>
  );
}

function SupplyOrdersBlock({
  form,
  lockedForm,
  orders,
  lockedOrders,
  disabled,
  lockFilledFields,
  gemDisabled,
  bgDisabled,
  quickFocus,
  onCountChange,
  onOrderChange,
}: {
  form: FormState;
  lockedForm: FormState;
  orders: SupplyOrderDetail[];
  lockedOrders: SupplyOrderDetail[];
  disabled: boolean;
  lockFilledFields: boolean;
  gemDisabled: boolean;
  bgDisabled: boolean;
  quickFocus?: boolean;
  onCountChange: (value: string) => void;
  onOrderChange: (index: number, key: SupplyOrderKey, value: string) => void;
}) {
  const orderFieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const orderQuickFocusAppliedRef = useRef("");
  const latestOrdersRef = useRef(orders);
  const [activeSubview, setActiveSubview] = useState<SupplyOrderSubviewKey>("supplyOrder");
  const activeSubviewFields = supplyOrderFields.filter((field) =>
    supplyOrderSubviewFields[activeSubview].includes(field.key as SupplyOrderKey),
  );

  useEffect(() => {
    latestOrdersRef.current = orders;
  });

  useEffect(() => {
    if (!quickFocus) return;
    const focusKey = "supply-order-and-payment";
    if (orderQuickFocusAppliedRef.current === focusKey) return;

    window.setTimeout(() => {
      if (!hasFilledValue(form.noOfSo)) {
        orderFieldRefs.current.noOfSo?.focus();
        orderQuickFocusAppliedRef.current = focusKey;
        return;
      }

      for (const [index, order] of latestOrdersRef.current.entries()) {
        for (const field of supplyOrderFields) {
          if (field.key === "soValueCapital") continue;
          const key = field.key as SupplyOrderKey;
          if (
            (gemDisabled && key === "gemSoNo") ||
            (bgDisabled && supplyOrderBgDisabledKeys.includes(key))
          ) {
            continue;
          }
          if (!hasFilledValue(String(order[key] ?? ""))) {
            orderFieldRefs.current[`${index}:${key}`]?.focus();
            orderQuickFocusAppliedRef.current = focusKey;
            return;
          }
        }
      }
    }, 100);
  }, [bgDisabled, form.noOfSo, gemDisabled, orders.length, quickFocus]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 rounded-md border border-border bg-secondary/20 p-1.5">
        {supplyOrderSubviewTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveSubview(tab.key)}
            className={
              "h-8 rounded px-3 text-xs font-medium transition " +
              (activeSubview === tab.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground")
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeSubview === "supplyOrder" ? (
        <DynamicField
          field={{ key: "noOfSo", label: "No. of S.O.", type: "number" }}
          value={form.noOfSo}
          disabled={disabled || (lockFilledFields && hasFilledValue(lockedForm.noOfSo))}
          onChange={onCountChange}
          inputRef={(element) => {
            orderFieldRefs.current.noOfSo = element;
          }}
        />
      ) : null}

      {!activeSubviewFields.length ? (
        <div className="rounded-md border border-dashed border-border bg-secondary/20 px-4 py-6 text-sm text-muted-foreground">
          No fields in this tab.
        </div>
      ) : null}

      {activeSubviewFields.length
        ? orders.map((order, index) => (
            <div key={index} className="rounded-md border border-border bg-secondary/20 p-4">
              <div className="mb-4 border-b border-border pb-2 text-sm font-semibold">
                Supply Order {index + 1}
              </div>
              <div className="grid grid-cols-1 gap-4">
                {activeSubviewFields.map((field) => {
                  const key = field.key as SupplyOrderKey;
                  const lockedOrder = lockedOrders[index];

                  if (field.key === "soValueCapital") {
                    return (
                      <SoValueField
                        key={field.key}
                        capitalSelected={form.valueCapitalSelected === "Yes"}
                        revenueSelected={form.valueRevenueSelected === "Yes"}
                        capitalValue={order.soValueCapital ?? ""}
                        revenueValue={order.soValueRevenue ?? ""}
                        disabled={disabled}
                        lockFilledFields={lockFilledFields}
                        lockedValueFilled={
                          hasFilledValue(lockedOrder?.soValueCapital) ||
                          hasFilledValue(lockedOrder?.soValueRevenue)
                        }
                        onChange={(patch) => {
                          if ("soValueCapital" in patch) {
                            onOrderChange(index, "soValueCapital", patch.soValueCapital);
                          }
                          if ("soValueRevenue" in patch) {
                            onOrderChange(index, "soValueRevenue", patch.soValueRevenue);
                          }
                        }}
                      />
                    );
                  }

                  return (
                    <DynamicField
                      key={field.key}
                      field={field}
                      value={String(order[key] ?? "")}
                      radioName={`supplyOrder-${index}-${field.key}`}
                      disabled={
                        disabled ||
                        (lockFilledFields && hasFilledValue(String(lockedOrder?.[key] ?? ""))) ||
                        (gemDisabled && key === "gemSoNo") ||
                        (bgDisabled && supplyOrderBgDisabledKeys.includes(key))
                      }
                      onChange={(value) => onOrderChange(index, key, value)}
                      inputRef={(element) => {
                        orderFieldRefs.current[`${index}:${key}`] = element;
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))
        : null}
    </div>
  );
}

function RemarksSummaryBlock({ form, remarks }: { form: FormState; remarks: FileRemark[] }) {
  const [stageFilter, setStageFilter] = useState("All");
  const [sortOrder, setSortOrder] = useState<"latest" | "oldest">("latest");
  const stageOptions = [
    "All",
    ...Array.from(new Set(remarks.map((remark) => remark.section).filter(Boolean))).sort(),
  ];
  const visibleRemarks = remarks
    .filter((remark) => remark.text.trim())
    .filter((remark) => stageFilter === "All" || remark.section === stageFilter)
    .sort((a, b) => {
      const direction = sortOrder === "latest" ? -1 : 1;
      return direction * compareRemarkDates(a.createdAt, b.createdAt);
    });

  return (
    <section
      id={sectionId("Remarks Summary")}
      className="md:col-span-2 scroll-mt-24 rounded-md border border-border bg-secondary/25 p-4"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div>
          <h3 className="text-sm font-semibold">Remarks Summary</h3>
          <span className="text-xs text-muted-foreground">
            {visibleRemarks.length} of {remarks.filter((remark) => remark.text.trim()).length}{" "}
            remarks shown
          </span>
        </div>
        <button
          type="button"
          onClick={() => printRemarksReport(form, visibleRemarks, stageFilter)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          <Printer className="size-3.5" /> Export PDF
        </button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block">
          <div className="mb-1.5 text-xs font-medium">Stage</div>
          <select
            value={stageFilter}
            onChange={(event) => setStageFilter(event.target.value)}
            className={inputCls}
          >
            {stageOptions.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="mb-1.5 text-xs font-medium">Sort</div>
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as "latest" | "oldest")}
            className={inputCls}
          >
            <option value="latest">Latest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>

      {visibleRemarks.length ? (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-secondary/70 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-40 px-3 py-2 text-left font-semibold">Date</th>
                <th className="w-56 px-3 py-2 text-left font-semibold">Stage</th>
                <th className="px-3 py-2 text-left font-semibold">Remark</th>
              </tr>
            </thead>
            <tbody>
              {visibleRemarks.map((remark) => (
                <tr key={remark.id} className="border-t border-border">
                  <td className="px-3 py-2 align-top text-muted-foreground">
                    {formatRemarkDate(remark.createdAt)}
                  </td>
                  <td className="px-3 py-2 align-top font-medium">{remark.section}</td>
                  <td className="whitespace-pre-wrap px-3 py-2 align-top">{remark.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Remarks added through stage-wise Add remark buttons will appear here.
        </p>
      )}
    </section>
  );
}

function TimelineBlock({
  form,
  supplyOrders,
  divisions,
}: {
  form: FormState;
  supplyOrders: SupplyOrderDetail[];
  divisions: ReturnType<typeof useDivisions>;
}) {
  const [showAllDates, setShowAllDates] = useState(false);
  const enabledTimelineFields = getEnabledTimelineFields(form, divisions);
  const allItems = [
    ...enabledTimelineFields.map((field, index) => ({
      label: field.label,
      date: form[field.key],
      order: index,
    })),
    ...getSupplyOrderTimelineItems(supplyOrders, enabledTimelineFields.length),
  ];
  const filledItems = allItems
    .map((field) => ({
      label: field.label,
      date: field.date,
      order: field.order,
    }))
    .filter((item) => item.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const items = showAllDates ? getFullTimelineItems(allItems) : filledItems;
  const timelineMetrics = getTimelineMetrics(filledItems);

  return (
    <section
      id={sectionId("Timeline")}
      className="md:col-span-2 scroll-mt-24 rounded-md border border-border bg-secondary/25 p-4"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div>
          <h3 className="text-sm font-semibold">Timeline</h3>
          <span className="text-xs text-muted-foreground">
            {filledItems.length} of {allItems.length} date fields filled
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => printTimelineReport(form, filledItems)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            <Printer className="size-3.5" /> Print
          </button>
          <div className="inline-flex rounded-md border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => setShowAllDates(false)}
              className={
                "h-7 rounded px-2.5 text-xs font-medium " +
                (!showAllDates ? "bg-primary text-primary-foreground" : "text-muted-foreground")
              }
            >
              Filled only
            </button>
            <button
              type="button"
              onClick={() => setShowAllDates(true)}
              className={
                "h-7 rounded px-2.5 text-xs font-medium " +
                (showAllDates ? "bg-primary text-primary-foreground" : "text-muted-foreground")
              }
            >
              All dates
            </button>
          </div>
        </div>
      </div>

      {filledItems.length === 0 && !showAllDates ? (
        <p className="text-sm text-muted-foreground">
          Timeline will appear here as date fields are filled.
        </p>
      ) : (
        <ol className="relative space-y-0">
          <span className="absolute left-[5.75rem] top-2 bottom-2 w-px bg-success/60" />
          {items.map((item) => {
            const metrics = timelineMetrics.get(getTimelineItemKey(item));
            return (
              <li key={`${item.label}-${item.date || "empty"}`} className="relative pb-4 last:pb-0">
                <div className="grid grid-cols-[4.5rem_1.5rem_minmax(0,1fr)] items-start gap-2">
                  <div className="pt-0.5 text-right text-[11px] font-medium text-muted-foreground">
                    {item.date ? formatDayCount(metrics?.gapDays) : "-"}
                  </div>
                  <div className="relative flex h-5 justify-center">
                    <span
                      className={
                        "mt-1.5 size-3 rounded-full border-2 border-card " +
                        (item.date
                          ? "bg-success shadow-[0_0_0_3px_var(--color-success)]/10"
                          : "bg-muted-foreground/35")
                      }
                    />
                  </div>
                  <div className="rounded-md border border-border bg-card px-3 py-2.5">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div
                        className={
                          item.date
                            ? "min-w-0 text-sm font-medium"
                            : "min-w-0 text-sm text-muted-foreground"
                        }
                      >
                        {item.label}
                      </div>
                      <div className="shrink-0 text-right text-[11px] font-medium text-muted-foreground">
                        {item.date ? formatDayCount(metrics?.cumulativeDays) : "-"}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {item.date ? formatTimelineDate(item.date) : "Not filled"}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function MilestonesBlock({
  milestones,
  applicableMilestones,
  currentMilestone,
  completedMilestones,
  autoCompletedMilestones,
  lockedCurrentMilestone,
  lockedCompletedMilestones,
  disabled,
  lockFilledFields,
  lockControl,
  onCurrentChange,
  onCompletedChange,
}: {
  milestones: string[];
  applicableMilestones: Set<string>;
  currentMilestone: string;
  completedMilestones: string[];
  autoCompletedMilestones: string[];
  lockedCurrentMilestone: string;
  lockedCompletedMilestones: string[];
  disabled: boolean;
  lockFilledFields: boolean;
  lockControl: ReactNode;
  onCurrentChange: (value: string) => void;
  onCompletedChange: (value: string[]) => void;
}) {
  const completedSet = new Set([...completedMilestones, ...autoCompletedMilestones]);
  const autoCompletedSet = new Set(autoCompletedMilestones);
  const lockedCompletedSet = new Set(lockedCompletedMilestones);
  const applicableMilestoneList = milestones.filter((milestone) =>
    applicableMilestones.has(milestone),
  );
  const applicableCount = applicableMilestoneList.length;
  const applicableCompletedCount = applicableMilestoneList.filter((milestone) =>
    completedSet.has(milestone),
  ).length;

  const toggleCurrent = (milestone: string) => {
    if (disabled) return;
    if (!applicableMilestones.has(milestone) || completedSet.has(milestone)) return;
    onCurrentChange(currentMilestone === milestone ? "" : milestone);
  };

  const toggleCompleted = (milestone: string) => {
    if (disabled) return;
    if (!applicableMilestones.has(milestone)) return;
    if (autoCompletedSet.has(milestone)) return;
    const next = new Set(completedSet);
    if (next.has(milestone)) {
      next.delete(milestone);
    } else {
      next.add(milestone);
      if (currentMilestone === milestone) {
        onCurrentChange("");
      }
    }
    onCompletedChange(
      milestones.filter((item) => applicableMilestones.has(item) && next.has(item)),
    );
  };

  return (
    <section
      id={sectionId("Milestones")}
      className="md:col-span-2 scroll-mt-24 rounded-md border border-border bg-secondary/25 p-4"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div>
          <h3 className="text-sm font-semibold">Milestones</h3>
          <span className="text-xs text-muted-foreground">
            Select the current stage and mark completed stages manually.
          </span>
        </div>
        {lockControl}
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold">Applicable stages</h4>
            <p className="text-xs text-muted-foreground">
              Select one current stage and mark completed stages.
            </p>
          </div>
          <span className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs tabular-nums text-muted-foreground">
            {applicableCompletedCount}/{applicableCount}
          </span>
        </div>
        <div className="overflow-hidden rounded-md border border-border bg-background">
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] border-b border-border bg-secondary/35 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
            <div>Stage</div>
            <div className="text-center">Current</div>
            <div className="text-center">Completed</div>
          </div>
          {applicableMilestoneList.map((milestone) => {
            const isCompleted = completedSet.has(milestone);
            const isAutoCompleted = autoCompletedSet.has(milestone);
            const isCurrent = currentMilestone === milestone;
            const isFileClosed = normalizeMilestoneName(milestone) === "fileclosed";
            const currentDisabled =
              isFileClosed ||
              disabled ||
              isCompleted ||
              (lockFilledFields && hasFilledValue(lockedCurrentMilestone));
            const completedDisabled =
              disabled ||
              isAutoCompleted ||
              (lockFilledFields && lockedCompletedSet.has(milestone));
            return (
              <div
                key={milestone}
                className={`grid min-h-10 grid-cols-[minmax(0,1fr)_6rem_6rem] items-center border-b border-border px-3 py-2 text-sm last:border-b-0 ${
                  isCurrent ? "bg-primary/10 font-semibold text-primary" : ""
                } ${isCompleted ? "text-muted-foreground" : ""}`}
              >
                <div className="min-w-0 truncate">{milestone}</div>
                <div className="flex justify-center">
                  {isFileClosed ? (
                    <span className="text-xs text-muted-foreground">-</span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={isCurrent}
                      disabled={currentDisabled}
                      onChange={() => toggleCurrent(milestone)}
                      className="size-4 accent-primary disabled:cursor-not-allowed"
                      aria-label={`Mark ${milestone} as current`}
                    />
                  )}
                </div>
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={isCompleted}
                    disabled={completedDisabled}
                    onChange={() => toggleCompleted(milestone)}
                    className="size-4 accent-primary disabled:cursor-not-allowed"
                    aria-label={`Mark ${milestone} as completed`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function formatTimelineDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getTimelineDayGap(fromDate: string, toDate: string) {
  const fromTime = parseTimelineDateTime(fromDate);
  const toTime = parseTimelineDateTime(toDate);
  if (fromTime === undefined || toTime === undefined) return undefined;
  return Math.round((toTime - fromTime) / 86_400_000);
}

function parseTimelineDateTime(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  const time = parsed.getTime();
  return Number.isNaN(time) ? undefined : time;
}

function formatDayCount(days: number | undefined) {
  if (days === undefined) return "-";
  return `${days} ${Math.abs(days) === 1 ? "day" : "days"}`;
}

function getTimelineMetrics(items: TimelineItem[]) {
  const firstItem = items[0];
  return new Map(
    items.map((item, index) => {
      const previousItem = items[index - 1];
      const gapDays = previousItem ? getTimelineDayGap(previousItem.date, item.date) : undefined;
      const cumulativeDays = firstItem ? getTimelineDayGap(firstItem.date, item.date) : undefined;

      return [getTimelineItemKey(item), { gapDays, cumulativeDays }];
    }),
  );
}

function getFullTimelineItems(items: TimelineItem[]) {
  return [...items].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date) || a.order - b.order;
    if (a.date) return -1;
    if (b.date) return 1;
    return a.order - b.order;
  });
}

function getSupplyOrderTimelineItems(supplyOrders: SupplyOrderDetail[], startOrder: number) {
  const dateFields = supplyOrderFields.filter((field) => field.type === "date");
  const showOrderNumber = supplyOrders.length > 1;
  return supplyOrders.flatMap((order, orderIndex) =>
    dateFields
      .filter((field) => field.key !== "revisedDp" || isYes(order.dpExtension ?? ""))
      .map((field, fieldIndex) => {
        const key = field.key as SupplyOrderKey;
        return {
          label: showOrderNumber ? `${field.label} (S.O. ${orderIndex + 1})` : field.label,
          date: String(order[key] ?? ""),
          order: startOrder + orderIndex * dateFields.length + fieldIndex,
        };
      }),
  );
}

function getTimelineItemKey(item: TimelineItem) {
  return `${item.label}-${item.date}`;
}

function compareRemarkDates(a: string, b: string) {
  return getRemarkTime(a) - getRemarkTime(b);
}

function getRemarkTime(value: string) {
  const dateValue = getRemarkDateInputValue(value);
  const localTime = parseLocalDateTime(dateValue);
  if (localTime !== undefined) return localTime;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function printTimelineReport(form: FormState, filledItems: TimelineItem[]) {
  const details = [
    { label: "Control number", value: form.imms },
    { label: "Division", value: form.division },
    { label: "Description", value: form.demandDescription },
    { label: "Indentor", value: form.indentor },
  ];
  const timelineRows = filledItems.map((item, index) => {
      const firstItem = filledItems[0];
      const previousItem = filledItems[index - 1];
      const gapDays = previousItem ? getTimelineDayGap(previousItem.date, item.date) : undefined;
      const cumulativeDays = firstItem ? getTimelineDayGap(firstItem.date, item.date) : undefined;

      return [
        index + 1,
        item.label,
        formatTimelineDate(item.date),
        formatDayCount(gapDays),
        formatDayCount(cumulativeDays),
      ];
    });

  void downloadBackendExport({
    format: "pdf",
    title: "File Timeline",
    fileName: `${getExportFileName(form.imms || form.uniqueCode || "timeline")}.pdf`,
    tables: [
      {
        title: "File details",
        headers: ["S.No.", "Field", "Value"],
        rows: details.map((detail, index) => [index + 1, detail.label, detail.value || "Not set"]),
      },
      {
        title: "Timeline",
        headers: ["S.No.", "Field", "Date", "Time gap", "Cumulative time"],
        rows: timelineRows.length ? timelineRows : [["No timeline fields are filled."]],
      },
    ],
  });
}

function printRemarksReport(form: FormState, remarks: FileRemark[], stageFilter: string) {
  const details = [
    { label: "Unique code", value: form.uniqueCode },
    { label: "Control number", value: form.imms },
    { label: "Division", value: form.division },
    { label: "Indentor", value: form.indentor },
    { label: "Description", value: form.demandDescription },
  ];
  void downloadBackendExport({
    format: "pdf",
    title: "Remarks Summary",
    subtitle: `Stage: ${stageFilter}`,
    fileName: `${getExportFileName(form.imms || form.uniqueCode || "remarks-summary")}.pdf`,
    tables: [
      {
        title: "File details",
        headers: ["S.No.", "Field", "Value"],
        rows: details.map((detail, index) => [index + 1, detail.label, detail.value || "Not set"]),
      },
      {
        title: "Remarks",
        headers: ["S.No.", "Date", "Stage", "Remark"],
        rows: remarks.length
          ? remarks.map((remark, index) => [
              index + 1,
              formatRemarkDate(remark.createdAt),
              remark.section,
              remark.text,
            ])
          : [["No remarks are available for the selected filter."]],
      },
    ],
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sectionId(title: string) {
  return `add-section-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

const inputCls =
  "w-full max-w-md h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition";

const textareaCls =
  "w-full max-w-2xl min-h-20 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition resize-y";

function sectionBlockCls(index: number) {
  const accents = [
    "border-l-primary",
    "border-l-success",
    "border-l-warning",
    "border-l-chart-5",
    "border-l-destructive",
    "border-l-chart-2",
  ];
  return `md:col-span-2 scroll-mt-24 rounded-md border border-l-2 border-border bg-card p-4 shadow-sm ${accents[index % accents.length]}`;
}

function sectionStripeCls(index: number) {
  const colors = [
    "bg-primary",
    "bg-success",
    "bg-warning",
    "bg-chart-5",
    "bg-destructive",
    "bg-chart-2",
  ];
  return `inline-block h-4 w-1 rounded-full ${colors[index % colors.length]}`;
}

function toFilePayload(form: FormState) {
  return Object.fromEntries(
    Object.entries(form)
      .filter(([key]) => key !== "valueCapitalSelected" && key !== "valueRevenueSelected")
      .map(([key, value]) => [key, value || undefined]),
  ) as Omit<import("@/lib/files-store").FileRecord, "id" | "createdAt">;
}

function cleanFirmRows(rows: FirmDetail[]) {
  const cleaned = rows
    .map((row) => ({
      firmName: row.firmName?.trim() || undefined,
      city: row.city?.trim() || undefined,
      emailId: row.emailId?.trim() || undefined,
    }))
    .filter((row) => row.firmName || row.city || row.emailId);
  return cleaned.length ? cleaned : undefined;
}

function createRemarksFromFile(file: FileRecord | undefined) {
  return (
    file?.remarks
      ?.map((remark) => ({
        id: remark.id || createRemarkId(),
        section: remark.section || "File details",
        text: remark.text ?? "",
        createdAt: getRemarkDateInputValue(remark.createdAt) || formatLocalDate(new Date()),
      }))
      .filter((remark) => remark.section) ?? []
  );
}

function cleanFileRemarks(remarks: FileRemark[]) {
  const cleaned = remarks
    .map((remark) => ({
      id: remark.id || createRemarkId(),
      section: remark.section,
      text: remark.text.trim(),
      createdAt: getRemarkDateInputValue(remark.createdAt) || formatLocalDate(new Date()),
    }))
    .filter((remark) => remark.section && remark.text);
  return cleaned.length ? cleaned : undefined;
}

function createRemarkId() {
  return globalThis.crypto?.randomUUID?.() ?? `remark-${Date.now()}-${Math.random()}`;
}

function formatRemarkDate(value: string) {
  if (!value) return "";
  const dateValue = getRemarkDateInputValue(value);
  const date = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getRemarkDateInputValue(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatLocalDate(date);
}

function getTcecCommitteeOptions(committees: string[] | undefined, currentValue: string) {
  const values = (committees ?? []).filter(Boolean);
  return currentValue && !values.includes(currentValue) ? [...values, currentValue] : values;
}

function getConfiguredMilestones(milestones: string[] | undefined) {
  const values = (milestones ?? [])
    .map((item) => normalizeConfiguredMilestoneLabel(item.trim()))
    .filter(Boolean);
  const configured = values.length ? values : defaultMilestones;
  return appendFileClosedMilestone(configured);
}

function appendFileClosedMilestone(milestones: string[]) {
  const withoutFileClosed = milestones.filter(
    (milestone) =>
      normalizeMilestoneName(milestone) !== normalizeMilestoneName(fileClosedMilestone),
  );
  return [...withoutFileClosed, fileClosedMilestone];
}

function normalizeConfiguredMilestoneLabel(milestone: string) {
  return normalizeMilestoneName(milestone) === "controlled" ? "Controlling" : milestone;
}

function getApplicableMilestones(
  milestones: string[],
  form: FormState,
  supplyOrders: SupplyOrderDetail[],
  divisions: Division[],
) {
  return new Set(
    milestones.filter((milestone) =>
      isMilestoneApplicableToFile(milestone, form, supplyOrders, divisions),
    ),
  );
}

function isMilestoneApplicableToFile(
  milestone: string,
  form: FormState,
  supplyOrders: SupplyOrderDetail[],
  divisions: Division[],
) {
  const key = normalizeMilestoneName(milestone);

  if (key === "highvalue") return isYes(form.highValue);
  if (key === "pretcec" || key === "posttcec" || key === "cnc") return isYes(form.tcec);
  if (key === "ad") return isYes(form.ad) && !isDivisionAdNo(form.division, divisions);
  if (key === "rqa") return isYes(form.rqa);
  if (key === "ifa") return isYes(form.ifa);
  if (key === "bankguarantee") return isYes(form.bg);

  return true;
}

function normalizeMilestoneName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanSupplyOrderRows(rows: SupplyOrderDetail[]) {
  const normalized = rows.map((row) => applySupplyOrderRules(row, undefined));
  return normalized.map((row) => ({
    soNo: row.soNo?.trim() || undefined,
    gemSoNo: row.gemSoNo?.trim() || undefined,
    soDate: row.soDate || undefined,
    soValueCapital: row.soValueCapital || undefined,
    soValueRevenue: row.soValueRevenue || undefined,
    dpDate: row.dpDate || undefined,
    firm: row.firm?.trim() || undefined,
    bgValidityDate: row.bgValidityDate || undefined,
    dpExtension: row.dpExtension || undefined,
    dpExtensionCount: row.dpExtensionCount || undefined,
    ld: row.ld || undefined,
    revisedDp: row.revisedDp || undefined,
    materialReceiptDate: row.materialReceiptDate || undefined,
    irPreparationDate: row.irPreparationDate || undefined,
    irReceiptDate: row.irReceiptDate || undefined,
    billPreparationDate: row.billPreparationDate || undefined,
    billSentForPaymentDate: row.billSentForPaymentDate || undefined,
    paymentDate: row.paymentDate || undefined,
    paymentMode: row.paymentMode || undefined,
    bgReturnDate: row.bgReturnDate || undefined,
    demandCancelled: row.demandCancelled || undefined,
    soCancelled: row.soCancelled || undefined,
    soCancelledDate: row.soCancelledDate || undefined,
  }));
}

function normalizeSupplyOrderRows(file: FileRecord | undefined) {
  const rows =
    file?.supplyOrders
      ?.map((row) => applySupplyOrderRules({ ...emptySupplyOrder, ...row }, undefined))
      .filter((row) => Object.values(row).some(Boolean)) ?? [];
  if (rows.length) return rows;
  if (!file) return [];

  const legacy = applySupplyOrderRules(
    {
      soNo: file.soNo ?? "",
      gemSoNo: file.gemSoNo ?? "",
      soDate: file.soDate ?? "",
      soValueCapital: file.soValueCapital ?? "",
      soValueRevenue: file.soValueRevenue ?? "",
      dpDate: file.dpDate ?? "",
      firm: file.firm ?? "",
      bgValidityDate: file.bgValidityDate ?? "",
      dpExtension: file.dpExtension ?? "No",
      dpExtensionCount: file.dpExtensionCount ?? "",
      ld: file.ld ?? "",
      revisedDp: file.revisedDp ?? "",
      materialReceiptDate: file.materialReceiptDate ?? "",
      irPreparationDate: file.irPreparationDate ?? "",
      irReceiptDate: file.irReceiptDate ?? "",
      billPreparationDate: file.billPreparationDate ?? "",
      billSentForPaymentDate: file.billSentForPaymentDate ?? "",
      paymentDate: file.paymentDate ?? "",
      paymentMode: file.paymentMode ?? "",
      bgReturnDate: file.bgReturnDate ?? "",
      demandCancelled: file.demandCancelled ?? "No",
      soCancelled: file.soCancelled ?? "No",
      soCancelledDate: file.soCancelledDate ?? "",
    },
    undefined,
  );
  return Object.values(legacy).some(Boolean) ? [legacy] : [];
}

function legacySupplyOrderPatch(rows: SupplyOrderDetail[]) {
  const first = rows[0] ?? emptySupplyOrder;
  return {
    soNo: first.soNo || undefined,
    gemSoNo: first.gemSoNo || undefined,
    soDate: first.soDate || undefined,
    soValueCapital: first.soValueCapital || undefined,
    soValueRevenue: first.soValueRevenue || undefined,
    dpDate: first.dpDate || undefined,
    firm: first.firm || undefined,
    bgValidityDate: first.bgValidityDate || undefined,
    dpExtension: first.dpExtension || undefined,
    dpExtensionCount: first.dpExtensionCount || undefined,
    ld: first.ld || undefined,
    revisedDp: first.revisedDp || undefined,
    materialReceiptDate: first.materialReceiptDate || undefined,
    irPreparationDate: first.irPreparationDate || undefined,
    irReceiptDate: first.irReceiptDate || undefined,
    billPreparationDate: first.billPreparationDate || undefined,
    billSentForPaymentDate: first.billSentForPaymentDate || undefined,
    paymentDate: first.paymentDate || undefined,
    paymentMode: first.paymentMode || undefined,
    bgReturnDate: first.bgReturnDate || undefined,
    demandCancelled: first.demandCancelled || undefined,
    soCancelled: first.soCancelled || undefined,
    soCancelledDate: first.soCancelledDate || undefined,
  };
}

function resizeSupplyOrders(rows: SupplyOrderDetail[], count: number) {
  return Array.from({ length: count }, (_, index) =>
    applySupplyOrderRules({ ...emptySupplyOrder, ...(rows[index] ?? {}) }, undefined),
  );
}

function clampSupplyOrderCount(value: string) {
  const count = Number.parseInt(value, 10);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(50, count));
}

function hasSavedSupplyOrders(file: FileRecord | undefined) {
  return normalizeSupplyOrderRows(file).length > 0;
}

function hasSavedFirmDetails(file: FileRecord | undefined) {
  return Boolean(cleanFirmRows(file?.invitedFirms ?? []) || cleanFirmRows(file?.bidderFirms ?? []));
}

function applyConditionalRules(form: FormState) {
  let next = form;
  if (isInr(next.currency) && !next.exchangeRate) {
    next = {
      ...next,
      exchangeRate: "1",
    };
  }
  if (next.valueCapitalSelected === "Yes") {
    next = {
      ...next,
      valueRevenue: "",
      valueRevenueSelected: "",
      soValueRevenue: "",
    };
  }
  if (next.valueRevenueSelected === "Yes") {
    next = {
      ...next,
      valueCapital: "",
      valueCapitalSelected: "",
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
      adVettingDate: "",
      postTcecDate: "",
      postTcecMinutesDate: "",
      postTcecCommitteeNumber: "",
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

function applySupplyOrderRules(
  order: SupplyOrderDetail,
  form: Pick<FormState, "valueCapitalSelected" | "valueRevenueSelected"> | undefined,
) {
  let next: SupplyOrderDetail = { ...emptySupplyOrder, ...order };
  if (form?.valueCapitalSelected === "Yes") {
    next = { ...next, soValueRevenue: "" };
  }
  if (form?.valueRevenueSelected === "Yes") {
    next = { ...next, soValueCapital: "" };
  }
  if (isYes(next.dpExtension ?? "")) {
    next = { ...next, dpExtensionCount: getInitialExtensionCount(next.dpExtensionCount ?? "") };
  }
  if (isNo(next.dpExtension ?? "")) {
    next = { ...next, dpExtensionCount: "" };
  }
  return next;
}

function getSupplyOrderPatch(
  order: SupplyOrderDetail,
  key: SupplyOrderKey,
  value: string,
): SupplyOrderDetail {
  if (key !== "soValueCapital" && key !== "soValueRevenue") {
    return { ...order, [key]: value };
  }

  const amount = formatDecimalInput(value);
  return {
    ...order,
    [key]: amount,
    ...(hasNonZeroAmount(amount)
      ? { [key === "soValueCapital" ? "soValueRevenue" : "soValueCapital"]: "" }
      : {}),
  };
}

function hasNonZeroAmount(value: string | undefined) {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return false;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount !== 0;
}

function findValueThresholdMatch(
  levels: ValueThresholdLevel[] | undefined,
  form: Pick<
    FormState,
    | "valueCapital"
    | "valueRevenue"
    | "valueCapitalSelected"
    | "valueRevenueSelected"
    | "currency"
    | "exchangeRate"
  >,
) {
  if (!levels?.length) return undefined;
  const valueType =
    form.valueCapitalSelected === "Yes"
      ? "capital"
      : form.valueRevenueSelected === "Yes"
        ? "revenue"
        : undefined;
  if (!valueType) return undefined;
  const amount = parseMoneyAmount(valueType === "capital" ? form.valueCapital : form.valueRevenue);
  if (amount === undefined) return undefined;
  const currency = (form.currency || "INR").trim().toUpperCase();
  const exchangeRate = currency && currency !== "INR" ? parseMoneyAmount(form.exchangeRate) : 1;
  if (exchangeRate === undefined || exchangeRate <= 0) return undefined;
  const inrAmount = amount * exchangeRate;

  return levels.find((level) => {
    if (level.appliesTo !== "both" && level.appliesTo !== valueType) return false;
    const min = parseMoneyAmount(level.minValue);
    const max = parseMoneyAmount(level.maxValue);
    if (min !== undefined && inrAmount < min) return false;
    if (max !== undefined && inrAmount > max) return false;
    return true;
  });
}

function parseMoneyAmount(value: string | undefined) {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : undefined;
}

function isNo(value: string) {
  return value.trim().toLowerCase() === "no";
}

function isYes(value: string) {
  return value.trim().toLowerCase() === "yes";
}

function isInr(value: string | undefined) {
  return (value ?? "").trim().toUpperCase() === "INR";
}

function getInitialExtensionCount(value: string) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? value : "1";
}

function getAutoTenderLive(form: FormState) {
  if (hasDate(form.refloatBiddingDate) && hasDate(form.refloatBidOpeningDate)) {
    return isTenderLiveOnCalendarDate(form.refloatBiddingDate, form.refloatBidOpeningDate)
      ? "Yes"
      : "No";
  }

  return isTenderLiveOnCalendarDate(form.bidDate, form.bidOpeningDate) ? "Yes" : "No";
}

function isTenderLiveOnCalendarDate(bidDate: string, bidOpeningDate: string) {
  const bidTime = parseLocalDateTime(bidDate);
  const openingTime = parseLocalDateTime(bidOpeningDate);
  const todayTime = parseLocalDateTime(formatLocalDate(new Date()));

  if (bidTime === undefined || openingTime === undefined || todayTime === undefined) {
    return false;
  }

  return bidTime <= todayTime && todayTime <= openingTime;
}

function hasDate(date: string) {
  return parseLocalDateTime(date) !== undefined;
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

function isDivisionAdNo(divisionName: string, divisions: ReturnType<typeof useDivisions>) {
  const division = divisions.find(
    (item) => item.name.trim().toLowerCase() === divisionName.trim().toLowerCase(),
  );
  return isNo(division?.ad ?? "");
}

function clearDivisionDisabledFields(form: FormState, divisions: ReturnType<typeof useDivisions>) {
  return isDivisionAdNo(form.division, divisions) ? { ...form, adVettingDate: "" } : form;
}

function getEnabledTimelineFields(form: FormState, divisions: ReturnType<typeof useDivisions>) {
  return timelineFields.filter((field) => !isTimelineFieldDisabled(field.key, form, divisions));
}

function isTimelineFieldDisabled(
  key: FieldKey,
  form: FormState,
  divisions: ReturnType<typeof useDivisions>,
) {
  return (
    (key === "adVettingDate" && isDivisionAdNo(form.division, divisions)) ||
    (isNo(form.tcec) && tcecDisabledKeys.includes(key)) ||
    (isNo(form.gem) && gemDisabledKeys.includes(key)) ||
    (isNo(form.highValue) && highValueDisabledKeys.includes(key)) ||
    (isNo(form.rqa) && rqaDisabledKeys.includes(key)) ||
    (isNo(form.ifa) && ifaDisabledKeys.includes(key)) ||
    (isNo(form.bg) && bgDisabledKeys.includes(key)) ||
    (isNo(form.rfpVetting) && rfpVettingDisabledKeys.includes(key)) ||
    (isNo(form.refloat) && refloatDisabledKeys.includes(key))
  );
}

function getSavedFileValue(file: FileRecord | undefined, key: FieldKey) {
  if (!file) return undefined;
  return (file as Record<string, unknown>)[key];
}

function generateUniqueCode(
  financialYear: string,
  divisionName: string,
  divisions: ReturnType<typeof useDivisions>,
  files: FileRecord[],
) {
  const division = divisions.find(
    (item) => item.name.trim().toLowerCase() === divisionName.trim().toLowerCase(),
  );
  const divisionCode = (division?.code ?? "").replace(/\s+/g, "");
  const yearCode = financialYear.replace(/\D/g, "").slice(-2);
  if (!yearCode || !divisionCode) return "";

  const prefix = `${yearCode}${divisionCode}`;
  const nextSerial =
    files.reduce((max, file) => {
      if (!file.uniqueCode?.startsWith(prefix)) return max;
      const serial = Number(file.uniqueCode.slice(prefix.length));
      return Number.isFinite(serial) ? Math.max(max, serial) : max;
    }, 0) + 1;

  return `${prefix}${String(nextSerial).padStart(3, "0")}`;
}

function ValueField({
  capitalValue,
  revenueValue,
  capitalSelected,
  revenueSelected,
  thresholdMatch,
  disabled,
  lockFilledFields = false,
  lockedSelectionFilled = false,
  lockedValueFilled = false,
  onChange,
}: {
  capitalValue: string;
  revenueValue: string;
  capitalSelected: boolean;
  revenueSelected: boolean;
  thresholdMatch?: ValueThresholdLevel;
  disabled: boolean;
  lockFilledFields?: boolean;
  lockedSelectionFilled?: boolean;
  lockedValueFilled?: boolean;
  onChange: (
    patch: Pick<
      FormState,
      "valueCapital" | "valueRevenue" | "valueCapitalSelected" | "valueRevenueSelected"
    >,
  ) => void;
}) {
  const value = capitalSelected ? capitalValue : revenueSelected ? revenueValue : "";
  const selected = capitalSelected || revenueSelected;
  const selectionDisabled = disabled || (lockFilledFields && lockedSelectionFilled);
  const valueDisabled = disabled || !selected || (lockFilledFields && lockedValueFilled);

  const updateCapital = (checked: boolean) => {
    onChange({
      valueCapital: checked ? value : "",
      valueRevenue: "",
      valueCapitalSelected: checked ? "Yes" : "",
      valueRevenueSelected: "",
    });
  };

  const updateRevenue = (checked: boolean) => {
    onChange({
      valueCapital: "",
      valueRevenue: checked ? value : "",
      valueCapitalSelected: "",
      valueRevenueSelected: checked ? "Yes" : "",
    });
  };

  const updateValue = (nextValue: string) => {
    const cleanedValue = formatDecimalInput(nextValue);
    onChange({
      valueCapital: capitalSelected ? cleanedValue : "",
      valueRevenue: !capitalSelected && revenueSelected ? cleanedValue : "",
      valueCapitalSelected: capitalSelected ? "Yes" : "",
      valueRevenueSelected: !capitalSelected && revenueSelected ? "Yes" : "",
    });
  };

  return (
    <Field label="Value">
      <div className={`space-y-2 ${disabledCls(disabled)}`}>
        <div className="grid max-w-md grid-cols-2 gap-2">
          <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
            <input
              type="checkbox"
              checked={capitalSelected}
              disabled={selectionDisabled}
              onChange={(event) => updateCapital(event.target.checked)}
              className="size-4 rounded border-input"
            />
            Capital
          </label>
          <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
            <input
              type="checkbox"
              checked={revenueSelected}
              disabled={selectionDisabled}
              onChange={(event) => updateRevenue(event.target.checked)}
              className="size-4 rounded border-input"
            />
            Revenue
          </label>
        </div>
        <input
          value={value}
          onChange={(event) => updateValue(event.target.value)}
          inputMode="decimal"
          disabled={valueDisabled}
          placeholder="Enter value"
          className={inputCls + disabledCls(valueDisabled)}
        />
        <div className="min-h-5 text-xs text-muted-foreground">
          {thresholdMatch
            ? `Threshold: ${thresholdMatch.label}`
            : selected
              ? "No threshold level matched."
              : "Select Capital or Revenue to match a threshold."}
        </div>
      </div>
    </Field>
  );
}

function SoValueField({
  capitalSelected,
  revenueSelected,
  capitalValue,
  revenueValue,
  disabled,
  lockFilledFields = false,
  lockedValueFilled = false,
  onChange,
}: {
  capitalSelected: boolean;
  revenueSelected: boolean;
  capitalValue: string;
  revenueValue: string;
  disabled: boolean;
  lockFilledFields?: boolean;
  lockedValueFilled?: boolean;
  onChange: (patch: Pick<FormState, "soValueCapital" | "soValueRevenue">) => void;
}) {
  const selectedType = capitalSelected ? "Capital" : revenueSelected ? "Revenue" : "";
  const value = capitalSelected ? capitalValue : revenueSelected ? revenueValue : "";
  const fieldDisabled = disabled || !selectedType || (lockFilledFields && lockedValueFilled);

  const updateValue = (nextValue: string) => {
    const cleanedValue = formatDecimalInput(nextValue);
    onChange({
      soValueCapital: capitalSelected ? cleanedValue : "",
      soValueRevenue: revenueSelected ? cleanedValue : "",
    });
  };

  return (
    <Field label="S.O. value">
      <div className={`space-y-2 ${disabledCls(fieldDisabled)}`}>
        <div className="grid max-w-md grid-cols-2 gap-2">
          <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
            <input
              type="checkbox"
              checked={capitalSelected}
              readOnly
              disabled
              className="size-4 rounded border-input"
            />
            Capital
          </label>
          <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
            <input
              type="checkbox"
              checked={revenueSelected}
              readOnly
              disabled
              className="size-4 rounded border-input"
            />
            Revenue
          </label>
        </div>
        <input
          value={value}
          onChange={(event) => updateValue(event.target.value)}
          inputMode="decimal"
          disabled={fieldDisabled}
          placeholder={
            selectedType
              ? `Enter S.O. ${selectedType.toLowerCase()} value`
              : "Select Capital or Revenue above"
          }
          className={inputCls + disabledCls(fieldDisabled)}
        />
      </div>
    </Field>
  );
}

function DynamicField({
  field,
  value,
  disabled = false,
  onChange,
  inputRef,
  radioName,
}: {
  field: ExtraField;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  inputRef?: (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null) => void;
  radioName?: string;
}) {
  if (field.options && isYesNoOptions(field.options)) {
    return (
      <Field label={field.label}>
        <RadioGroup
          name={radioName ?? field.key}
          options={field.options}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      </Field>
    );
  }

  if (field.typeahead && field.options) {
    const listId = `${field.key}-options`;
    return (
      <Field label={field.label}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.placeholder}
          list={listId}
          className={inputCls + disabledCls(disabled)}
        />
        <datalist id={listId}>
          {field.options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </Field>
    );
  }

  if (field.options) {
    return (
      <Field label={field.label}>
        <select
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={inputCls + disabledCls(disabled)}
        >
          <option value="">Select</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  if (field.type === "textarea") {
    return (
      <Field label={field.label}>
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={field.placeholder}
          className={textareaCls + disabledCls(disabled)}
        />
      </Field>
    );
  }

  return (
    <Field label={field.label}>
      <input
        ref={inputRef}
        type={field.key === "exchangeRate" ? "text" : (field.type ?? "text")}
        value={value}
        onChange={(e) =>
          onChange(
            field.key === "exchangeRate"
              ? formatDecimalInput(e.target.value)
              : field.type === "date"
                ? clampDateYearInput(e.target.value)
                : e.target.value,
          )
        }
        disabled={disabled}
        max={field.type === "date" ? "9999-12-31" : undefined}
        min={field.type === "number" ? 0 : undefined}
        step={field.key === "exchangeRate" ? "any" : field.type === "number" ? 1 : undefined}
        inputMode={field.key === "exchangeRate" ? "decimal" : undefined}
        placeholder={field.placeholder}
        className={inputCls + disabledCls(disabled)}
      />
    </Field>
  );
}

function disabledCls(disabled: boolean) {
  return disabled ? " opacity-60 cursor-not-allowed" : "";
}

function hasFilledValue(value: string | undefined) {
  return Boolean(value?.trim());
}

function hasFileValueForLock(form: FormState, key: FieldKey) {
  return hasFilledValue(String(form[key] ?? ""));
}

function getUnfilledFieldKeys(
  section: (typeof extraSections)[number],
  form: FormState,
  divisions: ReturnType<typeof useDivisions>,
) {
  return section.fields
    .filter(
      (field) =>
        !["uniqueCode", "tenderLive"].includes(field.key) &&
        !isTimelineFieldDisabled(field.key, form, divisions) &&
        !hasFilledValue(String(form[field.key] ?? "")),
    )
    .map((field) => field.key);
}

function formatDecimalInput(value: string) {
  const digitsAndDots = value.replace(/[^\d.]/g, "");
  const [first, ...rest] = digitsAndDots.split(".");
  const decimalPart = rest.join("");
  const formattedInteger = formatThousandsAndLakhs(first);
  return rest.length > 0 ? `${formattedInteger}.${decimalPart}` : formattedInteger;
}

function clampDateYearInput(value: string) {
  const [year = "", ...rest] = value.split("-");
  if (year.length <= 4) return value;
  return [year.slice(0, 4), ...rest].join("-");
}

function formatThousandsAndLakhs(integerPart: string) {
  const lastThree = integerPart.slice(-3);
  const beforeThousands = integerPart.slice(0, -3);

  if (!beforeThousands) return integerPart;

  const lastTwoBeforeThousands = beforeThousands.slice(-2);
  const lakhPart = beforeThousands.slice(0, -2);
  return [lakhPart, lastTwoBeforeThousands, lastThree].filter(Boolean).join(",");
}

function isYesNoOptions(options: string[]) {
  return (
    options.length === 2 && options[0].toLowerCase() === "yes" && options[1].toLowerCase() === "no"
  );
}

function RadioGroup({
  name,
  options,
  value,
  disabled,
  onChange,
}: {
  name: string;
  options: string[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className={`grid max-w-md grid-cols-2 gap-2 ${disabledCls(disabled)}`}>
      {options.map((option) => (
        <label
          key={option}
          className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"
        >
          <input
            type="radio"
            name={name}
            checked={value === option}
            disabled={disabled}
            onChange={() => onChange(option)}
            className="size-4 border-input"
          />
          {option}
        </label>
      ))}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-[240px_minmax(0,1fr)] md:items-start">
      <div className="flex min-h-10 items-center justify-between md:justify-start md:pt-0">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
