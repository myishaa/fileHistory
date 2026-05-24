import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { store, type FileRecord, useDivisions, useFiles } from "@/lib/files-store";
import { Filter, Pencil, Search, SlidersHorizontal, X } from "lucide-react";

export const Route = createFileRoute("/search")({
  component: SearchPage,
});

type FileKey = Exclude<keyof FileRecord, "id" | "createdAt">;

type FieldDef = {
  key: FileKey;
  label: string;
  type?: "date" | "textarea";
  options?: string[];
};

const yesNo = ["Yes", "No"];
const yesNoCaps = ["YES", "NO"];
const modeOptions = ["OBM", "PBM", "SBM", "LBM", "LPC"];
const paymentModeOptions = ["Online", "Offline"];

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

const editableFields = fieldSections.flatMap((section) => section.fields);

const statusDateFields: { key: FileKey; label: string }[] = [
  { key: "receivedDate", label: "Received date" },
  { key: "scrutinyDate", label: "Scrutiny date" },
  { key: "scrutinyResponseDate", label: "Scrutiny response date" },
  { key: "scrutinyCompletionDate", label: "Scrutiny completion date" },
  { key: "immsDate", label: "IMMS date" },
  { key: "highValueMeetingDate", label: "High value meeting date" },
  { key: "highValueMinutesDate", label: "High value minutes date" },
  { key: "preTcecDate", label: "Pre-TCEC date" },
  { key: "preTcecMinutesDate", label: "Pre-TCEC minutes date" },
  { key: "adVettingDate", label: "AD vetting date" },
  { key: "rqaApprovalDate", label: "R&QA approval date" },
  { key: "ifaSentDate", label: "IFA sent date" },
  { key: "ifaFinalDate", label: "IFA final date" },
  { key: "cfaDate", label: "CFA date" },
  { key: "gemUndertakingDate", label: "GeM undertaking date" },
  { key: "bidDate", label: "Bid date" },
  { key: "bidOpeningDate", label: "Bid opening date" },
  { key: "postTcecDate", label: "Post-TCEC date" },
  { key: "postTcecMinutesDate", label: "Post-TCEC minutes date" },
  { key: "refloatBiddingDate", label: "Refloat bidding date" },
  { key: "refloatBidOpeningDate", label: "Refloat bid opening date" },
  { key: "refloatPostTcecDate", label: "Refloat-Post TCEC date" },
  { key: "cncDate", label: "CNC date" },
  { key: "cncApprovalDate", label: "CNC approval date" },
  { key: "soDate", label: "S.O. date" },
];

