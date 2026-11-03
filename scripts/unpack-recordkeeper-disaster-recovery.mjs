#!/usr/bin/env node

import { createDecipheriv, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [, , inputArgument, outputArgument] = process.argv;
const password = process.env.RECOVERY_BACKUP_PASSWORD;

if (!inputArgument || !outputArgument || !password) {
  console.error(
    "Usage: RECOVERY_BACKUP_PASSWORD='...' node scripts/unpack-recordkeeper-disaster-recovery.mjs <package.rkdr> <output-directory>",
  );
  process.exit(2);
}

const inputPath = resolve(inputArgument);
const outputDirectory = resolve(outputArgument);
const encrypted = await readFile(inputPath);
const headerEnd = encrypted.indexOf(0x0a);
if (headerEnd < 0) throw new Error("Recovery package header is missing.");

let header;
try {
  header = JSON.parse(encrypted.subarray(0, headerEnd).toString("utf8"));
} catch {
  throw new Error("Recovery package header is invalid.");
}
if (header?.format !== "recordkeeper-full-recovery-backup" || header?.version !== 1) {
  throw new Error("Unsupported recovery package format.");
}
for (const field of ["salt", "iv"]) {
  if (typeof header[field] !== "string") throw new Error(`Recovery package ${field} is missing.`);
}

const tagLength = 16;
if (encrypted.length <= headerEnd + 1 + tagLength) throw new Error("Recovery package is empty.");
const ciphertext = encrypted.subarray(headerEnd + 1, encrypted.length - tagLength);
const tag = encrypted.subarray(encrypted.length - tagLength);

let archive;
try {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    scryptSync(password, Buffer.from(header.salt, "base64"), 32),
    Buffer.from(header.iv, "base64"),
  );
  decipher.setAuthTag(tag);
  archive = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
} catch {
  throw new Error("Recovery password is incorrect or the package is damaged.");
}

await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
const archivePath = join(outputDirectory, "recovery-package.tar.gz");
await writeFile(archivePath, archive, { mode: 0o600 });

const tar = process.env.TAR_PATH?.trim() || "tar";
const result = spawnSync(tar, ["-xzf", archivePath, "--no-absolute-names", "--no-same-owner", "-C", outputDirectory], {
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Archive extraction failed with exit code ${result.status}.`);
console.log(`Recovery package extracted to ${outputDirectory}`);
