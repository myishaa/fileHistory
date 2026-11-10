import { useSyncExternalStore, useState, type FormEvent, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DialogOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type PromptOptions = DialogOptions & {
  inputLabel?: string;
  inputType?: "text" | "password";
  defaultValue?: string;
};

type DialogRequest =
  | {
      id: number;
      type: "alert";
      message: string;
      options?: DialogOptions;
      resolve: (value: void) => void;
    }
  | {
      id: number;
      type: "confirm";
      message: string;
      options?: DialogOptions;
      resolve: (value: boolean) => void;
    }
  | {
      id: number;
      type: "prompt";
      message: string;
      options?: PromptOptions;
      resolve: (value: string | null) => void;
    };

let nextDialogId = 1;
const dialogQueue: DialogRequest[] = [];
const subscribers = new Set<() => void>();

function notifyDialogSubscribers() {
  subscribers.forEach((subscriber) => subscriber());
}

function subscribeToDialogs(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function getCurrentDialog() {
  return dialogQueue[0] ?? null;
}

function enqueueDialog<T>(
  request: (id: number, resolve: (value: T) => void) => DialogRequest,
) {
  return new Promise<T>((resolve) => {
    dialogQueue.push(request(nextDialogId++, resolve));
    notifyDialogSubscribers();
  });
}

function settleCurrentDialog(value: void | boolean | string | null) {
  const current = dialogQueue.shift();
  if (!current) return;
  notifyDialogSubscribers();
  current.resolve(value as never);
}

export function showAppAlert(message: string, options?: DialogOptions) {
  return enqueueDialog<void>((id, resolve) => ({
    id,
    type: "alert",
    message,
    options,
    resolve,
  }));
}

export function showAppConfirm(message: string, options?: DialogOptions) {
  return enqueueDialog<boolean>((id, resolve) => ({
    id,
    type: "confirm",
    message,
    options,
    resolve,
  }));
}

export function showAppPrompt(message: string, options?: PromptOptions) {
  return enqueueDialog<string | null>((id, resolve) => ({
    id,
    type: "prompt",
    message,
    options,
    resolve,
  }));
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const request = useSyncExternalStore(
    subscribeToDialogs,
    getCurrentDialog,
    () => null,
  );

  return (
    <>
      {children}
      {request ? <AppDialogView key={request.id} request={request} /> : null}
    </>
  );
}

function AppDialogView({ request }: { request: DialogRequest }) {
  const [inputValue, setInputValue] = useState(
    request.type === "prompt" ? request.options?.defaultValue ?? "" : "",
  );
  const options = request.options;
  const promptOptions = request.type === "prompt" ? request.options : undefined;
  const isPrompt = request.type === "prompt";
  const isConfirm = request.type === "confirm";
  const title = options?.title ?? (isPrompt ? "Input required" : isConfirm ? "Confirm action" : "Notice");
  const confirmLabel = options?.confirmLabel ?? (isConfirm || isPrompt ? "Continue" : "Okay");

  const close = () => {
    settleCurrentDialog(isConfirm ? false : isPrompt ? null : undefined);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPrompt) {
      settleCurrentDialog(inputValue);
    } else if (isConfirm) {
      settleCurrentDialog(true);
    } else {
      settleCurrentDialog(undefined);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap text-left">
              {request.message}
            </DialogDescription>
          </DialogHeader>
          {isPrompt ? (
            <label className="mt-4 block text-sm font-medium">
              {promptOptions?.inputLabel ?? "Value"}
              <input
                autoFocus
                type={promptOptions?.inputType ?? "text"}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
          ) : null}
          <DialogFooter className="mt-6">
            {isConfirm || isPrompt ? (
              <button
                type="button"
                onClick={close}
                className="h-9 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-accent"
              >
                {options?.cancelLabel ?? "Cancel"}
              </button>
            ) : null}
            <button
              type="submit"
              className={`h-9 rounded-md px-4 text-sm font-medium ${
                options?.destructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-primary text-primary-foreground hover:opacity-90"
              }`}
            >
              {confirmLabel}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
