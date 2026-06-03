// Lightweight localStorage-backed store for files and divisions.
import * as React from "react";
import { defaultTableFieldPresets, type TableFieldPreset } from "@/lib/table-field-presets";

export type FileRecord = {
  id: string;
  title?: string;
  division?: string;
  officer?: string;
  imms?: string;
  date?: string; // ISO yyyy-mm-dd
  year?: string;
  uniqueCode?: string;
  receivedDate?: string;
  scrutinyDate?: string;
  scrutinyResponseDate?: string;
  scrutinyCompletionDate?: string;
  immsDate?: string;
  fileNo?: string;
  indentor?: string;
  demandDescription?: string;
  valueCapital?: string;
  valueRevenue?: string;
  currency?: string;
  exchangeRate?: string;
  gte?: string;
  fileType?: string;
  tcec?: string;
  mode?: string;
  gem?: string;
  highValue?: string;
  ad?: string;
  rqa?: string;
  ifa?: string;
  psb?: string;
  bg?: string;
  rfpVetting?: string;
  highValueMeetingDate?: string;
  highValueMinutesDate?: string;
  preTcecDate?: string;
  preTcecMinutesDate?: string;
  preTcecCommitteeNo?: string;
  adVettingDate?: string;
  rqaApprovalDate?: string;
  ifaSentDate?: string;
  ifaFinalDate?: string;
  cfaSentDate?: string;
  cfaDate?: string;
  gemUndertakingDate?: string;
  rfpVettingInitiationDate?: string;
  rfpVettingApprovalDate?: string;
  tenderLive?: string;
  bidDate?: string;
  bidOpeningDate?: string;
  bidOpened?: string;
  refloat?: string;
  postTcecDate?: string;
  postTcecMinutesDate?: string;
  postTcecCommitteeNumber?: string;
  refloatBiddingDate?: string;
  refloatBidOpeningDate?: string;
  refloatPostTcecDate?: string;
  refloatPostTcecMinutesDate?: string;
  refloatPostTcecCommitteeNo?: string;
  rst?: string;
  biddingStageOver?: string;
  cncDate?: string;
  cncApprovalDate?: string;
  noOfSo?: string;
  soNo?: string;
  gemSoNo?: string;
  soDate?: string;
  soValueCapital?: string;
  soValueRevenue?: string;
  dpDate?: string;
  firm?: string;
  bgValidityDate?: string;
  dpExtension?: string;
  dpExtensionCount?: string;
  ld?: string;
  revisedDp?: string;
  materialReceiptDate?: string;
  paymentDate?: string;
  paymentMode?: string;
  bgReturnDate?: string;
  demandCancelled?: string;
  soCancelled?: string;
  fileDetailsRemark1?: string;
  fileDetailsRemark2?: string;
  scrutinyRemark1?: string;
  scrutinyRemark2?: string;
  tcecRemark1?: string;
  tcecRemark2?: string;
  approvalRemark1?: string;
  approvalRemark2?: string;
  biddingRemark1?: string;
  biddingRemark2?: string;
  supplyOrderRemark1?: string;
  supplyOrderRemark2?: string;
  remark1?: string;
  remark2?: string;
  remark3?: string;
  remark4?: string;
  remark5?: string;
  remark6?: string;
  remark7?: string;
  remark8?: string;
  remark9?: string;
  invitedFirms?: FirmDetail[];
  bidderFirms?: FirmDetail[];
  supplyOrders?: SupplyOrderDetail[];
  currentMilestone?: string;
  completedMilestones?: string[];
  createdAt: string;
};

export type SupplyOrderDetail = {
  soNo?: string;
  gemSoNo?: string;
  soDate?: string;
  soValueCapital?: string;
  soValueRevenue?: string;
  dpDate?: string;
  firm?: string;
  bgValidityDate?: string;
  dpExtension?: string;
  dpExtensionCount?: string;
  ld?: string;
  revisedDp?: string;
  materialReceiptDate?: string;
  paymentDate?: string;
  paymentMode?: string;
  bgReturnDate?: string;
  demandCancelled?: string;
  soCancelled?: string;
  supplyOrderRemark1?: string;
  supplyOrderRemark2?: string;
};

