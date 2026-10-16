import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Prueba preventiva: ningún schema Zod de las rutas puede aceptar `createdBy` ni
 * `updatedBy`. La extensión de Prisma (`infra/prisma.ts`) respeta los valores
 * explícitos, así que un body que los traiga permitiría suplantar la autoría.
 *
 * Enfoque: se analiza el AST (compilador de TypeScript) de cada
 * `src/modules/**\/*.routes.ts` y se revisan las claves de los literales pasados
 * a `z.object / z.strictObject / z.looseObject` y a `.extend / .merge`. Al mirar
 * claves de esquema y no texto suelto, no molestan los usos legítimos de
 * `createdBy` en un `data:` de Prisma ni filtros como `changedBy` en audit.
 */
const RAIZ = join(__dirname, "..", "..", "modules");
const PROHIBIDAS = new Set(["createdBy", "updatedBy"]);
const CONSTRUCTORES = new Set(["object", "strictObject", "looseObject", "extend"]);

function archivosRoutes(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "__tests__" ? [] : archivosRoutes(ruta);
    return nombre.endsWith(".routes.ts") ? [ruta] : [];
  });
}

/** Devuelve "archivo:línea clave" por cada clave prohibida declarada en un schema Zod. */
export function clavesProhibidasEnSchemas(codigo: string, nombre = "x.routes.ts"): string[] {
  const fuente = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true);
  const hallazgos: string[] = [];

  const nombreDeClave = (p: ts.ObjectLiteralElementLike): string | null => {
    if (!p.name) return null;
    if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return p.name.text;
    return null;
  };

  const visitar = (nodo: ts.Node): void => {
    if (
      ts.isCallExpression(nodo) &&
      ts.isPropertyAccessExpression(nodo.expression) &&
      CONSTRUCTORES.has(nodo.expression.name.text)
    ) {
      const literal = nodo.arguments[0];
      if (literal && ts.isObjectLiteralExpression(literal)) {
        for (const p of literal.properties) {
          const clave = nombreDeClave(p);
          if (clave && PROHIBIDAS.has(clave)) {
            const { line } = fuente.getLineAndCharacterOfPosition(p.getStart());
            hallazgos.push(`${nombre}:${line + 1} ${clave}`);
          }
        }
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return hallazgos;
}

describe("schemas Zod de rutas no aceptan createdBy / updatedBy", () => {
  const archivos = archivosRoutes(RAIZ);

  it("encuentra los archivos de rutas", () => {
    expect(archivos.length).toBeGreaterThan(10);
  });

  it("ninguno declara createdBy/updatedBy dentro de un schema", () => {
    const hallazgos = archivos.flatMap((a) => clavesProhibidasEnSchemas(readFileSync(a, "utf8"), a));
    expect(hallazgos).toEqual([]);
  });

  it("el detector sí cazaría una violación (z.object, extend y claves entre comillas)", () => {
    const malo = `
      const a = z.object({ name: z.string(), createdBy: z.string() });
      const b = a.extend({ "updatedBy": z.string().optional() });
      const c = z.object({ changedBy: z.string() });
    `;
    const r = clavesProhibidasEnSchemas(malo);
    expect(r).toHaveLength(2);
    expect(r.join()).toContain("createdBy");
    expect(r.join()).toContain("updatedBy");
  });
});
