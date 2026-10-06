import { AppRole } from "@prisma/client";
import { prisma } from "../../infra/prisma.js";

/**
 * Quién puede ser **nombrado** delegado de aprobación de horas extra (D-13).
 *
 * El dueño del producto decidió no ampliar permisos: únicamente aprueba el PM
 * relacionado con el proyecto, y la delegación se restringe a quien ya es PM en
 * vez de ofrecer consultores que nunca podrían aprobar. Este módulo es la
 * **única** definición de esa regla: la usan la validación de
 * `POST /api/delegations` y el listado que rellena el desplegable de la
 * pantalla, para que el formulario no vuelva a ofrecer lo que el backend
 * rechaza (que es justo el bug R-024).
 *
 * **Ser PM = figurar como responsable de algún proyecto**
 * (`Project.projectManagerEmail`), no tener el rol en la cuenta. La razón es la
 * misma que motivó R-024: el rol vive en `User`, y esa fila solo nace la primera
 * vez que la persona inicia sesión (aprovisionamiento JIT de `auth/guard.ts`).
 * Si la regla fuera "tener rol PM", un PM que todavía no ha entrado a la
 * aplicación no podría recibir una delegación — exactamente el bug recién
 * arreglado. Hoy, además, solo hay un usuario con rol en todo el sistema.
 *
 * **Por qué cuenta cualquier proyecto y no solo los del delegante.** Un proyecto
 * tiene un único `projectManagerEmail`, así que exigir "PM de este proyecto"
 * dejaría como único candidato al propio delegante y la funcionalidad no
 * existiría. Lo que se delega es una tarea de PM, y la persona capaz de hacerla
 * es quien ya dirige proyectos — normalmente **otros** proyectos, que es
 * precisamente el caso de un PM cubriendo a un compañero de vacaciones.
 *
 * **Por qué también vale el rol ADMIN o PM de la cuenta.** Es un camino
 * adicional, nunca el único. Un Administrador puede aprobar cualquier hora extra
 * sin delegación alguna (`canReviewExtraHour`), así que rechazarlo sería negar
 * una delegación que funcionaría perfectamente; y lo mismo vale para alguien con
 * rol PM a quien todavía no le han asignado un proyecto. Como es un camino
 * añadido al de `projectManagerEmail`, no reintroduce la dependencia de haber
 * iniciado sesión.
 */

const ROLES_QUE_HABILITAN = [AppRole.ADMIN, AppRole.PM];

/** Motivo por el que una persona aparece como candidata. */
export type MotivoCandidato = "PROYECTO" | "ROL";

export type CandidatoDelegacion = {
  /** Siempre en minúscula: es lo que se guarda en `ApprovalDelegation.toUserEmail`. */
  email: string;
  /** Nombre para mostrar; si no hay ficha ni cuenta, el propio correo. */
  nombre: string;
  motivo: MotivoCandidato;
  /** Nombres de los proyectos que dirige. Vacío cuando el motivo es `ROL`. */
  proyectos: string[];
};

/**
 * ¿Este correo puede recibir una delegación?
 *
 * Dos consultas acotadas en vez de construir la lista entera: la validación
 * corre en cada `POST` y solo necesita un sí o un no. La regla es la misma que
 * aplica `listarCandidatosDelegacion`, y hay una prueba que comprueba que las
 * dos coinciden.
 */
export async function esCandidatoDelegacion(email: string): Promise<boolean> {
  const correo = email.toLowerCase();

  // `projectManagerEmail` es un campo de correo libre, no una relación, y nadie
  // garantiza en qué mayúsculas se escribió: se compara sin distinguirlas, igual
  // que ya se hace con el correo del consultor.
  const [proyectoACargo, cuentaConRol] = await Promise.all([
    prisma.project.findFirst({
      where: { projectManagerEmail: { equals: correo, mode: "insensitive" } },
      select: { id: true },
    }),
    prisma.user.findFirst({
      where: {
        email: { equals: correo, mode: "insensitive" },
        active: true,
        roles: { some: { role: { name: { in: ROLES_QUE_HABILITAN } } } },
      },
      select: { id: true },
    }),
  ]);

  return Boolean(proyectoACargo ?? cuentaConRol);
}

/**
 * Todos los candidatos válidos, para rellenar el desplegable de la pantalla.
 *
 * Se deduplica por correo en minúscula y gana el motivo `PROYECTO`, que es el
 * que se puede explicar al usuario ("dirige X e Y").
 */
export async function listarCandidatosDelegacion(): Promise<CandidatoDelegacion[]> {
  const [proyectos, cuentasConRol] = await Promise.all([
    prisma.project.findMany({
      where: { projectManagerEmail: { not: null } },
      select: { name: true, projectManagerEmail: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        roles: { some: { role: { name: { in: ROLES_QUE_HABILITAN } } } },
      },
      select: { email: true, displayName: true },
    }),
  ]);

  const porCorreo = new Map<string, CandidatoDelegacion>();

  for (const proyecto of proyectos) {
    const correo = proyecto.projectManagerEmail?.trim().toLowerCase();
    if (!correo) continue;
    const existente = porCorreo.get(correo);
    if (existente) {
      existente.proyectos.push(proyecto.name);
    } else {
      porCorreo.set(correo, { email: correo, nombre: correo, motivo: "PROYECTO", proyectos: [proyecto.name] });
    }
  }

  for (const cuenta of cuentasConRol) {
    const correo = cuenta.email.toLowerCase();
    if (porCorreo.has(correo)) continue;
    porCorreo.set(correo, { email: correo, nombre: cuenta.displayName || correo, motivo: "ROL", proyectos: [] });
  }

  // Nombre para mostrar: la ficha de consultor o la cuenta, lo que haya. Un PM
  // que nunca ha iniciado sesión no tiene `User`, así que sin este paso el
  // desplegable mostraría solo correos.
  const correos = [...porCorreo.keys()];
  if (correos.length > 0) {
    const [consultores, usuarios] = await Promise.all([
      prisma.consultant.findMany({
        where: { email: { in: correos, mode: "insensitive" } },
        select: { email: true, fullName: true },
      }),
      prisma.user.findMany({
        where: { email: { in: correos, mode: "insensitive" } },
        select: { email: true, displayName: true },
      }),
    ]);

    for (const usuario of usuarios) {
      const candidato = porCorreo.get(usuario.email.toLowerCase());
      if (candidato && candidato.nombre === candidato.email && usuario.displayName) {
        candidato.nombre = usuario.displayName;
      }
    }
    // La ficha de consultor gana sobre el `displayName` de la cuenta: es el
    // nombre que Administración mantiene.
    for (const consultor of consultores) {
      const candidato = consultor.email ? porCorreo.get(consultor.email.toLowerCase()) : undefined;
      if (candidato && consultor.fullName) {
        candidato.nombre = consultor.fullName;
      }
    }
  }

  return [...porCorreo.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}