export type FirmDetail = {
  firmName?: string;
  city?: string;
  emailId?: string;
};

export type Division = {
  id: string;
  name: string;
  code?: string;
  allocatedCapital?: string;
  allocatedRevenue?: string;
  ad?: string;
};
export type AppUserRole = "admin" | "division_user";
export type AppUser = {
  id: string;
  name: string;
  username: string;
  role: AppUserRole;
  divisionIds: string[];
};
export type AppTheme = "light" | "dark";
export type AppThemeTint = "plain" | "yellow" | "green" | "blue" | "pink" | "lavender";
export type AppSettings = {
  financialYear: string;
  theme: AppTheme;
  themeTint: AppThemeTint;
  deletionPassword: string;
  tcecCommittees: string[];
  milestones: string[];
  tableFieldPresets: TableFieldPreset[];
  activeUserId?: string;
};

const FILES_KEY = "ofms.files.v1";
const DIVS_KEY = "ofms.divisions.v1";
const SETTINGS_KEY = "ofms.settings.v1";
const USERS_KEY = "ofms.users.v1";

function currentYear() {
  return String(new Date().getFullYear());
}

const defaultSettings: AppSettings = {
  financialYear: currentYear(),
  theme: "light",
  themeTint: "plain",
  deletionPassword: "",
  tcecCommittees: [],
  milestones: [],
  tableFieldPresets: defaultTableFieldPresets,
};

const defaultDivisions: Division[] = [
  {
    id: "d1",
    name: "Mechanical",
    code: "MECH",
    allocatedCapital: "",
    allocatedRevenue: "",
    ad: "No",
  },
  {
    id: "d2",
    name: "Electrical",
    code: "ELEC",
    allocatedCapital: "",
    allocatedRevenue: "",
    ad: "No",
  },
  {
    id: "d3",
    name: "Electronics",
    code: "ELX",
    allocatedCapital: "",
    allocatedRevenue: "",
    ad: "No",
  },
  {
    id: "d4",
    name: "Administration",
    code: "ADMIN",
    allocatedCapital: "",
    allocatedRevenue: "",
    ad: "No",
  },
  {
    id: "d5",
    name: "Procurement",
    code: "PROC",
    allocatedCapital: "",
    allocatedRevenue: "",
    ad: "No",
  },
];

const defaultUsers: AppUser[] = [];

const sampleOfficers = ["Rajesh Kumar", "Anita Sharma", "Vikram Singh", "Priya Nair", "S. Iyer"];
const sampleTitles = [
  "Gear assembly inspection report",
  "Transformer maintenance log",
  "PCB calibration certificate",
  "Procurement order — bearings",
  "Annual audit summary",
  "Vendor compliance file",
  "Lathe machine overhaul",
  "Sensor batch QA report",
];

function seedFiles(): FileRecord[] {
  const out: FileRecord[] = [];
  for (let i = 0; i < 18; i++) {
    const div = defaultDivisions[i % defaultDivisions.length].name;
    const incomplete = i % 4 === 0;
    out.push({
      id: crypto.randomUUID(),
      title: incomplete && i % 8 === 0 ? undefined : sampleTitles[i % sampleTitles.length],
      division: div,
      officer: incomplete && i % 6 === 0 ? undefined : sampleOfficers[i % sampleOfficers.length],
      imms: incomplete ? undefined : `IMMS-${1000 + i}`,
      date: new Date(Date.now() - i * 86400000 * 2).toISOString().slice(0, 10),
      createdAt: new Date(Date.now() - i * 86400000 * 2).toISOString(),
    });
  }
  return out;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

let initialized = false;
function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  if (!localStorage.getItem(DIVS_KEY)) write(DIVS_KEY, defaultDivisions);
  if (!localStorage.getItem(FILES_KEY)) write(FILES_KEY, seedFiles());
  if (!localStorage.getItem(SETTINGS_KEY)) write(SETTINGS_KEY, defaultSettings);
  if (!localStorage.getItem(USERS_KEY)) write(USERS_KEY, defaultUsers);
}

