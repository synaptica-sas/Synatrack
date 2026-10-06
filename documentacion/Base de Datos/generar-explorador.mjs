// Genera explorador-esquema.html a partir de backend/prisma/schema.prisma.
// Uso (desde la raíz del repo): node "documentacion/Base de Datos/generar-explorador.mjs"
// Volver a ejecutarlo cada vez que cambie el esquema. No necesita dependencias.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, "../..");
const esquema = path.join(raiz, "backend/prisma/schema.prisma");
const plantilla = path.join(aqui, "explorador.template.html");
const salida = path.join(aqui, "explorador-esquema.html");

// ─── Parser de schema.prisma ──────────────────────────────────────────────────

function parsearEsquema(texto) {
  const enums = {};
  const models = {};
  let cur = null, kind = null, pending = [], comentarioPrevio = [];

  // Devuelve el contenido entre paréntesis de un atributo, respetando anidamiento.
  function argDe(attrs, nombre) {
    const i = attrs.indexOf(nombre + "(");
    if (i < 0) return null;
    let depth = 0, j = i + nombre.length;
    for (; j < attrs.length; j++) {
      if (attrs[j] === "(") depth++;
      else if (attrs[j] === ")") { depth--; if (depth === 0) break; }
    }
    return attrs.slice(i + nombre.length + 1, j);
  }
  const lista = (s) => (s.match(/\[([^\]]*)\]/)?.[1] || "").split(",").map((x) => x.trim().replace(/\(.*\)/, "")).filter(Boolean);

  for (const raw of texto.split(/\r?\n/)) {
    const line = raw.trim();
    if (!cur) {
      let m;
      if ((m = line.match(/^(enum|model)\s+(\w+)\s*\{/))) {
        kind = m[1];
        cur = m[2];
        if (kind === "enum") enums[cur] = { name: cur, values: [], note: comentarioPrevio.join(" ") };
        else models[cur] = { name: cur, note: comentarioPrevio.join(" "), fields: [], indexes: [], uniques: [], pk: null };
        comentarioPrevio = []; pending = [];
      } else if (line.startsWith("//")) {
        const t = line.replace(/^\/\/\/?\s?/, "");
        // Los separadores de sección ("// ─── FX ───") no describen al modelo siguiente.
        if (/^─/.test(t)) comentarioPrevio = []; else comentarioPrevio.push(t);
      } else if (!line) comentarioPrevio = [];
      continue;
    }
    if (line === "}") { cur = null; continue; }
    if (!line) { pending = []; continue; }
    if (line.startsWith("//")) { pending.push(line.replace(/^\/\/\/?\s?/, "")); continue; }
    const [code, ...cm] = line.split(/\s\/\/\/?\s?/);
    const note = [...pending, cm.join(" ").trim()].filter(Boolean).join(" ");
    pending = [];
    if (kind === "enum") { enums[cur].values.push({ v: code.trim(), note }); continue; }
    const M = models[cur];
    if (code.startsWith("@@")) {
      const campos = lista(code);
      if (code.startsWith("@@index")) M.indexes.push(campos);
      else if (code.startsWith("@@unique")) M.uniques.push(campos);
      else if (code.startsWith("@@id")) M.pk = campos;
      continue;
    }
    const m = code.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
    if (!m) continue;
    const [, name, type, arr, opt, attrs] = m;
    const f = { name, type, list: !!arr, optional: !!opt, note };
    if (/@id\b/.test(attrs)) f.id = true;
    if (/@unique\b/.test(attrs)) f.unique = true;
    if (/@updatedAt\b/.test(attrs)) f.updatedAt = true;
    const def = argDe(attrs, "@default"); if (def !== null) f.default = def;
    const db = attrs.match(/@db\.(\w+)(\(([^)]*)\))?/); if (db) f.db = db[1] + (db[2] || "");
    const rel = argDe(attrs, "@relation");
    if (rel !== null) {
      f.relation = { fields: lista(rel.match(/fields:\s*\[[^\]]*\]/)?.[0] || ""), onDelete: rel.match(/onDelete:\s*(\w+)/)?.[1] || null };
    }
    M.fields.push(f);
  }

  // Las relaciones salen de los campos con @relation(fields: ...); los campos de
  // relación inversos (listas de hijos) no son columnas y se descartan.
  const nombres = new Set(Object.keys(models));
  const relations = [];
  for (const M of Object.values(models)) {
    for (const f of M.fields) {
      if (nombres.has(f.type)) f.isRelation = true;
      if (f.relation && f.relation.fields.length) {
        const fk = M.fields.find((x) => x.name === f.relation.fields[0]);
        relations.push({
          from: M.name, fk: f.relation.fields[0], to: f.type, optional: f.optional,
          // Valor por defecto de Prisma cuando no se declara onDelete.
          onDelete: f.relation.onDelete || (f.optional ? "SetNull" : "Restrict"),
          unique: !!fk?.unique,
        });
      }
    }
    M.fields = M.fields.filter((f) => !f.isRelation);
  }
  return { models, enums, relations };
}

