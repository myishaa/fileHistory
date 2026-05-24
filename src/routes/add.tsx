import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { store, useDivisions } from "@/lib/files-store";
import { Save, Eraser, Info } from "lucide-react";

export const Route = createFileRoute("/add")({
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
  remark7: "",
  remark8: "",
};

type FormState = typeof empty;
type FieldKey = keyof FormState;

type ExtraField = {
  key: FieldKey;
  label: string;
  type?: "date" | "textarea";
  options?: string[];
  placeholder?: string;
};

const yesNo = ["Yes", "No"];
const yesNoCaps = ["YES", "NO"];
const modeOptions = ["OBM", "PBM", "SBM", "LBM", "LPC"];
const paymentModeOptions = ["Online", "Offline"];

const extraSections: { title: string; fields: ExtraField[] }[] = [
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
      { key: "highValueMeetingDate", label: "High value meeting date", type: "date" },
      { key: "highValueMinutesDate", label: "High value minutes date", type: "date" },
      { key: "preTcecDate", label: "Pre-TCEC Date", type: "date" },
      { key: "preTcecMinutesDate", label: "Pre-TCEC minutes date", type: "date" },
      { key: "preTcecCommitteeNo", label: "Pre-TCEC Committee no." },
      { key: "adVettingDate", label: "AD Vetting date", type: "date" },
      { key: "rqaApprovalDate", label: "R&QA approval date", type: "date" },
      { key: "ifaSentDate", label: "IFA sent date", type: "date" },
      { key: "ifaFinalDate", label: "IFA final date", type: "date" },
      { key: "cfaDate", label: "CFA date", type: "date" },
      { key: "gemUndertakingDate", label: "GeM undertaking date", type: "date" },
      { key: "tenderLive", label: "Tender Live (Yes/No)", options: yesNo },
      { key: "bidDate", label: "Bid date", type: "date" },
      { key: "bidOpeningDate", label: "Bid opening Date", type: "date" },
      { key: "bidOpened", label: "Bid opened (YES/NO)", options: yesNoCaps },
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
    ],
  },
  {
    title: "Supply order and payment",
    fields: [
      { key: "soNo", label: "S.0. No." },
      { key: "gemSoNo", label: "GeM S.O. NO." },
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
      { key: "remark7", label: "Remark-7", type: "textarea" },
      { key: "remark8", label: "Remark-8", type: "textarea" },
    ],
  },
];

function AddFilePage() {
  const divisions = useDivisions();
  const navigate = useNavigate();
  const [form, setForm] = useState(empty);
  const [saved, setSaved] = useState(false);

  const update = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    store.addFile(toFilePayload(form));
    setSaved(true);
    setTimeout(() => {
      navigate({ to: "/search" });
    }, 700);
  };

  return (
    <div className="max-w-6xl">
      <div className="bg-card border border-border rounded-xl shadow-[var(--shadow-card)] overflow-hidden">
        <div className="p-6 border-b border-border">
          <h2 className="text-base font-semibold">Add a new file</h2>
          <p className="text-xs text-muted-foreground mt-1">
            All fields are optional — save now and complete missing details later.
          </p>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
          {extraSections.map((section) => (
            <section key={section.title} className="md:col-span-2 pt-2">
              <h3 className="text-sm font-semibold border-b border-border pb-2 mb-4">{section.title}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {section.fields.map((field) => {
                  const renderedField =
                    field.key === "division"
                      ? { ...field, options: divisions.map((division) => division.name) }
                      : field;

                  return (
                    <DynamicField
                      key={field.key}
                      field={renderedField}
                      value={form[field.key]}
                      onChange={(value) => update(field.key, value)}
                    />
                  );
                })}
              </div>
            </section>
          ))}

          <div className="md:col-span-2 flex items-start gap-2 text-xs text-muted-foreground bg-accent/40 border border-border rounded-md p-3">
            <Info className="size-4 mt-0.5 text-primary" />
            <p>
              Tip: incomplete entries are flagged with a status badge so you can find and update them
              from <span className="font-medium text-foreground">Search Files</span>.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border bg-secondary/40 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setForm(empty)}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-sm hover:bg-accent"
          >
            <Eraser className="size-4" /> Clear
          </button>
          <button
            type="button"
            onClick={save}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Save className="size-4" /> {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition";

const textareaCls =
  "w-full min-h-20 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition resize-y";

function toFilePayload(form: FormState) {
  return Object.fromEntries(
    Object.entries(form).map(([key, value]) => [key, value || undefined]),
  ) as Omit<import("@/lib/files-store").FileRecord, "id" | "createdAt">;
}

function DynamicField({
  field,
  value,
  onChange,
}: {
  field: ExtraField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.options) {
    return (
      <Field label={field.label}>
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
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
          placeholder={field.placeholder}
          className={textareaCls}
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
        placeholder={field.placeholder}
        className={inputCls}
      />
    </Field>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1.5 flex items-center justify-between">
        <span>{label} <span className="text-muted-foreground font-normal">(optional)</span></span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
