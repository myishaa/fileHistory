export type FileTypeGroup = "goodsServices" | "contract";

export type FileTypeGroupSetting = {
  fileType: string;
  group: FileTypeGroup;
};

export const fileTypeGroupOptions: { value: FileTypeGroup; label: string; description: string }[] =
  [
    {
      value: "goodsServices",
      label: "Group A - Goods & Services",
      description: "IR Yes/No decides delivery or job-completion workflow.",
    },
    {
      value: "contract",
      label: "Group B - AMC/MPC/O&M/CARS",
      description: "Contract/service workflow based on job completion and stage delivery rules.",
    },
  ];

export function normalizeFileTypeGroup(value: unknown): FileTypeGroup {
  return value === "contract" ? "contract" : "goodsServices";
}

export function getDefaultFileTypeGroup(fileType: string | undefined): FileTypeGroup {
  const normalized = (fileType ?? "").trim().toLowerCase();
  return normalized === "amc" ||
    normalized === "mpc" ||
    normalized === "cars" ||
    normalized === "capsi" ||
    normalized === "o&m"
    ? "contract"
    : "goodsServices";
}

export function normalizeFileTypeGroups(
  groups: FileTypeGroupSetting[] | undefined,
  fileTypes: string[] | undefined,
): FileTypeGroupSetting[] {
  const configured = new Map(
    (groups ?? [])
      .filter((entry) => entry && typeof entry.fileType === "string")
      .map((entry) => [entry.fileType.trim().toLowerCase(), normalizeFileTypeGroup(entry.group)]),
  );
  const seen = new Set<string>();
  return (fileTypes ?? [])
    .map((fileType) => fileType.trim())
    .filter((fileType) => {
      const key = fileType.toLowerCase();
      if (!fileType || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((fileType) => ({
      fileType,
      group: configured.get(fileType.toLowerCase()) ?? getDefaultFileTypeGroup(fileType),
    }));
}

export function getConfiguredFileTypeGroup(
  fileType: string | undefined,
  groups: FileTypeGroupSetting[] | undefined,
): FileTypeGroup {
  const normalized = (fileType ?? "").trim().toLowerCase();
  if (!normalized) return "goodsServices";
  const match = (groups ?? []).find((entry) => entry.fileType.trim().toLowerCase() === normalized);
  return match ? normalizeFileTypeGroup(match.group) : getDefaultFileTypeGroup(fileType);
}

export function isContractFileType(file: {
  fileType?: string;
  fileTypeGroup?: FileTypeGroup | string;
}): boolean {
  return (
    normalizeFileTypeGroup(file.fileTypeGroup ?? getDefaultFileTypeGroup(file.fileType)) ===
    "contract"
  );
}

export function isDeliveryInspectionApplicableByGroup(file: {
  fileType?: string;
  fileTypeGroup?: FileTypeGroup | string;
  ir?: string;
}): boolean {
  return !isNo(file.ir) && !isContractFileType(file);
}

export function isBiddingApplicableForFile(file: { mode?: string; fileType?: string }): boolean {
  const mode = String(file.mode ?? "")
    .trim()
    .toUpperCase();
  const fileType = String(file.fileType ?? "")
    .trim()
    .toLowerCase();
  const gem = String((file as { gem?: string }).gem ?? "")
    .trim()
    .toLowerCase();
  const gemBiddingMode = String((file as { gemBiddingMode?: string }).gemBiddingMode ?? "")
    .trim()
    .toLowerCase();
  return (
    mode !== "LPC" &&
    fileType !== "cars" &&
    fileType !== "capsi" &&
    !(gem === "yes" && gemBiddingMode === "comparison")
  );
}

function isNo(value: unknown) {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === "no"
  );
}
