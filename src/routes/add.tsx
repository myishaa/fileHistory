import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  store,
  type Division,
  type FileRecord,
  type FirmDetail,
  type SupplyOrderDetail,
  useAccessibleDivisions,
  useAccessibleFiles,
  useDivisions,
  useFiles,
  useSettings,
} from "@/lib/files-store";
import { Save, Eraser, Lock, Printer, Trash2, Unlock } from "lucide-react";
import { requestDeletionPassword } from "@/lib/delete-password";
import { validateMilestoneCompletionConsistency } from "@/lib/milestone-validation";

export const Route = createFileRoute("/add")({
  validateSearch: (search: Record<string, unknown>) => ({
    fileId: typeof search.fileId === "string" ? search.fileId : undefined,
    section: typeof search.section === "string" ? search.section : undefined,
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
  fileType: "",
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
  bidDate: "",
  bidOpeningDate: "",
  bidOpened: "",
  refloat: "No",
  postTcecDate: "",
  postTcecMinutesDate: "",
  postTcecCommitteeNumber: "",
  refloatBiddingDate: "",
  refloatBidOpeningDate: "",
  refloatPostTcecDate: "",
  refloatPostTcecMinutesDate: "",
  refloatPostTcecCommitteeNo: "",
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
  ld: "",
  revisedDp: "",
  materialReceiptDate: "",
  paymentDate: "",
  paymentMode: "",
  bgReturnDate: "",
  demandCancelled: "No",
  soCancelled: "No",
  fileDetailsRemark1: "",
  fileDetailsRemark2: "",
  scrutinyRemark1: "",
  scrutinyRemark2: "",
  tcecRemark1: "",
  tcecRemark2: "",
  approvalRemark1: "",
  approvalRemark2: "",
  biddingRemark1: "",
  biddingRemark2: "",
  supplyOrderRemark1: "",
  supplyOrderRemark2: "",
  remark1: "",
  remark2: "",
  remark3: "",
  remark4: "",
  remark5: "",
  remark6: "",
  remark7: "",
  remark8: "",
  remark9: "",
};

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
    year: financialYear,
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
  "ad",
  "adVettingDate",
  "postTcecDate",
  "postTcecMinutesDate",
  "postTcecCommitteeNumber",
  "refloatPostTcecDate",
  "refloatPostTcecMinutesDate",
  "refloatPostTcecCommitteeNo",
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
  "refloatPostTcecCommitteeNo",
];

const yesNo = ["Yes", "No"];
const yesNoCaps = ["YES", "NO"];
const modeOptions = ["OBM", "PBM", "SBM", "LBM", "LPC"];
const fileTypeOptions = ["General", "AMC", "MPC"];
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
  ld: "",
  revisedDp: "",
  materialReceiptDate: "",
  paymentDate: "",
  paymentMode: "",
  bgReturnDate: "",
  demandCancelled: "No",
  soCancelled: "No",
  supplyOrderRemark1: "",
  supplyOrderRemark2: "",
};

const supplyOrderFields: ExtraField[] = [
  { key: "soNo", label: "S.0. No." },
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
  { key: "paymentDate", label: "Payment Date", type: "date" },
  { key: "paymentMode", label: "Payment mode(Online/Offline)", options: paymentModeOptions },
  { key: "bgReturnDate", label: "BG return date", type: "date" },
  { key: "demandCancelled", label: "Demand cancelled (Yes/No)", options: yesNo },
  { key: "soCancelled", label: "S.O. Cancelled (Yes/No)", options: yesNo },
  { key: "supplyOrderRemark1", label: "Remark-1", type: "textarea" },
  { key: "supplyOrderRemark2", label: "Remark-2", type: "textarea" },
];

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
      { key: "fileType", label: "File type" },
      { key: "tcec", label: "TCEC (YES/NO)", options: yesNoCaps },
      { key: "gem", label: "GeM (yes/no)", options: yesNo },
      { key: "highValue", label: "High value (Yes/No)", options: yesNo },
      { key: "rqa", label: "R&QA (Yes/No)", options: yesNo },
      { key: "ifa", label: "IFA (Yes/No)", options: yesNo },
      { key: "psb", label: "PSB (Yes/No)", options: yesNo },
      { key: "bg", label: "BG (Yes/No)", options: yesNo },
      { key: "rfpVetting", label: "RFP vetting", options: yesNo },
      { key: "fileDetailsRemark1", label: "Remark-1", type: "textarea" },
      { key: "fileDetailsRemark2", label: "Remark-2", type: "textarea" },
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
      { key: "scrutinyRemark1", label: "Remark-1", type: "textarea" },
      { key: "scrutinyRemark2", label: "Remark-2", type: "textarea" },
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
      { key: "refloatPostTcecCommitteeNo", label: "Refloat Post-TCEC committee number" },
      { key: "refloatPostTcecDate", label: "Refloat Post-TCEC date", type: "date" },
      {
        key: "refloatPostTcecMinutesDate",
        label: "Refloat Post-TCEC minutes date",
        type: "date",
      },
      { key: "tcecRemark1", label: "Remark-1", type: "textarea" },
      { key: "tcecRemark2", label: "Remark-2", type: "textarea" },
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
      { key: "approvalRemark1", label: "Remark-1", type: "textarea" },
      { key: "approvalRemark2", label: "Remark-2", type: "textarea" },
    ],
  },
  {
    title: "Bidding details",
    fields: [
      { key: "gemUndertakingDate", label: "GeM undertaking date", type: "date" },
      { key: "rfpVettingInitiationDate", label: "RFP vetting initiation", type: "date" },
      { key: "rfpVettingApprovalDate", label: "RFP vetting approval", type: "date" },
      { key: "tenderLive", label: "Tender live", options: yesNo },
      { key: "bidDate", label: "Bid date", type: "date" },
      { key: "bidOpeningDate", label: "Bid opening", type: "date" },
      { key: "bidOpened", label: "Bid opened", options: yesNoCaps },
      { key: "refloat", label: "Refloat (Yes/No)", options: yesNo },
      { key: "refloatBiddingDate", label: "Refloat bidding date", type: "date" },
      { key: "refloatBidOpeningDate", label: "Refloat Bid opening date", type: "date" },
      { key: "rst", label: "RST (Yes/No)", options: yesNo },
      { key: "biddingStageOver", label: "Bidding stage over", options: yesNo },
      { key: "cncDate", label: "CNC date", type: "date" },
      { key: "cncApprovalDate", label: "CNC approval date", type: "date" },
      { key: "biddingRemark1", label: "Remark-1", type: "textarea" },
      { key: "biddingRemark2", label: "Remark-2", type: "textarea" },
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
  const allDivisions = useDivisions();
  const divisions = useAccessibleDivisions();
  const files = useAccessibleFiles();
  const allFiles = useFiles();
  const settings = useSettings();
  const { fileId, section } = Route.useSearch();
  const navigate = useNavigate();
  const editingFile = files.find((file) => file.id === fileId);
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
  const [currentMilestone, setCurrentMilestone] = useState(editingFile?.currentMilestone ?? "");
  const [completedMilestones, setCompletedMilestones] = useState<string[]>(() =>
    normalizeCompletedMilestones(editingFile?.completedMilestones),
  );
  const [saved, setSaved] = useState(false);
  const [unlockedSections, setUnlockedSections] = useState<Set<string>>(() => new Set());
  const [activeBoardSection, setActiveBoardSection] = useState(section ?? "File details");

  useEffect(() => {
    setForm(
      applyConditionalRules(
        editingFile
          ? createFormFromFile(editingFile, settings.financialYear)
          : createEmptyForm(settings.financialYear),
      ),
    );
    setFirmDetails(createFirmDetailsFromFile(editingFile));
    setSupplyOrders(createSupplyOrdersFromFile(editingFile));
    setCurrentMilestone(editingFile?.currentMilestone ?? "");
    setCompletedMilestones(normalizeCompletedMilestones(editingFile?.completedMilestones));
    setUnlockedSections(new Set());
    // The file object is re-read from localStorage on each render; reset only when the edited id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingFile?.id, settings.financialYear]);

  useEffect(() => {
    setActiveBoardSection(section ?? "File details");
  }, [section, editingFile?.id]);

  const generatedUniqueCode = isEditing
    ? form.uniqueCode
    : generateUniqueCode(settings.financialYear, form.division, allDivisions, allFiles);
  const formWithLockedYear = {
    ...form,
    year: settings.financialYear,
    uniqueCode: generatedUniqueCode,
  };
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
    setCurrentMilestone((current) =>
      current && !applicableMilestones.has(current) ? "" : current,
    );
    setCompletedMilestones((current) => {
      const next = current.filter((item) => applicableMilestones.has(item));
      return next.length === current.length ? current : next;
    });
  }, [applicableMilestones]);

  const activeSection = extraSections.find((section) => section.title === activeBoardSection);
  const activeSectionIndex = extraSections.findIndex(
    (section) => section.title === activeBoardSection,
  );
  const update = (k: keyof typeof form, v: string) => {
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
    setForm((f) => {
      const patch: Partial<FormState> = { [k]: v };
      if (k === "currency" && isInr(v)) {
        patch.exchangeRate = "1";
      }
      if (k === "gem" && isYes(v)) {
        patch.paymentMode = "Online";
      }
      const next = applyConditionalRules({ ...f, ...patch });
      return isDivisionAdNo(next.division, divisions) ? { ...next, adVettingDate: "" } : next;
    });
  };
  const updateSupplyOrder = (index: number, key: SupplyOrderKey, value: string) => {
    setSupplyOrders((current) =>
      current.map((order, orderIndex) =>
        orderIndex === index
          ? applySupplyOrderRules(getSupplyOrderPatch(order, key, value), formWithLockedYear)
          : order,
      ),
    );
  };
  const toggleSectionLock = (sectionTitle: string) => {
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
    setFirmDetails((current) => ({
      ...current,
      [group]: current[group].map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row,
      ),
    }));
  };
  const addFirmDetail = (group: keyof FirmDetailsState) => {
    setFirmDetails((current) => ({
      ...current,
      [group]: [...current[group], { ...emptyFirmDetail }],
    }));
  };
  const deleteFirmDetail = (group: keyof FirmDetailsState, index: number) => {
    setFirmDetails((current) => ({
      ...current,
      [group]: current[group].filter((_, rowIndex) => rowIndex !== index),
    }));
  };
  const deleteSelectedFirmDetails = (group: keyof FirmDetailsState, indexes: number[]) => {
    const selected = new Set(indexes);
    setFirmDetails((current) => ({
      ...current,
      [group]: current[group].filter((_, rowIndex) => !selected.has(rowIndex)),
    }));
  };
  const firmDetailsLocked = isEditing && !unlockedSections.has("Firm details");
  const supplyOrdersLocked = isEditing && !unlockedSections.has("Supply order and payment");
  const milestonesLocked = isEditing && !unlockedSections.has("Milestones");
  const renderSectionUnlockButton = (sectionTitle: string) => {
    if (!isEditing) return null;

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

        if (field.key === "valueCapital") {
          return (
            <ValueField
              key={field.key}
              capitalValue={formWithLockedYear.valueCapital}
              revenueValue={formWithLockedYear.valueRevenue}
              capitalSelected={formWithLockedYear.valueCapitalSelected === "Yes"}
              revenueSelected={formWithLockedYear.valueRevenueSelected === "Yes"}
              disabled={false}
              lockFilledFields={lockFilledFields}
              onChange={(patch) => {
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
              disabled={false}
              lockFilledFields={lockFilledFields}
              onChange={(patch) =>
                setForm((current) => applyConditionalRules({ ...current, ...patch }))
              }
            />
          );
        }

        if (field.key === "fileType") {
          return (
            <FileTypeField
              key={field.key}
              value={formWithLockedYear.fileType}
              disabled={lockFilledFields && hasFilledValue(formWithLockedYear.fileType)}
              onChange={(value) => update("fileType", value)}
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
              (lockFilledFields && hasFilledValue(formWithLockedYear[field.key])) ||
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
          />
        );
      })}
    </div>
  );

  const save = () => {
    const supplyOrderCount = clampSupplyOrderCount(formWithLockedYear.noOfSo);
    const cleanedSupplyOrders = cleanSupplyOrderRows(
      resizeSupplyOrders(supplyOrders, supplyOrderCount),
    );
    const payload = {
      ...toFilePayload(
        clearDivisionDisabledFields(applyConditionalRules(formWithLockedYear), divisions),
      ),
      ...legacySupplyOrderPatch(cleanedSupplyOrders),
      noOfSo: String(supplyOrderCount),
      supplyOrders: cleanedSupplyOrders,
      invitedFirms: cleanFirmRows(firmDetails.invitedFirms),
      bidderFirms: cleanFirmRows(firmDetails.bidderFirms),
      currentMilestone: currentMilestone || undefined,
      completedMilestones: completedMilestones.length ? completedMilestones : undefined,
    };
    const milestoneErrors = validateMilestoneCompletionConsistency(payload, milestoneOptions);
    if (milestoneErrors.length) {
      alert(["Please fix milestone status before saving:", ...milestoneErrors].join("\n"));
      return;
    }
    if (editingFile) {
      store.updateFile(editingFile.id, payload);
      setUnlockedSections(new Set());
      setSaved(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => setSaved(false), 1200);
      return;
    } else {
      store.addFile(payload);
    }
    setSaved(true);
    setTimeout(() => {
      navigate({ to: "/search", search: { dashboardFilter: undefined, division: undefined } });
    }, 700);
  };

  const deleteFile = () => {
    if (!editingFile) return;
    const label =
      editingFile.uniqueCode || editingFile.imms || editingFile.demandDescription || "this file";
    if (!requestDeletionPassword(`delete ${label}`)) return;
    store.deleteFile(editingFile.id);
    navigate({ to: "/search", search: { dashboardFilter: undefined, division: undefined } });
  };

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
    <div className="w-full">
      <div className="bg-card border border-border rounded-md shadow-[var(--shadow-card)] overflow-hidden">
        <div className="p-5 border-b border-border bg-secondary/30">
          <h2 className="text-base font-semibold">
            {isEditing ? "Edit file details" : "Add a new file"}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {isEditing
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
          {activeBoardSection === "Milestones" && (
            <MilestonesBlock
              milestones={milestoneOptions}
              applicableMilestones={applicableMilestones}
              currentMilestone={currentMilestone}
              completedMilestones={completedMilestones}
              disabled={false}
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
                  disabled={false}
                  lockFilledFields={firmDetailsLocked}
                  onAdd={addFirmDetail}
                  onChange={updateFirmDetail}
                  onDelete={deleteFirmDetail}
                  onDeleteSelected={deleteSelectedFirmDetails}
                />
              ) : activeSection.title === "Supply order and payment" ? (
                <SupplyOrdersBlock
                  form={formWithLockedYear}
                  orders={supplyOrders}
                  disabled={false}
                  lockFilledFields={supplyOrdersLocked}
                  gemDisabled={gemIsNo}
                  bgDisabled={bgIsNo}
                  onCountChange={
                    supplyOrdersLocked && hasFilledValue(formWithLockedYear.noOfSo)
                      ? () => undefined
                      : (value) => update("noOfSo", value)
                  }
                  onOrderChange={updateSupplyOrder}
                />
              ) : (
                renderSectionFields(activeSection)
              )}
            </section>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border bg-secondary/40 flex flex-wrap items-center justify-between gap-2">
          <div>
            {isEditing && (
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
            {!isEditing && (
              <button
                type="button"
                onClick={() => {
                  setForm(applyConditionalRules(createEmptyForm(settings.financialYear)));
                  setCurrentMilestone("");
                  setCompletedMilestones([]);
                }}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-sm hover:bg-accent"
              >
                <Eraser className="size-4" /> Clear
              </button>
            )}
            <button
              type="button"
              onClick={save}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              <Save className="size-4" /> {saved ? "Saved" : isEditing ? "Update" : "Save"}
            </button>
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
  const links = ["Timeline", "Milestones", ...extraSections.map((section) => section.title)];

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

function FirmDetailsBlock({
  details,
  disabled,
  lockFilledFields,
  onAdd,
  onChange,
  onDelete,
  onDeleteSelected,
}: {
  details: FirmDetailsState;
  disabled: boolean;
  lockFilledFields: boolean;
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
  const firmCounts = {
    invitedFirms: details.invitedFirms.length,
    bidderFirms: details.bidderFirms.length,
  };
  const selectedIndexes = [...selectedRows].filter((index) => index < rows.length);

  useEffect(() => {
    setSelectedRows(new Set());
  }, [activeTab, rows.length]);

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
          const rowHasValue =
            hasFilledValue(row.firmName) || hasFilledValue(row.city) || hasFilledValue(row.emailId);
          const firmNameDisabled = disabled || (lockFilledFields && hasFilledValue(row.firmName));
          const cityDisabled = disabled || (lockFilledFields && hasFilledValue(row.city));
          const emailDisabled = disabled || (lockFilledFields && hasFilledValue(row.emailId));
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
                  value={row.firmName ?? ""}
                  onChange={(event) => onChange(activeTab, index, "firmName", event.target.value)}
                  disabled={firmNameDisabled}
                  className={inputCls + disabledCls(firmNameDisabled)}
                />
              </label>
              <label className="block">
                <div className="mb-1.5 text-xs font-medium">City</div>
                <input
                  value={row.city ?? ""}
                  onChange={(event) => onChange(activeTab, index, "city", event.target.value)}
                  disabled={cityDisabled}
                  className={inputCls + disabledCls(cityDisabled)}
                />
              </label>
              <label className="block">
                <div className="mb-1.5 text-xs font-medium">Email id</div>
                <input
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
  orders,
  disabled,
  lockFilledFields,
  gemDisabled,
  bgDisabled,
  onCountChange,
  onOrderChange,
}: {
  form: FormState;
  orders: SupplyOrderDetail[];
  disabled: boolean;
  lockFilledFields: boolean;
  gemDisabled: boolean;
  bgDisabled: boolean;
  onCountChange: (value: string) => void;
  onOrderChange: (index: number, key: SupplyOrderKey, value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <DynamicField
        field={{ key: "noOfSo", label: "No. of S.O.", type: "number" }}
        value={form.noOfSo}
        disabled={disabled || (lockFilledFields && hasFilledValue(form.noOfSo))}
        onChange={onCountChange}
      />

      {orders.map((order, index) => (
        <div key={index} className="rounded-md border border-border bg-secondary/20 p-4">
          <div className="mb-4 border-b border-border pb-2 text-sm font-semibold">
            Supply Order {index + 1}
          </div>
          <div className="grid grid-cols-1 gap-4">
            {supplyOrderFields.map((field) => {
              const key = field.key as SupplyOrderKey;

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
                  disabled={
                    disabled ||
                    (lockFilledFields && hasFilledValue(String(order[key] ?? ""))) ||
                    (gemDisabled && key === "gemSoNo") ||
                    (bgDisabled && supplyOrderBgDisabledKeys.includes(key))
                  }
                  onChange={(value) => onOrderChange(index, key, value)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
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
  disabled: boolean;
  lockFilledFields: boolean;
  lockControl: ReactNode;
  onCurrentChange: (value: string) => void;
  onCompletedChange: (value: string[]) => void;
}) {
  const completedSet = new Set(completedMilestones);
  const applicableMilestoneList = milestones.filter((milestone) =>
    applicableMilestones.has(milestone),
  );
  const applicableCount = applicableMilestoneList.length;

  const toggleCurrent = (milestone: string) => {
    if (disabled) return;
    if (!applicableMilestones.has(milestone) || completedSet.has(milestone)) return;
    onCurrentChange(currentMilestone === milestone ? "" : milestone);
  };

  const toggleCompleted = (milestone: string) => {
    if (disabled) return;
    if (!applicableMilestones.has(milestone)) return;
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
            {completedMilestones.length}/{applicableCount}
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
            const isCurrent = currentMilestone === milestone;
            const currentDisabled =
              disabled || isCompleted || (lockFilledFields && hasFilledValue(currentMilestone));
            const completedDisabled = disabled || (lockFilledFields && isCompleted);
            return (
              <div
                key={milestone}
                className={`grid min-h-10 grid-cols-[minmax(0,1fr)_6rem_6rem] items-center border-b border-border px-3 py-2 text-sm last:border-b-0 ${
                  isCurrent ? "bg-primary/10 font-semibold text-primary" : ""
                } ${isCompleted ? "text-muted-foreground" : ""}`}
              >
                <div className="min-w-0 truncate">{milestone}</div>
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={isCurrent}
                    disabled={currentDisabled}
                    onChange={() => toggleCurrent(milestone)}
                    className="size-4 accent-primary disabled:cursor-not-allowed"
                    aria-label={`Mark ${milestone} as current`}
                  />
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

function printTimelineReport(form: FormState, filledItems: TimelineItem[]) {
  const printWindow = window.open("", "_blank", "width=900,height=720");
  if (!printWindow) {
    alert("Allow pop-ups to print this timeline.");
    return;
  }

  const details = [
    { label: "Control number", value: form.imms },
    { label: "Division", value: form.division },
    { label: "Description", value: form.demandDescription },
    { label: "Indentor", value: form.indentor },
  ];
  const detailRows = details
    .map(
      (detail) => `
        <tr>
          <th>${escapeHtml(detail.label)}</th>
          <td>${escapeHtml(detail.value || "Not set")}</td>
        </tr>
      `,
    )
    .join("");
  const timelineRows = filledItems
    .map((item, index) => {
      const firstItem = filledItems[0];
      const previousItem = filledItems[index - 1];
      const gapDays = previousItem ? getTimelineDayGap(previousItem.date, item.date) : undefined;
      const cumulativeDays = firstItem ? getTimelineDayGap(firstItem.date, item.date) : undefined;

      return `
        <tr>
          <td>${escapeHtml(item.label)}</td>
          <td>${escapeHtml(formatTimelineDate(item.date))}</td>
          <td>${escapeHtml(formatDayCount(gapDays))}</td>
          <td>${escapeHtml(formatDayCount(cumulativeDays))}</td>
        </tr>
      `;
    })
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(form.imms || form.uniqueCode || "Timeline")}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: Arial, sans-serif;
            color: #111;
            margin: 22px;
          }
          header {
            border-bottom: 2px solid #111;
            margin-bottom: 16px;
            padding-bottom: 10px;
          }
          h1 {
            font-size: 18px;
            margin: 0 0 5px;
          }
          h2 {
            font-size: 14px;
            margin: 18px 0 8px;
          }
          .subtle {
            color: #555;
            font-size: 12px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
          }
          th, td {
            border: 1px solid #bbb;
            padding: 7px 8px;
            text-align: left;
            vertical-align: top;
          }
          th {
            background: #f3f3f3;
            font-weight: 600;
          }
          .detail-table th {
            width: 28%;
          }
          .timeline-table th:nth-child(1) {
            width: 42%;
          }
          .timeline-table th:nth-child(2) {
            width: 18%;
          }
          .timeline-table th:nth-child(3),
          .timeline-table th:nth-child(4) {
            width: 20%;
          }
          @media print {
            body { margin: 10mm; }
            tr { break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <header>
          <h1>File Timeline</h1>
          <div class="subtle">Printed: ${escapeHtml(new Date().toLocaleString())}</div>
        </header>
        <h2>File details</h2>
        <table class="detail-table">
          <tbody>${detailRows}</tbody>
        </table>
        <h2>Timeline</h2>
        ${
          filledItems.length
            ? `<table class="timeline-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Date</th>
                    <th>Time gap</th>
                    <th>Cumulative time</th>
                  </tr>
                </thead>
                <tbody>${timelineRows}</tbody>
              </table>`
            : `<p class="subtle">No timeline fields are filled.</p>`
        }
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

function getTcecCommitteeOptions(committees: string[] | undefined, currentValue: string) {
  const values = (committees ?? []).filter(Boolean);
  return currentValue && !values.includes(currentValue) ? [...values, currentValue] : values;
}

function getConfiguredMilestones(milestones: string[] | undefined) {
  const values = (milestones ?? []).map((item) => item.trim()).filter(Boolean);
  return values.length ? values : defaultMilestones;
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
    paymentDate: row.paymentDate || undefined,
    paymentMode: row.paymentMode || undefined,
    bgReturnDate: row.bgReturnDate || undefined,
    demandCancelled: row.demandCancelled || undefined,
    soCancelled: row.soCancelled || undefined,
    supplyOrderRemark1: row.supplyOrderRemark1?.trim() || undefined,
    supplyOrderRemark2: row.supplyOrderRemark2?.trim() || undefined,
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
      paymentDate: file.paymentDate ?? "",
      paymentMode: file.paymentMode ?? "",
      bgReturnDate: file.bgReturnDate ?? "",
      demandCancelled: file.demandCancelled ?? "No",
      soCancelled: file.soCancelled ?? "No",
      supplyOrderRemark1: file.supplyOrderRemark1 ?? "",
      supplyOrderRemark2: file.supplyOrderRemark2 ?? "",
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
    paymentDate: first.paymentDate || undefined,
    paymentMode: first.paymentMode || undefined,
    bgReturnDate: first.bgReturnDate || undefined,
    demandCancelled: first.demandCancelled || undefined,
    soCancelled: first.soCancelled || undefined,
    supplyOrderRemark1: first.supplyOrderRemark1 || undefined,
    supplyOrderRemark2: first.supplyOrderRemark2 || undefined,
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
  disabled,
  lockFilledFields = false,
  onChange,
}: {
  capitalValue: string;
  revenueValue: string;
  capitalSelected: boolean;
  revenueSelected: boolean;
  disabled: boolean;
  lockFilledFields?: boolean;
  onChange: (
    patch: Pick<
      FormState,
      "valueCapital" | "valueRevenue" | "valueCapitalSelected" | "valueRevenueSelected"
    >,
  ) => void;
}) {
  const value = capitalSelected ? capitalValue : revenueSelected ? revenueValue : "";
  const selected = capitalSelected || revenueSelected;
  const selectionDisabled = disabled || (lockFilledFields && selected);
  const valueDisabled = disabled || !selected || (lockFilledFields && hasFilledValue(value));

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
  onChange,
}: {
  capitalSelected: boolean;
  revenueSelected: boolean;
  capitalValue: string;
  revenueValue: string;
  disabled: boolean;
  lockFilledFields?: boolean;
  onChange: (patch: Pick<FormState, "soValueCapital" | "soValueRevenue">) => void;
}) {
  const selectedType = capitalSelected ? "Capital" : revenueSelected ? "Revenue" : "";
  const value = capitalSelected ? capitalValue : revenueSelected ? revenueValue : "";
  const fieldDisabled = disabled || !selectedType || (lockFilledFields && hasFilledValue(value));

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

function FileTypeField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="File type">
      <div className={`grid max-w-md grid-cols-1 gap-2 sm:grid-cols-3 ${disabledCls(disabled)}`}>
        {fileTypeOptions.map((option) => (
          <label
            key={option}
            className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"
          >
            <input
              type="checkbox"
              checked={value === option}
              disabled={disabled}
              onChange={(event) => onChange(event.target.checked ? option : "")}
              className="size-4 rounded border-input"
            />
            {option}
          </label>
        ))}
      </div>
    </Field>
  );
}

function DynamicField({
  field,
  value,
  disabled = false,
  onChange,
}: {
  field: ExtraField;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  if (field.options && isYesNoOptions(field.options)) {
    return (
      <Field label={field.label}>
        <RadioGroup
          name={field.key}
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
        type={field.key === "exchangeRate" ? "text" : (field.type ?? "text")}
        value={value}
        onChange={(e) =>
          onChange(
            field.key === "exchangeRate" ? formatDecimalInput(e.target.value) : e.target.value,
          )
        }
        disabled={disabled}
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

function formatDecimalInput(value: string) {
  const digitsAndDots = value.replace(/[^\d.]/g, "");
  const [first, ...rest] = digitsAndDots.split(".");
  const decimalPart = rest.join("");
  const formattedInteger = formatThousandsAndLakhs(first);
  return rest.length > 0 ? `${formattedInteger}.${decimalPart}` : formattedInteger;
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
