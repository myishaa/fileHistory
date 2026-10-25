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
  const chartCopyRotation = owner.getAttribute("data-chart-copy-rotated-label");
  if (chartCopyRotation) {
    const angle = Number(chartCopyRotation) || 0;
    const bounds = owner.getBoundingClientRect();
    const height = owner instanceof HTMLElement ? owner.offsetHeight : bounds.height;
    const radians = angle * Math.PI / 180;
    const layoutX = bounds.left + Math.sin(radians) * height;
    const layoutY = bounds.top;
    const x = layoutX - origin.left;
    const y = layoutY - origin.top;
    const fontSize = Number.parseFloat(style.fontSize) || 12;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y + fontSize));
    text.setAttribute("dominant-baseline", "alphabetic");
    text.setAttribute("xml:space", "preserve");
    text.setAttribute("fill", style.color);
    text.setAttribute("font-family", style.fontFamily);
    text.setAttribute("font-size", String(fontSize));
    text.setAttribute("font-weight", style.fontWeight);
    text.setAttribute("font-style", style.fontStyle);
    text.setAttribute("transform", `rotate(${angle} ${x} ${y})`);
    text.textContent = node.textContent.trim();
    parent.appendChild(text);
    return;
  }
  const centeredChartTitle = owner.hasAttribute("data-chart-copy-title");
  const baseFontSize = Number.parseFloat(style.fontSize) || 12;
  const fontSize = centeredChartTitle
    ? baseFontSize * (origin.width / 600)
    : baseFontSize;
  const matrix = style.transform === "none" ? new DOMMatrix() : new DOMMatrix(style.transform);
  const transformed = style.transform !== "none";
  const bounds = owner.getBoundingClientRect();
  const width = owner instanceof HTMLElement ? owner.offsetWidth : bounds.width;
  const height = owner instanceof HTMLElement ? owner.offsetHeight : bounds.height;
  const [originX = "0", originY = "0"] = style.transformOrigin.split(" ");
  const ox = Number.parseFloat(originX) || 0;
  const oy = Number.parseFloat(originY) || 0;
  const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => ({
    x: matrix.a * (x - ox) + matrix.c * (y - oy) + matrix.e + ox,
    y: matrix.b * (x - ox) + matrix.d * (y - oy) + matrix.f + oy,
  }));
  const layoutX = transformed ? bounds.left - Math.min(...corners.map((point) => point.x)) : bounds.left;
  const layoutY = transformed ? bounds.top - Math.min(...corners.map((point) => point.y)) : bounds.top;
  const pivotX = layoutX - origin.left + ox;
  const pivotY = layoutY - origin.top + oy;
  const transform = transformed
    ? `translate(${pivotX + matrix.e} ${pivotY + matrix.f}) matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} 0 0) translate(${-pivotX} ${-pivotY})`
    : undefined;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (context) context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;

  const wholeTextRange = document.createRange();
  wholeTextRange.selectNodeContents(node);
  const wholeTextRects = wholeTextRange.getClientRects();
  const wholeText = node.textContent.trim();
  if (wholeText && wholeTextRects.length === 1) {
    const rect = wholeTextRects[0];
    let x = centeredChartTitle ? origin.width / 2 : rect.left - origin.left;
    let y = rect.top + rect.height / 2 - origin.top;
    if (transformed) {
      const local = matrix.inverse().transformPoint(new DOMPoint(
        rect.left + rect.width / 2 - layoutX - ox,
        rect.top + rect.height / 2 - layoutY - oy,
      ));
      const textWidth = context?.measureText(wholeText).width ?? rect.width;
      x = layoutX - origin.left + local.x + ox - textWidth / 2;
      y = layoutY - origin.top + local.y + oy;
    }
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y + fontSize * 0.35));
    text.setAttribute("dominant-baseline", "alphabetic");
    text.setAttribute("xml:space", "preserve");
    text.setAttribute("fill", style.color);
    text.setAttribute("font-family", style.fontFamily);
    text.setAttribute("font-size", String(fontSize));
    text.setAttribute("font-weight", style.fontWeight);
    text.setAttribute("font-style", style.fontStyle);
    if (centeredChartTitle) text.setAttribute("text-anchor", "middle");
    if (transform) text.setAttribute("transform", transform);
    text.textContent = wholeText;
    parent.appendChild(text);
    return;
  }

  const tokenPattern = /\S+\s*/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(node.textContent ?? ""))) {
    const range = document.createRange();
    range.setStart(node, match.index);
    range.setEnd(node, match.index + match[0].trimEnd().length);
    const rect = range.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    let x = rect.left + rect.width / 2 - origin.left;
    let y = rect.top + rect.height / 2 - origin.top;
    if (transformed) {
      const local = matrix.inverse().transformPoint(new DOMPoint(
        rect.left + rect.width / 2 - layoutX - ox,
        rect.top + rect.height / 2 - layoutY - oy,
      ));
      x = layoutX - origin.left + local.x + ox;
      y = layoutY - origin.top + local.y + oy;
    }
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const measuredWidth = context?.measureText(match[0].trimEnd()).width ?? rect.width;
    text.setAttribute("x", String(transformed ? x - measuredWidth / 2 : rect.left - origin.left));
    text.setAttribute("y", String(y + fontSize * 0.35));
    text.setAttribute("dominant-baseline", "alphabetic");
    text.setAttribute("fill", style.color);
    text.setAttribute("font-family", style.fontFamily);
    text.setAttribute("font-size", String(fontSize));
    text.setAttribute("font-weight", style.fontWeight);
    text.setAttribute("font-style", style.fontStyle);
    if (transform) text.setAttribute("transform", transform);
    text.textContent = match[0].trimEnd();
    parent.appendChild(text);
  }
}

