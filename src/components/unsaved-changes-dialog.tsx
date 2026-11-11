type UnsavedChangesDialogProps = {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
};

export function UnsavedChangesDialog({ open, onStay, onLeave }: UnsavedChangesDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-foreground/35 p-4"
      role="presentation"
    >
      <section
        aria-labelledby="unsaved-changes-title"
        aria-describedby="unsaved-changes-description"
        aria-modal="true"
        role="alertdialog"
        className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-[var(--shadow-elevated)]"
      >
        <h2 id="unsaved-changes-title" className="text-lg font-semibold">
          Unsaved changes
        </h2>
        <p id="unsaved-changes-description" className="mt-2 text-sm text-muted-foreground">
          You have changes that haven’t been saved. If you leave this page, those changes will be
          lost.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onStay}
            className="h-9 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-accent"
          >
            Stay on this page
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="h-9 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:opacity-90"
          >
            Leave without saving
          </button>
        </div>
      </section>
    </div>
  );
}