export const store = {
  getFiles(): FileRecord[] {
    ensureInit();
    return read<FileRecord[]>(FILES_KEY, []);
  },
  getDivisions(): Division[] {
    ensureInit();
    return read<Division[]>(DIVS_KEY, defaultDivisions);
  },
  getSettings(): AppSettings {
    ensureInit();
    return { ...defaultSettings, ...read<Partial<AppSettings>>(SETTINGS_KEY, defaultSettings) };
  },
  getUsers(): AppUser[] {
    ensureInit();
    return read<AppUser[]>(USERS_KEY, defaultUsers);
  },
  updateSettings(patch: Partial<AppSettings>) {
    write(SETTINGS_KEY, { ...store.getSettings(), ...patch });
    emit();
  },
  addFile(f: Omit<FileRecord, "id" | "createdAt">) {
    const files = store.getFiles();
    files.unshift({ ...f, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
    write(FILES_KEY, files);
    emit();
  },
  updateFile(id: string, patch: Partial<FileRecord>) {
    const files = store.getFiles().map((f) => (f.id === id ? { ...f, ...patch } : f));
    write(FILES_KEY, files);
    emit();
  },
  deleteFile(id: string) {
    write(
      FILES_KEY,
      store.getFiles().filter((f) => f.id !== id),
    );
    emit();
  },
  addDivision(
    name: string,
    code?: string,
    allocatedCapital?: string,
    allocatedRevenue?: string,
    ad?: string,
  ) {
    const divs = store.getDivisions();
    divs.push({ id: crypto.randomUUID(), name, code, allocatedCapital, allocatedRevenue, ad });
    write(DIVS_KEY, divs);
    emit();
  },
  updateDivision(id: string, patch: Partial<Division>) {
    write(
      DIVS_KEY,
      store.getDivisions().map((d) => (d.id === id ? { ...d, ...patch } : d)),
    );
    emit();
  },
  deleteDivision(id: string) {
    write(
      DIVS_KEY,
      store.getDivisions().filter((d) => d.id !== id),
    );
    write(
      USERS_KEY,
      store.getUsers().map((user) => ({
        ...user,
        divisionIds: user.divisionIds.filter((divId) => divId !== id),
      })),
    );
    emit();
  },
  addUser(user: Omit<AppUser, "id">) {
    const users = store.getUsers();
    users.push({ ...user, id: crypto.randomUUID() });
    write(USERS_KEY, users);
    emit();
  },
  updateUser(id: string, patch: Partial<AppUser>) {
    write(
      USERS_KEY,
      store.getUsers().map((user) => (user.id === id ? { ...user, ...patch } : user)),
    );
    emit();
  },
  deleteUser(id: string) {
    write(
      USERS_KEY,
      store.getUsers().filter((user) => user.id !== id),
    );
    emit();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useFiles() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const u = store.subscribe(() => setTick((t) => t + 1));
    return () => {
      u();
    };
  }, []);
  return store.getFiles();
}

export function useDivisions() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const u = store.subscribe(() => setTick((t) => t + 1));
    return () => {
      u();
    };
  }, []);
  return store.getDivisions();
}

export function useSettings() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const u = store.subscribe(() => setTick((t) => t + 1));
    return () => {
      u();
    };
  }, []);
  return store.getSettings();
}

export function useUsers() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const u = store.subscribe(() => setTick((t) => t + 1));
    return () => {
      u();
    };
  }, []);
  return store.getUsers();
}

export function useActiveUser() {
  const users = useUsers();
  const settings = useSettings();
  return users.find((user) => user.id === settings.activeUserId);
}

export function useAccessibleDivisions() {
  const divisions = useDivisions();
  const activeUser = useActiveUser();
  if (!activeUser || activeUser.role === "admin") return divisions;
  return divisions.filter((division) => activeUser.divisionIds.includes(division.id));
}

export function useAccessibleFiles() {
  const files = useFiles();
  const accessibleDivisions = useAccessibleDivisions();
  const activeUser = useActiveUser();
  if (!activeUser || activeUser.role === "admin") return files;
  const allowedDivisionNames = new Set(accessibleDivisions.map((division) => division.name));
  return files.filter((file) => file.division && allowedDivisionNames.has(file.division));
}

export function isIncomplete(f: FileRecord) {
  return !f.title || !f.division || !f.officer || !f.imms || !f.date;
}