function SearchPage() {
  const files = useFiles();
  const divisions = useDivisions();
  const divisionOptions = divisions.map((division) => division.name);
  const years = useMemo(
    () => Array.from(new Set(files.map((file) => file.year).filter(Boolean))).sort() as string[],
    [files],
  );

  const [yearText, setYearText] = useState("");
  const [yearSelect, setYearSelect] = useState("");
  const [imms, setImms] = useState("");
  const [indentor, setIndentor] = useState("");
  const [divisionText, setDivisionText] = useState("");
  const [divisionSelect, setDivisionSelect] = useState("");
  const [valueFrom, setValueFrom] = useState("");
  const [valueTo, setValueTo] = useState("");
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
  const [freeText, setFreeText] = useState("");
  const [freeDate, setFreeDate] = useState("");
  const [editing, setEditing] = useState<FileRecord | null>(null);

  const hasFilters =
    yearText ||
    yearSelect ||
    imms ||
    indentor ||
    divisionText ||
    divisionSelect ||
    valueFrom ||
    valueTo ||
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
    freeText ||
    freeDate;

  const results = useMemo(() => {
    const minValue = parseAmount(valueFrom);
    const maxValue = parseAmount(valueTo);

    return files.filter((file) => {
      if (yearText && !includesText(file.year, yearText)) return false;
      if (yearSelect && file.year !== yearSelect) return false;
      if (imms && !includesText(file.imms, imms)) return false;
      if (indentor && !includesText(file.indentor, indentor)) return false;
      if (divisionText && !includesText(file.division, divisionText)) return false;
      if (divisionSelect && file.division !== divisionSelect) return false;
      if (description && !includesText(file.demandDescription, description)) return false;
      if (firm && !includesText(file.firm, firm)) return false;
      if (highValue && !isYes(file.highValue)) return false;
      if (ad && !isYes(file.ad)) return false;
      if (rqa && !isYes(file.rqa)) return false;
      if (refloat && !hasAny(file, ["refloatBiddingDate", "refloatBidOpeningDate", "refloatPostTcecDate", "refloatPostTcecCommitteeNo"])) return false;
      if (cnc && !hasAny(file, ["cncDate", "cncApprovalDate"])) return false;
      if (tcec && !isTcecFile(file)) return false;
      if (tenderLive && !isYes(file.tenderLive)) return false;
      if (soNo && !includesText(file.soNo, soNo)) return false;
      if (gemSoNo && !includesText(file.gemSoNo, gemSoNo)) return false;
      if (dpExtension && !isYes(file.dpExtension)) return false;
      if (!matchesValueRange(file, minValue, maxValue)) return false;
      if (!matchesDateRange(file.dpDate, dpFrom, dpTo)) return false;
      if (freeText && !allSearchText(file).includes(freeText.trim().toLowerCase())) return false;
      if (freeDate && !editableFields.some((field) => field.type === "date" && file[field.key] === freeDate)) return false;
      return true;
    });
  }, [
    files,
    yearText,
    yearSelect,
    imms,
    indentor,
    divisionText,
    divisionSelect,
    valueFrom,
    valueTo,
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
    freeText,
    freeDate,
  ]);

  const clearAll = () => {
    setYearText("");
    setYearSelect("");
    setImms("");
    setIndentor("");
    setDivisionText("");
    setDivisionSelect("");
    setValueFrom("");
    setValueTo("");
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
    setFreeText("");
    setFreeDate("");
  };

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-xl p-3 shadow-[var(--shadow-card)] flex items-center gap-2">
        <Search className="size-4 text-muted-foreground ml-2" />
        <input
          value={freeText}
          onChange={(event) => setFreeText(event.target.value)}
          placeholder="Free search"
          className="flex-1 h-10 bg-transparent outline-none text-sm"
        />
        {hasFilters && (
          <button
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent"
          >
            <X className="size-3.5" /> Clear all
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-5">
        <aside className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)] h-fit space-y-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal className="size-4" /> Filters
          </div>

          <FilterGroup label="Year">
            <div className="grid grid-cols-2 gap-2">
              <FilterInput value={yearText} onChange={setYearText} placeholder="Type year" />
              <FilterSelect value={yearSelect} onChange={setYearSelect} options={years} placeholder="All years" />
            </div>
          </FilterGroup>

          <FilterGroup label="IMMS">
            <FilterInput value={imms} onChange={setImms} placeholder="IMMS no." />
          </FilterGroup>

          <FilterGroup label="Indentor">
            <FilterInput value={indentor} onChange={setIndentor} placeholder="Indentor" />
          </FilterGroup>

          <FilterGroup label="Division">
            <div className="grid grid-cols-2 gap-2">
              <FilterInput value={divisionText} onChange={setDivisionText} placeholder="Type division" />
              <FilterSelect value={divisionSelect} onChange={setDivisionSelect} options={divisionOptions} placeholder="All divisions" />
            </div>
          </FilterGroup>

          <FilterGroup label="Value">
            <div className="grid grid-cols-2 gap-2">
              <FilterInput value={valueFrom} onChange={setValueFrom} placeholder="From" />
              <FilterInput value={valueTo} onChange={setValueTo} placeholder="To" />
            </div>
          </FilterGroup>

          <FilterGroup label="Description">
            <FilterInput value={description} onChange={setDescription} placeholder="Demand description" />
          </FilterGroup>

          <FilterGroup label="Firm">
            <FilterInput value={firm} onChange={setFirm} placeholder="Firm" />
          </FilterGroup>

          <div className="grid grid-cols-2 gap-2">
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
        </aside>

        <section className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Filter className="size-3.5" />
              <span className="font-medium text-foreground">{results.length}</span> result{results.length !== 1 && "s"}
            </span>
            <span>Click any row to open and edit the file</span>
          </div>

          <div className="bg-card border border-border rounded-xl shadow-[var(--shadow-card)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="bg-secondary/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">IMMS</th>
                    <th className="text-left font-medium px-4 py-2.5">Division</th>
                    <th className="text-left font-medium px-4 py-2.5">Indentor</th>
                    <th className="text-left font-medium px-4 py-2.5">Value (Rs.)</th>
                    <th className="text-left font-medium px-4 py-2.5">Current status</th>
                    <th className="text-left font-medium px-4 py-2.5">S.O. Date</th>
                    <th className="text-left font-medium px-4 py-2.5">D.P Date</th>
                    <th className="text-left font-medium px-4 py-2.5">Remark-1</th>
                    <th className="text-left font-medium px-4 py-2.5">Remark-2</th>
                    <th className="text-right font-medium px-4 py-2.5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {results.length === 0 && (
                    <tr>
                      <td colSpan={10} className="text-center text-sm text-muted-foreground py-10">
                        No files match your filters.
                      </td>
                    </tr>
                  )}
                  {results.map((file) => {
                    const status = getCurrentStatus(file);
                    return (
                      <tr
                        key={file.id}
                        onClick={() => setEditing(file)}
                        className="border-t border-border hover:bg-secondary/40 cursor-pointer"
                      >
                        <td className="px-4 py-3 font-medium">{file.imms || missing}</td>
                        <td className="px-4 py-3 text-muted-foreground">{file.division || missing}</td>
                        <td className="px-4 py-3 text-muted-foreground">{file.indentor || missing}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatValue(file)}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {status ? `${status.label}: ${status.date}` : missing}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{file.soDate || missing}</td>
                        <td className="px-4 py-3 text-muted-foreground">{file.dpDate || missing}</td>
                        <td className="px-4 py-3 text-muted-foreground max-w-[160px] truncate">{file.remark1 || missing}</td>
                        <td className="px-4 py-3 text-muted-foreground max-w-[160px] truncate">{file.remark2 || missing}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditing(file);
                            }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/15"
                          >
                            <Pencil className="size-3.5" /> Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {editing && <EditModal file={editing} onClose={() => setEditing(null)} divisions={divisionOptions} />}
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
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full h-9 px-2.5 rounded-md border border-input bg-background text-sm"
    />
  );
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
  const [form, setForm] = useState<Record<FileKey, string>>(() => {
    const entries = editableFields.map((field) => [field.key, String(file[field.key] ?? "")]);
    return Object.fromEntries(entries) as Record<FileKey, string>;
  });

  const update = (key: FileKey, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = () => {
    store.updateFile(file.id, toFilePatch(form));
    onClose();
  };

  const del = () => {
    store.deleteFile(file.id);
    onClose();
  };

  return (
    <ModalShell title="File details" onClose={onClose}>
      <div className="space-y-6">
        {fieldSections.map((section) => (
          <section key={section.title}>
            <h4 className="text-sm font-semibold border-b border-border pb-2 mb-4">{section.title}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {section.fields.map((field) => {
                const renderedField =
                  field.key === "division" ? { ...field, options: divisions } : field;
                return (
                  <EditField
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
      </div>
      <div className="mt-6 flex justify-between">
        <button onClick={del} className="text-xs text-destructive hover:underline">Delete file</button>
        <div className="flex gap-2">
          <button onClick={onClose} className="h-9 px-4 rounded-md border border-border bg-card text-sm hover:bg-accent">Cancel</button>
          <button onClick={save} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium">Save</button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-[var(--shadow-elevated)] w-full max-w-6xl max-h-[90vh] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="size-7 grid place-items-center rounded-md hover:bg-accent">
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
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.options) {
    return (
      <label className="block">
        <div className="text-xs font-medium mb-1.5">{field.label}</div>
        <select value={value} onChange={(event) => onChange(event.target.value)} className={editInputCls}>
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
          className="w-full min-h-20 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 resize-y"
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
        className={editInputCls}
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

function includesText(value: string | undefined, query: string) {
  return (value ?? "").toLowerCase().includes(query.trim().toLowerCase());
}

function isYes(value: string | undefined) {
  return ["yes", "y"].includes((value ?? "").trim().toLowerCase());
}

function hasAny(file: FileRecord, keys: FileKey[]) {
  return keys.some((key) => Boolean(file[key]));
}

function isTcecFile(file: FileRecord) {
  return isYes(file.tcec) || hasAny(file, ["preTcecDate", "preTcecMinutesDate", "postTcecDate", "postTcecMinutesDate"]);
}

function parseAmount(value: string | undefined) {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function matchesValueRange(file: FileRecord, minValue: number | undefined, maxValue: number | undefined) {
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

function matchesDateRange(date: string | undefined, from: string, to: string) {
  if (!from && !to) return true;
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function allSearchText(file: FileRecord) {
  return editableFields
    .map((field) => file[field.key])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getCurrentStatus(file: FileRecord) {
  return statusDateFields.reduce<{ label: string; date: string } | null>((latest, field) => {
    const date = file[field.key];
    if (!date) return latest;
    if (!latest || date > latest.date) return { label: field.label, date };
    return latest;
  }, null);
}

function formatValue(file: FileRecord) {
  const parts = [
    file.valueCapital ? `Capital: ${file.valueCapital}` : "",
    file.valueRevenue ? `Revenue: ${file.valueRevenue}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : missing;
}
