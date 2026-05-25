import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
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
import { store, useDivisions, useFiles, useSettings } from "@/lib/files-store";
import { requestDeletionPassword } from "@/lib/delete-password";

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

function SettingsPage() {
  const settings = useSettings();

  return (
    <div className="space-y-4 max-w-5xl">
      <DivisionSettings />

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
          <Field label="Date format" value="YYYY-MM-DD" />
          <Field label="Locale" value="English (India)" />
        </div>
      </div>

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

function DivisionSettings() {
  const divisions = useDivisions();
  const files = useFiles();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [allocatedCapital, setAllocatedCapital] = useState("");
  const [allocatedRevenue, setAllocatedRevenue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editCapital, setEditCapital] = useState("");
  const [editRevenue, setEditRevenue] = useState("");

  const add = () => {
    if (!name.trim()) return;
    store.addDivision(
      name.trim(),
      code.trim() || undefined,
      allocatedCapital.trim() || undefined,
      allocatedRevenue.trim() || undefined,
    );
    setName("");
    setCode("");
    setAllocatedCapital("");
    setAllocatedRevenue("");
  };

  const startEdit = (division: (typeof divisions)[number]) => {
    setEditingId(division.id);
    setEditName(division.name);
    setEditCode(division.code ?? "");
    setEditCapital(division.allocatedCapital ?? "");
    setEditRevenue(division.allocatedRevenue ?? "");
  };

  const saveEdit = (id: string) => {
    if (!editName.trim()) return;
    store.updateDivision(id, {
      name: editName.trim(),
      code: editCode.trim() || undefined,
      allocatedCapital: editCapital.trim() || undefined,
      allocatedRevenue: editRevenue.trim() || undefined,
    });
    setEditingId(null);
  };

  return (
    <div className="bg-card border border-border rounded-md p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold mb-1">Divisions</h2>
      <p className="text-xs text-muted-foreground mb-5">
        Add and manage division details from Settings.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr_1fr_1fr_auto] gap-3">
        <DivisionInput value={name} onChange={setName} placeholder="Division name" />
        <DivisionInput value={code} onChange={setCode} placeholder="Division code" />
        <DivisionInput
          value={allocatedCapital}
          onChange={setAllocatedCapital}
          placeholder="Allocated capital"
        />
        <DivisionInput
          value={allocatedRevenue}
          onChange={setAllocatedRevenue}
          placeholder="Allocated revenue"
        />
        <button
          type="button"
          onClick={add}
          className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      <div className="mt-5 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Division name</th>
              <th className="text-left font-medium px-4 py-2.5">Division code</th>
              <th className="text-left font-medium px-4 py-2.5">Allocated capital</th>
              <th className="text-left font-medium px-4 py-2.5">Allocated revenue</th>
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
                      />
                    ) : (
                      division.allocatedCapital || "Not set"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {isEditing ? (
                      <DivisionInput
                        value={editRevenue}
                        onChange={setEditRevenue}
                        placeholder="Allocated revenue"
                      />
                    ) : (
                      division.allocatedRevenue || "Not set"
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
