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

  const confirmationDialog = (
    <AlertDialog
      open={Boolean(pending)}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pending?.title ??
              (pending?.applyImmediately ? "Confirm destructive change?" : "Confirm field cleanup?")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pending?.description ??
              (pending?.applyImmediately
                ? "The listed values will be erased immediately after deletion-password verification."
                : "The listed values will be removed from the current form. Save the form to apply these changes.")}
            {pending?.details ? (
              <span className="mt-2 block whitespace-pre-wrap text-foreground">
                {pending.details}
              </span>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
