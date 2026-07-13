import { store } from "@/lib/files-store";

export function promptDeletionPassword(action: string) {
  return showPasswordPrompt(`Enter deletion password to ${action}:`);
}

export async function requestDeletionPassword(action: string) {
  const password = store.getSettings().deletionPassword;
  if (!password) {
    alert("Set a deletion password in Settings before protected actions.");
    return false;
  }

  const entered = await promptDeletionPassword(action);
  if (entered === password) return true;
  if (entered !== null) alert("Incorrect deletion password.");
  return false;
}

function showPasswordPrompt(message: string) {
  return new Promise<string | null>((resolve) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "presentation");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "9999";
    overlay.style.display = "grid";
    overlay.style.placeItems = "center";
    overlay.style.background = "rgba(15, 23, 42, 0.45)";
    overlay.style.padding = "16px";

    const panel = document.createElement("form");
    panel.style.width = "min(420px, 100%)";
    panel.style.borderRadius = "8px";
    panel.style.border = "1px solid hsl(var(--border))";
    panel.style.background = "hsl(var(--card))";
    panel.style.color = "hsl(var(--card-foreground))";
    panel.style.boxShadow = "var(--shadow-card)";
    panel.style.padding = "18px";

    const label = document.createElement("label");
    label.style.display = "block";
    label.style.fontSize = "13px";
    label.style.fontWeight = "600";
    label.textContent = message;

    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "current-password";
    input.style.marginTop = "10px";
    input.style.width = "100%";
    input.style.height = "40px";
    input.style.borderRadius = "6px";
    input.style.border = "1px solid hsl(var(--input))";
    input.style.background = "hsl(var(--background))";
    input.style.padding = "0 12px";
    input.style.fontSize = "14px";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.marginTop = "16px";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.style.height = "36px";
    cancel.style.borderRadius = "6px";
    cancel.style.border = "1px solid hsl(var(--border))";
    cancel.style.background = "hsl(var(--background))";
    cancel.style.padding = "0 12px";
    cancel.style.fontSize = "13px";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Confirm";
    submit.style.height = "36px";
    submit.style.borderRadius = "6px";
    submit.style.border = "1px solid hsl(var(--primary))";
    submit.style.background = "hsl(var(--primary))";
    submit.style.color = "hsl(var(--primary-foreground))";
    submit.style.padding = "0 12px";
    submit.style.fontSize = "13px";

    const close = (value: string | null) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(value);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(null);
    };

    cancel.addEventListener("click", () => close(null));
    panel.addEventListener("submit", (event) => {
      event.preventDefault();
      close(input.value);
    });
    document.addEventListener("keydown", onKeyDown);

    label.appendChild(input);
    actions.append(cancel, submit);
    panel.append(label, actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    input.focus();
  });
}
