import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Lock, Pencil, Plus, Trash2, Unlock, X } from "lucide-react";
import {
  fetchFilesForYear,
  fetchIndentors,
  store,
  useActiveUser,
  useDivisions,
  useSettings,
  useUsers,
  type AppUserRole,
  type Division,
  type FileRecord,
  type Indentor,
  type ValueThresholdAppliesTo,
  type ValueThresholdLevel,
} from "@/lib/files-store";
import { mmgSummaryFieldOptions, normalizeMmgSummaryFields } from "@/lib/mmg-summary";
import { tableFieldPresetGroups, type TableFieldPreset } from "@/lib/table-field-presets";
import { promptDeletionPassword, requestDeletionPassword } from "@/lib/delete-password";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { YearSetupPanel } from "@/routes/year-setup";
import { displayFinancialYearLabel, isAllActiveFilesYear } from "@/lib/year-filter";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const defaultMilestoneSequence = [
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

function appendFileClosedMilestone(milestones: string[]) {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  const normalizedMilestones = milestones.map(normalizeConfiguredMilestoneLabel);
  const withoutFileClosed = normalizedMilestones.filter(
    (milestone) => normalize(milestone) !== normalize(fileClosedMilestone),
  );
  return [...withoutFileClosed, fileClosedMilestone];
}

function normalizeConfiguredMilestoneLabel(milestone: string) {
  return milestone.trim().toLowerCase() === "controlled" ? "Controlling" : milestone;
}

function readFinancialYearStart(label: string) {
  const match = label.match(/\b(20\d{2}|19\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function formatFinancialYear(startYear: number) {
  const endYear = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYear}`;
}

function getNextFinancialYearLabel(years: string[]) {
  const latestStartYear = years.reduce<number | null>((latest, year) => {
    const startYear = readFinancialYearStart(year);
    if (startYear === null) return latest;
    return latest === null || startYear > latest ? startYear : latest;
  }, null);
  return formatFinancialYear((latestStartYear ?? new Date().getFullYear()) + 1);
}

function SettingsPage() {
  const activeUser = useActiveUser();
  const [activeAdminSection, setActiveAdminSection] = useState("divisions");
  if (activeUser?.role === "viewer" || activeUser?.role === "division_user") {
    return (
      <div className="space-y-4 max-w-6xl">
        <Tabs defaultValue="theme" className="space-y-4">
          <TabsList aria-label="Settings sections">
            <TabsTrigger value="theme">UI theme</TabsTrigger>
            <TabsTrigger value="indentors">Indentors</TabsTrigger>
            <TabsTrigger value="presets">Preset table fields</TabsTrigger>
          </TabsList>
          <TabsContent value="theme">
            <PreferenceSettings />
          </TabsContent>
          <TabsContent value="indentors">
            <IndentorSettings />
          </TabsContent>
          <TabsContent value="presets">
            <TableFieldPresetSettings />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  if (activeUser?.role === "sub_admin" || activeUser?.role === "editor") {
    const canEditMmgSummary = activeUser.role === "sub_admin";
    return (
      <div className="space-y-4 max-w-6xl">
        <Tabs defaultValue="user" className="space-y-4">
          <TabsList aria-label="Settings sections">
            <TabsTrigger value="user">User</TabsTrigger>
            <TabsTrigger value="indentors">Indentors</TabsTrigger>
            <TabsTrigger value="presets">Preset table fields</TabsTrigger>
            {canEditMmgSummary ? <TabsTrigger value="mmgSummary">MMG Summary</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="user">
            <AccountSettings />
          </TabsContent>
          <TabsContent value="indentors">
            <IndentorSettings />
          </TabsContent>
          <TabsContent value="presets">
            <TableFieldPresetSettings />
          </TabsContent>
          {canEditMmgSummary ? (
            <TabsContent value="mmgSummary">
              <MmgSummarySettings />
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    );
  }

  if (activeUser?.role !== "admin") {
    return (
      <div className="max-w-xl rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <h1 className="text-sm font-semibold">Admin settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is available only to administrators.
        </p>
      </div>
    );
  }

  const adminSections = [
    { key: "workspace", label: "Workspace", content: <WorkspaceSettings /> },
    { key: "yearSetup", label: "Year Setup", content: <YearSetupPanel /> },
    { key: "mmgSummary", label: "MMG Summary", content: <MmgSummarySettings /> },
    { key: "divisions", label: "Divisions", content: <DivisionSettings /> },
    { key: "indentors", label: "Indentors", content: <IndentorSettings /> },
    { key: "tcec", label: "TCEC Committee", content: <TcecCommitteeSettings /> },
    { key: "thresholds", label: "Value thresholds", content: <ValueThresholdSettings /> },
    { key: "milestones", label: "Milestones", content: <MilestoneSettings /> },
    { key: "presets", label: "Preset table fields", content: <TableFieldPresetSettings /> },
    { key: "users", label: "Authorised users", content: <UserSettings /> },
    { key: "archive", label: "Archive", content: <ArchiveSettings /> },
  ];
  const selectedAdminSection =
    adminSections.find((section) => section.key === activeAdminSection) ?? adminSections[0];

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="rounded-md border border-border bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="space-y-1">
            {adminSections.map((section) => {
              const selected = selectedAdminSection.key === section.key;
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => setActiveAdminSection(section.key)}
                  className={
                    "w-full rounded-md px-3 py-2 text-left text-sm font-medium transition " +
                    (selected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground")
                  }
                >
                  {section.label}
                </button>
              );
            })}
          </div>
        </aside>
        <div className="min-w-0">{selectedAdminSection.content}</div>
      </div>
    </div>
  );
}

function PreferenceSettings() {
  const settings = useSettings();
  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">UI theme</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Choose the display theme for your own login.
      </p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <ThemeField
          label="Theme"
          value={settings.theme}
          onChange={(value) => store.updateSettings({ theme: value })}
        />
        <ThemeTintField
          label="Theme color"
          value={settings.themeTint}
          onChange={(value) => store.updateSettings({ themeTint: value })}
        />
      </div>
    </div>
  );
}

function AccountSettings() {
  const activeUser = useActiveUser();
  const divisions = useDivisions();
  const settings = useSettings();
  const assignedDivisionNames =
    activeUser?.role === "sub_admin"
      ? "All divisions"
      : activeUser?.divisionIds
          .map((id) => divisions.find((division) => division.id === id)?.name)
          .filter(Boolean)
          .join(", ") || "No divisions assigned";

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">User settings</h2>
      <p className="text-xs text-muted-foreground mb-5">View your account and access details.</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" value={activeUser?.name ?? "Not signed in"} />
        <Field label="Username" value={activeUser?.username ?? "Not signed in"} />
        <Field label="Role" value={activeUser ? roleLabel(activeUser.role) : "Not signed in"} />
        <Field label="Divisions" value={assignedDivisionNames} />
      </div>

      {(activeUser?.role === "editor" || activeUser?.role === "sub_admin") && (
        <div className="mt-5 max-w-sm">
          <ThemeTintField
            label="UI tint"
            value={settings.themeTint}
            onChange={(value) => store.updateSettings({ themeTint: value })}
          />
        </div>
      )}
    </div>
  );
}

const mmgLiveTrialOptions = [
  {
    key: "status1",
    label: "Status-1",
    description: "Milestone status counts from Dashboard.",
  },
  {
    key: "status2",
    label: "Status-2",
    description: "Division-wise live milestone table from Dashboard.",
  },
  {
    key: "finance",
    label: "Finance totals",
    description: "Allocated, intended, booked, committed, and spent totals.",
  },
] as const;

function MmgLiveSettings() {
  const settings = useSettings();
  const selectedOptions = settings.mmgLiveOptions ?? [];

  const toggleOption = (optionKey: string) => {
    const next = selectedOptions.includes(optionKey)
      ? selectedOptions.filter((key) => key !== optionKey)
      : [...selectedOptions, optionKey];
    store.updateSettings({ mmgLiveOptions: next });
  };

  return (
    <div className="rounded-md border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mb-1 text-sm font-semibold">MMG live</h2>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Trial setup for publishing selected Dashboard/Reports summaries to a read-only local
            intranet page.
          </p>
        </div>
        <a
          href="/mmg-live"
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
        >
          Preview
        </a>
      </div>

      <label className="mb-4 flex items-center justify-between gap-4 rounded-md border border-border bg-secondary/25 px-3 py-2">
        <span>
          <span className="block text-sm font-medium">Activate MMG live page</span>
          <span className="block text-xs text-muted-foreground">
            When inactive, the public page shows an unavailable message.
          </span>
        </span>
        <input
          type="checkbox"
          checked={settings.mmgLiveEnabled === true}
          onChange={(event) => store.updateSettings({ mmgLiveEnabled: event.target.checked })}
          className="size-4"
        />
      </label>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {mmgLiveTrialOptions.map((option) => (
          <label
            key={option.key}
            className={
              "rounded-md border p-4 transition " +
              (selectedOptions.includes(option.key)
                ? "border-primary bg-primary/10"
                : "border-border bg-background hover:bg-accent")
            }
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{option.label}</div>
                <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
              </div>
              <input
                type="checkbox"
                checked={selectedOptions.includes(option.key)}
                onChange={() => toggleOption(option.key)}
                className="mt-0.5 size-4"
              />
            </div>
          </label>
        ))}
      </div>

      <div className="mt-4 rounded-md border border-dashed border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
        Public URL: <span className="font-medium text-foreground">/mmg-live</span>
      </div>
    </div>
  );
}

function WorkspaceSettings() {
  const settings = useSettings();
  const [selectedYearFileCount, setSelectedYearFileCount] = useState(0);
  const [newFinancialYear, setNewFinancialYear] = useState("");
  const selectedFinancialYear = isAllActiveFilesYear(settings.selectedYear)
    ? settings.financialYear
    : settings.selectedYear;
  const financialYears = Array.from(
    new Set(
      [settings.financialYear, selectedFinancialYear, ...settings.financialYears]
        .filter(Boolean)
        .filter((year) => !isAllActiveFilesYear(year)),
    ),
  ).sort((a, b) => b.localeCompare(a));
  const suggestedFinancialYear = getNextFinancialYearLabel(financialYears);
  useEffect(() => {
    let cancelled = false;
    fetchFilesForYear(selectedFinancialYear)
      .then((payload) => {
        if (!cancelled) setSelectedYearFileCount(payload.files.length);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setSelectedYearFileCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFinancialYear]);
  const canDeleteSelectedYear =
    selectedFinancialYear !== settings.financialYear &&
    selectedYearFileCount === 0 &&
    financialYears.length > 1;

  const addFinancialYear = () => {
    const label = newFinancialYear.trim() || suggestedFinancialYear;
    if (!label) return;
    store.addFinancialYear(label, true);
    setNewFinancialYear("");
  };

  const setCurrentFinancialYear = () => {
    store.updateSettings({
      financialYear: selectedFinancialYear,
      selectedYear: selectedFinancialYear,
    });
  };

  const toggleYearSelectionLock = () => {
    store.updateSettings({ yearSelectionLocked: !settings.yearSelectionLocked });
  };

  const deleteSelectedFinancialYear = () => {
    if (!canDeleteSelectedYear) return;
    if (requestDeletionPassword(`delete financial year "${selectedFinancialYear}"`)) {
      store.deleteFinancialYear(selectedFinancialYear);
    }
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Workspace</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Configure how this records system behaves.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="md:col-span-2 rounded-md border border-border bg-secondary/20 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Financial years</h3>
              <p className="text-xs text-muted-foreground">
                Select a year for allocation editing, or set it as the current file year.
              </p>
            </div>
            <span className="rounded bg-background px-2 py-1 text-xs text-muted-foreground">
              Current: {displayFinancialYearLabel(settings.financialYear)}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(220px,0.7fr)_minmax(260px,1fr)]">
            <label className="block">
              <div className="text-xs font-medium mb-1.5">Selected year</div>
              <select
                value={selectedFinancialYear}
                onChange={(event) => store.updateSettings({ selectedYear: event.target.value })}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              >
                {financialYears.map((year) => (
                  <option key={year} value={year}>
                    {displayFinancialYearLabel(year)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="text-xs font-medium mb-1.5">Add year</div>
              <input
                value={newFinancialYear || suggestedFinancialYear}
                onChange={(event) => setNewFinancialYear(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addFinancialYear();
                }}
                placeholder={suggestedFinancialYear}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3 xl:col-span-2">
              <button
                type="button"
                onClick={addFinancialYear}
                className="h-10 min-w-32 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
              >
                <Plus className="size-4" /> Add Year
              </button>

              <button
                type="button"
                onClick={setCurrentFinancialYear}
                disabled={selectedFinancialYear === settings.financialYear}
                className="h-10 min-w-40 px-4 inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                <Check className="size-4" /> Set as current
              </button>

              <button
                type="button"
                onClick={toggleYearSelectionLock}
                className={
                  "h-10 min-w-36 px-4 inline-flex items-center justify-center gap-1.5 rounded-md border text-sm font-medium " +
                  (settings.yearSelectionLocked
                    ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                    : "border-border bg-background hover:bg-accent")
                }
              >
                {settings.yearSelectionLocked ? (
                  <>
                    <Lock className="size-4" /> Locked
                  </>
                ) : (
                  <>
                    <Unlock className="size-4" /> Unlocked
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={deleteSelectedFinancialYear}
                disabled={!canDeleteSelectedYear}
                title={
                  selectedFinancialYear === settings.financialYear
                    ? "Current financial year cannot be deleted"
                    : selectedYearFileCount > 0
                      ? "Years with files cannot be deleted"
                      : "Delete selected year"
                }
                className="h-10 min-w-32 px-4 inline-flex items-center justify-center gap-1.5 rounded-md border border-destructive/30 bg-background text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 className="size-4" /> Delete
              </button>
            </div>
          </div>
        </div>
        <ThemeField
          label="Theme"
          value={settings.theme}
          onChange={(value) => store.updateSettings({ theme: value })}
        />
        <ThemeTintField
          label="Theme color"
          value={settings.themeTint}
          onChange={(value) => store.updateSettings({ themeTint: value })}
        />
        <PasswordField
          label="Deletion password"
          value={settings.deletionPassword}
          onChange={(value) => store.updateSettings({ deletionPassword: value })}
        />
      </div>
    </div>
  );
}

function TcecCommitteeSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const [name, setName] = useState("");
  const committees = settings.tcecCommittees ?? [];

  if (activeUser && activeUser.role !== "admin") return null;

  const updateCommittees = (next: string[]) => {
    store.updateSettings({ tcecCommittees: next });
  };

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = committees.some(
      (committee) => committee.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exists) {
      setName("");
      return;
    }
    updateCommittees([...committees, trimmed]);
    setName("");
  };

  const remove = (committee: string) => {
    updateCommittees(committees.filter((item) => item !== committee));
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">TCEC Committee</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add committee names for selection in TCEC fields.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
        <DivisionInput value={name} onChange={setName} placeholder="Committee name" />
        <button
          type="button"
          onClick={add}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-4 rounded-md border border-border">
        {committees.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No committee names added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {committees.map((committee) => (
              <li key={committee} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm font-medium">{committee}</span>
                <button
                  type="button"
                  onClick={() => remove(committee)}
                  className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                  aria-label={`Delete ${committee}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const defaultThresholdAppliesTo: ValueThresholdAppliesTo = "both";

function createThresholdLevels(count: number, existing: ValueThresholdLevel[]) {
  return Array.from({ length: count }, (_, index) => {
    const levelNumber = index + 1;
    const current = existing[index];
    return {
      label: current?.label || `Level ${levelNumber}`,
      levelNumber,
      minValue: current?.minValue ?? "",
      maxValue: current?.maxValue ?? "",
      appliesTo: current?.appliesTo ?? defaultThresholdAppliesTo,
    };
  });
}

function ValueThresholdSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const selectedYear = isAllActiveFilesYear(settings.selectedYear)
    ? settings.financialYear
    : settings.selectedYear;
  const [levels, setLevels] = useState<ValueThresholdLevel[]>(() =>
    formatThresholdLevels(settings.valueThresholdLevels ?? []),
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    setLevels(formatThresholdLevels(settings.valueThresholdLevels ?? []));
    setMessage("");
  }, [settings.selectedYear, settings.valueThresholdLevels]);

  if (activeUser && activeUser.role !== "admin") return null;

  const levelCount = levels.length;
  const save = (nextLevels = levels) => {
    const normalized = nextLevels.map((level, index) => ({
      ...level,
      label: level.label.trim() || `Level ${index + 1}`,
      levelNumber: index + 1,
      minValue: formatThresholdAmountInput(level.minValue) || "",
      maxValue: formatThresholdAmountInput(level.maxValue) || "",
      appliesTo: level.appliesTo || defaultThresholdAppliesTo,
    }));
    const invalid = normalized.find((level) => {
      const min = parseOptionalPositiveNumber(level.minValue);
      const max = parseOptionalPositiveNumber(level.maxValue);
      return (
        min.invalid ||
        max.invalid ||
        (min.value !== undefined && max.value !== undefined && min.value > max.value)
      );
    });
    if (invalid) {
      setMessage("Check threshold values before saving.");
      return;
    }
    setLevels(normalized);
    setMessage("Thresholds saved.");
    store.updateSettings({ selectedYear, valueThresholdLevels: normalized });
  };

  const updateCount = (count: number) => {
    const next = createThresholdLevels(count, levels);
    setLevels(next);
    setMessage("");
  };

  const updateLevel = (index: number, patch: Partial<ValueThresholdLevel>) => {
    setLevels((current) =>
      current.map((level, levelIndex) =>
        levelIndex === index ? { ...level, ...patch, levelNumber: levelIndex + 1 } : level,
      ),
    );
    setMessage("");
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">Value thresholds</h2>
          <p className="text-xs text-muted-foreground">
            Configure value levels for {selectedYear}. Files are matched by capital/revenue value.
          </p>
        </div>
        <label className="block">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Levels</div>
          <select
            value={String(levelCount)}
            onChange={(event) => updateCount(Number(event.target.value))}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="0">Select</option>
            {Array.from({ length: 8 }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
      </div>

      {levels.length === 0 ? (
        <div className="rounded-md border border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
          Select the number of threshold levels to begin.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-[780px] w-full text-sm">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Level</th>
                <th className="px-3 py-2 text-left font-medium">Label</th>
                <th className="px-3 py-2 text-left font-medium">Applies to</th>
                <th className="px-3 py-2 text-left font-medium">Min value</th>
                <th className="px-3 py-2 text-left font-medium">Max value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {levels.map((level, index) => (
                <tr key={index}>
                  <td className="px-3 py-2 font-medium">{index + 1}</td>
                  <td className="px-3 py-2">
                    <input
                      value={level.label}
                      onChange={(event) => updateLevel(index, { label: event.target.value })}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={level.appliesTo}
                      onChange={(event) =>
                        updateLevel(index, {
                          appliesTo: event.target.value as ValueThresholdAppliesTo,
                        })
                      }
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      <option value="both">Both</option>
                      <option value="capital">Capital</option>
                      <option value="revenue">Revenue</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={level.minValue ?? ""}
                      onChange={(event) =>
                        updateLevel(index, {
                          minValue: formatThresholdAmountInput(event.target.value),
                        })
                      }
                      inputMode="decimal"
                      placeholder="No minimum"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={level.maxValue ?? ""}
                      onChange={(event) =>
                        updateLevel(index, {
                          maxValue: formatThresholdAmountInput(event.target.value),
                        })
                      }
                      inputMode="decimal"
                      placeholder="No maximum"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">{message}</div>
        <button
          type="button"
          onClick={() => save()}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Check className="size-4" /> Save thresholds
        </button>
      </div>
    </div>
  );
}

function parseOptionalPositiveNumber(value: string | undefined) {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return { value: undefined, invalid: false };
  const parsed = Number(cleaned);
  return {
    value: Number.isFinite(parsed) ? parsed : undefined,
    invalid: !Number.isFinite(parsed) || parsed < 0,
  };
}

function formatThresholdLevels(levels: ValueThresholdLevel[]) {
  return levels.map((level) => ({
    ...level,
    minValue: formatThresholdAmountInput(level.minValue),
    maxValue: formatThresholdAmountInput(level.maxValue),
  }));
}

function formatThresholdAmountInput(value: string | undefined) {
  const raw = String(value ?? "").replace(/,/g, "");
  const sanitized = raw.replace(/[^\d.]/g, "");
  const [integerPart, ...decimalParts] = sanitized.split(".");
  const decimalPart = decimalParts.join("");
  const formattedInteger = formatIndianIntegerInput(integerPart);
  if (sanitized.includes(".")) return `${formattedInteger}.${decimalPart}`;
  return formattedInteger;
}

function formatIndianIntegerInput(integerPart: string) {
  const trimmed = integerPart.replace(/^0+(?=\d)/, "");
  const lastThree = trimmed.slice(-3);
  const beforeThousands = trimmed.slice(0, -3);
  if (!beforeThousands) return trimmed;
  const lastTwoBeforeThousands = beforeThousands.slice(-2);
  const lakhPart = beforeThousands.slice(0, -2);
  return [lakhPart, lastTwoBeforeThousands, lastThree].filter(Boolean).join(",");
}

function MilestoneSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const [name, setName] = useState("");
  const milestones = appendFileClosedMilestone(
    settings.milestones && settings.milestones.length > 0
      ? settings.milestones
      : defaultMilestoneSequence,
  );
  const [position, setPosition] = useState(String(milestones.length + 1));

  if (activeUser && activeUser.role !== "admin") return null;

  const updateMilestones = (next: string[]) => {
    store.updateSettings({ milestones: next });
  };

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = milestones.some(
      (milestone) => milestone.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exists) {
      setName("");
      return;
    }
    const insertIndex = Math.max(0, Math.min(Number(position) - 1, milestones.length));
    updateMilestones([
      ...milestones.slice(0, insertIndex),
      trimmed,
      ...milestones.slice(insertIndex),
    ]);
    setName("");
    setPosition(String(milestones.length + 2));
  };

  const remove = (milestone: string) => {
    updateMilestones(milestones.filter((item) => item !== milestone));
  };

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= milestones.length) return;
    const next = [...milestones];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateMilestones(next);
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Milestones</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add milestone names and place them at the required sequence in the workflow.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_170px_auto]">
        <DivisionInput value={name} onChange={setName} placeholder="Milestone name" />
        <label className="block">
          <div className="text-xs font-medium mb-1.5">Position</div>
          <select
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
          >
            {Array.from({ length: milestones.length + 1 }, (_, index) => (
              <option key={index + 1} value={String(index + 1)}>
                {index + 1}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={add}
          className="h-10 self-end px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-4 rounded-md border border-border">
        {milestones.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No milestone names added yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {milestones.map((milestone, index) => (
              <li key={milestone} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-secondary text-xs font-semibold">
                    {index + 1}
                  </span>
                  <span className="truncate text-sm font-medium">{milestone}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="size-8 grid place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    aria-label={`Move ${milestone} up`}
                  >
                    <ArrowUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === milestones.length - 1}
                    className="size-8 grid place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    aria-label={`Move ${milestone} down`}
                  >
                    <ArrowDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(milestone)}
                    className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                    aria-label={`Delete ${milestone}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TableFieldPresetSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const presets = settings.tableFieldPresets ?? [];
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0]?.id ?? "");
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];
  const selectedPresetEditable =
    activeUser?.role === "admin" || selectedPreset?.owner === "personal";
  const selectedFieldKeys = selectedPreset?.fieldKeys ?? [];
  const allFieldKeys = tableFieldPresetGroups.flatMap((group) =>
    group.fields.map((field) => field.key),
  );

  useEffect(() => {
    if (!selectedPreset && presets[0]) setSelectedPresetId(presets[0].id);
  }, [presets, selectedPreset]);

  const updatePresets = (next: TableFieldPreset[]) => {
    store.updateSettings({ tableFieldPresets: next });
  };

  const updateSelectedPreset = (patch: Partial<TableFieldPreset>) => {
    if (!selectedPreset || !selectedPresetEditable) return;
    updatePresets(
      presets.map((preset) => (preset.id === selectedPreset.id ? { ...preset, ...patch } : preset)),
    );
  };

  const addPreset = () => {
    const nextPreset: TableFieldPreset = {
      id: crypto.randomUUID(),
      name: `Preset ${presets.length + 1}`,
      fieldKeys: ["division", "indentor", "demandDescription"],
      owner: activeUser?.role === "admin" ? "global" : "personal",
      ownerUserId: activeUser?.role === "admin" ? undefined : activeUser?.id,
    };
    updatePresets([...presets, nextPreset]);
    setSelectedPresetId(nextPreset.id);
  };

  const removePreset = () => {
    if (!selectedPreset || !selectedPresetEditable) return;
    const next = presets.filter((preset) => preset.id !== selectedPreset.id);
    updatePresets(next);
    setSelectedPresetId(next[0]?.id ?? "");
  };

  const toggleField = (fieldKey: string) => {
    if (!selectedPreset || !selectedPresetEditable) return;
    updateSelectedPreset({
      fieldKeys: selectedFieldKeys.includes(fieldKey)
        ? selectedFieldKeys.filter((key) => key !== fieldKey)
        : [...selectedFieldKeys, fieldKey],
    });
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">Preset table fields</h2>
          <p className="text-xs text-muted-foreground">
            Shared presets are set by admin and visible to all. Add personal presets visible only to
            your own login.
          </p>
        </div>
        <button
          type="button"
          onClick={addPreset}
          className="h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add preset
        </button>
      </div>

      {presets.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No presets added yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="rounded-md border border-border bg-secondary/20 p-2">
            <div className="space-y-1">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedPresetId(preset.id)}
                  className={
                    "w-full rounded-md px-3 py-2 text-left text-sm font-medium transition " +
                    (selectedPreset?.id === preset.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground")
                  }
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate">{preset.name}</span>
                    {preset.owner === "global" && activeUser?.role !== "admin" ? (
                      <span className="rounded bg-background/80 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        Shared
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {selectedPreset ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-[220px] flex-1">
                  <div className="text-xs font-medium mb-1.5">Preset name</div>
                  <input
                    value={selectedPreset.name}
                    onChange={(event) => updateSelectedPreset({ name: event.target.value })}
                    disabled={!selectedPresetEditable}
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => updateSelectedPreset({ fieldKeys: allFieldKeys })}
                  disabled={!selectedPresetEditable}
                  className="h-10 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent disabled:opacity-50"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => updateSelectedPreset({ fieldKeys: [] })}
                  disabled={!selectedPresetEditable}
                  className="h-10 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent disabled:opacity-50"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={removePreset}
                  disabled={!selectedPresetEditable}
                  className="h-10 rounded-md border border-destructive/40 bg-background px-3 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
              {!selectedPresetEditable ? (
                <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                  This shared preset is managed by admin. Add a preset to create your own editable
                  version.
                </div>
              ) : null}

              <div className="space-y-4">
                {tableFieldPresetGroups.map((group) => (
                  <section
                    key={group.title}
                    className="rounded-md border border-border bg-secondary/20 p-3"
                  >
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.title}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.fields.map((field) => (
                        <label
                          key={field.key}
                          className="flex min-h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedFieldKeys.includes(field.key)}
                            onChange={() => toggleField(field.key)}
                            disabled={!selectedPresetEditable}
                            className="size-4 rounded border-input"
                          />
                          <span>{field.label}</span>
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function MmgSummarySettings() {
  const settings = useSettings();
  const fields = normalizeMmgSummaryFields(settings.mmgSummaryFields);
  const optionGroups = Array.from(new Set(mmgSummaryFieldOptions.map((option) => option.group)));

  const updateFields = (nextFields: typeof fields) => {
    store.updateSettings({ mmgSummaryFields: nextFields });
  };

  const updateField = (key: string, patch: Partial<(typeof fields)[number]>) => {
    updateFields(fields.map((field) => (field.key === key ? { ...field, ...patch } : field)));
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">MMG Summary</h2>
          <p className="text-xs text-muted-foreground">
            Choose fields and edit labels for the MMG Summary report export.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => updateFields(fields.map((field) => ({ ...field, enabled: true })))}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => updateFields(fields.map((field) => ({ ...field, enabled: false })))}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => updateFields(normalizeMmgSummaryFields([]))}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
          >
            Reset labels
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {optionGroups.map((group) => {
          const groupOptions = mmgSummaryFieldOptions.filter((option) => option.group === group);
          return (
            <section key={group} className="rounded-md border border-border bg-secondary/20 p-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </div>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {groupOptions.map((option) => {
                  const field = fields.find((item) => item.key === option.key) ?? {
                    key: option.key,
                    label: option.label,
                    enabled: true,
                  };
                  return (
                    <div
                      key={option.key}
                      className="grid gap-2 rounded-md border border-input bg-background p-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,240px)]"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={field.enabled}
                          onChange={(event) =>
                            updateField(option.key, { enabled: event.target.checked })
                          }
                          className="size-4 rounded border-input"
                        />
                        <span>{option.label}</span>
                      </label>
                      <label className="text-xs text-muted-foreground">
                        <span className="mb-1 block">Export label</span>
                        <input
                          value={field.label}
                          onChange={(event) =>
                            updateField(option.key, { label: event.target.value })
                          }
                          className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function DivisionSettings() {
  const divisions = useDivisions();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [ad, setAd] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editAd, setEditAd] = useState("");
  const [editMessagesEnabled, setEditMessagesEnabled] = useState(true);
  const [editViewerPassword, setEditViewerPassword] = useState("");

  const add = () => {
    if (!name.trim()) return;
    store.addDivision(name.trim(), code.trim() || undefined, undefined, undefined, ad);
    setName("");
    setCode("");
    setAd("");
  };

  const startEdit = (division: (typeof divisions)[number]) => {
    setEditingId(division.id);
    setEditName(division.name);
    setEditCode(division.code ?? "");
    setEditAd(division.ad ?? "");
    setEditMessagesEnabled(division.messagesEnabled !== false);
    setEditViewerPassword("");
  };

  const saveEdit = (id: string) => {
    if (!editName.trim()) return;
    store.updateDivision(id, {
      name: editName.trim(),
      code: editCode.trim() || undefined,
      ad: editAd,
      messagesEnabled: editMessagesEnabled,
      ...(editViewerPassword.trim() ? { viewerPassword: editViewerPassword.trim() } : {}),
    });
    setEditingId(null);
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Divisions</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Use this page for the master list of division names, codes, AD marking, and viewer
        passwords. Deleting a division sends it to Archive for recovery. Year-wise activation,
        yearly funds, and merged/continued division work are handled in Year Setup.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr_0.7fr_auto]">
        <DivisionInput value={name} onChange={setName} placeholder="Division name" />
        <DivisionInput value={code} onChange={setCode} placeholder="Division code" />
        <DivisionAdSelect value={ad} onChange={setAd} />
        <button
          type="button"
          onClick={add}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-5 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[820px] table-fixed text-sm">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[16%]" />
            <col className="w-[10%]" />
            <col className="w-[18%]" />
            <col className="w-[22%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Division name</th>
              <th className="text-left font-medium px-4 py-2.5">Division code</th>
              <th className="text-left font-medium px-4 py-2.5">AD</th>
              <th className="text-left font-medium px-4 py-2.5">Messages</th>
              <th className="text-left font-medium px-4 py-2.5">Viewer password</th>
              <th className="text-right font-medium px-4 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {divisions.map((division) => {
              const isEditing = editingId === division.id;
              return (
                <tr key={division.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <DivisionInput
                        value={editName}
                        onChange={setEditName}
                        placeholder="Division name"
                      />
                    ) : (
                      <span className="font-medium">{division.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {isEditing ? (
                      <DivisionInput
                        value={editCode}
                        onChange={setEditCode}
                        placeholder="Division code"
                      />
                    ) : (
                      division.code || "Not set"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {isEditing ? (
                      <DivisionAdSelect value={editAd} onChange={setEditAd} />
                    ) : (
                      division.ad || "No"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {isEditing ? (
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editMessagesEnabled}
                          onChange={(event) => setEditMessagesEnabled(event.target.checked)}
                          className="size-4"
                        />
                        <span>{editMessagesEnabled ? "Active" : "Inactive"}</span>
                      </label>
                    ) : division.messagesEnabled === false ? (
                      "Inactive"
                    ) : (
                      "Active"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {isEditing ? (
                      <DivisionInput
                        value={editViewerPassword}
                        onChange={setEditViewerPassword}
                        placeholder="New viewer password"
                      />
                    ) : (
                      "Set while editing"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => saveEdit(division.id)}
                            className="size-8 grid place-items-center rounded-md text-success hover:bg-success/10"
                          >
                            <Check className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="size-8 grid place-items-center rounded-md hover:bg-accent"
                          >
                            <X className="size-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(division)}
                            className="size-8 grid place-items-center rounded-md hover:bg-accent"
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (requestDeletionPassword(`delete division "${division.name}"`)) {
                                store.deleteDivision(division.id);
                              }
                            }}
                            className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type IndentorDraft = Pick<
  Indentor,
  "divisionId" | "name" | "sfId" | "designation" | "mobileNo" | "landlineNo" | "email"
>;

const emptyIndentorDraft: IndentorDraft = {
  divisionId: "",
  name: "",
  sfId: "",
  designation: "",
  mobileNo: "",
  landlineNo: "",
  email: "",
};

const indentorDesignationOptions = [
  "TO 'A'",
  "TO 'B'",
  "TO 'C'",
  "TO 'D'",
  "Sc. B",
  "Sc. C",
  "Sc. D",
  "Sc. E",
  "Sc. F",
  "Sc. G",
  "Sc. H",
];

function IndentorSettings() {
  const activeUser = useActiveUser();
  const divisions = useDivisions();
  const canManage = activeUser?.role === "admin" || activeUser?.role === "sub_admin";
  const availableDivisions =
    !activeUser || canManage
      ? divisions
      : divisions.filter((division) => activeUser.divisionIds.includes(division.id));
  const [draft, setDraft] = useState<IndentorDraft>(emptyIndentorDraft);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [indentors, setIndentors] = useState<Indentor[]>([]);
  const [indentorTotal, setIndentorTotal] = useState(0);
  const [indentorsLoading, setIndentorsLoading] = useState(false);
  const [indentorsError, setIndentorsError] = useState<string | undefined>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<IndentorDraft>(emptyIndentorDraft);

  useEffect(() => {
    if (!draft.divisionId && availableDivisions[0]) {
      setDraft((current) => ({ ...current, divisionId: availableDivisions[0].id }));
    }
  }, [availableDivisions, draft.divisionId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const loadIndentors = () => {
    setIndentorsLoading(true);
    setIndentorsError(undefined);
    fetchIndentors({
      divisionId: divisionFilter === "all" ? undefined : divisionFilter,
      q: debouncedSearch,
      page,
      pageSize,
    })
      .then((result) => {
        setIndentors(result.indentors);
        setIndentorTotal(result.total);
        if (result.page !== page) setPage(result.page);
        if (result.pageSize !== pageSize) setPageSize(result.pageSize);
      })
      .catch((error) => {
        console.error(error);
        setIndentorsError(error instanceof Error ? error.message : "Failed to load indentors.");
      })
      .finally(() => setIndentorsLoading(false));
  };

  useEffect(() => {
    loadIndentors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisionFilter, debouncedSearch, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(indentorTotal / pageSize));
  const firstResultNumber = indentorTotal === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastResultNumber = Math.min(indentorTotal, (page - 1) * pageSize + indentors.length);

  const updateDraft = (key: keyof IndentorDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateEditDraft = (key: keyof IndentorDraft, value: string) => {
    setEditDraft((current) => ({ ...current, [key]: value }));
  };

  const isComplete = (value: IndentorDraft) =>
    value.divisionId &&
    value.name.trim() &&
    value.sfId.trim() &&
    value.designation.trim() &&
    value.mobileNo.trim() &&
    value.landlineNo.trim() &&
    value.email.trim();

  const resetDraft = () =>
    setDraft({ ...emptyIndentorDraft, divisionId: availableDivisions[0]?.id ?? "" });

  const addIndentor = async () => {
    if (!isComplete(draft)) return;
    if (
      activeUser?.role === "viewer" &&
      !window.confirm(
        "Please confirm all indentor details are correct. Once added by a viewer, these details cannot be edited or deleted by the viewer.",
      )
    ) {
      return;
    }
    await store.addIndentor({
      divisionId: draft.divisionId,
      name: draft.name.trim(),
      sfId: draft.sfId.trim(),
      designation: draft.designation.trim(),
      mobileNo: draft.mobileNo.trim(),
      landlineNo: draft.landlineNo.trim(),
      email: draft.email.trim(),
    });
    resetDraft();
    setPage(1);
    loadIndentors();
  };

  const startEdit = (indentor: Indentor) => {
    setEditingId(indentor.id);
    setEditDraft({
      divisionId: indentor.divisionId,
      name: indentor.name,
      sfId: indentor.sfId,
      designation: indentor.designation,
      mobileNo: indentor.mobileNo,
      landlineNo: indentor.landlineNo,
      email: indentor.email,
    });
  };

  const saveEdit = async (id: string) => {
    if (!isComplete(editDraft)) return;
    await store.updateIndentor(id, {
      divisionId: editDraft.divisionId,
      name: editDraft.name.trim(),
      sfId: editDraft.sfId.trim(),
      designation: editDraft.designation.trim(),
      mobileNo: editDraft.mobileNo.trim(),
      landlineNo: editDraft.landlineNo.trim(),
      email: editDraft.email.trim(),
    });
    setEditingId(null);
    loadIndentors();
  };

  const deleteIndentor = async (id: string) => {
    await store.deleteIndentor(id);
    if (indentors.length === 1 && page > 1) {
      setPage((current) => Math.max(1, current - 1));
    } else {
      loadIndentors();
    }
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold mb-1">Indentors</h2>
          <p className="text-xs text-muted-foreground">
            Add and search division-wise indentors used when files are created.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:max-w-xl sm:flex-row">
          <select
            value={divisionFilter}
            onChange={(event) => {
              setDivisionFilter(event.target.value);
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="all">All divisions</option>
            {availableDivisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.name}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, SF ID, designation, email"
            className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <IndentorDivisionSelect
          value={draft.divisionId}
          divisions={availableDivisions}
          disabled={availableDivisions.length <= 1}
          onChange={(value) => updateDraft("divisionId", value)}
        />
        <DivisionInput
          value={draft.name}
          onChange={(value) => updateDraft("name", value)}
          placeholder="Name"
        />
        <DivisionInput
          value={draft.sfId}
          onChange={(value) => updateDraft("sfId", value)}
          placeholder="SF ID"
        />
        <IndentorDesignationField
          value={draft.designation}
          onChange={(value) => updateDraft("designation", value)}
        />
        <DivisionInput
          value={draft.mobileNo}
          onChange={(value) => updateDraft("mobileNo", value)}
          placeholder="Mobile no."
        />
        <DivisionInput
          value={draft.landlineNo}
          onChange={(value) => updateDraft("landlineNo", value)}
          placeholder="Landline no."
        />
        <DivisionInput
          value={draft.email}
          onChange={(value) => updateDraft("email", value)}
          placeholder="Email id"
        />
        <button
          type="button"
          onClick={addIndentor}
          disabled={!isComplete(draft)}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-4" /> Add indentor
        </button>
      </div>

      <div className="mt-5 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[1050px] table-fixed text-sm">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Division</th>
              <th className="px-4 py-2.5 text-left font-medium">Name</th>
              <th className="px-4 py-2.5 text-left font-medium">SF ID</th>
              <th className="px-4 py-2.5 text-left font-medium">Designation</th>
              <th className="px-4 py-2.5 text-left font-medium">Mobile</th>
              <th className="px-4 py-2.5 text-left font-medium">Landline</th>
              <th className="px-4 py-2.5 text-left font-medium">Email</th>
              <th className="px-4 py-2.5 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {indentors.length === 0 ? (
              <tr className="border-t border-border">
                <td className="px-4 py-6 text-center text-muted-foreground" colSpan={8}>
                  {indentorsLoading
                    ? "Loading indentors..."
                    : indentorsError
                      ? indentorsError
                      : "No indentors found."}
                </td>
              </tr>
            ) : (
              indentors.map((indentor) => {
                const isEditing = editingId === indentor.id;
                return (
                  <tr key={indentor.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <IndentorDivisionSelect
                          value={editDraft.divisionId}
                          divisions={divisions}
                          onChange={(value) => updateEditDraft("divisionId", value)}
                        />
                      ) : (
                        indentor.divisionName
                      )}
                    </td>
                    <IndentorCell
                      editing={isEditing}
                      value={isEditing ? editDraft.name : indentor.name}
                      onChange={(value) => updateEditDraft("name", value)}
                    />
                    <IndentorCell
                      editing={isEditing}
                      value={isEditing ? editDraft.sfId : indentor.sfId}
                      onChange={(value) => updateEditDraft("sfId", value)}
                    />
                    <IndentorDesignationCell
                      editing={isEditing}
                      value={isEditing ? editDraft.designation : indentor.designation}
                      onChange={(value) => updateEditDraft("designation", value)}
                    />
                    <IndentorCell
                      editing={isEditing}
                      value={isEditing ? editDraft.mobileNo : indentor.mobileNo}
                      onChange={(value) => updateEditDraft("mobileNo", value)}
                    />
                    <IndentorCell
                      editing={isEditing}
                      value={isEditing ? editDraft.landlineNo : indentor.landlineNo}
                      onChange={(value) => updateEditDraft("landlineNo", value)}
                    />
                    <IndentorCell
                      editing={isEditing}
                      value={isEditing ? editDraft.email : indentor.email}
                      onChange={(value) => updateEditDraft("email", value)}
                    />
                    <td className="px-4 py-3">
                      {canManage ? (
                        <div className="flex justify-end gap-1">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => saveEdit(indentor.id)}
                                className="size-8 grid place-items-center rounded-md text-success hover:bg-success/10"
                              >
                                <Check className="size-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="size-8 grid place-items-center rounded-md hover:bg-accent"
                              >
                                <X className="size-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startEdit(indentor)}
                                className="size-8 grid place-items-center rounded-md hover:bg-accent"
                              >
                                <Pencil className="size-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteIndentor(indentor.id)}
                                className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        <span className="block text-right text-xs text-muted-foreground">View</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          Showing {firstResultNumber}-{lastResultNumber} of {indentorTotal}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {[25, 50, 100, 200].map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="h-8 rounded-md border border-border px-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            className="h-8 rounded-md border border-border px-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function UserSettings() {
  const users = useUsers();
  const divisions = useDivisions();
  const settings = useSettings();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppUserRole>("editor");
  const [divisionIds, setDivisionIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<AppUserRole>("editor");
  const [editDivisionIds, setEditDivisionIds] = useState<string[]>([]);

  const add = () => {
    if (!name.trim() || !username.trim() || !password.trim()) return;
    store.addUser({
      name: name.trim(),
      username: username.trim(),
      password: password.trim(),
      role,
      divisionIds,
    });
    setName("");
    setUsername("");
    setPassword("");
    setRole("editor");
    setDivisionIds([]);
  };

  const startEdit = (user: (typeof users)[number]) => {
    setEditingId(user.id);
    setEditName(user.name);
    setEditUsername(user.username);
    setEditPassword("");
    setEditRole(user.role);
    setEditDivisionIds(user.divisionIds ?? []);
  };

  const saveEdit = (id: string) => {
    if (!editName.trim() || !editUsername.trim()) return;
    store.updateUser(id, {
      name: editName.trim(),
      username: editUsername.trim(),
      ...(editPassword.trim() ? { password: editPassword.trim() } : {}),
      role: editRole,
      divisionIds: editDivisionIds,
    });
    setEditingId(null);
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Authorised users</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add users and assign the divisions they should be allowed to work with.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_0.8fr_auto] gap-3">
        <DivisionInput value={name} onChange={setName} placeholder="User name" />
        <DivisionInput value={username} onChange={setUsername} placeholder="Username" />
        <DivisionInput value={password} onChange={setPassword} placeholder="Password" />
        <UserRoleSelect value={role} onChange={setRole} />
        <button
          type="button"
          onClick={add}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-3">
        <DivisionAccessPicker
          divisions={divisions}
          selectedIds={divisionIds}
          onChange={setDivisionIds}
        />
      </div>

      <div className="mt-5 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[860px] table-fixed text-sm">
          <colgroup>
            <col className="w-[20%]" />
            <col className="w-[18%]" />
            <col className="w-[16%]" />
            <col className="w-[34%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Name</th>
              <th className="text-left font-medium px-4 py-2.5">Username</th>
              <th className="text-left font-medium px-4 py-2.5">Role</th>
              <th className="text-left font-medium px-4 py-2.5">Visible divisions</th>
              <th className="text-right font-medium px-4 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr className="border-t border-border">
                <td className="px-4 py-6 text-muted-foreground text-center" colSpan={5}>
                  No users added yet.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isEditing = editingId === user.id;
                return (
                  <tr key={user.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <DivisionInput
                          value={editName}
                          onChange={setEditName}
                          placeholder="User name"
                        />
                      ) : (
                        <span className="font-medium">{user.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isEditing ? (
                        <div className="space-y-2">
                          <DivisionInput
                            value={editUsername}
                            onChange={setEditUsername}
                            placeholder="Username"
                          />
                          <DivisionInput
                            value={editPassword}
                            onChange={setEditPassword}
                            placeholder="New password"
                          />
                        </div>
                      ) : (
                        user.username
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isEditing ? (
                        <UserRoleSelect value={editRole} onChange={setEditRole} />
                      ) : (
                        roleLabel(user.role)
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isEditing ? (
                        <DivisionAccessPicker
                          divisions={divisions}
                          selectedIds={editDivisionIds}
                          onChange={setEditDivisionIds}
                        />
                      ) : (
                        divisionAccessLabel(user.divisionIds, divisions)
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => saveEdit(user.id)}
                              className="size-8 grid place-items-center rounded-md text-success hover:bg-success/10"
                            >
                              <Check className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="size-8 grid place-items-center rounded-md hover:bg-accent"
                            >
                              <X className="size-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(user)}
                              className="size-8 grid place-items-center rounded-md hover:bg-accent"
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (requestDeletionPassword(`delete user "${user.name}"`)) {
                                  store.deleteUser(user.id);
                                }
                              }}
                              className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRoleSelect({
  value,
  onChange,
}: {
  value: AppUserRole;
  onChange: (value: AppUserRole) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as AppUserRole)}
      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
    >
      <option value="admin">Admin</option>
      <option value="sub_admin">Sub admin</option>
      <option value="editor">Editor</option>
    </select>
  );
}

function ArchiveSettings() {
  const [archivedFiles, setArchivedFiles] = useState<FileRecord[]>([]);
  const [archivedDivisions, setArchivedDivisions] = useState<Division[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const loadArchive = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [filesResult, divisionsResult] = await Promise.all([
        store.listArchivedFiles(),
        store.listArchivedDivisions(),
      ]);
      setArchivedFiles(filesResult.files);
      setArchivedDivisions(divisionsResult.divisions);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load archive.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadArchive();
  }, []);

  const restore = async (file: FileRecord) => {
    await store.restoreArchivedFile(file.id);
    await loadArchive();
  };

  const restoreDivision = async (division: Division) => {
    await store.restoreArchivedDivision(division.id);
    await loadArchive();
  };

  const permanentlyDeleteDivision = async (division: Division) => {
    const deletionPassword = promptDeletionPassword(
      `permanently delete archived division "${division.name}"`,
    );
    if (deletionPassword === null) return;
    await store.permanentlyDeleteArchivedDivision(division.id, deletionPassword);
    await loadArchive();
  };

  const permanentlyDelete = async (file: FileRecord) => {
    const label = file.uniqueCode || file.fileNo || file.indentor || file.id;
    const deletionPassword = promptDeletionPassword(`permanently delete archived file "${label}"`);
    if (deletionPassword === null) return;
    await store.permanentlyDeleteArchivedFile(file.id, deletionPassword);
    await loadArchive();
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold mb-1">Archive</h2>
          <p className="text-xs text-muted-foreground">Review archived files and divisions.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadArchive()}
          className="h-8 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mb-5 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[640px] table-fixed text-sm">
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[18%]" />
            <col className="w-[18%]" />
            <col className="w-[18%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Archived division</th>
              <th className="px-4 py-2.5 text-left font-medium">Code</th>
              <th className="px-4 py-2.5 text-left font-medium">AD</th>
              <th className="px-4 py-2.5 text-left font-medium">Archived on</th>
              <th className="py-2.5 pl-8 pr-4 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="border-t border-border">
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Loading archived divisions...
                </td>
              </tr>
            ) : archivedDivisions.length === 0 ? (
              <tr className="border-t border-border">
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No archived divisions.
                </td>
              </tr>
            ) : (
              archivedDivisions.map((division) => (
                <tr key={division.id} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-medium">{division.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{division.code || "Not set"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{division.ad || "No"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {division.archivedAt ? formatArchiveDate(division.archivedAt) : "Not set"}
                  </td>
                  <td className="py-3 pl-8 pr-4">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => void restoreDivision(division)}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-accent"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => void permanentlyDeleteDivision(division)}
                        className="h-8 rounded-md border border-destructive/30 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[900px] table-fixed text-sm">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[16%]" />
            <col className="w-[16%]" />
            <col className="w-[26%]" />
            <col className="w-[10%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Unique code</th>
              <th className="px-4 py-2.5 text-left font-medium">Division</th>
              <th className="px-4 py-2.5 text-left font-medium">Indentor</th>
              <th className="px-4 py-2.5 text-left font-medium">Description</th>
              <th className="px-4 py-2.5 text-left font-medium">Year</th>
              <th className="py-2.5 pl-8 pr-4 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="border-t border-border">
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  Loading archive...
                </td>
              </tr>
            ) : archivedFiles.length === 0 ? (
              <tr className="border-t border-border">
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  No archived files.
                </td>
              </tr>
            ) : (
              archivedFiles.map((file) => (
                <tr key={file.id} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-medium">{file.uniqueCode || "Not set"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{file.division || "Not set"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{file.indentor || "Not set"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {file.demandDescription || "Not set"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{file.year || "Not set"}</td>
                  <td className="py-3 pl-8 pr-4">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => void restore(file)}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-accent"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => void permanentlyDelete(file)}
                        className="h-8 rounded-md border border-destructive/30 px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatArchiveDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function DivisionAccessPicker({
  divisions,
  selectedIds,
  onChange,
}: {
  divisions: ReturnType<typeof useDivisions>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (divisionId: string) => {
    onChange(
      selectedIds.includes(divisionId)
        ? selectedIds.filter((id) => id !== divisionId)
        : [...selectedIds, divisionId],
    );
  };

  if (divisions.length === 0) {
    return (
      <div className="text-xs text-muted-foreground border border-dashed border-border rounded-md px-3 py-2">
        Add divisions first.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {divisions.map((division) => (
        <label
          key={division.id}
          className="inline-flex items-center gap-2 min-h-9 px-3 rounded-md border border-input bg-background text-sm"
        >
          <input
            type="checkbox"
            checked={selectedIds.includes(division.id)}
            onChange={() => toggle(division.id)}
            className="size-4 rounded border-input"
          />
          <span>{division.name}</span>
        </label>
      ))}
    </div>
  );
}

function roleLabel(role: AppUserRole) {
  if (role === "admin") return "Admin";
  if (role === "sub_admin") return "Sub admin";
  if (role === "editor") return "Editor";
  return "Viewer";
}

function divisionAccessLabel(selectedIds: string[], divisions: ReturnType<typeof useDivisions>) {
  if (selectedIds.length === 0) return "No divisions selected";
  const names = selectedIds
    .map((id) => divisions.find((division) => division.id === id)?.name)
    .filter(Boolean);
  return names.length ? names.join(", ") : "No matching divisions";
}

function EditableField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1.5">{label}</div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g. 2026"
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  );
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1.5">{label}</div>
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Required for delete actions"
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  );
}

function DivisionInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
    />
  );
}

function IndentorDivisionSelect({
  value,
  divisions,
  disabled = false,
  onChange,
}: {
  value: string;
  divisions: Division[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-70"
    >
      <option value="">Select division</option>
      {divisions.map((division) => (
        <option key={division.id} value={division.id}>
          {division.name}
        </option>
      ))}
    </select>
  );
}

function IndentorDesignationField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const isPreset = indentorDesignationOptions.includes(value);
  const [otherMode, setOtherMode] = useState(Boolean(value && !isPreset));
  const selected = otherMode ? "Other" : value;

  useEffect(() => {
    if (value && !indentorDesignationOptions.includes(value)) {
      setOtherMode(true);
    }
    if (indentorDesignationOptions.includes(value)) {
      setOtherMode(false);
    }
  }, [value]);

  return (
    <div className="space-y-2">
      <select
        value={selected}
        onChange={(event) => {
          const next = event.target.value;
          setOtherMode(next === "Other");
          onChange(next === "Other" ? "" : next);
        }}
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      >
        <option value="">Designation</option>
        {indentorDesignationOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value="Other">Other</option>
      </select>
      {selected === "Other" ? (
        <DivisionInput value={value} onChange={onChange} placeholder="Type designation" />
      ) : null}
    </div>
  );
}

function IndentorCell({
  editing,
  value,
  onChange,
}: {
  editing: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <td className="px-4 py-3 text-muted-foreground">
      {editing ? <DivisionInput value={value} onChange={onChange} placeholder="" /> : value}
    </td>
  );
}

function IndentorDesignationCell({
  editing,
  value,
  onChange,
}: {
  editing: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <td className="px-4 py-3 text-muted-foreground">
      {editing ? <IndentorDesignationField value={value} onChange={onChange} /> : value}
    </td>
  );
}

function DivisionAdSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="AD"
      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
    >
      <option value="" disabled>
        AD
      </option>
      <option value="Yes">Yes</option>
      <option value="No">No</option>
    </select>
  );
}

function ThemeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "light" | "dark";
  onChange: (value: "light" | "dark") => void;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1.5">{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as "light" | "dark")}
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      >
        <option value="light">White theme</option>
        <option value="dark">Dark theme</option>
      </select>
    </label>
  );
}

function ThemeTintField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "plain" | "yellow" | "green" | "blue" | "pink" | "lavender";
  onChange: (value: "plain" | "yellow" | "green" | "blue" | "pink" | "lavender") => void;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1.5">{label}</div>
      <select
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value as "plain" | "yellow" | "green" | "blue" | "pink" | "lavender",
          )
        }
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      >
        <option value="plain">Plain white / black</option>
        <option value="yellow">Yellow tinted</option>
        <option value="green">Green tinted</option>
        <option value="blue">Blue tinted</option>
        <option value="pink">Pink tinted</option>
        <option value="lavender">Lavender tinted</option>
      </select>
    </label>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1.5">{label}</div>
      <input
        defaultValue={value}
        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  );
}
