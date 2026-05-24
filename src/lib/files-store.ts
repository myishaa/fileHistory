// Lightweight localStorage-backed store for files and divisions.
import * as React from "react";

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
  tcec?: string;
  mode?: string;
  gem?: string;
  highValue?: string;
  ad?: string;
  rqa?: string;
  ifa?: string;
  highValueMeetingDate?: string;
  highValueMinutesDate?: string;
  preTcecDate?: string;
  preTcecMinutesDate?: string;
  preTcecCommitteeNo?: string;
  adVettingDate?: string;
  rqaApprovalDate?: string;
  ifaSentDate?: string;
  ifaFinalDate?: string;
  cfaDate?: string;
  gemUndertakingDate?: string;
  tenderLive?: string;
  bidDate?: string;
  bidOpeningDate?: string;
  bidOpened?: string;
  postTcecDate?: string;
  postTcecMinutesDate?: string;
  postTcecCommitteeNumber?: string;
  refloatBiddingDate?: string;
  refloatBidOpeningDate?: string;
  refloatPostTcecDate?: string;
  refloatPostTcecCommitteeNo?: string;
  rst?: string;
  cncDate?: string;
  cncApprovalDate?: string;
  soNo?: string;
  gemSoNo?: string;
  soDate?: string;
  soValueCapital?: string;
  soValueRevenue?: string;
  dpDate?: string;
  firm?: string;
  bgValidityDate?: string;
  dpExtension?: string;
  revisedDp?: string;
  materialReceiptDate?: string;
  paymentDate?: string;
  paymentMode?: string;
  bgReturnDate?: string;
  demandCancelled?: string;
  soCancelled?: string;
  remark1?: string;
  remark2?: string;
  remark3?: string;
  remark4?: string;
  remark5?: string;
  remark7?: string;
  remark8?: string;
  createdAt: string;
};

export type Division = { id: string; name: string; code?: string };

const FILES_KEY = "ofms.files.v1";
const DIVS_KEY = "ofms.divisions.v1";

const defaultDivisions: Division[] = [
  { id: "d1", name: "Mechanical", code: "MECH" },
  { id: "d2", name: "Electrical", code: "ELEC" },
  { id: "d3", name: "Electronics", code: "ELX" },
  { id: "d4", name: "Administration", code: "ADMIN" },
  { id: "d5", name: "Procurement", code: "PROC" },
];

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
    write(FILES_KEY, store.getFiles().filter((f) => f.id !== id));
    emit();
  },
  addDivision(name: string, code?: string) {
    const divs = store.getDivisions();
    divs.push({ id: crypto.randomUUID(), name, code });
    write(DIVS_KEY, divs);
    emit();
  },
  updateDivision(id: string, patch: Partial<Division>) {
    write(DIVS_KEY, store.getDivisions().map((d) => (d.id === id ? { ...d, ...patch } : d)));
    emit();
  },
  deleteDivision(id: string) {
    write(DIVS_KEY, store.getDivisions().filter((d) => d.id !== id));
    emit();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useFiles() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => { const u = store.subscribe(() => setTick((t) => t + 1)); return () => { u; }; }, []);
  return store.getFiles();
}

export function useDivisions() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => { const u = store.subscribe(() => setTick((t) => t + 1)); return () => { u; }; }, []);
  return store.getDivisions();
}

export function isIncomplete(f: FileRecord) {
  return !f.title || !f.division || !f.officer || !f.imms || !f.date;
}
