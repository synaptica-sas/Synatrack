#!/usr/bin/env node
/**
 * Marca una nueva versión de Synatrack y genera su changelog.
 *
 * Qué hace:
 *   1. Lee la versión actual de `VERSION` (raíz del repo).
 *   2. Busca el tag `v<version-actual>` y junta los commits desde ahí hasta HEAD
 *      (sin merges).
 *   3. Calcula la versión nueva (semver) según el tipo de cambio que le des.
 *   4. Escribe `documentacion/versiones/v<nueva>.md` con esos commits.
 *   5. Actualiza `VERSION`, `backend/package.json`, `frontend/package.json` y el
 *      `appVersion` que se ve en el pie de página del frontend.
 *
 * No hace commit, no crea el tag y no hace push: eso lo decide quien lo corre.
 *
 * Uso:
 *   node scripts/release.mjs <patch|minor|major> [--base <ref>]
 *
 * El tipo de cambio es obligatorio a propósito (no hay default): obliga a mirar
 * los commits y decidir si son correcciones (patch), funcionalidad nueva
 * (minor) o algo que rompe compatibilidad (major), en vez de que el script
 * adivine.
 *
 * `--base <ref>` es solo para la primera vez que se corre en un repo sin tags
 * `v*`: indica desde qué commit/tag contar los cambios. Con tags ya creados no
 * hace falta.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function sh(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

const [bump, ...rest] = process.argv.slice(2);
if (!["patch", "minor", "major"].includes(bump)) {
  fail(
    "indica el tipo de cambio: `node scripts/release.mjs patch|minor|major`.\n" +
      "  patch  = correcciones\n" +
      "  minor  = funcionalidad nueva, compatible\n" +
      "  major  = rompe compatibilidad (ej. cambio de esquema que exige migrar datos a mano)",
  );
}

let baseRef = null;
const baseFlagIndex = rest.indexOf("--base");
if (baseFlagIndex !== -1) {
  baseRef = rest[baseFlagIndex + 1];
  if (!baseRef) fail("--base necesita un valor (un tag o un commit).");
}

const versionPath = join(ROOT, "VERSION");
if (!existsSync(versionPath)) fail(`no existe ${versionPath}`);
const currentVersion = readFileSync(versionPath, "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(currentVersion)) {
  fail(`VERSION tiene un valor raro: "${currentVersion}" (se espera X.Y.Z)`);
}

if (!baseRef) {
  const expectedTag = `v${currentVersion}`;
  try {
    sh(["rev-parse", "--verify", `${expectedTag}^{commit}`]);
    baseRef = expectedTag;
  } catch {
    fail(
      `no existe el tag "${expectedTag}" y no se dio --base.\n` +
        `Si es la primera vez que se corre este script, crea el tag apuntando al commit que ya está en producción:\n` +
        `  git tag ${expectedTag} <commit-en-produccion>\n` +
        `o pasa explícitamente desde dónde contar: node scripts/release.mjs ${bump} --base <ref>`,
    );
  }
}

const log = sh(["log", `${baseRef}..HEAD`, "--no-merges", "--pretty=format:%h|%s"]);
const commits = log
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [hash, ...subjectParts] = line.split("|");
    return { hash, subject: subjectParts.join("|") };
  });

if (commits.length === 0) {
  fail(`no hay commits nuevos entre ${baseRef} y HEAD. No tiene sentido marcar una versión vacía.`);
}

const [major, minor, patch] = currentVersion.split(".").map(Number);
const nextVersion =
  bump === "major"
    ? `${major + 1}.0.0`
    : bump === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

const today = new Date().toISOString().slice(0, 10);
const versionesDir = join(ROOT, "documentacion", "versiones");
mkdirSync(versionesDir, { recursive: true });

const changelogPath = join(versionesDir, `v${nextVersion}.md`);
if (existsSync(changelogPath)) {
  fail(`ya existe ${changelogPath}. Borra ese archivo primero si quieres regenerarlo.`);
}

const baseShortSha = sh(["rev-parse", "--short", baseRef]);

const changelogBody = [
  `# v${nextVersion} — ${today}`,
  "",
  `Comparado con v${currentVersion} (\`${baseShortSha}\`).`,
  "",
  "## Commits incluidos",
  "",
  "> Revisa y reescribe esta lista en prosa antes de publicarla: son los mensajes de commit",
  "> tal cual, no una nota de versión lista para alguien externo al equipo.",
  "",
  ...commits.map((c) => `- ${c.subject} (\`${c.hash}\`)`),
  "",
].join("\n");

writeFileSync(changelogPath, changelogBody, "utf8");

function bumpPackageJson(relPath) {
  const full = join(ROOT, relPath);
  if (!existsSync(full)) return;
  const raw = readFileSync(full, "utf8");
  const updated = raw.replace(/"version":\s*"[^"]*"/, `"version": "${nextVersion}"`);
  if (updated === raw) {
    console.warn(`Aviso: no encontré el campo "version" en ${relPath}, lo dejé igual.`);
    return;
  }
  writeFileSync(full, updated, "utf8");
}

bumpPackageJson("backend/package.json");
bumpPackageJson("frontend/package.json");

const appTsxPath = join(ROOT, "frontend", "src", "App.tsx");
if (existsSync(appTsxPath)) {
  const raw = readFileSync(appTsxPath, "utf8");
  const updated = raw.replace(/appVersion="[^"]*"/, `appVersion="${nextVersion}"`);
  if (updated === raw) {
    console.warn(`Aviso: no encontré appVersion="..." en ${appTsxPath}, lo dejé igual.`);
  } else {
    writeFileSync(appTsxPath, updated, "utf8");
  }
}

writeFileSync(versionPath, `${nextVersion}\n`, "utf8");

console.log(`Versión ${currentVersion} -> ${nextVersion}`);
console.log(`Changelog: documentacion/versiones/v${nextVersion}.md (${commits.length} commits, revísalo y reescríbelo antes de publicar)`);
console.log("");
console.log("Siguiente paso (no lo hace este script):");
console.log(`  git add VERSION backend/package.json frontend/package.json frontend/src/App.tsx documentacion/versiones/v${nextVersion}.md`);
console.log(`  git commit -m "Versión ${nextVersion}"`);
console.log(`  git tag v${nextVersion}`);
console.log(`  git push && git push origin v${nextVersion}`);
