import type { JornadaFila } from "../../services/api";

/** Hoy como `YYYY-MM-DD` en UTC (el backend resuelve vigencias en UTC). */
export function hoyIso(ahora: Date = new Date()): string {
  return ahora.toISOString().slice(0, 10);
}

export type FilaConEstado = JornadaFila & { estado: "vigente" | "futura" | "anterior" };

/**
 * Ordena las filas por clave (país o consultor) y fecha, y marca cuál rige hoy:
 * dentro de cada clave, la de mayor `validFrom` que no sea posterior a `hoy`.
 * Las fechas son texto `YYYY-MM-DD`, así que se comparan como texto.
 */
export function marcarVigencias(filas: JornadaFila[], hoy: string): FilaConEstado[] {
  const clave = (f: JornadaFila) => f.consultantId ?? f.country ?? "";
  const ordenadas = [...filas].sort(
    (a, b) => clave(a).localeCompare(clave(b), "es") || a.validFrom.localeCompare(b.validFrom),
  );
  const vigenteId = new Map<string, string>();
  for (const f of ordenadas) {
    if (f.validFrom <= hoy) vigenteId.set(clave(f), f.id);
  }
  return ordenadas.map((f) => ({
    ...f,
    estado: f.validFrom > hoy ? "futura" : vigenteId.get(clave(f)) === f.id ? "vigente" : "anterior",
  }));
}

export type Umbrales = { under: string; over: string };

/** Valida los umbrales de capacity: `0 <= under < over <= 300`. Devuelve el error o `null`. */
export function validarUmbrales({ under, over }: Umbrales): string | null {
  const u = Number(under.replace(",", "."));
  const o = Number(over.replace(",", "."));
  if (under.trim() === "" || over.trim() === "" || !Number.isFinite(u) || !Number.isFinite(o)) {
    return "Indica ambos umbrales como números.";
  }
  if (u < 0 || o > 300) return "Los umbrales deben estar entre 0 y 300 %.";
  if (u >= o) return "El umbral de subutilizado debe ser menor que el de sobreasignado.";
  return null;
}
