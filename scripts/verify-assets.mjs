import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "assets");
const manifestPath = join(assets, "SHA256SUMS");
const manifest = readFileSync(manifestPath, "utf8")
  .trim()
  .split(/\r?\n/)
  .map((line) => {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) throw new Error(`Invalid SHA256SUMS line: ${line}`);
    return { expected: match[1], name: match[2] };
  });

const errors = [];
const declared = new Set();

for (const { expected, name } of manifest) {
  declared.add(name);
  const path = join(assets, ...name.split("/"));
  if (!existsSync(path)) {
    errors.push(`Missing asset: ${name}`);
    continue;
  }

  const actual = createHash("sha256")
    .update(readFileSync(path))
    .digest("hex");
  if (actual !== expected) errors.push(`Hash mismatch: ${name}`);
}

for (const path of walk(assets)) {
  const name = relative(assets, path).replaceAll("\\", "/");
  if (name !== "SHA256SUMS" && !declared.has(name)) {
    errors.push(`Asset absent from SHA256SUMS: ${name}`);
  }
}

const index = readFileSync(join(root, "index.html"), "utf8");
const forbidden = [
  "cdn.tailwindcss.com",
  "cdnjs.cloudflare.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "www.gstatic.com/firebasejs/",
  "<!-- CLOUD_STORAGE -->"
];

for (const value of forbidden) {
  if (index.includes(value)) errors.push(`Forbidden index reference: ${value}`);
}

if (/password:\s*["']1234["']/.test(index)) {
  errors.push("Default password found in index.html");
}

for (const match of index.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)) {
  const path = join(root, ...match[1].slice(2).split("/"));
  if (!existsSync(path)) errors.push(`Missing referenced asset: ${match[1]}`);
}

if (!index.includes("const appState = {") || index.length < 100_000) {
  errors.push("The full LMS application script is not present");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Verified ${manifest.length} assets and the standalone index.`);
}

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
