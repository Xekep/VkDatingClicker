const fs = require("node:fs");
const path = require("node:path");
const crx3 = require("crx3");

const rootDir = path.resolve(__dirname, "..");
const sourceDir = path.join(rootDir, "src");
const manifestPath = path.join(sourceDir, "manifest.json");
const distDir = path.join(rootDir, "dist");

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const version = manifest.version;
  const expectedTag = `v${version}`;
  const releaseTag = process.env.RELEASE_TAG;
  const keyPath = process.env.CRX_KEY_PATH;

  if (!keyPath) {
    throw new Error("CRX_KEY_PATH is required and must point to a PEM private key.");
  }

  if (!fs.existsSync(keyPath)) {
    throw new Error(`CRX key was not found at: ${keyPath}`);
  }

  if (releaseTag && releaseTag !== expectedTag) {
    throw new Error(
      `Release tag mismatch: expected ${expectedTag}, received ${releaseTag}.`
    );
  }

  const baseName = `${slugify(manifest.name)}-${version}`;
  const crxPath = path.join(distDir, `${baseName}.crx`);
  const zipPath = path.join(distDir, `${baseName}.zip`);

  fs.mkdirSync(distDir, { recursive: true });

  await crx3([manifestPath], {
    keyPath,
    crxPath,
    zipPath
  });

  console.log(`Packed ${baseName}`);
  console.log(`CRX: ${crxPath}`);
  console.log(`ZIP: ${zipPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
