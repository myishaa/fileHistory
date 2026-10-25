import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { downloadQuickEntryExcelExport } from "@/lib/export-download";
import { useAccessibleDivisions, useActiveUser, useSettings, useStoreStatus, store } from "@/lib/files-store";
import { Textarea } from "@/components/ui/textarea";
import {
  quickEntryExcelFieldGroups,
  quickEntryExcelFieldLabels,
  readLegacyQuickEntryExcelPresets,
  type QuickEntryExcelPreset,
} from "@/lib/quick-entry-excel";

const multiValueFieldKeys = new Set([
  "completedMilestones",
  "activeYears",
  "fileMarkers",
  "stageCompletedMilestones",
  "advanceCompletedMilestones",
]);
const reviewRiskFieldKeys = new Set([
  "psbBgAmount", "pwbBgAmount", "combinedBgAmount",
  "billReturnHistory", "stageBillReturnHistory", "advanceReturnHistory",
  "supplementaryBillReturnHistory",
]);

export function QuickEntryExcelExportList() {
  const settings = useSettings();
  const divisions = useAccessibleDivisions();
  const defaultYear = settings.financialYears.includes(settings.selectedYear)
    ? settings.selectedYear
    : settings.financialYear;
  const presets = settings.quickEntryExcelPresets ?? [];
  const [exportingId, setExportingId] = useState("");
  const [selectedDivision, setSelectedDivision] = useState("all");
  const [selectedFileTypes, setSelectedFileTypes] = useState<string[]>([]);
  const [expandedView, setExpandedView] = useState(false);
  const fileTypeDropdownRef = useRef<HTMLDetailsElement>(null);
  const availableFileTypes = useMemo(
    () => Array.from(new Set(settings.fileTypes.map((value) => value.trim()).filter(Boolean))),
    [settings.fileTypes],
  );
  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      const dropdown = fileTypeDropdownRef.current;
      if (dropdown?.open && !dropdown.contains(event.target as Node)) dropdown.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const dropdown = fileTypeDropdownRef.current;
      if (event.key !== "Escape" || !dropdown?.open) return;
      event.preventDefault();
      dropdown.open = false;
      dropdown.querySelector<HTMLElement>("summary")?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

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
        fileTypes: selectedFileTypes,
        divisionId: selectedDivision === "all" ? undefined : selectedDivision,
        viewMode: expandedView ? "expanded" : "collapsed",
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
      className="min-h-[22rem] p-5"
    >
      <div className="mb-4 flex justify-end">
        <span className="text-xs text-muted-foreground">
          Each export uses its saved FY / S.O. date scope
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block min-w-48">
          <span className="mb-1.5 block text-sm font-medium">Division</span>
          <select
            value={selectedDivision}
            onChange={(event) => setSelectedDivision(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All divisions</option>
            {divisions.map((division) => (
              <option key={division.id} value={division.id}>{division.name}</option>
            ))}
          </select>
        </label>
        <details ref={fileTypeDropdownRef} className="group relative min-w-48">
          <summary className="flex h-9 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-input bg-background px-3 text-sm [&::-webkit-details-marker]:hidden">
            <span className="font-medium">File type</span>
            <span className="truncate text-muted-foreground">
              {!selectedFileTypes.length || selectedFileTypes.length === availableFileTypes.length
                ? "All file types"
                : `${selectedFileTypes.length} selected`}
            </span>
          </summary>
          <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-md">
            <label className="flex items-center gap-2 border-b border-border px-2 py-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={!selectedFileTypes.length || selectedFileTypes.length === availableFileTypes.length}
                onChange={() => setSelectedFileTypes(
                  !selectedFileTypes.length || selectedFileTypes.length === availableFileTypes.length
                    ? []
                    : availableFileTypes,
                )}
                className="size-4 accent-primary"
              />
              All file types
            </label>
            {availableFileTypes.map((fileType) => (
              <label key={fileType} className="flex items-center gap-2 px-2 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={!selectedFileTypes.length || selectedFileTypes.includes(fileType)}
                  onChange={() => setSelectedFileTypes((current) => {
                    const selected = current.length ? current : availableFileTypes;
                    const next = selected.includes(fileType)
                      ? selected.filter((item) => item !== fileType)
                      : [...selected, fileType];
                    return next.length === availableFileTypes.length ? [] : next;
                  })}
                  className="size-4 accent-primary"
                />
                {fileType}
              </label>
            ))}
          </div>
        </details>
        <div>
          <span className="mb-1.5 block text-sm font-medium">View</span>
          <div className="flex h-9 items-center gap-2">
            <span className={`text-sm ${!expandedView ? "font-medium text-foreground" : "text-muted-foreground"}`}>Collapsed</span>
            <button
              type="button"
              role="switch"
              aria-checked={expandedView}
              aria-label="Expanded export view"
              onClick={() => setExpandedView((value) => !value)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${expandedView ? "bg-primary" : "bg-muted-foreground/40"}`}
            >
              <span className={`inline-block size-4 rounded-full bg-background shadow-sm transition-transform ${expandedView ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
            <span className={`text-sm ${expandedView ? "font-medium text-foreground" : "text-muted-foreground"}`}>Expanded</span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Division and file type narrow each export. Collapsed summarizes selected S.O./stage amounts and dated actual payments; selected stage dates show their latest recorded value. Other stage-only and supplementary details appear in Expanded, with one row per stage.
      </p>
      {presets.length ? (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-emerald-700/15 bg-background px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{preset.name}</div>
                {preset.note ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{preset.note}</p> : null}
                <div className="text-xs text-muted-foreground">
                  {(preset.scopeMode ?? "fy") === "so" ? "S.O. Based" : "FY Based"} | {preset.financialYear || defaultYear} | {preset.fields.length} fields + status history
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
  return `${pad(date.getDate())}${pad(date.getMonth() + 1)}${String(date.getFullYear()).slice(-2)}_${pad(date.getHours())}.${pad(date.getMinutes())}Hrs`;
}

export function QuickEntryExcelSettings() {
  const user = useActiveUser();
  const settings = useSettings();
  const storeStatus = useStoreStatus();
  const userId = user?.id ?? "anonymous";
  const presets = settings.quickEntryExcelPresets ?? [];
  const [name, setName] = useState("");
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [scopeMode, setScopeMode] = useState<"fy" | "so">("fy");
  const defaultYear = settings.financialYears.includes(settings.selectedYear)
    ? settings.selectedYear
    : settings.financialYear;
  const [financialYear, setFinancialYear] = useState(defaultYear);
  const [editingId, setEditingId] = useState("");
  const [editingNoteId, setEditingNoteId] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const legacyImportStarted = useRef(false);

  useEffect(() => {
    if (
      user?.role !== "admin" ||
      !storeStatus.loaded ||
      legacyImportStarted.current ||
      settings.quickEntryExcelPresetsLegacyImported ||
      presets.length
    ) return;
    const legacyPresets = readLegacyQuickEntryExcelPresets(userId);
    if (!legacyPresets.length) return;
    legacyImportStarted.current = true;
    setSaving(true);
    store.saveSettings({
      quickEntryExcelPresets: legacyPresets,
      quickEntryExcelPresetsLegacyImported: true,
    }).then(() => setError(""))
      .catch((saveError) => {
        legacyImportStarted.current = false;
        setError(saveError instanceof Error ? saveError.message : "Could not import saved exports.");
      })
      .finally(() => setSaving(false));
  }, [presets.length, settings.quickEntryExcelPresetsLegacyImported, storeStatus.loaded, user?.role, userId]);

  useEffect(() => {
    if (!editingId) setFinancialYear(defaultYear);
  }, [defaultYear, editingId]);

  const toggleField = (field: string) => {
    if (field === "soDate" && scopeMode === "so" && selectedFields.includes(field)) return;
    setSelectedFields((current) =>
      current.includes(field) ? current.filter((item) => item !== field) : [...current, field],
    );
  };

  const persistPresets = async (next: QuickEntryExcelPreset[]) => {
    setSaving(true);
    setError("");
    try {
      await store.saveSettings({
        quickEntryExcelPresets: next,
        quickEntryExcelPresetsLegacyImported: true,
      });
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save shared exports.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addPreset = async () => {
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
      note: presets.find((preset) => preset.id === editingId)?.note,
      fields:
        scopeMode === "so" && !selectedFields.includes("soDate")
          ? [...selectedFields, "soDate"]
          : selectedFields,
      fileTypes: presets.find((preset) => preset.id === editingId)?.fileTypes ?? [],
      scopeMode,
      financialYear,
    };
    const next = editingId
      ? presets.map((preset) => (preset.id === editingId ? updatedPreset : preset))
      : [...presets, updatedPreset];
    if (!(await persistPresets(next))) return;
    setName("");
    setSelectedFields([]);
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
    setScopeMode(preset.scopeMode ?? "fy");
    setFinancialYear(preset.financialYear || defaultYear);
    setError("");
  };

  const removePreset = async (id: string) => {
    const next = presets.filter((preset) => preset.id !== id);
    if (!(await persistPresets(next))) return;
    if (editingNoteId === id) {
      setEditingNoteId("");
      setNoteDraft("");
    }
    if (editingId === id) {
      setEditingId("");
      setName("");
      setSelectedFields([]);
      setScopeMode("fy");
      setFinancialYear(defaultYear);
    }
  };

  const saveNote = async (presetId: string) => {
    const next = presets.map((preset) =>
      preset.id === presetId ? { ...preset, note: noteDraft.trim() || undefined } : preset,
    );
    if (!(await persistPresets(next))) return;
    setEditingNoteId("");
    setNoteDraft("");
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
            Admin-configured exports are shared with all users on the Quick Entry page.
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
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-medium">
                Fields to include <span
                  className="font-normal text-muted-foreground"
                  title="File Status history uses numbered columns and is always appended."
                >(File Status history is always appended.)</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedFields(scopeMode === "so" ? ["soDate"] : []);
                  setError("");
                }}
                title="Reset selected fields"
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent"
              >
                <RotateCcw className="size-3.5" /> Reset
              </button>
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
                        <span
                          className={multiValueFieldKeys.has(key)
                            ? "text-red-600"
                            : reviewRiskFieldKeys.has(key) ? "text-blue-700" : undefined}
                          title={multiValueFieldKeys.has(key)
                            ? "Contains multiple values in one cell; review before including in the export."
                            : reviewRiskFieldKeys.has(key)
                              ? "Review this field for return-cycle row structure or aggregate duplication before including it."
                              : undefined}
                        >
                          {label}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <p className="mt-2 text-xs text-red-600">
              Selecting these fields may disturb Excel layout because they can contain multiple values in one cell.
            </p>
            <p className="mt-1 text-xs text-blue-700">
              Select these fields carefully for Excel export.
            </p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <button
            type="button"
            onClick={() => void addPreset()}
            disabled={saving}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {saving ? null : editingId ? null : <Plus className="size-4" />}
            {saving ? "Saving..." : editingId ? "Save changes" : "Add Excel export"}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={() => {
                setEditingId("");
                setName("");
                setSelectedFields([]);
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
                  {editingNoteId === preset.id ? (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        value={noteDraft}
                        onChange={(event) => setNoteDraft(event.target.value)}
                        maxLength={300}
                        rows={2}
                        placeholder="Add a note about this configured export"
                        aria-label={`Note for ${preset.name}`}
                        className="min-h-16 resize-y text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void saveNote(preset.id)}
                          disabled={saving}
                          className="inline-flex h-8 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                        >
                          Save note
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingNoteId(""); setNoteDraft(""); }}
                          disabled={saving}
                          className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-start justify-between gap-2">
                      {preset.note ? (
                        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{preset.note}</p>
                      ) : <span className="text-xs text-muted-foreground">No note</span>}
                      <button
                        type="button"
                        onClick={() => { setEditingNoteId(preset.id); setNoteDraft(preset.note ?? ""); }}
                        className="shrink-0 text-xs font-medium text-primary hover:underline"
                      >
                        {preset.note ? "Edit note" : "Add note"}
                      </button>
                    </div>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Export name: {preset.name}_DDMMYY_HH.mmHrs.xlsx
                  </p>
                  <ul className="mt-2 grid list-disc grid-cols-1 gap-x-5 gap-y-0.5 pl-5 text-xs text-muted-foreground sm:grid-cols-2">
                    {preset.fields.map((field) => (
                      <li key={field} className="min-w-0 break-words">
                        {quickEntryExcelFieldLabels.get(field) ?? field}
                      </li>
                    ))}
                    <li className="min-w-0 break-words">File Status history</li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => editPreset(preset)}
                  disabled={saving}
                  title={`Edit ${preset.name}`}
                  aria-label={`Edit ${preset.name}`}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void removePreset(preset.id)}
                  disabled={saving}
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