function appendDomElement(
  source: Element,
  parent: Element,
  origin: DOMRect,
  skipRechartsLegend = false,
  removePieRectangles = false,
) {
  if (source.hasAttribute("data-chart-copy-exclude")) return;
  if (source.classList.contains("recharts-tooltip-wrapper") || source.classList.contains("recharts-tooltip-cursor")) return;
  if (skipRechartsLegend && source.classList.contains("recharts-legend-wrapper")) return;
  if (source instanceof SVGElement) {
    const clone = source.cloneNode(true) as SVGElement;
    inlineTreeStyles(source, clone);
    const sourceText = Array.from(source.querySelectorAll<SVGTextElement>("text"));
    const cloneText = Array.from(clone.querySelectorAll<SVGTextElement>("text"));
    sourceText.forEach((text, index) => {
      const copiedText = cloneText[index];
      if (!copiedText) return;
      const computed = window.getComputedStyle(text);
      copiedText.setAttribute("fill", computed.fill);
      copiedText.style.fill = computed.fill;
      copiedText.style.fontFamily = computed.fontFamily;
      copiedText.style.fontSize = computed.fontSize;
      copiedText.style.fontWeight = computed.fontWeight;
      copiedText.style.opacity = computed.opacity;
      copiedText.style.visibility = computed.visibility;
    });
    clone.querySelectorAll(".recharts-tooltip-cursor, .recharts-tooltip-wrapper").forEach((element) => element.remove());
    if (removePieRectangles) clone.querySelectorAll("rect").forEach((element) => element.remove());
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
    if ((background !== "rgba(0, 0, 0, 0)" && background !== "transparent") || borderWidth > 0) {
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
      appendDomElement(child, parent, origin, skipRechartsLegend, removePieRectangles);
    }
  });
}

function serializeDomChart(target: Element, width: number, height: number, copiedAt: string) {
  const footerHeight = 24;
  const bounds = target.getBoundingClientRect();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height + footerHeight));
  svg.setAttribute("viewBox", `0 0 ${width} ${height + footerHeight}`);
  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("width", String(width));
  background.setAttribute("height", String(height + footerHeight));
  background.setAttribute("fill", "#ffffff");
  svg.appendChild(background);
  const legendItems = Array.from(target.querySelectorAll<HTMLElement>(
    ".recharts-legend-wrapper .recharts-legend-item",
  )).filter((item) => item.getClientRects().length > 0);
  const includeLegend = legendItems.length > 1;
  const isPieChart = Boolean(target.querySelector(".recharts-pie"));
  appendDomElement(target, svg, bounds, includeLegend, isPieChart);
  if (includeLegend) {
    legendItems.forEach((item) => {
      Array.from(item.children).forEach((child) => appendDomElement(child, svg, bounds));
    });
  }
  const stamp = document.createElementNS("http://www.w3.org/2000/svg", "text");
  stamp.setAttribute("x", String(width - 12));
  stamp.setAttribute("y", String(height + 16));
  stamp.setAttribute("text-anchor", "end");
  stamp.setAttribute("fill", "#64748b");
  stamp.setAttribute("font-family", "Arial, sans-serif");
  stamp.setAttribute("font-size", "12");
  stamp.textContent = copiedAt;
  svg.appendChild(stamp);
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

function formatCopiedAt(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")}-${value("month")}-${value("year")} (${value("hour")}:${value("minute")}${value("dayPeriod").toUpperCase()})`;
}

async function renderChartPng(target: Element, copiedAt: string) {
  const bounds = target.getBoundingClientRect();
  const width = Math.ceil(bounds.width);
  const height = Math.ceil(bounds.height);
  if (!width || !height) throw new Error("The chart has no visible area to copy.");

  const footerHeight = 24;
  const outputHeight = height + footerHeight;
  const markup = serializeDomChart(target, width, height, copiedAt);
  const imageUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const scale = 3;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = outputHeight * scale;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the chart image.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, outputHeight);
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

  const imageBlob = renderChartPng(target, formatCopiedAt(new Date()));
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
