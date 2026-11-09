/**
 * Compatibilidad de `Project.company` tras el catálogo de empresas.
 *
 * Antes `company` era una columna de texto; ahora es la relación `Company`.
 * Los consumidores existentes (dashboard, portafolio, exportaciones, alertas...)
 * esperan el NOMBRE como string, así que al serializar toda respuesta se aplana:
 * cualquier clave `company` cuyo valor sea un objeto con `name` se reemplaza por
 * ese nombre y, si el objeto trae `id`, se agrega `companyId` al hermano.
 *
 * `Consultant.company` ya es un string, y los objetos `Company` del módulo de
 * empresas nunca viven bajo una clave `company`, así que no hay colisión.
 */
function esObjetoPlano(valor: unknown): valor is Record<string, unknown> {
  if (valor === null || typeof valor !== "object") return false;
  const proto = Object.getPrototypeOf(valor);
  return proto === Object.prototype || proto === null;
}

export function aplanarEmpresaDeProyecto<T>(valor: T): T {
  if (Array.isArray(valor)) {
    return valor.map((v) => aplanarEmpresaDeProyecto(v)) as unknown as T;
  }
  if (!esObjetoPlano(valor)) return valor;

  const salida: Record<string, unknown> = {};
  for (const [clave, v] of Object.entries(valor)) {
    if (clave === "company" && esObjetoPlano(v) && typeof v.name === "string") {
      salida.company = v.name;
      if (typeof v.id === "string" && salida.companyId === undefined && valor.companyId === undefined) {
        salida.companyId = v.id;
      }
    } else {
      salida[clave] = aplanarEmpresaDeProyecto(v);
    }
  }
  return salida as T;
}
