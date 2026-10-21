import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Pencil, Plus, Trash2 } from "lucide-react";
import { downloadQuickEntryExcelExport } from "@/lib/export-download";
import { useActiveUser, useSettings } from "@/lib/files-store";
import {
  quickEntryExcelFieldGroups,
  quickEntryExcelFieldLabels,
  readQuickEntryExcelPresets,
  saveQuickEntryExcelPresets,
  subscribeQuickEntryExcelPresets,
  type QuickEntryExcelPreset,
} from "@/lib/quick-entry-excel";

export function QuickEntryExcelExportList() {
  const user = useActiveUser();
  const settings = useSettings();
  const defaultYear = settings.financialYears.includes(settings.selectedYear)
    ? settings.selectedYear
    : settings.financialYear;
  const [presets, setPresets] = useState<QuickEntryExcelPreset[]>([]);
  const [exportingId, setExportingId] = useState("");

  useEffect(() => {
    const userId = user?.id ?? "anonymous";
    const refresh = () => setPresets(readQuickEntryExcelPresets(userId));
    refresh();
    return subscribeQuickEntryExcelPresets(refresh);
  }, [user?.id]);

  const exportPreset = async (preset: QuickEntryExcelPreset) => {
    if (exportingId) return;
    const fields = preset.fields.filter((field) => quickEntryExcelFieldLabels.has(field));
    if (!fields.length) return;
    const timestamp = getLocalExportTimestamp();
    const safeBaseName = preset.name
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, "_")
      .replace(/[. ]+$/g, "") || "Quick_Entry_Export";

    setExportingId(preset.id);
    try {
      await downloadQuickEntryExcelExport({
        title: preset.name,
        fileName: `${safeBaseName}_${timestamp}.xlsx`,
        fields,
        fileTypes: preset.fileTypes ?? [],
        scopeMode: preset.scopeMode ?? "fy",
        financialYear: preset.financialYear || defaultYear,
      });
    } finally {
      setExportingId("");
    }
  };

  return (
    <div
      role="tabpanel"
      className="border-l-4 border-emerald-600 bg-emerald-50/50 p-5 dark:bg-emerald-950/15"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md border border-emerald-600/25 bg-emerald-600/10">
            <FileSpreadsheet className="size-5 text-emerald-700 dark:text-emerald-300" />
          </div>
          <h2 className="text-base font-semibold">Excel Exports</h2>
        </div>
        <span className="text-xs text-muted-foreground">
          Each export uses its saved FY / S.O. date scope
        </span>
      </div>
      {presets.length ? (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-emerald-700/15 bg-background px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{preset.name}</div>
                <div className="text-xs text-muted-foreground">
                  {(preset.scopeMode ?? "fy") === "so" ? "S.O. Based" : "FY Based"} | {preset.financialYear || defaultYear} | {preset.fields.length} fields + status history | {preset.fileTypes?.length ? `${preset.fileTypes.length} file types` : "All file types"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void exportPreset(preset)}
                disabled={Boolean(exportingId)}
                title={`Export ${preset.name} using its saved ${preset.scopeMode === "so" ? "S.O." : "FY"} date scope`}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="size-3.5" />
                {exportingId === preset.id ? "Exporting..." : "Export"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No export presets configured.</p>
      )}
    </div>
  );
}

