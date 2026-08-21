import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "assets");
const temporary = join(root, ".asset-build-tmp");
const indexPath = join(root, "index.html");

rmSync(temporary, { recursive: true, force: true });
mkdirSync(temporary, { recursive: true });

const firebaseTemporary = join(temporary, "firebase-storage.min.js");
await build({
  entryPoints: [join(root, "src", "firebase-storage.js")],
  bundle: true,
  format: "esm",
  legalComments: "inline",
  minify: true,
  outfile: firebaseTemporary,
  target: ["es2020"]
});

const tailwindTemporary = join(temporary, "tailwind.min.css");
execFileSync(
  process.execPath,
  [
    join(root, "node_modules", "tailwindcss", "lib", "cli.js"),
    "-c",
    join(root, "tailwind.config.cjs"),
    "-i",
    join(root, "tailwind-input.css"),
    "-o",
    tailwindTemporary,
    "--minify"
  ],
  { cwd: root, stdio: "inherit" }
);

let index = readFileSync(indexPath, "utf8");
index = installHashedAsset({
  temporaryPath: firebaseTemporary,
  prefix: "firebase-storage",
  extension: ".min.js",
  reference: /\.\/assets\/firebase-storage(?:-[a-f0-9]{12})?\.min\.js/g,
  index
});
index = installHashedAsset({
  temporaryPath: tailwindTemporary,
  prefix: "tailwind",
  extension: ".min.css",
  reference: /\.\/assets\/tailwind(?:-[a-f0-9]{12})?\.min\.css/g,
  index
});

writeFileSync(indexPath, index, "utf8");
rmSync(temporary, { recursive: true, force: true });
writeManifest();

function installHashedAsset({
  temporaryPath,
  prefix,
  extension,
  reference,
  index
}) {
  const content = readFileSync(temporaryPath);
  const hash = createHash("sha256").update(content).digest("hex");
  const filename = `${prefix}-${hash.slice(0, 12)}${extension}`;
  const target = join(assets, filename);

  for (const entry of readdirSync(assets)) {
    if (entry.startsWith(`${prefix}-`) && entry.endsWith(extension)) {
      rmSync(join(assets, entry));
    }
  }

  renameSync(temporaryPath, target);
  if (!reference.test(index)) {
    throw new Error(`Could not find the ${prefix} asset reference in index.html`);
  }

  reference.lastIndex = 0;
  return index.replace(reference, `./assets/${filename}`);
}

function writeManifest() {
  const files = walk(assets)
    .filter((path) => !path.endsWith("SHA256SUMS"))
    .sort((left, right) => left.localeCompare(right));

  const lines = files.map((path) => {
    const hash = createHash("sha256")
      .update(readFileSync(path))
      .digest("hex");
    return `${hash}  ${relative(assets, path).replaceAll("\\", "/")}`;
  });

  writeFileSync(join(assets, "SHA256SUMS"), `${lines.join("\n")}\n`, "utf8");
}

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
