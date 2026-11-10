import { useCallback, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";

type DeleteConfirmationProps = {
  children: ReactNode;
  onConfirm: () => void | Promise<void>;
  mode?: "delete" | "archive" | "draft";
  description?: ReactNode;
  actionLabel?: string;
};

type PendingDeletionConfirmation = {
  details?: ReactNode;
  actionLabel: string;
  applyImmediately: boolean;
  title?: ReactNode;
  description?: ReactNode;
};

export function DeleteConfirmation({
  children,
  onConfirm,
  mode = "delete",
  description,
  actionLabel,
}: DeleteConfirmationProps) {
  const isArchive = mode === "archive";
  const isDraft = mode === "draft";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not complete this action.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            {description ??
              (isArchive
                ? "This item will be moved to Archive. You can restore it later; it will not be permanently deleted."
                : isDraft
                  ? "This removes the item from the current form. The database will not change until you save."
                  : "Once deleted, data will be lost.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={
              isArchive || isDraft
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            }
            onClick={confirm}
            disabled={busy}
          >
            {busy
              ? "Working…"
              : (actionLabel ?? (isArchive ? "Archive" : isDraft ? "Remove" : "Delete"))}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function useDeleteConfirmation() {
  const [pending, setPending] = useState<PendingDeletionConfirmation | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const confirmDeletion = useCallback(
    (
      details?: ReactNode,
      actionLabel = "Continue",
      options?: {
        applyImmediately?: boolean;
        title?: ReactNode;
        description?: ReactNode;
      },
    ) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setPending({
          details,
          actionLabel,
          applyImmediately: options?.applyImmediately ?? false,
          title: options?.title,
          description: options?.description,
        });
      }),
    [],
  );

  const settle = (confirmed: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setPending(null);
    resolve?.(confirmed);
  };

  const pendingIsDestructive = Boolean(
    pending?.applyImmediately || pending?.actionLabel === "Delete",
  );
  const confirmationDialog = (
    <AlertDialog
      open={Boolean(pending)}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <AlertDialogContent
        className={`overflow-hidden p-0 ${
          pendingIsDestructive ? "border-destructive/30" : "border-warning/40"
        }`}
      >
        <div
          className={
            pendingIsDestructive
              ? "border-b border-destructive/20 bg-destructive/5"
              : "border-b border-warning/30 bg-warning/10"
          }
        >
          <AlertDialogHeader className="px-6 pb-5 pt-6">
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full ${
                  pendingIsDestructive
                    ? "bg-destructive/10 text-destructive"
                    : "bg-warning/20 text-warning-foreground"
                }`}
              >
                <AlertTriangle className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <AlertDialogTitle className="text-lg">
                  {pending?.title ??
                    (pending?.applyImmediately
                      ? "Confirm destructive change?"
                      : "Confirm field cleanup?")}
                </AlertDialogTitle>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {pendingIsDestructive ? "Permanent change" : "Review before continuing"}
                </p>
              </div>
            </div>
          </AlertDialogHeader>
        </div>
        <div className="px-6 py-5">
          <AlertDialogDescription>
            {pending?.description ??
              (pending?.applyImmediately
                ? "The listed values will be erased immediately after deletion-password verification."
                : "The listed values will be removed from the current form. Save the form to apply these changes.")}
            {pending?.details ? (
              <span
                className={`mt-4 block whitespace-pre-wrap rounded-md border p-3 text-sm leading-relaxed text-foreground ${
                  pendingIsDestructive
                    ? "border-destructive/25 bg-destructive/5"
                    : "border-warning/30 bg-warning/10"
                }`}
              >
                {pending.details}
              </span>
            ) : null}
          </AlertDialogDescription>
        </div>
        <AlertDialogFooter className="border-t border-border bg-muted/20 px-6 py-4">
          <AlertDialogCancel onClick={() => settle(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={
              pendingIsDestructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:opacity-90"
            }
            onClick={() => settle(true)}
          >
            {pending?.actionLabel ?? "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirmDeletion, confirmationDialog };
}
