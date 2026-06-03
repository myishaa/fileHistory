import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  Lock,
  Pencil,
  Plus,
  QrCode,
  ScanLine,
  Shield,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  store,
  useActiveUser,
  useDivisions,
  useFiles,
  useSettings,
  useUsers,
  type AppUserRole,
} from "@/lib/files-store";
import { tableFieldPresetGroups, type TableFieldPreset } from "@/lib/table-field-presets";
import { requestDeletionPassword } from "@/lib/delete-password";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const futureFeatures = [
  {
    icon: ScanLine,
    title: "Barcode scanning",
    desc: "Scan physical file barcodes with any USB or mobile scanner to instantly pull records.",
  },
  {
    icon: QrCode,
    title: "QR code integration",
    desc: "Generate and print QR codes for each file folder for fast lookup.",
  },
  {
    icon: Upload,
    title: "File uploads",
    desc: "Attach scanned PDFs, photos, and digital copies to physical file entries.",
  },
  {
    icon: BarChart3,
    title: "Analytics dashboard",
    desc: "Deep insights on file turnaround, officer load, and division throughput.",
  },
  {
    icon: Shield,
    title: "Authentication & roles",
    desc: "Login with role-based access for staff, supervisors, and administrators.",
  },
];

const defaultMilestoneSequence = [
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

function SettingsPage() {
  const [activeAdminSection, setActiveAdminSection] = useState("divisions");
  const adminSections = [
    { key: "divisions", label: "Divisions", content: <DivisionSettings /> },
    { key: "tcec", label: "TCEC Committee", content: <TcecCommitteeSettings /> },
    { key: "milestones", label: "Milestones", content: <MilestoneSettings /> },
    { key: "presets", label: "Preset table fields", content: <TableFieldPresetSettings /> },
    { key: "users", label: "Users", content: <UserSettings /> },
  ];
  const selectedAdminSection =
    adminSections.find((section) => section.key === activeAdminSection) ?? adminSections[0];

  return (
    <div className="space-y-4 max-w-6xl">
      <Tabs defaultValue="admin" className="space-y-4">
        <TabsList aria-label="Settings sections">
          <TabsTrigger value="admin">Admin</TabsTrigger>
          <TabsTrigger value="user">User</TabsTrigger>
        </TabsList>

        <TabsContent value="admin">
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
        </TabsContent>

        <TabsContent value="user">
          <WorkspaceSettings />
        </TabsContent>
      </Tabs>

      <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-semibold">Upcoming features</h2>
            <p className="text-xs text-muted-foreground">Planned for future releases.</p>
          </div>
          <span className="text-[10px] uppercase tracking-wider bg-secondary text-muted-foreground rounded px-2 py-1">
            Roadmap
          </span>
        </div>

        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {futureFeatures.map((f) => {
            const Icon = f.icon;
            return (
              <li
                key={f.title}
                className="flex gap-3 p-3 rounded-md border border-border bg-secondary/25"
              >
                <div className="size-9 rounded-md bg-background text-primary border border-border grid place-items-center shrink-0">
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">
                    {f.title}
                    <Lock className="size-3 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function WorkspaceSettings() {
  const settings = useSettings();

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Workspace</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Configure how this records system behaves.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <EditableField
          label="Financial year"
          value={settings.financialYear}
          onChange={(value) => store.updateSettings({ financialYear: value })}
        />
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
        <Field label="Locale" value="English (India)" />
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

function MilestoneSettings() {
  const settings = useSettings();
  const activeUser = useActiveUser();
  const [name, setName] = useState("");
  const milestones =
    settings.milestones && settings.milestones.length > 0
      ? settings.milestones
      : defaultMilestoneSequence;
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
  const selectedFieldKeys = selectedPreset?.fieldKeys ?? [];
  const allFieldKeys = tableFieldPresetGroups.flatMap((group) =>
    group.fields.map((field) => field.key),
  );

  if (activeUser && activeUser.role !== "admin") return null;

  const updatePresets = (next: TableFieldPreset[]) => {
    store.updateSettings({ tableFieldPresets: next });
  };

  const updateSelectedPreset = (patch: Partial<TableFieldPreset>) => {
    if (!selectedPreset) return;
    updatePresets(
      presets.map((preset) => (preset.id === selectedPreset.id ? { ...preset, ...patch } : preset)),
    );
  };

  const addPreset = () => {
    const nextPreset = {
      id: crypto.randomUUID(),
      name: `Preset ${presets.length + 1}`,
      fieldKeys: ["division", "indentor", "demandDescription"],
    };
    updatePresets([...presets, nextPreset]);
    setSelectedPresetId(nextPreset.id);
  };

  const removePreset = () => {
    if (!selectedPreset) return;
    const next = presets.filter((preset) => preset.id !== selectedPreset.id);
    updatePresets(next);
    setSelectedPresetId(next[0]?.id ?? "");
  };

  const toggleField = (fieldKey: string) => {
    if (!selectedPreset) return;
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
            Create field sets like Director or Head for the Search File table.
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
                  {preset.name}
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
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => updateSelectedPreset({ fieldKeys: allFieldKeys })}
                  className="h-10 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => updateSelectedPreset({ fieldKeys: [] })}
                  className="h-10 rounded-md border border-border bg-background px-3 text-xs hover:bg-accent"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={removePreset}
                  className="h-10 rounded-md border border-destructive/40 bg-background px-3 text-xs text-destructive hover:bg-destructive/10"
                >
                  Delete
                </button>
              </div>

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

function DivisionSettings() {
  const divisions = useDivisions();
  const files = useFiles();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [allocatedCapital, setAllocatedCapital] = useState("");
  const [allocatedRevenue, setAllocatedRevenue] = useState("");
  const [ad, setAd] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editCapital, setEditCapital] = useState("");
  const [editRevenue, setEditRevenue] = useState("");
  const [editAd, setEditAd] = useState("");

  const add = () => {
    if (!name.trim()) return;
    store.addDivision(
      name.trim(),
      code.trim() || undefined,
      allocatedCapital.trim() || undefined,
      allocatedRevenue.trim() || undefined,
      ad,
    );
    setName("");
    setCode("");
    setAllocatedCapital("");
    setAllocatedRevenue("");
    setAd("");
  };

  const startEdit = (division: (typeof divisions)[number]) => {
    setEditingId(division.id);
    setEditName(division.name);
    setEditCode(division.code ?? "");
    setEditCapital(division.allocatedCapital ?? "");
    setEditRevenue(division.allocatedRevenue ?? "");
    setEditAd(division.ad ?? "");
  };

  const saveEdit = (id: string) => {
    if (!editName.trim()) return;
    store.updateDivision(id, {
      name: editName.trim(),
      code: editCode.trim() || undefined,
      allocatedCapital: editCapital.trim() || undefined,
      allocatedRevenue: editRevenue.trim() || undefined,
      ad: editAd,
    });
    setEditingId(null);
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Divisions</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add and manage division details from Settings.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr_1fr_1fr_0.7fr_auto] gap-3">
        <DivisionInput value={name} onChange={setName} placeholder="Division name" />
        <DivisionInput value={code} onChange={setCode} placeholder="Division code" />
        <DivisionInput
          value={allocatedCapital}
          onChange={setAllocatedCapital}
          placeholder="Allocated capital"
          amount
        />
        <DivisionInput
          value={allocatedRevenue}
          onChange={setAllocatedRevenue}
          placeholder="Allocated revenue"
          amount
        />
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
        <table className="w-full min-w-[900px] table-fixed text-sm">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[14%]" />
            <col className="w-[18%]" />
            <col className="w-[18%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Division name</th>
              <th className="text-left font-medium px-4 py-2.5">Division code</th>
              <th className="text-left font-medium px-4 py-2.5">Allocated capital</th>
              <th className="text-left font-medium px-4 py-2.5">Allocated revenue</th>
              <th className="text-left font-medium px-4 py-2.5">AD</th>
              <th className="text-left font-medium px-4 py-2.5">Files</th>
              <th className="text-right font-medium px-4 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {divisions.map((division) => {
              const isEditing = editingId === division.id;
              const count = files.filter((file) => file.division === division.name).length;
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
                      <DivisionInput
                        value={editCapital}
                        onChange={setEditCapital}
                        placeholder="Allocated capital"
                        amount
                      />
                    ) : (
                      formatAmountValue(division.allocatedCapital) || "Not set"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {isEditing ? (
                      <DivisionInput
                        value={editRevenue}
                        onChange={setEditRevenue}
                        placeholder="Allocated revenue"
                        amount
                      />
                    ) : (
                      formatAmountValue(division.allocatedRevenue) || "Not set"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {isEditing ? (
                      <DivisionAdSelect value={editAd} onChange={setEditAd} />
                    ) : (
                      division.ad || "No"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{count}</td>
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

function UserSettings() {
  const users = useUsers();
  const divisions = useDivisions();
  const settings = useSettings();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<AppUserRole>("division_user");
  const [divisionIds, setDivisionIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editRole, setEditRole] = useState<AppUserRole>("division_user");
  const [editDivisionIds, setEditDivisionIds] = useState<string[]>([]);

  const add = () => {
    if (!name.trim() || !username.trim()) return;
    store.addUser({
      name: name.trim(),
      username: username.trim(),
      role,
      divisionIds,
    });
    setName("");
    setUsername("");
    setRole("division_user");
    setDivisionIds([]);
  };

  const startEdit = (user: (typeof users)[number]) => {
    setEditingId(user.id);
    setEditName(user.name);
    setEditUsername(user.username);
    setEditRole(user.role);
    setEditDivisionIds(user.divisionIds ?? []);
  };

  const saveEdit = (id: string) => {
    if (!editName.trim() || !editUsername.trim()) return;
    store.updateUser(id, {
      name: editName.trim(),
      username: editUsername.trim(),
      role: editRole,
      divisionIds: editDivisionIds,
    });
    setEditingId(null);
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Users</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add users and assign the divisions they should be allowed to work with.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1fr_1fr_0.8fr_auto] gap-3">
        <DivisionInput value={name} onChange={setName} placeholder="User name" />
        <DivisionInput value={username} onChange={setUsername} placeholder="Username" />
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

      <label className="mt-5 block max-w-sm">
        <div className="text-xs font-medium mb-1.5">Active user for this browser</div>
        <select
          value={settings.activeUserId ?? ""}
          onChange={(event) => store.updateSettings({ activeUserId: event.target.value })}
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
        >
          <option value="">No active user</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} ({roleLabel(user.role)})
            </option>
          ))}
        </select>
      </label>

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
                        <DivisionInput
                          value={editUsername}
                          onChange={setEditUsername}
                          placeholder="Username"
                        />
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
                                  if (settings.activeUserId === user.id) {
                                    store.updateSettings({ activeUserId: "" });
                                  }
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
      <option value="division_user">Division user</option>
    </select>
  );
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
  return "Division user";
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
      onChange={(event) =>
        onChange(amount ? formatDecimalInput(event.target.value) : event.target.value)
      }
      placeholder={placeholder}
      inputMode={amount ? "decimal" : undefined}
      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
    />
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

function parseAmount(value: string | undefined) {
  const cleaned = (value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatAmountValue(value: string | undefined) {
  const amount = parseAmount(value);
  if (amount === undefined) return value ?? "";
  return formatThousandsAndLakhs(amount);
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

function formatThousandsAndLakhs(value: number, maximumFractionDigits = 2) {
  const sign = value < 0 ? "-" : "";
  const absoluteValue = Math.abs(value);
  const fixedValue = Number.isInteger(absoluteValue)
    ? String(absoluteValue)
    : absoluteValue.toFixed(maximumFractionDigits).replace(/\.?0+$/, "");
  const [integerPart, decimalPart] = fixedValue.split(".");
  const lastThree = integerPart.slice(-3);
  const beforeThousands = integerPart.slice(0, -3);

  if (!beforeThousands) {
    return `${sign}${integerPart}${decimalPart ? `.${decimalPart}` : ""}`;
  }

  const lastTwoBeforeThousands = beforeThousands.slice(-2);
  const lakhPart = beforeThousands.slice(0, -2);
  const formattedInteger = [lakhPart, lastTwoBeforeThousands, lastThree].filter(Boolean).join(",");

  return `${sign}${formattedInteger}${decimalPart ? `.${decimalPart}` : ""}`;
}
