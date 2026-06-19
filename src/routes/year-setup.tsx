import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { GitMerge, Landmark, Plus, RotateCw, Save } from "lucide-react";
import {
  fetchIndentors,
  store,
  type Division,
  type Indentor,
  useActiveUser,
  useFiles,
  useSettings,
} from "@/lib/files-store";
import { isAllActiveFilesYear, isFileVisibleForYear } from "@/lib/year-filter";
import { formatThousandsAndLakhs, parseAmount } from "@/lib/money";

export const Route = createFileRoute("/year-setup")({
  component: YearSetupPage,
});

type DraftAllocation = {
  allocatedCapital: string;
  allocatedRevenue: string;
  active: boolean;
};

type YearSetupSubview = "setup" | "merge" | "split";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function YearSetupPage() {
  return <YearSetupPanel />;
}

export function YearSetupPanel() {
  const activeUser = useActiveUser();
  const settings = useSettings();
  const files = useFiles();
  const [currentDivisions, setCurrentDivisions] = useState<Division[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftAllocation>>({});
  const [savingId, setSavingId] = useState<string | undefined>();
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newCapital, setNewCapital] = useState("");
  const [newRevenue, setNewRevenue] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [mergeSourceIds, setMergeSourceIds] = useState<string[]>([]);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeTargetName, setMergeTargetName] = useState("");
  const [mergeTargetCode, setMergeTargetCode] = useState("");
  const [mergeEffectiveDate, setMergeEffectiveDate] = useState(todayIsoDate);
  const [mergeNotes, setMergeNotes] = useState("");
  const [moveActiveFiles, setMoveActiveFiles] = useState(true);
  const [deactivateSourceDivisions, setDeactivateSourceDivisions] = useState(true);
  const [mergeSaving, setMergeSaving] = useState(false);
  const [mergeMessage, setMergeMessage] = useState("");
  const [splitSourceDivisionId, setSplitSourceDivisionId] = useState("");
  const [splitIndentors, setSplitIndentors] = useState<Indentor[]>([]);
  const [splitIndentorTotal, setSplitIndentorTotal] = useState(0);
  const [splitIndentorSearch, setSplitIndentorSearch] = useState("");
  const [splitIndentorPage, setSplitIndentorPage] = useState(1);
  const [selectedSplitIndentorNames, setSelectedSplitIndentorNames] = useState<Record<string, string>>({});
  const [splitIndentorIds, setSplitIndentorIds] = useState<string[]>([]);
  const [splitTargetId, setSplitTargetId] = useState("");
  const [splitTargetName, setSplitTargetName] = useState("");
  const [splitTargetCode, setSplitTargetCode] = useState("");
  const [splitCapital, setSplitCapital] = useState("");
  const [splitRevenue, setSplitRevenue] = useState("");
  const [splitEffectiveDate, setSplitEffectiveDate] = useState(todayIsoDate);
  const [splitNotes, setSplitNotes] = useState("");
  const [deactivateSplitSource, setDeactivateSplitSource] = useState(false);
  const [splitSaving, setSplitSaving] = useState(false);
  const [splitMessage, setSplitMessage] = useState("");
  const [activeSubview, setActiveSubview] = useState<YearSetupSubview>("setup");
  const setupYear = isAllActiveFilesYear(settings.selectedYear)
    ? settings.financialYear
    : settings.selectedYear;

  const yearOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            settings.financialYear,
            setupYear,
            ...settings.financialYears,
            ...files.map((file) => file.year),
            ...files.flatMap((file) => file.activeYears ?? []),
          ]
            .map((year) => year?.trim())
            .filter((year): year is string => Boolean(year) && !isAllActiveFilesYear(year)),
        ),
      ).sort((a, b) => b.localeCompare(a)),
    [files, settings.financialYear, settings.financialYears, setupYear],
  );

  useEffect(() => {
    let cancelled = false;
    store
      .getDivisionsForYear(setupYear, true)
      .then((payload) => {
        if (!cancelled) setCurrentDivisions(payload.divisions);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setCurrentDivisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, setupYear]);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      currentDivisions.forEach((division) => {
        if (!next[division.id]) {
          next[division.id] = {
            allocatedCapital: division.allocatedCapital ?? "",
            allocatedRevenue: division.allocatedRevenue ?? "",
            active: division.active ?? false,
          };
        }
      });
      return next;
    });
  }, [currentDivisions]);

  const currentFilesByDivision = useMemo(
    () => getYearFileCounts(files, setupYear),
    [files, setupYear],
  );

  const rows = useMemo(
    () =>
      currentDivisions.map((division) => {
        const draft = drafts[division.id] ?? {
          allocatedCapital: division.allocatedCapital ?? "",
          allocatedRevenue: division.allocatedRevenue ?? "",
          active: division.active ?? false,
        };
        return {
          division,
          draft,
        };
      }),
    [currentDivisions, drafts],
  );

  const activeDivisions = useMemo(
    () => currentDivisions.filter((division) => division.active),
    [currentDivisions],
  );
  const targetOptions = useMemo(
    () => currentDivisions.filter((division) => !mergeSourceIds.includes(division.id)),
    [currentDivisions, mergeSourceIds],
  );
  const selectedSourceFileCount = useMemo(
    () =>
      currentDivisions
        .filter((division) => mergeSourceIds.includes(division.id))
        .reduce((total, division) => total + (currentFilesByDivision.get(division.name) ?? 0), 0),
    [currentDivisions, currentFilesByDivision, mergeSourceIds],
  );
  const splitSourceDivision = currentDivisions.find(
    (division) => division.id === splitSourceDivisionId,
  );
  useEffect(() => {
    if (!splitSourceDivisionId) {
      setSplitIndentors([]);
      setSplitIndentorTotal(0);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      fetchIndentors({
        divisionId: splitSourceDivisionId,
        q: splitIndentorSearch,
        page: splitIndentorPage,
        pageSize: 100,
      })
        .then((result) => {
          setSplitIndentors(result.indentors);
          setSplitIndentorTotal(result.total);
        })
        .catch((error) => {
          console.error(error);
          setSplitIndentors([]);
          setSplitIndentorTotal(0);
        });
    }, 200);
    return () => window.clearTimeout(timeoutId);
  }, [splitSourceDivisionId, splitIndentorSearch, splitIndentorPage]);
  const splitIndentorTotalPages = Math.max(1, Math.ceil(splitIndentorTotal / 100));
  const splitTargetOptions = useMemo(
    () => currentDivisions.filter((division) => division.id !== splitSourceDivisionId),
    [currentDivisions, splitSourceDivisionId],
  );
  const splitSelectedIndentorNames = useMemo(
    () => splitIndentorIds.map((id) => selectedSplitIndentorNames[id]).filter(Boolean),
    [selectedSplitIndentorNames, splitIndentorIds],
  );
  const splitSelectedFileCount = useMemo(() => {
    if (!splitSourceDivision || splitSelectedIndentorNames.length === 0) return 0;
    return files.filter(
      (file) =>
        isFileVisibleForYear(file, setupYear) &&
        file.division === splitSourceDivision.name &&
        Boolean(file.indentor) &&
        splitSelectedIndentorNames.includes(file.indentor),
    ).length;
  }, [files, setupYear, splitSelectedIndentorNames, splitSourceDivision]);
  const splitSourceCapital = parseAmount(splitSourceDivision?.allocatedCapital) ?? 0;
  const splitSourceRevenue = parseAmount(splitSourceDivision?.allocatedRevenue) ?? 0;
  const splitTransferCapital = parseAmount(splitCapital) ?? 0;
  const splitTransferRevenue = parseAmount(splitRevenue) ?? 0;
  const splitRemainingCapital = splitSourceCapital - splitTransferCapital;
  const splitRemainingRevenue = splitSourceRevenue - splitTransferRevenue;

  if (activeUser?.role !== "admin") {
    return (
      <div className="max-w-xl rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <h1 className="text-sm font-semibold">Year setup</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This yearly allocation setup is available only to administrators.
        </p>
      </div>
    );
  }

  const updateDraft = (id: string, patch: Partial<DraftAllocation>) => {
    setDrafts((current) => ({
      ...current,
      [id]: {
        allocatedCapital: current[id]?.allocatedCapital ?? "",
        allocatedRevenue: current[id]?.allocatedRevenue ?? "",
        active: current[id]?.active ?? false,
        ...patch,
      },
    }));
  };

  const saveAllocation = async (division: Division, allocation: DraftAllocation) => {
    setSavingId(division.id);
    try {
      await store.saveDivisionAllocation(division.id, setupYear, allocation);
    } finally {
      setSavingId(undefined);
    }
  };

  const addDivision = () => {
    if (!newName.trim()) return;
    store.addDivision(
      newName.trim(),
      newCode.trim() || undefined,
      newCapital.trim() || undefined,
      newRevenue.trim() || undefined,
      undefined,
      setupYear,
    );
    setNewName("");
    setNewCode("");
    setNewCapital("");
    setNewRevenue("");
  };

  const toggleMergeSource = (divisionId: string, checked: boolean) => {
    setMergeMessage("");
    setMergeSourceIds((current) =>
      checked ? [...current, divisionId] : current.filter((id) => id !== divisionId),
    );
    if (checked && mergeTargetId === divisionId) setMergeTargetId("");
  };

  const mergeDivisions = async () => {
    setMergeMessage("");
    if (mergeSourceIds.length < 2) {
      setMergeMessage("Select at least two source divisions.");
      return;
    }
    const targetName = mergeTargetName.trim();
    if (!targetName && !mergeTargetId) {
      setMergeMessage("Choose a target division or enter a new merged division name.");
      return;
    }

    setMergeSaving(true);
    try {
      await store.mergeDivisions({
        financialYear: setupYear,
        sourceDivisionIds: mergeSourceIds,
        targetDivisionId: targetName ? undefined : mergeTargetId,
        targetDivisionName: targetName || undefined,
        targetDivisionCode: targetName ? mergeTargetCode.trim() || undefined : undefined,
        effectiveDate: mergeEffectiveDate || undefined,
        notes: mergeNotes.trim() || undefined,
        moveActiveFiles,
        deactivateSourceDivisions,
      });
      setMergeSourceIds([]);
      setMergeTargetId("");
      setMergeTargetName("");
      setMergeTargetCode("");
      setMergeNotes("");
      setReloadKey((value) => value + 1);
      setMergeMessage("Division merge saved.");
    } catch (error) {
      setMergeMessage(error instanceof Error ? error.message : "Merge failed.");
    } finally {
      setMergeSaving(false);
    }
  };

  const toggleSplitIndentor = (indentorId: string, checked: boolean) => {
    setSplitMessage("");
    const indentor = splitIndentors.find((item) => item.id === indentorId);
    setSelectedSplitIndentorNames((current) => {
      const next = { ...current };
      if (checked && indentor) {
        next[indentorId] = indentor.name;
      } else {
        delete next[indentorId];
      }
      return next;
    });
    setSplitIndentorIds((current) =>
      checked ? [...current, indentorId] : current.filter((id) => id !== indentorId),
    );
  };

  const splitTransferDivision = async () => {
    setSplitMessage("");
    if (!splitSourceDivisionId) {
      setSplitMessage("Select a source division.");
      return;
    }
    if (splitIndentorIds.length === 0) {
      setSplitMessage("Select at least one indentor.");
      return;
    }
    const targetName = splitTargetName.trim();
    if (!targetName && !splitTargetId) {
      setSplitMessage("Choose a target division or enter a new division name.");
      return;
    }
    if (splitTargetId === splitSourceDivisionId) {
      setSplitMessage("Target division cannot be the source division.");
      return;
    }

    setSplitSaving(true);
    try {
      await store.splitTransferDivision({
        financialYear: setupYear,
        sourceDivisionId: splitSourceDivisionId,
        indentorIds: splitIndentorIds,
        targetDivisionId: targetName ? undefined : splitTargetId,
        targetDivisionName: targetName || undefined,
        targetDivisionCode: targetName ? splitTargetCode.trim() || undefined : undefined,
        allocatedCapital: splitCapital.trim() || "0",
        allocatedRevenue: splitRevenue.trim() || "0",
        effectiveDate: splitEffectiveDate || undefined,
        notes: splitNotes.trim() || undefined,
        deactivateSourceDivision: deactivateSplitSource,
	      });
	      setSplitIndentorIds([]);
	      setSelectedSplitIndentorNames({});
	      setSplitTargetId("");
      setSplitTargetName("");
      setSplitTargetCode("");
      setSplitCapital("");
      setSplitRevenue("");
      setSplitNotes("");
      setDeactivateSplitSource(false);
      setReloadKey((value) => value + 1);
      setSplitMessage("Division split / transfer saved.");
    } catch (error) {
      setSplitMessage(error instanceof Error ? error.message : "Split transfer failed.");
    } finally {
      setSplitSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Year setup</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select a financial year and decide which divisions are active for that year. Enter that
            year's capital and revenue funds here; each new year starts with its own allocation and
            committee setup.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Allocations can be edited mid-year and saved again; dashboard and reports will use the
            latest saved allocation for the selected year.
          </p>
        </div>
        <label className="block">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Setup year</div>
          <select
            value={setupYear}
            onChange={(event) => store.updateSettings({ selectedYear: event.target.value })}
            className="h-9 min-w-36 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="inline-flex rounded-md border border-border bg-card p-1 shadow-[var(--shadow-card)]">
        {[
          { key: "setup", label: "Year setup" },
          { key: "merge", label: "Merge divisions" },
          { key: "split", label: "Split / transfer" },
        ].map((view) => (
          <button
            key={view.key}
            type="button"
            onClick={() => setActiveSubview(view.key as YearSetupSubview)}
            className={
              "h-9 rounded px-3 text-sm font-medium transition " +
              (activeSubview === view.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground")
            }
          >
            {view.label}
          </button>
        ))}
      </div>

      {activeSubview === "setup" ? (
        <>
          <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Add a division for {setupYear}</h2>
                <p className="text-xs text-muted-foreground">
                  Use this when the year has a new office, section, or budget head.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_0.7fr_0.8fr_0.8fr_auto]">
              <AllocationInput value={newName} onChange={setNewName} placeholder="Division name" />
              <AllocationInput value={newCode} onChange={setNewCode} placeholder="Code" />
              <AllocationInput
                value={newCapital}
                onChange={setNewCapital}
                placeholder="Capital"
                amount
              />
              <AllocationInput
                value={newRevenue}
                onChange={setNewRevenue}
                placeholder="Revenue"
                amount
              />
              <button
                type="button"
                onClick={addDivision}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <Plus className="size-4" />
                Add
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-border bg-card shadow-[var(--shadow-card)]">
            <table className="w-full min-w-[760px] table-fixed text-sm">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[14%]" />
                <col className="w-[23%]" />
                <col className="w-[23%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead className="bg-secondary text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Division</th>
                  <th className="px-4 py-2.5 text-left font-medium">Active</th>
                  <th className="px-4 py-2.5 text-left font-medium">Capital allocation</th>
                  <th className="px-4 py-2.5 text-left font-medium">Revenue allocation</th>
                  <th className="px-4 py-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSaving = savingId === row.division.id;
                  return (
                    <tr key={row.division.id} className="border-t border-border align-top">
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                            <Landmark className="size-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium">{row.division.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.division.code || "No code"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        <label className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3">
                          <input
                            type="checkbox"
                            checked={row.draft.active}
                            onChange={(event) =>
                              updateDraft(row.division.id, { active: event.target.checked })
                            }
                            className="size-4 rounded border-input"
                          />
                          <span className="text-sm">Yes</span>
                        </label>
                      </td>
                      <td className="px-4 py-3">
                        <AllocationInput
                          value={row.draft.allocatedCapital}
                          onChange={(value) =>
                            updateDraft(row.division.id, { allocatedCapital: value })
                          }
                          placeholder="0"
                          amount
                        />
                      </td>
                      <td className="px-4 py-3">
                        <AllocationInput
                          value={row.draft.allocatedRevenue}
                          onChange={(value) =>
                            updateDraft(row.division.id, { allocatedRevenue: value })
                          }
                          placeholder="0"
                          amount
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => void saveAllocation(row.division, row.draft)}
                            disabled={isSaving}
                            title="Save allocation"
                            aria-label="Save allocation"
                            className="grid size-8 place-items-center rounded-md border border-border bg-background hover:bg-accent disabled:opacity-50"
                          >
                            {isSaving ? (
                              <RotateCw className="size-4 animate-spin" />
                            ) : (
                              <Save className="size-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : activeSubview === "merge" ? (
      <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Merge divisions for {setupYear}</h2>
            <p className="text-xs text-muted-foreground">
              Active files from selected divisions will continue under the merged division.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
            <GitMerge className="size-4" />
            {selectedSourceFileCount} active files
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Source divisions</div>
            <div className="grid max-h-52 gap-2 overflow-auto rounded-md border border-border bg-background p-2 sm:grid-cols-2">
              {activeDivisions.map((division) => (
                <label
                  key={division.id}
                  className="flex min-h-10 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={mergeSourceIds.includes(division.id)}
                    onChange={(event) => toggleMergeSource(division.id, event.target.checked)}
                    className="size-4 rounded border-input"
                  />
                  <span className="min-w-0 flex-1 truncate">{division.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {currentFilesByDivision.get(division.name) ?? 0}
                  </span>
                </label>
              ))}
              {!activeDivisions.length && (
                <div className="px-2 py-3 text-sm text-muted-foreground">
                  No active divisions in this year.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Existing merged division
                </div>
                <select
                  value={mergeTargetId}
                  onChange={(event) => {
                    setMergeTargetId(event.target.value);
                    if (event.target.value) setMergeTargetName("");
                  }}
                  disabled={Boolean(mergeTargetName.trim())}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
                >
                  <option value="">Select target</option>
                  {targetOptions.map((division) => (
                    <option key={division.id} value={division.id}>
                      {division.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Effective date
                </div>
                <input
                  type="date"
                  value={mergeEffectiveDate}
                  onChange={(event) => setMergeEffectiveDate(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_0.45fr]">
              <AllocationInput
                value={mergeTargetName}
                onChange={(value) => {
                  setMergeTargetName(value);
                  if (value.trim()) setMergeTargetId("");
                }}
                placeholder="New merged division name"
              />
              <AllocationInput
                value={mergeTargetCode}
                onChange={setMergeTargetCode}
                placeholder="Code"
              />
            </div>

            <textarea
              value={mergeNotes}
              onChange={(event) => setMergeNotes(event.target.value)}
              placeholder="Notes"
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />

            <div className="flex flex-wrap gap-2">
              <label className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                <input
                  type="checkbox"
                  checked={moveActiveFiles}
                  onChange={(event) => setMoveActiveFiles(event.target.checked)}
                  className="size-4 rounded border-input"
                />
                Move active files
              </label>
              <label className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                <input
                  type="checkbox"
                  checked={deactivateSourceDivisions}
                  onChange={(event) => setDeactivateSourceDivisions(event.target.checked)}
                  className="size-4 rounded border-input"
                />
                Deactivate source divisions
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">{mergeMessage}</div>
              <button
                type="button"
                onClick={() => void mergeDivisions()}
                disabled={mergeSaving}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {mergeSaving ? (
                  <RotateCw className="size-4 animate-spin" />
                ) : (
                  <GitMerge className="size-4" />
                )}
                Merge
              </button>
            </div>
          </div>
        </div>
      </div>
      ) : (
        <div className="rounded-md border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Split / transfer division for {setupYear}</h2>
              <p className="text-xs text-muted-foreground">
                Transfer selected indentors, their active files, and manual funds to another
                division.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
              <Landmark className="size-4" />
              {splitSelectedFileCount} matching files
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              <label className="block">
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Source division
                </div>
                <select
                  value={splitSourceDivisionId}
	                  onChange={(event) => {
	                    setSplitSourceDivisionId(event.target.value);
	                    setSplitIndentorIds([]);
	                    setSelectedSplitIndentorNames({});
	                    setSplitIndentorPage(1);
	                    setSplitIndentorSearch("");
	                    setSplitTargetId("");
	                    setSplitMessage("");
	                  }}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                >
                  <option value="">Select source division</option>
                  {activeDivisions.map((division) => (
                    <option key={division.id} value={division.id}>
                      {division.name}
                    </option>
                  ))}
                </select>
              </label>

	              <div>
	                <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
	                  <div className="text-xs font-medium text-muted-foreground">
	                    Indentors to transfer
	                  </div>
	                  <input
	                    value={splitIndentorSearch}
	                    onChange={(event) => {
	                      setSplitIndentorSearch(event.target.value);
	                      setSplitIndentorPage(1);
	                    }}
	                    disabled={!splitSourceDivisionId}
	                    placeholder="Search indentors"
	                    className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
	                  />
	                </div>
	                <div className="grid max-h-72 gap-2 overflow-auto rounded-md border border-border bg-background p-2">
	                  {splitIndentors.map((indentor) => (
	                    <label
                      key={indentor.id}
                      className="flex min-h-10 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        checked={splitIndentorIds.includes(indentor.id)}
                        onChange={(event) =>
                          toggleSplitIndentor(indentor.id, event.target.checked)
                        }
                        className="size-4 rounded border-input"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{indentor.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {indentor.sfId} - {indentor.designation}
                        </span>
                      </span>
                    </label>
                  ))}
                  {!splitSourceDivisionId ? (
                    <div className="px-2 py-3 text-sm text-muted-foreground">
                      Select a source division first.
                    </div>
	                  ) : splitIndentors.length === 0 ? (
	                    <div className="px-2 py-3 text-sm text-muted-foreground">
	                      No indentors found for this division.
	                    </div>
	                  ) : null}
	                </div>
	                {splitSourceDivisionId ? (
	                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
	                    <span>
	                      Showing {splitIndentors.length} of {splitIndentorTotal}
	                    </span>
	                    <div className="flex items-center gap-2">
	                      <button
	                        type="button"
	                        disabled={splitIndentorPage <= 1}
	                        onClick={() => setSplitIndentorPage((current) => Math.max(1, current - 1))}
	                        className="h-7 rounded-md border border-border px-2 disabled:opacity-50"
	                      >
	                        Previous
	                      </button>
	                      <span>
	                        Page {splitIndentorPage} of {splitIndentorTotalPages}
	                      </span>
	                      <button
	                        type="button"
	                        disabled={splitIndentorPage >= splitIndentorTotalPages}
	                        onClick={() =>
	                          setSplitIndentorPage((current) =>
	                            Math.min(splitIndentorTotalPages, current + 1),
	                          )
	                        }
	                        className="h-7 rounded-md border border-border px-2 disabled:opacity-50"
	                      >
	                        Next
	                      </button>
	                    </div>
	                  </div>
	                ) : null}
	              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Existing target division
                  </div>
                  <select
                    value={splitTargetId}
                    onChange={(event) => {
                      setSplitTargetId(event.target.value);
                      if (event.target.value) setSplitTargetName("");
                    }}
                    disabled={Boolean(splitTargetName.trim())}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
                  >
                    <option value="">Select target</option>
                    {splitTargetOptions.map((division) => (
                      <option key={division.id} value={division.id}>
                        {division.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Effective date
                  </div>
                  <input
                    type="date"
                    value={splitEffectiveDate}
                    onChange={(event) => setSplitEffectiveDate(event.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_0.45fr]">
                <AllocationInput
                  value={splitTargetName}
                  onChange={(value) => {
                    setSplitTargetName(value);
                    if (value.trim()) setSplitTargetId("");
                  }}
                  placeholder="New target division name"
                />
                <AllocationInput
                  value={splitTargetCode}
                  onChange={setSplitTargetCode}
                  placeholder="Code"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <AllocationInput
                  value={splitCapital}
                  onChange={setSplitCapital}
                  placeholder="Capital to transfer"
                  amount
                />
                <AllocationInput
                  value={splitRevenue}
                  onChange={setSplitRevenue}
                  placeholder="Revenue to transfer"
                  amount
                />
              </div>

              <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-secondary/25 p-3 text-sm sm:grid-cols-2">
                <BalanceSummary
                  label="Capital balance"
                  total={splitSourceCapital}
                  transfer={splitTransferCapital}
                  remaining={splitRemainingCapital}
                />
                <BalanceSummary
                  label="Revenue balance"
                  total={splitSourceRevenue}
                  transfer={splitTransferRevenue}
                  remaining={splitRemainingRevenue}
                />
              </div>

              <textarea
                value={splitNotes}
                onChange={(event) => setSplitNotes(event.target.value)}
                placeholder="Notes"
                rows={3}
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />

              <label className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                <input
                  type="checkbox"
                  checked={deactivateSplitSource}
                  onChange={(event) => setDeactivateSplitSource(event.target.checked)}
                  className="size-4 rounded border-input"
                />
                Deactivate source division after transfer
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">{splitMessage}</div>
                <button
                  type="button"
                  onClick={() => void splitTransferDivision()}
                  disabled={splitSaving}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {splitSaving ? (
                    <RotateCw className="size-4 animate-spin" />
                  ) : (
                    <Landmark className="size-4" />
                  )}
                  Transfer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AllocationInput({
  value,
  onChange,
  placeholder,
  amount = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  amount?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      inputMode={amount ? "decimal" : undefined}
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
    />
  );
}

function BalanceSummary({
  label,
  total,
  transfer,
  remaining,
}: {
  label: string;
  total: number;
  transfer: number;
  remaining: number;
}) {
  const remainingClass = remaining < 0 ? "text-destructive" : "text-foreground";
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Source</span>
        <span className="font-medium tabular-nums">{formatAmount(total)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Transfer</span>
        <span className="font-medium tabular-nums">{formatAmount(transfer)}</span>
      </div>
      <div className="flex justify-between gap-3 border-t border-border pt-1">
        <span className="text-muted-foreground">Remaining</span>
        <span className={`font-semibold tabular-nums ${remainingClass}`}>
          {formatAmount(remaining)}
        </span>
      </div>
    </div>
  );
}

function getYearFileCounts(files: ReturnType<typeof useFiles>, year: string) {
  const counts = new Map<string, number>();
  if (!year) return counts;
  files.forEach((file) => {
    if (!isFileVisibleForYear(file, year) || !file.division) return;
    counts.set(file.division, (counts.get(file.division) ?? 0) + 1);
  });
  return counts;
}

function formatAmount(value: number) {
  return formatThousandsAndLakhs(value, 2);
}
