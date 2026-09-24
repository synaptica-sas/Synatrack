import { AppRole } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../infra/prisma.js";

/**
 * El timesheet y el tracker son personales: siempre registran horas a nombre
 * de "yo". La identidad de login vive en `User` (correo de Azure AD) mientras
 * que las horas cuelgan de `Consultant`, y el unico puente entre ambos es el
 * correo -- igual que hace el modulo de actividades.
 *
 * Devuelve el consultor del usuario autenticado, o null si su correo no
 * corresponde a ninguno (por ejemplo un FINANCE que nunca carga horas).
 */
export async function findMyConsultant(request: FastifyRequest) {
  const email = request.authUser?.email;
  if (!email) return null;

  return prisma.consultant.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
}

/**
 * Resuelve sobre qué consultor puede operar la petición.
 *
 * Un ADMIN o PM puede cargar horas a nombre de otro pasando `consultantId`; es
 * un flujo legítimo de la PMO. Cualquier otro rol queda atado a su propio
 * consultor.
 *
 * Cuando alguien sin ese permiso pide el id de otra persona se devuelve un
 * error, **no** se reasigna en silencio a sí mismo: rebajar la petición sin
 * avisar hace creer que se registraron las horas del compañero cuando en
 * realidad se registraron las propias. Omitir el campo sí resuelve al consultor
 * propio, que es como lo usan el timesheet y el cronómetro.
 */
export async function resolveTargetConsultantId(
  request: FastifyRequest,
  requestedConsultantId?: string | null,
): Promise<{ consultantId: string } | { error: string }> {
  const roles = request.authUser?.roles ?? [];
  const canActForOthers = roles.includes(AppRole.ADMIN) || roles.includes(AppRole.PM);

  if (canActForOthers && requestedConsultantId) {
    const exists = await prisma.consultant.findUnique({
      where: { id: requestedConsultantId },
      select: { id: true },
    });
    if (!exists) return { error: "El consultor indicado no existe" };
    return { consultantId: exists.id };
  }

  const mine = await findMyConsultant(request);
  if (!mine) {
    return {
      error: `No hay un consultor asociado al correo ${request.authUser?.email ?? ""}, así que no se pueden registrar horas a tu nombre. Pide a un administrador que cree tu ficha de consultor.`,
    };
  }

  if (requestedConsultantId && requestedConsultantId !== mine.id) {
    return { error: "Solo puedes registrar horas a tu propio nombre." };
  }

  return { consultantId: mine.id };
}

export type ActivityResolution =
  | { ok: true; activityId: string | null }
  | { ok: false; error: string };

/**
 * Valida que la actividad exista y pertenezca al consultor sobre el que se
 * está imputando: una tarea del timesheet o del tracker solo puede apuntar a
 * una actividad propia.
 *
 * No enviar actividad es válido -- la descripción libre basta -- y devuelve
 * `activityId: null`.
 */
export async function resolveActivityId(
  activityId: string | null | undefined,
  consultantId: string,
): Promise<ActivityResolution> {
  if (!activityId) return { ok: true, activityId: null };

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { id: true, consultantId: true },
  });

  if (!activity || activity.consultantId !== consultantId) {
    return { ok: false, error: "La actividad indicada no existe o no pertenece a ese consultor" };
  }

  return { ok: true, activityId: activity.id };
}

/**
 * Las horas no se pueden tocar en un mes ya cerrado contablemente. Misma regla
 * que aplica el alta manual de horas.
 */
export async function isMonthClosed(projectId: string, workDate: Date) {
  const year = workDate.getUTCFullYear();
  const month = workDate.getUTCMonth() + 1;

  const snapshot = await prisma.monthlySnapshot.findUnique({
    where: { projectId_year_month: { projectId, year, month } },
  });

  return snapshot ? { year, month } : null;
}