function getLocalExportTimestamp() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function QuickEntryExcelSettings() {
  const user = useActiveUser();
  const settings = useSettings();
  const availableFileTypes = useMemo(
    () => Array.from(new Set(settings.fileTypes.map((value) => value.trim()).filter(Boolean))),
    [settings.fileTypes],
  );
  const userId = user?.id ?? "anonymous";
  const [presets, setPresets] = useState(() => readQuickEntryExcelPresets(userId));
  const [name, setName] = useState("");
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [selectedFileTypes, setSelectedFileTypes] = useState<string[]>(availableFileTypes);
  const [scopeMode, setScopeMode] = useState<"fy" | "so">("fy");
  const defaultYear = settings.financialYears.includes(settings.selectedYear)
    ? settings.selectedYear
    : settings.financialYear;
  const [financialYear, setFinancialYear] = useState(defaultYear);
  const [editingId, setEditingId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setPresets(readQuickEntryExcelPresets(userId));
  }, [userId]);

  useEffect(() => {
    if (!editingId) setFinancialYear(defaultYear);
  }, [defaultYear, editingId]);

  useEffect(() => {
    if (!editingId) setSelectedFileTypes(availableFileTypes);
  }, [editingId, settings.fileTypes]);

  const toggleField = (field: string) => {
    if (field === "soDate" && scopeMode === "so" && selectedFields.includes(field)) return;
    setSelectedFields((current) =>
      current.includes(field) ? current.filter((item) => item !== field) : [...current, field],
    );
  };

  const toggleFileType = (fileType: string) => {
    setSelectedFileTypes((current) =>
      current.includes(fileType)
        ? current.filter((item) => item !== fileType)
        : [...current, fileType],
    );
  };

  const addPreset = () => {
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError("Enter a name for this Excel export.");
      return;
    }
    if (selectedFields.length === 0) {
      setError("Select at least one field.");
      return;
    }
    if (!financialYear) {
      setError("Select a financial year for this export.");
      return;
    }
    if (!selectedFileTypes.length) {
      setError("Select at least one file type.");
      return;
    }
    if (
      presets.some(
        (preset) =>
          preset.id !== editingId &&
          preset.name.trim().toLowerCase() === normalizedName.toLowerCase(),
      )
    ) {
      setError("An export with that name already exists.");
      return;
    }
    const updatedPreset = {
      id: editingId || crypto.randomUUID(),
      name: normalizedName,
      fields:
        scopeMode === "so" && !selectedFields.includes("soDate")
          ? [...selectedFields, "soDate"]
          : selectedFields,
      fileTypes: selectedFileTypes.length === availableFileTypes.length ? [] : selectedFileTypes,
      scopeMode,
      financialYear,
    };
    const next = editingId
      ? presets.map((preset) => (preset.id === editingId ? updatedPreset : preset))
      : [...presets, updatedPreset];
    saveQuickEntryExcelPresets(userId, next);
    setPresets(next);
    setName("");
    setSelectedFields([]);
    setSelectedFileTypes(availableFileTypes);
    setEditingId("");
    setError("");
    if (scopeMode === "so" && !selectedFields.includes("soDate")) {
      setSelectedFields((current) => [...current, "soDate"]);
    }
  };

  const editPreset = (preset: QuickEntryExcelPreset) => {
    setEditingId(preset.id);
    setName(preset.name);
    setSelectedFields(preset.fields);
    setSelectedFileTypes(
      preset.fileTypes?.length
        ? availableFileTypes.filter((fileType) => preset.fileTypes?.includes(fileType))
        : availableFileTypes,
    );
    setScopeMode(preset.scopeMode ?? "fy");
    setFinancialYear(preset.financialYear || defaultYear);
    setError("");
  };

  const removePreset = (id: string) => {
    const next = presets.filter((preset) => preset.id !== id);
    saveQuickEntryExcelPresets(userId, next);
    setPresets(next);
    if (editingId === id) {
      setEditingId("");
      setName("");
      setSelectedFields([]);
      setSelectedFileTypes(availableFileTypes);
      setScopeMode("fy");
      setFinancialYear(defaultYear);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <div className="grid size-9 place-items-center rounded-md border border-emerald-700/20 bg-emerald-700/10">
          <FileSpreadsheet className="size-4 text-emerald-700 dark:text-emerald-300" />
        </div>
        <div>
          <h2 className="text-base font-semibold">Quick Entry Excel exports</h2>
          <p className="text-xs text-muted-foreground">
            Create as many named field sets as needed.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <div className="space-y-3">
          <label className="block max-w-xl">
            <span className="mb-1.5 block text-sm font-medium">Excel file name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="For example, Monthly review"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_minmax(12rem,18rem)] sm:items-end">
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Export scope</legend>
              <div className="inline-flex rounded-md border border-border bg-muted/30 p-1">
                {([
                  ["fy", "FY Based"],
                  ["so", "S.O. Based"],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={scopeMode === mode}
                    onClick={() => {
                      setScopeMode(mode);
                      if (mode === "so" && !selectedFields.includes("soDate")) {
                        setSelectedFields((current) => [...current, "soDate"]);
                      }
                    }}
                    className={`h-8 rounded px-3 text-sm ${
                      scopeMode === mode
                        ? "bg-background font-medium text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Financial year</span>
              <select
                value={financialYear}
                onChange={(event) => setFinancialYear(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {settings.financialYears.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {scopeMode === "fy"
              ? "Includes files by Demand Received Date in the selected FY."
              : "Includes S.O.s by S.O. Date in the selected FY, including files received in earlier years. S.O. Date is included automatically."}
          </p>
          <details className="group relative max-w-xl rounded-md border border-border bg-background">
            <summary className="flex h-9 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm [&::-webkit-details-marker]:hidden">
              <span>File type</span>
              <span className="truncate text-muted-foreground">
                {selectedFileTypes.length === availableFileTypes.length
                  ? "All file types"
                  : `${selectedFileTypes.length} selected`}
              </span>
            </summary>
            <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-md">
              <label className="flex items-center gap-2 border-b border-border px-2 py-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={selectedFileTypes.length === availableFileTypes.length}
                  onChange={() => setSelectedFileTypes(
                    selectedFileTypes.length === availableFileTypes.length ? [] : availableFileTypes,
                  )}
                  className="size-4 accent-primary"
                />
                All file types
              </label>
              {availableFileTypes.map((fileType) => (
                <label key={fileType} className="flex items-center gap-2 px-2 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedFileTypes.includes(fileType)}
                    onChange={() => toggleFileType(fileType)}
                    className="size-4 accent-primary"
                  />
                  {fileType}
                </label>
              ))}
            </div>
          </details>
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <div className="mb-2 text-sm font-medium">
              Fields to include <span className="font-normal text-muted-foreground">(File Status history is always appended.)</span>
            </div>
            <div className="grid max-h-[26rem] grid-cols-1 gap-4 overflow-y-auto pr-2 sm:grid-cols-2">
              {quickEntryExcelFieldGroups.map((group) => (
                <fieldset key={group.label} className="min-w-0">
                  <legend className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                    {group.label}
                  </legend>
                  <div className="space-y-1.5">
                    {group.fields.map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedFields.includes(key) || (scopeMode === "so" && key === "soDate")}
                          disabled={scopeMode === "so" && key === "soDate"}
                          onChange={() => toggleField(key)}
                          className="size-4 accent-primary"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <button
            type="button"
            onClick={addPreset}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {editingId ? null : <Plus className="size-4" />}
            {editingId ? "Save changes" : "Add Excel export"}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={() => {
                setEditingId("");
                setName("");
                setSelectedFields([]);
                setSelectedFileTypes(availableFileTypes);
                setError("");
              }}
              className="ml-2 inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
          ) : null}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Configured exports ({presets.length})</h3>
          {presets.length ? (
            presets.map((preset) => (
              <div
                key={preset.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border bg-card p-3"
              >
                <div className="min-w-0">
                  <div className="break-words text-sm font-medium">{preset.name}</div>
                  <p className="mt-1 text-xs font-medium text-foreground">
                    {(preset.scopeMode ?? "fy") === "so" ? "S.O. Based" : "FY Based"} · {preset.financialYear || defaultYear}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    File types: {preset.fileTypes?.length ? preset.fileTypes.join(", ") : "All file types"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {preset.fields
                      .map((field) => quickEntryExcelFieldLabels.get(field) ?? field)
                      .join(", ")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Export name: {preset.name}_YYYY-MM-DD_HH-mm-ss.xlsx
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => editPreset(preset)}
                  title={`Edit ${preset.name}`}
                  aria-label={`Edit ${preset.name}`}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => removePreset(preset.id)}
                  title={`Remove ${preset.name}`}
                  aria-label={`Remove ${preset.name}`}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              No Excel exports configured.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
