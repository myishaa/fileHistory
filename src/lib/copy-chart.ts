function copyComputedStyles(source: Element, target: Element) {
  const computed = window.getComputedStyle(source);
  const style = (target as HTMLElement | SVGElement).style;
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed.item(index);
    style.setProperty(property, computed.getPropertyValue(property));
  }
}

function inlineTreeStyles(source: Element, target: Element) {
  copyComputedStyles(source, target);
  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  sourceChildren.forEach((child, index) => {
    if (targetChildren[index]) inlineTreeStyles(child, targetChildren[index]);
  });
}

function appendTextNode(node: Text, parent: Element, origin: DOMRect) {
  const owner = node.parentElement;
  if (!owner || !node.textContent?.trim()) return;
  const style = window.getComputedStyle(owner);
  const fontSize = Number.parseFloat(style.fontSize) || 12;
  const text = node.textContent;
  const tokenPattern = /\S+\s*/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(text))) {
    const range = document.createRange();
    range.setStart(node, match.index);
    range.setEnd(node, match.index + match[0].length);
    const rect = range.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(rect.left - origin.left));
    label.setAttribute("y", String(rect.top - origin.top + rect.height / 2));
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("fill", style.color);
    label.setAttribute("font-family", style.fontFamily);
    label.setAttribute("font-size", String(fontSize));
    label.setAttribute("font-weight", style.fontWeight);
    label.setAttribute("font-style", style.fontStyle);
    label.textContent = match[0].trimEnd();
    parent.appendChild(label);
  }
}

function appendDomElement(source: Element, parent: Element, origin: DOMRect) {
  if (source.hasAttribute("data-chart-copy-exclude")) return;

  if (source instanceof SVGElement) {
    const clone = source.cloneNode(true) as SVGElement;
    inlineTreeStyles(source, clone);
    const bounds = source.getBoundingClientRect();
    clone.setAttribute("x", String(bounds.left - origin.left));
    clone.setAttribute("y", String(bounds.top - origin.top));
    clone.setAttribute("width", String(bounds.width));
    clone.setAttribute("height", String(bounds.height));
    parent.appendChild(clone);
    return;
  }

  const bounds = source.getBoundingClientRect();
  const style = window.getComputedStyle(source);
  if (bounds.width > 0 && bounds.height > 0) {
    const background = style.backgroundColor;
    const borderWidth = Number.parseFloat(style.borderTopWidth) || 0;
    if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent" || borderWidth > 0) {
      const box = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      box.setAttribute("x", String(bounds.left - origin.left));
      box.setAttribute("y", String(bounds.top - origin.top));
      box.setAttribute("width", String(bounds.width));
      box.setAttribute("height", String(bounds.height));
      box.setAttribute("fill", background === "rgba(0, 0, 0, 0)" ? "none" : background);
      if (borderWidth > 0) {
        box.setAttribute("stroke", style.borderTopColor);
        box.setAttribute("stroke-width", String(borderWidth));
      }
      const radius = Number.parseFloat(style.borderTopLeftRadius);
      if (radius > 0) box.setAttribute("rx", String(radius));
      parent.appendChild(box);
    }
  }

  Array.from(source.childNodes).forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) appendTextNode(child as Text, parent, origin);
    else if (child instanceof Element && !["SCRIPT", "STYLE"].includes(child.tagName)) {
      appendDomElement(child, parent, origin);
    }
  });
}

function serializeDomChart(target: Element, width: number, height: number) {
  const bounds = target.getBoundingClientRect();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("width", String(width));
  background.setAttribute("height", String(height));
  background.setAttribute("fill", "#ffffff");
  svg.appendChild(background);
  appendDomElement(target, svg, bounds);
  return new XMLSerializer().serializeToString(svg);
}

function distanceFromControl(control: HTMLElement, target: Element) {
  const controlRect = control.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const controlX = controlRect.left + controlRect.width / 2;
  const controlY = controlRect.top + controlRect.height / 2;
  const targetX = targetRect.left + targetRect.width / 2;
  const targetY = targetRect.top + targetRect.height / 2;
  return Math.hypot(controlX - targetX, controlY - targetY);
}

function findChartTarget(control: HTMLElement) {
  const explicitTarget = control.closest("[data-chart-copy-area]");
  if (explicitTarget) return explicitTarget;

  let ancestor = control.parentElement;
  while (ancestor) {
    const charts = Array.from(ancestor.querySelectorAll("svg.recharts-surface"))
      .filter((chart) => chart.getClientRects().length > 0);
    if (charts.length) {
      const chart = charts.sort((left, right) =>
        distanceFromControl(control, left) - distanceFromControl(control, right),
      )[0];
      const pieFrame = chart.closest('[aria-label$="pie chart"]');
      return pieFrame ?? chart.parentElement ?? chart;
    }

    const bars = Array.from(ancestor.querySelectorAll('[role="group"][aria-label]'))
      .filter((bar) => bar.getClientRects().length > 0);
    if (bars.length) {
      return bars.sort((left, right) =>
        distanceFromControl(control, left) - distanceFromControl(control, right),
      )[0];
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

async function renderChartPng(target: Element) {
  const chartSvg = target.matches("svg") ? target : target.querySelector("svg.recharts-surface");
  const source = target.hasAttribute("data-chart-copy-area") ? target : chartSvg ?? target;
  const bounds = source.getBoundingClientRect();
  const width = Math.ceil(bounds.width);
  const height = Math.ceil(bounds.height);
  if (!width || !height) throw new Error("The chart has no visible area to copy.");

  let markup: string;
  if (chartSvg) {
    const clone = chartSvg.cloneNode(true) as SVGElement;
    inlineTreeStyles(chartSvg, clone);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    markup = new XMLSerializer().serializeToString(clone);
  } else {
    markup = serializeDomChart(target, width, height);
  }
  const imageUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const scale = 3;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the chart image.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode the chart image.")), "image/png");
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function downloadChartPng(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "chart.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyChartAsPng(control: HTMLElement): Promise<"copied" | "downloaded"> {
  const target = findChartTarget(control);
  if (!target) throw new Error("No visible chart was found to copy.");

  const imageBlob = renderChartPng(target);
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": imageBlob })]);
      return "copied";
    } catch {
      const blob = await imageBlob;
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return "copied";
      } catch {
        downloadChartPng(blob);
        return "downloaded";
      }
    }
  }
  downloadChartPng(await imageBlob);
  return "downloaded";
}
