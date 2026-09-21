#!/usr/bin/env node
/**
 * Genera documentacion/MAPA_PROYECTO.md: un mapa navegable del proyecto
 * (tabla de endpoints con sus roles, mapa de pantallas del frontend y grafo de
 * dependencias entre carpetas).
 *
 * El objetivo es que una sesion nueva de Claude (o una persona nueva en el
 * equipo) entienda donde vive cada cosa leyendo UN archivo, en vez de hacer
 * decenas de greps sobre 80+ archivos.
 *
 * Uso:  node scripts/generate-map.mjs
 * Es idempotente: reejecutalo cada vez que agregues rutas o pantallas.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BACKEND_SRC = join(ROOT, "backend", "src");
const FRONTEND_SRC = join(ROOT, "frontend", "src");

// ─── utilidades ──────────────────────────────────────────────────────────────

function walk(dir, exts = [".ts", ".tsx"]) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      out.push(...walk(full, exts));
    } else if (exts.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

const posix = (p) => p.split(sep).join("/");

// ─── 1. Endpoints del backend ────────────────────────────────────────────────

/** Lee routes/index.ts y devuelve { nombreDeFuncion: prefijo }. */
function readPrefixes() {
  const src = readFileSync(join(BACKEND_SRC, "routes", "index.ts"), "utf8");
  const prefixes = {};
  const re = /app\.register\((\w+)(?:,\s*\{\s*prefix:\s*"([^"]+)"\s*\})?\)/g;
  let m;
  while ((m = re.exec(src))) prefixes[m[1]] = m[2] ?? "";
  return prefixes;
}

/** Extrae los endpoints declarados en un archivo *.routes.ts. */
function readEndpoints(file) {
  const src = readFileSync(file, "utf8");
  const fnMatch = src.match(/export async function (\w+)\(/);
  const fnName = fnMatch ? fnMatch[1] : null;

  const endpoints = [];
  // El cuerpo se captura con lookahead para NO consumirlo: si se consumiera,
  // lastIndex avanzaria por encima de las rutas siguientes y se perderian.
  const re = /app\.(get|post|put|patch|delete)\(\s*"([^"]*)"\s*,([\s\S]{0,500}?)async\s*\((?=([\s\S]{0,1200}))/g;
  let m;
  while ((m = re.exec(src))) {
    const [, method, path, between, body] = m;
    const rolesMatch = between.match(/authorize\(\[([^\]]*)\]/);
    let roles;
    if (rolesMatch) {
      roles = rolesMatch[1]
        .split(",")
        .map((r) => r.trim().replace("AppRole.", ""))
        .filter(Boolean);
    } else if (between.includes("authenticate")) {
      roles = ["(cualquier autenticado)"];
    } else if (/\bauthenticate\(request/.test(body)) {
      // Se autentica dentro del handler, no en un preHandler (ej. POST /api/fx/sync,
      // que acepta ademas un token de sistema para el cron job).
      const inner = body.match(/authorize\(\[([^\]]*)\]/);
      const innerRoles = inner
        ? inner[1].split(",").map((r) => r.trim().replace("AppRole.", "")).filter(Boolean).join(", ")
        : "autenticado";
      roles = [`${innerRoles} — auth dentro del handler`];
    } else {
      roles = ["PUBLICO"];
    }
    endpoints.push({ method: method.toUpperCase(), path, roles });
  }
  return { fnName, endpoints };
}

function buildApiTable() {
  const prefixes = readPrefixes();
  const files = walk(BACKEND_SRC).filter((f) => f.endsWith(".routes.ts"));
  const rows = [];

  for (const file of files.sort()) {
    const { fnName, endpoints } = readEndpoints(file);
    const prefix = fnName && fnName in prefixes ? prefixes[fnName] : "?";
    const rel = posix(relative(ROOT, file));
    for (const ep of endpoints) {
      const full = (prefix + ep.path).replace(/\/$/, "") || "/";
      rows.push({ method: ep.method, path: full, roles: ep.roles.join(", "), file: rel });
    }
  }

  rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  const lines = [
    "| Método | Ruta | Roles autorizados | Archivo |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.method} | \`${r.path}\` | ${r.roles} | [${r.file}](${r.file}) |`),
  ];
  return { table: lines.join("\n"), count: rows.length };
}

// ─── 2. Pantallas del frontend ───────────────────────────────────────────────

function buildTabsTable() {
  const app = readFileSync(join(FRONTEND_SRC, "App.tsx"), "utf8");

  const groups = [];
  const groupRe = /label:\s*"([^"]+)",\s*\n\s*tabs:\s*\[([\s\S]*?)\n\s*\],/g;
  let g;
  while ((g = groupRe.exec(app))) {
    const tabs = [];
    const tabRe = /\{\s*id:\s*"(\w+)",\s*label:\s*"([^"]+)",[^}]*?(?:permission:\s*"([^"]+)")?\s*\}/g;
    let t;
    while ((t = tabRe.exec(g[2]))) tabs.push({ id: t[1], label: t[2], permission: t[3] ?? "-" });
    groups.push({ label: g[1], tabs });
  }

  // Ubica el componente de cada tab dentro de features/
  const featureFiles = walk(FRONTEND_SRC).filter((f) => f.includes(`${sep}features${sep}`));

  const lines = ["| Grupo | Pantalla | TabId | Permiso | Componente |", "|---|---|---|---|---|"];
  for (const group of groups) {
    for (const tab of group.tabs) {
      // Prefiere el componente principal (<Algo>Tab.tsx) sobre los auxiliares
      // que viven en la misma carpeta de la feature.
      const inFeature = featureFiles.filter((f) =>
        posix(f).toLowerCase().includes(`/features/${tab.id.toLowerCase()}/`),
      );
      const guess =
        inFeature.find((f) => posix(f).toLowerCase().endsWith(`/${tab.id.toLowerCase()}tab.tsx`)) ??
        inFeature.find((f) => posix(f).toLowerCase().endsWith("tab.tsx")) ??
        inFeature[0];
      const comp = guess ? posix(relative(ROOT, guess)) : "-";
      const link = guess ? `[${comp}](${comp})` : "-";
      lines.push(`| ${group.label} | ${tab.label} | \`${tab.id}\` | \`${tab.permission}\` | ${link} |`);
    }
  }
  return { table: lines.join("\n"), count: groups.reduce((s, g) => s + g.tabs.length, 0) };
}