// ─── Parser del DDL de Supabase (salida de `supabase db dump`) ────────────────

// Toma el ddl_supabase_AAAA-MM-DD.sql más reciente de esta carpeta, si existe,
// para que el explorador marque qué difiere entre el código y la base real.
function parsearDDL() {
  const archivos = fs.readdirSync(aqui).filter((f) => /^ddl_supabase_\d{4}-\d{2}-\d{2}\.sql$/.test(f)).sort();
  if (!archivos.length) return null;
  const archivo = archivos[archivos.length - 1];
  const texto = fs.readFileSync(path.join(aqui, archivo), "utf8").replace(/\r/g, "");
  const stmts = texto.split("\n").filter((l) => !l.startsWith("--")).join("\n")
    .split(/;\s*\n/).map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
  const tables = {}, enums = [], rls = new Set();
  let anonGrants = 0;
  for (const s of stmts) {
    let m;
    if ((m = s.match(/^CREATE TYPE "public"\."(\w+)" AS ENUM/))) enums.push(m[1]);
    else if ((m = s.match(/^CREATE TABLE (?:IF NOT EXISTS )?"public"\."(\w+)" \((.*)\)$/))) {
      const cols = {};
      let depth = 0, cur = "";
      const partes = [];
      for (const ch of m[2]) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) { partes.push(cur); cur = ""; } else cur += ch;
      }
      partes.push(cur);
      for (const p of partes.map((x) => x.trim().replace(/"public"\./g, "").replace(/"/g, ""))) {
        const c = p.match(/^(\w+) (.*?)(?: DEFAULT .*?)?( NOT NULL)?$/);
        if (!c) continue;
        cols[c[1]] = { type: c[2].replace(" without time zone", "").replace(/\s/g, ""), notNull: !!c[3] };
      }
      tables[m[1]] = cols;
    } else if ((m = s.match(/^ALTER TABLE (?:ONLY )?"public"\."(\w+)" ENABLE ROW LEVEL SECURITY/))) rls.add(m[1]);
    else if (/^GRANT .* ON TABLE "public"\."\w+" TO "anon"/.test(s)) anonGrants++;
  }
  return { file: archivo, date: archivo.slice(13, 23), tables, enums, rls: [...rls], anonGrants };
}

// ─── Generación ───────────────────────────────────────────────────────────────

const datos = parsearEsquema(fs.readFileSync(esquema, "utf8"));
datos.supabase = parsearDDL();
let commit = "desconocido";
try { commit = execSync("git rev-parse --short HEAD", { cwd: raiz }).toString().trim(); } catch {}
const fecha = new Date().toISOString().slice(0, 10);

const cuerpo = fs.readFileSync(plantilla, "utf8")
  .replace("/*__SCHEMA__*/null", JSON.stringify(datos).replace(/</g, "\\u003c"))
  .replace("__COMMIT__", commit)
  .replace("__FECHA__", fecha);

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${cuerpo}
</body>
</html>
`;
fs.writeFileSync(salida, html);
console.log(`explorador-esquema.html generado: ${Object.keys(datos.models).length} tablas, ${Object.keys(datos.enums).length} enums, ${datos.relations.length} relaciones (commit ${commit}).`);
console.log(datos.supabase ? `Comparado con ${datos.supabase.file}.` : "Sin DDL de Supabase en la carpeta: no se compara con la base real.");
