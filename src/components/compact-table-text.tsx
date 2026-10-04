import type { CSSProperties } from "react";

export function getCompactTableTextWidth(key: string, label = "") {
  const normalized = `${key} ${label}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (normalized.includes("description")) return 36;
  if (
    normalized.includes("bidder firm") ||
    normalized.includes("invited firm") ||
    normalized.includes("bq firm") ||
    normalized.includes("bidderfirm") ||
    normalized.includes("invitedfirm") ||
    normalized.includes("bqfirm")
  ) {
    return 22;
  }
  if (
    normalized.includes("firm address") ||
    normalized.includes("firmaddress") ||
    normalized === "address" ||
    normalized.endsWith(" address")
  ) {
    return 26;
  }
  if (
    normalized === "indentor" ||
    normalized.endsWith(" indentor") ||
    normalized === "firm" ||
    normalized.endsWith(" firm") ||
    normalized === "name firm" ||
    normalized.includes("firm name") ||
    normalized.includes("so firm") ||
    normalized === "firmname" ||
    normalized === "sofirm"
  ) {
    return 20;
  }
  return undefined;
}

export function CompactTableText({
  value,
  width,
  className = "",
}: {
  value: string;
  width: number;
  className?: string;
}) {
  const style: CSSProperties = {
    maxWidth: `${width}ch`,
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    overflow: "hidden",
  };
  return (
    <span
      className={`min-w-0 whitespace-normal break-words ${className}`}
      style={style}
      title={value}
      aria-label={value}
      tabIndex={value.length > width ? 0 : undefined}
    >
      {value}
    </span>
  );
}