// ─── 3. Grafo de dependencias entre carpetas ─────────────────────────────────

/** Agrupa un archivo en un nodo del grafo (su carpeta significativa). */
function nodeOf(file, base) {
  const rel = posix(relative(base, file));
  const parts = rel.split("/");
  if (parts.length === 1) return parts[0].replace(/\.tsx?$/, "");
  if (parts[0] === "modules" || parts[0] === "features") return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

function buildGraph(base, title) {
  const files = walk(base);
  const edges = new Map();

  for (const file of files) {
    const from = nodeOf(file, base);
    const src = readFileSync(file, "utf8");
    const re = /from\s+"(\.[^"]+)"/g;
    let m;
    while ((m = re.exec(src))) {
      const target = join(dirname(file), m[1]);
      const to = nodeOf(target, base);
      if (to === from) continue;
      const key = `${from}|${to}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }

  const ids = new Map();
  const idOf = (name) => {
    if (!ids.has(name)) ids.set(name, `n${ids.size}`);
    return ids.get(name);
  };

  const sorted = [...edges.entries()].sort((a, b) => b[1] - a[1]);
  const lines = ["```mermaid", "graph LR"];
  for (const [key, weight] of sorted) {
    const [from, to] = key.split("|");
    lines.push(`  ${idOf(from)}["${from}"] -->|${weight}| ${idOf(to)}["${to}"]`);
  }
  lines.push("```");
  return { graph: lines.join("\n"), nodes: ids.size, edges: sorted.length, title };
}

// ─── Render ──────────────────────────────────────────────────────────────────

const api = buildApiTable();
const tabs = buildTabsTable();
const beGraph = buildGraph(BACKEND_SRC, "Backend");
const feGraph = buildGraph(FRONTEND_SRC, "Frontend");

const doc = `# Mapa del proyecto Synatrack

> **Archivo generado.** No lo edites a mano: corre \`node scripts/generate-map.mjs\`
> después de agregar rutas, pantallas o módulos.
> Generado el ${new Date().toISOString().slice(0, 10)}.

Resumen: **${api.count} endpoints**, **${tabs.count} pantallas**,
**${beGraph.nodes} módulos de backend** y **${feGraph.nodes} de frontend**.

---

## 1. Endpoints del backend

Los roles salen del \`authorize([...])\` real de cada ruta, que es lo que de verdad
protege el endpoint (el mapa de \`Permission\` en \`auth/roles.ts\` solo gobierna la UI).

${api.table}

---

## 2. Pantallas del frontend

El permiso es el que decide si la pestaña aparece en el sidebar.

${tabs.table}

---

## 3. Grafo de dependencias — Backend

Cada flecha va del módulo que importa al importado; el número es la cantidad de imports.

${beGraph.graph}

---

## 4. Grafo de dependencias — Frontend

${feGraph.graph}
`;

const out = join(ROOT, "documentacion", "MAPA_PROYECTO.md");
writeFileSync(out, doc, "utf8");
console.log(`Escrito ${posix(relative(ROOT, out))}`);
console.log(`  ${api.count} endpoints, ${tabs.count} pantallas`);
console.log(`  backend: ${beGraph.nodes} nodos / ${beGraph.edges} aristas`);
console.log(`  frontend: ${feGraph.nodes} nodos / ${feGraph.edges} aristas`);
