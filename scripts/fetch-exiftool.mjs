import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "13.59";
const PACKAGES = {
  mac: {
    file: `Image-ExifTool-${VERSION}.tar.gz`,
    sha256: "668ea3acececb7235fbd0f4900e72d5f12c9b07e5c778fd36cb1e9b5828fd65a",
  },
  win: {
    file: `exiftool-${VERSION}_64.zip`,
    sha256: "44b512b25af500724ba579d0a53c8fc5851628b692dd5e5d94ae4a15c2cba9ec",
  },
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "src-tauri", "resources", "exiftool");
const arg = process.argv.find((a) => a.startsWith("--platform="))?.split("=")[1];
const platform = arg ?? (process.platform === "win32" ? "win" : "mac");
const force = process.argv.includes("--force");

const stampFile = join(target, ".version");
const stamp = `${platform}-${VERSION}`;
if (!force && existsSync(stampFile) && readFileSync(stampFile, "utf8").trim() === stamp) {
  console.log(`exiftool ${stamp} already present`);
  process.exit(0);
}

const pkg = PACKAGES[platform];
if (!pkg) throw new Error(`unknown platform: ${platform}`);

const url = `https://sourceforge.net/projects/exiftool/files/${pkg.file}/download`;
console.log(`downloading ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
const digest = createHash("sha256").update(buf).digest("hex");
if (digest !== pkg.sha256) throw new Error(`sha256 mismatch: ${digest}`);

const work = mkdtempSync(join(tmpdir(), "exiftool-"));
const archive = join(work, pkg.file);
writeFileSync(archive, buf);
execFileSync("tar", ["-xf", archive, "-C", work]);
const makeWritable = (dir) => {
  if (process.platform !== "win32" && existsSync(dir)) execFileSync("chmod", ["-R", "u+w", dir]);
};
makeWritable(work);
makeWritable(target);

rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
mkdirSync(target, { recursive: true });

if (platform === "mac") {
  const src = join(work, `Image-ExifTool-${VERSION}`);
  cpSync(join(src, "exiftool"), join(target, "exiftool"));
  cpSync(join(src, "lib"), join(target, "lib"), { recursive: true });
} else {
  const src = join(work, `exiftool-${VERSION}_64`);
  cpSync(join(src, "exiftool(-k).exe"), join(target, "exiftool.exe"));
  cpSync(join(src, "exiftool_files"), join(target, "exiftool_files"), { recursive: true });
}

makeWritable(target);
writeFileSync(stampFile, stamp);
try {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch (e) {
  console.warn(`could not remove temp dir ${work}: ${e.code ?? e}`);
}
console.log(`exiftool ${stamp} installed to ${target}`);
