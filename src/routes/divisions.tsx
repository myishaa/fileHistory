import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchFilesForYear, store, type FileRecord, useDivisions, useSettings } from "@/lib/files-store";
import { Building2, Pencil, Trash2, Plus, X, Check } from "lucide-react";
import { requestDeletionPassword } from "@/lib/delete-password";

export const Route = createFileRoute("/divisions")({
  component: DivisionsPage,
});

function DivisionsPage() {
  const divisions = useDivisions();
  const settings = useSettings();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");

  const add = () => {
    if (!name.trim()) return;
    store.addDivision(name.trim(), code.trim() || undefined);
    setName("");
    setCode("");
  };

  useEffect(() => {
    let cancelled = false;
    fetchFilesForYear(settings.selectedYear)
      .then((payload) => {
        if (!cancelled) setFiles(payload.files);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.selectedYear]);

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)]">
        <h2 className="text-sm font-semibold mb-1">Add a division</h2>
        <p className="text-xs text-muted-foreground mb-4">Create departments to categorise office files.</p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Division name"
            className="h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Division code"
            className="h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
          <button
            onClick={add}
            className="h-10 px-4 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus className="size-4" /> Add division
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {divisions.map((d) => {
          const count = files.filter((f) => f.division === d.name).length;
          const isEditing = editingId === d.id;
          return (
            <div key={d.id} className="bg-card border border-border rounded-xl p-5 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-elevated)] transition">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
                    <Building2 className="size-5" />
                  </div>
                  {isEditing ? (
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 px-2 rounded-md border border-input bg-background text-sm"
                    />
                  ) : (
                    <div>
                      <div className="text-sm font-semibold">{d.name}</div>
                      <div className="text-[11px] text-muted-foreground">{count} files</div>
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => {
                          store.updateDivision(d.id, { name: editName, code: editCode || undefined });
                          setEditingId(null);
                        }}
                        className="size-8 grid place-items-center rounded-md text-success hover:bg-success/10"
                      >
                        <Check className="size-4" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="size-8 grid place-items-center rounded-md hover:bg-accent">
                        <X className="size-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditingId(d.id);
                          setEditName(d.name);
                          setEditCode(d.code ?? "");
                        }}
                        className="size-8 grid place-items-center rounded-md hover:bg-accent"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={async () => {
                          if (await requestDeletionPassword(`delete division "${d.name}"`)) {
                            store.deleteDivision(d.id);
                          }
                        }}
                        className="size-8 grid place-items-center rounded-md text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-4">
                {isEditing ? (
                  <input
                    value={editCode}
                    onChange={(e) => setEditCode(e.target.value)}
                    placeholder="Division code"
                    className="w-full h-9 px-2 rounded-md border border-input bg-background text-sm"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
                    {d.code ?? "No code"}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
