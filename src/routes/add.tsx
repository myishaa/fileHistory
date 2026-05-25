import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { store, type FileRecord, useDivisions, useFiles, useSettings } from "@/lib/files-store";
import { Save, Eraser, Info, Lock, Trash2, Unlock } from "lucide-react";
import { requestDeletionPassword } from "@/lib/delete-password";

export const Route = createFileRoute("/add")({
  validateSearch: (search: Record<string, unknown>) => ({
    fileId: typeof search.fileId === "string" ? search.fileId : undefined,
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
  valueCapitalSelected: "",
  valueRevenueSelected: "",
  tcec: "",
  mode: "",
  gem: "",
  highValue: "",
  ad: "",
  rqa: "",
  ifa: "",
  highValueMeetingDate: "",
  highValueMinutesDate: "",
  preTcecDate: "",
  preTcecMinutesDate: "",
  preTcecCommitteeNo: "",
  adVettingDate: "",
  rqaApprovalDate: "",
  ifaSentDate: "",
  ifaFinalDate: "",
  cfaDate: "",
  gemUndertakingDate: "",
  tenderLive: "",
  bidDate: "",
  bidOpeningDate: "",
  bidOpened: "",
  refloat: "",
  postTcecDate: "",
  postTcecMinutesDate: "",
  postTcecCommitteeNumber: "",
  refloatBiddingDate: "",
  refloatBidOpeningDate: "",
  refloatPostTcecDate: "",
  refloatPostTcecCommitteeNo: "",
  rst: "",
  cncDate: "",
  cncApprovalDate: "",
  soNo: "",
  gemSoNo: "",
  soDate: "",
  soValueCapital: "",
  soValueRevenue: "",
  dpDate: "",
  firm: "",
  bgValidityDate: "",
  dpExtension: "",
  revisedDp: "",
  materialReceiptDate: "",
  paymentDate: "",
  paymentMode: "",
  bgReturnDate: "",
  demandCancelled: "",
  soCancelled: "",
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

type FormState = typeof empty;
type FieldKey = keyof FormState;

function createEmptyForm(financialYear: string): FormState {
  return { ...empty, year: financialYear };
}

const formKeys = Object.keys(empty) as FieldKey[];

function createFormFromFile(file: FileRecord, financialYear: string): FormState {
  return {
    ...createEmptyForm(financialYear),
    ...Object.fromEntries(
      formKeys.map((key) => [key, String((file as Record<string, unknown>)[key] ?? "")]),
    ),
    valueCapitalSelected: file.valueCapital ? "Yes" : "",
    valueRevenueSelected: file.valueRevenue ? "Yes" : "",
    year: financialYear,
  } as FormState;
}

type ExtraField = {
  key: FieldKey;
  label: string;
  type?: "date" | "textarea";
  options?: string[];
  placeholder?: string;
  typeahead?: boolean;
};

const tcecDisabledKeys: FieldKey[] = [
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

const ifaDisabledKeys: FieldKey[] = ["ifa", "ifaSentDate", "ifaFinalDate"];

const yesNo = ["Yes", "No"];
const yesNoCaps = ["YES", "NO"];
const modeOptions = ["OBM", "PBM", "SBM", "LBM", "LPC"];
const paymentModeOptions = ["Online", "Offline"];

const extraSections: { title: string; fields: ExtraField[] }[] = [
  {
    title: "File details",
    fields: [
      { key: "uniqueCode", label: "Unique code" },
      { key: "year", label: "Year" },
      { key: "division", label: "Division" },
      { key: "indentor", label: "Indentor" },
      { key: "demandDescription", label: "Description", type: "textarea" },
      { key: "valueCapital", label: "Value" },
      { key: "receivedDate", label: "Received date", type: "date" },
      { key: "mode", label: "Mode (OBM/PBM/SBM/LBM/LPC)", options: modeOptions },
      { key: "tcec", label: "TCEC (YES/NO)", options: yesNoCaps },
      { key: "gem", label: "GeM (yes/no)", options: yesNo },
      { key: "highValue", label: "High value (Yes/No)", options: yesNo },
      { key: "ad", label: "AD vetting (Yes/No)", options: yesNo },
      { key: "rqa", label: "R&QA (Yes/No)", options: yesNo },
      { key: "ifa", label: "IFA (Yes/No)", options: yesNo },
    ],
  },
  {
    title: "Scrutiny and IMMS",
    fields: [
      { key: "scrutinyDate", label: "Scrutiny date", type: "date" },
      { key: "scrutinyResponseDate", label: "Scrutiny response", type: "date" },
      { key: "scrutinyCompletionDate", label: "Scrutiny completion date", type: "date" },
      { key: "imms", label: "IMMS Number" },
      { key: "immsDate", label: "IMMS Date", type: "date" },
      { key: "fileNo", label: "File Number" },
    ],
  },
  {
    title: "TCEC block",
    fields: [
      { key: "preTcecCommitteeNo", label: "Pre TCEC committee" },
      { key: "preTcecDate", label: "Pre-TCEC Date", type: "date" },
      { key: "preTcecMinutesDate", label: "Pre-TCEC minutes date", type: "date" },
      { key: "postTcecCommitteeNumber", label: "Post TCEC committee number" },
      { key: "postTcecDate", label: "Post TCEC date", type: "date" },
      { key: "postTcecMinutesDate", label: "Post TCEC minutes date", type: "date" },
      { key: "refloatPostTcecCommitteeNo", label: "Refloat post TCEC committee number" },
      { key: "refloatPostTcecDate", label: "Refloat post TCEC date", type: "date" },
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
      { key: "cfaDate", label: "CFA date", type: "date" },
    ],
  },
  {
    title: "Bidding details",
    fields: [
      { key: "gemUndertakingDate", label: "GeM undertaking date", type: "date" },
      { key: "tenderLive", label: "Tender live", options: yesNo },
      { key: "bidDate", label: "Bid date", type: "date" },
      { key: "bidOpeningDate", label: "Bid opening", type: "date" },
      { key: "bidOpened", label: "Bid opened", options: yesNoCaps },
      { key: "refloat", label: "Refloat (Yes/No)", options: yesNo },
      { key: "refloatBiddingDate", label: "Refloat bidding date", type: "date" },
      { key: "refloatBidOpeningDate", label: "Refloat Bid opening date", type: "date" },
      { key: "rst", label: "RST (Yes/No)", options: yesNo },
      { key: "cncDate", label: "CNC date", type: "date" },
      { key: "cncApprovalDate", label: "CNC approval date", type: "date" },
    ],
  },
  {
    title: "Supply order and payment",
    fields: [
      { key: "soNo", label: "S.0. No." },
      { key: "gemSoNo", label: "GeM S.O. NO." },
      { key: "soDate", label: "S.O. date", type: "date" },
      { key: "soValueCapital", label: "S.O. value" },
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
    ],
  },
  {
    title: "Remarks",
    fields: [
      { key: "remark1", label: "Remark-1", type: "textarea" },
      { key: "remark2", label: "Remark-2", type: "textarea" },
      { key: "remark3", label: "Remark-3", type: "textarea" },
      { key: "remark4", label: "Remark-4", type: "textarea" },
      { key: "remark5", label: "Remark-5", type: "textarea" },
      { key: "remark6", label: "Remark-6", type: "textarea" },
      { key: "remark7", label: "Remark-7", type: "textarea" },
      { key: "remark8", label: "Remark-8", type: "textarea" },
      { key: "remark9", label: "Remark-9", type: "textarea" },
    ],
  },
];

const timelineFields = extraSections
  .flatMap((section) => section.fields)
  .filter((field) => field.type === "date")
  .map((field) => ({ key: field.key, label: field.label }));

function AddFilePage() {
  const divisions = useDivisions();
  const files = useFiles();
  const settings = useSettings();
  const { fileId } = Route.useSearch();
  const navigate = useNavigate();
  const editingFile = files.find((file) => file.id === fileId);
  const isEditing = Boolean(fileId && editingFile);
  const [form, setForm] = useState(() =>
    editingFile
      ? createFormFromFile(editingFile, settings.financialYear)
      : createEmptyForm(settings.financialYear),
  );
  const [saved, setSaved] = useState(false);
  const [unlockedSections, setUnlockedSections] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setForm(
      editingFile
        ? createFormFromFile(editingFile, settings.financialYear)
        : createEmptyForm(settings.financialYear),
    );
    setUnlockedSections(new Set());
    // The file object is re-read from localStorage on each render; reset only when the edited id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingFile?.id, settings.financialYear]);

  const generatedUniqueCode = isEditing
    ? form.uniqueCode
    : generateUniqueCode(settings.financialYear, form.division, divisions, files);
  const formWithLockedYear = {
    ...form,
    year: settings.financialYear,
    uniqueCode: generatedUniqueCode,
  };
  const tcecIsNo = isNo(formWithLockedYear.tcec);
  const ifaDisabled = shouldDisableIfa(formWithLockedYear);
  const update = (k: keyof typeof form, v: string) => {
    if (k === "year") return;
    setForm((f) => applyConditionalRules({ ...f, [k]: v }));
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

  const save = () => {
    const payload = toFilePayload(applyConditionalRules(formWithLockedYear));
    if (editingFile) {
      store.updateFile(editingFile.id, payload);
    } else {
      store.addFile(payload);
    }
    setSaved(true);
    setTimeout(() => {
      navigate({ to: "/search" });
    }, 700);
  };

  const deleteFile = () => {
    if (!editingFile) return;
    const label =
      editingFile.uniqueCode || editingFile.imms || editingFile.demandDescription || "this file";
    if (!requestDeletionPassword(`delete ${label}`)) return;
    store.deleteFile(editingFile.id);
    navigate({ to: "/search" });
  };

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

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <TimelineBlock form={formWithLockedYear} />

          {extraSections.map((section, index) => (
            <section key={section.title} className={sectionBlockCls(index)}>
              <h3 className="text-sm font-semibold border-b border-border pb-2 mb-4 flex items-center gap-2">
                <span className={sectionStripeCls(index)} />
                <span className="min-w-0 flex-1">{section.title}</span>
                {isEditing && (
                  <button
                    type="button"
                    onClick={() => toggleSectionLock(section.title)}
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-background text-xs font-medium text-foreground border border-border hover:bg-accent"
                  >
                    {unlockedSections.has(section.title) ? (
                      <>
                        <Unlock className="size-3.5" /> Unlocked
                      </>
                    ) : (
                      <>
                        <Lock className="size-3.5" /> Edit block
                      </>
                    )}
                  </button>
                )}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {section.fields.map((field) => {
                  const renderedField =
                    field.key === "division"
                      ? {
                          ...field,
                          options: divisions.map((division) => division.name),
                          placeholder: "Type or select division",
                          typeahead: true,
                        }
                      : field;
                  const existingValueLocked =
                    isEditing &&
                    !unlockedSections.has(section.title) &&
                    (field.key === "valueCapital"
                      ? Boolean(editingFile?.valueCapital || editingFile?.valueRevenue)
                      : field.key === "soValueCapital"
                        ? Boolean(editingFile?.soValueCapital || editingFile?.soValueRevenue)
                        : Boolean(getSavedFileValue(editingFile, field.key)));

                  if (field.key === "valueCapital") {
                    return (
                      <ValueField
                        key={field.key}
                        capitalValue={formWithLockedYear.valueCapital}
                        revenueValue={formWithLockedYear.valueRevenue}
                        capitalSelected={formWithLockedYear.valueCapitalSelected === "Yes"}
                        revenueSelected={formWithLockedYear.valueRevenueSelected === "Yes"}
                        disabled={existingValueLocked}
                        onChange={(patch) =>
                          setForm((current) => applyConditionalRules({ ...current, ...patch }))
                        }
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
                        disabled={existingValueLocked}
                        onChange={(patch) =>
                          setForm((current) => applyConditionalRules({ ...current, ...patch }))
                        }
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
                        existingValueLocked ||
                        (tcecIsNo && tcecDisabledKeys.includes(field.key)) ||
                        (ifaDisabled && ifaDisabledKeys.includes(field.key))
                      }
                      onChange={(value) => update(field.key, value)}
                    />
                  );
                })}
              </div>
            </section>
          ))}

          <div className="md:col-span-2 flex items-start gap-2 text-xs text-muted-foreground bg-secondary/50 border border-border rounded-md p-3">
            <Info className="size-4 mt-0.5 text-primary" />
            <p>
              Tip: incomplete entries are flagged with a status badge so you can find and update
              them from <span className="font-medium text-foreground">Search Files</span>.
            </p>
          </div>
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
            <button
              type="button"
              onClick={() =>
                setForm(
                  editingFile
                    ? createFormFromFile(editingFile, settings.financialYear)
                    : createEmptyForm(settings.financialYear),
                )
              }
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-sm hover:bg-accent"
            >
              <Eraser className="size-4" /> {isEditing ? "Reset" : "Clear"}
            </button>
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

function TimelineBlock({ form }: { form: FormState }) {
  const items = timelineFields
    .map((field) => ({
      label: field.label,
      date: form[field.key],
    }))
    .filter((item) => item.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <section className="md:col-span-2 rounded-md border border-border bg-secondary/25 p-4">
      <div className="mb-4 flex items-center justify-between border-b border-border pb-2">
        <h3 className="text-sm font-semibold">Timeline</h3>
        <span className="text-xs text-muted-foreground">{items.length} date fields filled</span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Timeline will appear here as date fields are filled.
        </p>
      ) : (
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <li
              key={`${item.label}-${item.date}`}
              className="relative rounded-md border border-border bg-card px-3 py-2.5"
            >
              <div className="flex items-start gap-2">
                <span className="mt-1.5 size-2 rounded-full bg-primary" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{item.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatTimelineDate(item.date)}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
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

const inputCls =
  "w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition";

const textareaCls =
  "w-full min-h-20 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition resize-y";

function sectionBlockCls(index: number) {
  const accents = [
    "border-l-primary",
    "border-l-success",
    "border-l-warning",
    "border-l-chart-5",
    "border-l-destructive",
    "border-l-chart-2",
  ];
  return `md:col-span-2 rounded-md border border-l-2 border-border bg-card p-4 shadow-sm ${accents[index % accents.length]}`;
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

function applyConditionalRules(form: FormState) {
  let next = form;
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

function isNo(value: string) {
  return value.trim().toLowerCase() === "no";
}

function shouldDisableIfa(form: FormState) {
  return isNo(form.tcec) && form.mode !== "PBM";
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
  onChange,
}: {
  capitalValue: string;
  revenueValue: string;
  capitalSelected: boolean;
  revenueSelected: boolean;
  disabled: boolean;
  onChange: (
    patch: Pick<
      FormState,
      "valueCapital" | "valueRevenue" | "valueCapitalSelected" | "valueRevenueSelected"
    >,
  ) => void;
}) {
  const value = capitalValue || revenueValue;

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
    const cleanedValue = cleanDecimalInput(nextValue);
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
        <div className="grid grid-cols-2 gap-2">
          <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
            <input
              type="checkbox"
              checked={capitalSelected}
              disabled={disabled}
              onChange={(event) => updateCapital(event.target.checked)}
              className="size-4 rounded border-input"
            />
            Capital
          </label>
          <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
            <input
              type="checkbox"
              checked={revenueSelected}
              disabled={disabled}
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
          disabled={disabled || (!capitalSelected && !revenueSelected)}
          placeholder="Enter value"
          className={inputCls + disabledCls(disabled || (!capitalSelected && !revenueSelected))}
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
  onChange,
}: {
  capitalSelected: boolean;
  revenueSelected: boolean;
  capitalValue: string;
  revenueValue: string;
  disabled: boolean;
  onChange: (patch: Pick<FormState, "soValueCapital" | "soValueRevenue">) => void;
}) {
  const selectedType = capitalSelected ? "Capital" : revenueSelected ? "Revenue" : "";
  const value = capitalSelected ? capitalValue : revenueSelected ? revenueValue : "";
  const fieldDisabled = disabled || !selectedType;

  const updateValue = (nextValue: string) => {
    const cleanedValue = cleanDecimalInput(nextValue);
    onChange({
      soValueCapital: capitalSelected ? cleanedValue : "",
      soValueRevenue: revenueSelected ? cleanedValue : "",
    });
  };

  return (
    <Field label="S.O. value">
      <div className={`space-y-2 ${disabledCls(fieldDisabled)}`}>
        <div className="grid grid-cols-2 gap-2">
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
        type={field.type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={field.placeholder}
        className={inputCls + disabledCls(disabled)}
      />
    </Field>
  );
}

function disabledCls(disabled: boolean) {
  return disabled ? " opacity-60 cursor-not-allowed" : "";
}

function cleanDecimalInput(value: string) {
  const digitsAndDots = value.replace(/[^\d.]/g, "");
  const [first, ...rest] = digitsAndDots.split(".");
  return rest.length > 0 ? `${first}.${rest.join("")}` : first;
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
    <div className={`grid grid-cols-2 gap-2 ${disabledCls(disabled)}`}>
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
    <div className="block">
      <div className="text-xs font-medium mb-1.5 flex items-center justify-between">
        <span>
          {label} <span className="text-muted-foreground font-normal">(optional)</span>
        </span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
