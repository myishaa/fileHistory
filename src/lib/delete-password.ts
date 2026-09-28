import { store } from "@/lib/files-store";

export function promptDeletionPassword(action: string) {
  return showPasswordPrompt(`Enter deletion password to ${action}:`, "Deletion password required");
}

export function promptPassword(message: string) {
  const title = /account password/i.test(message)
    ? "Account password required"
    : "Edit password required";
  return showPasswordPrompt(message, title);
}

export async function requestDeletionPassword(action: string) {
  const entered = await promptDeletionPassword(action);
  if (entered === null) return false;
  try {
    await store.verifyDeletionPassword(entered);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deletion password verification failed.";
    alert(message === "Invalid deletion password." ? "Incorrect deletion password." : message);
    return false;
  }
}

function showPasswordPrompt(message: string, title: string) {
  return new Promise<string | null>((resolve) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "presentation");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
	    overlay.style.zIndex = "9999";
	    overlay.style.display = "grid";
	    overlay.style.placeItems = "center";
	    overlay.style.background = "rgba(2, 6, 23, 0.82)";
	    overlay.style.backdropFilter = "blur(3px)";
	    overlay.style.padding = "16px";

	    const panel = document.createElement("form");
	    panel.style.width = "min(420px, 100%)";
	    panel.style.borderRadius = "8px";
	    panel.style.border = "2px solid #1d4ed8";
	    panel.style.background = "#ffffff";
	    panel.style.color = "#0f172a";
	    panel.style.boxShadow = "0 28px 90px rgba(0, 0, 0, 0.55)";
	    panel.style.padding = "20px";
	    panel.style.opacity = "1";
	    panel.style.isolation = "isolate";

	    const heading = document.createElement("div");
	    heading.textContent = title;
	    heading.style.margin = "-20px -20px 16px";
	    heading.style.padding = "14px 18px";
	    heading.style.borderRadius = "6px 6px 0 0";
	    heading.style.background = "#1d4ed8";
	    heading.style.color = "#ffffff";
	    heading.style.fontSize = "15px";
	    heading.style.fontWeight = "700";

	    const label = document.createElement("label");
	    label.style.display = "block";
	    label.style.fontSize = "13px";
	    label.style.fontWeight = "600";
	    label.style.color = "#0f172a";
	    label.textContent = message;

	    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "current-password";
    input.style.marginTop = "10px";
    input.style.width = "100%";
	    input.style.height = "40px";
	    input.style.borderRadius = "6px";
	    input.style.border = "1px solid #94a3b8";
	    input.style.background = "#ffffff";
	    input.style.color = "#0f172a";
	    input.style.padding = "0 12px";
	    input.style.fontSize = "14px";
	    input.style.outline = "none";

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
	    cancel.style.border = "1px solid #94a3b8";
	    cancel.style.background = "#ffffff";
	    cancel.style.color = "#0f172a";
	    cancel.style.padding = "0 12px";
	    cancel.style.fontSize = "13px";
	    cancel.style.fontWeight = "600";

	    const submit = document.createElement("button");
	    submit.type = "submit";
	    submit.textContent = "Confirm";
	    submit.style.height = "36px";
	    submit.style.borderRadius = "6px";
	    submit.style.border = "1px solid #1d4ed8";
	    submit.style.background = "#1d4ed8";
	    submit.style.color = "#ffffff";
	    submit.style.padding = "0 12px";
	    submit.style.fontSize = "13px";
	    submit.style.fontWeight = "700";

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
	    panel.append(heading, label, actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    input.focus();
  });
}
