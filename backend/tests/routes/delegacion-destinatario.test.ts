import { AppRole, ExtraHourStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/infra/prisma.js";
import { comoRol, crearAppDePrueba } from "../helpers/app.js";
import {
  crearEscenarioBasico,
  crearHoraExtra,
  limpiarEscenario,
  type EscenarioBasico,
} from "../helpers/datos.js";

/**
 * R-024 — A quién se puede **nombrar** delegado de aprobación.
 *
 * El bug que reportaron los usuarios: `POST /api/delegations` exigía que el
 * correo del delegado tuviera fila en `User`, y esa fila solo nace cuando la
 * persona inicia sesión por primera vez (aprovisionamiento JIT). Delegar en un
 * consultor recién dado de alta fallaba con un mensaje que sonaba a error de
 * tipeo aunque el correo estuviera bien escrito.
 *
 * El arreglo amplía **dónde se busca** a la persona (`User` o `Consultant`).
 * No amplía quién puede aprobar: eso lo comprueba el último caso de este mismo
 * archivo, y es lo que queda pendiente de la decisión D-13.
 */
describe("POST /api/delegations: a quién se puede nombrar delegado (R-024)", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  let pmEmail: string;
  /** Correos de `User` creados aquí, para borrarlos al final. */
  const usuariosCreados: string[] = [];

  const rangoVigente = () => ({
    startDate: new Date(Date.now() - 86_400_000).toISOString(),
    endDate: new Date(Date.now() + 86_400_000).toISOString(),
  });

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("deleg-dest");
    const proyecto = await prisma.project.findUniqueOrThrow({ where: { id: escenario.projectId } });
    pmEmail = proyecto.projectManagerEmail!;
  });

  afterAll(async () => {
    await prisma.approvalDelegation.deleteMany({ where: { projectId: escenario.projectId } });
    if (usuariosCreados.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: usuariosCreados } } });
    }
    await limpiarEscenario(escenario);
    await app.close();
  });

  it("deja delegar en un consultor que nunca ha iniciado sesión (el caso del bug)", async () => {
    // `consultorA` existe como ficha de consultor y **no** tiene fila en `User`:
    // es exactamente la situación que fallaba.
    const sinUsuario = await prisma.user.findUnique({ where: { email: escenario.consultorA.email } });
    expect(sinUsuario).toBeNull();

    const res = await app.inject({
      method: "POST",
      url: "/api/delegations",
      headers: comoRol(AppRole.PM, pmEmail),
      payload: {
        projectId: escenario.projectId,
        toUserEmail: escenario.consultorA.email,
        ...rangoVigente(),
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.toUserEmail).toBe(escenario.consultorA.email.toLowerCase());

    // Y quedó guardada de verdad, no solo contestada.
    const enBase = await prisma.approvalDelegation.findFirst({
      where: { projectId: escenario.projectId, toUserEmail: escenario.consultorA.email.toLowerCase() },
    });
    expect(enBase).not.toBeNull();
  });

  it("encuentra al consultor aunque su correo esté guardado con otras mayúsculas", async () => {
    // `Consultant.email` no es único ni está normalizado: la ficha pudo quedar
    // con el correo tal como lo escribió quien la dio de alta.
    const consultorMixto = await prisma.consultant.create({
      data: {
        fullName: `Consultor Mayúsculas ${escenario.prefijo}`,
        email: `Mixto.${escenario.prefijo}@Synaptica.TEST`,
        role: "Consultor",
        hourlyRate: 30,
        rateCurrency: "USD",
        country: "Colombia",
      },
    });

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/delegations",
        headers: comoRol(AppRole.PM, pmEmail),
        payload: {
          projectId: escenario.projectId,
          // El schema Zod lo pasa a minúscula; la ficha lo tiene en mixto.
          toUserEmail: consultorMixto.email!.toUpperCase(),
          ...rangoVigente(),
        },
      });

      expect(res.statusCode).toBe(201);
    } finally {
      await prisma.approvalDelegation.deleteMany({
        where: { toUserEmail: consultorMixto.email!.toLowerCase() },
      });
      await prisma.consultant.delete({ where: { id: consultorMixto.id } });
    }
  });

  it("sigue delegando en un usuario que existe en User pero no es consultor", async () => {
    const correo = `otro.pm.${escenario.prefijo}@synaptica.test`;
    await prisma.user.create({ data: { email: correo, displayName: "Otro PM" } });
    usuariosCreados.push(correo);

    const res = await app.inject({
      method: "POST",
      url: "/api/delegations",
      headers: comoRol(AppRole.PM, pmEmail),
      payload: {
        projectId: escenario.projectId,
        toUserEmail: correo,
        ...rangoVigente(),
      },
    });

    expect(res.statusCode).toBe(201);
  });

  it("sigue rechazando un correo que no existe en ningún lado", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/delegations",
      headers: comoRol(AppRole.PM, pmEmail),
      payload: {
        projectId: escenario.projectId,
        toUserEmail: `fantasma.${escenario.prefijo}@synaptica.test`,
        ...rangoVigente(),
      },
    });

    expect(res.statusCode).toBe(400);
    // El mensaje tiene que decir dónde se buscó, para que no parezca un error
    // de tipeo cuando el correo está bien escrito.
    expect(res.json().message).toContain("usuarios");
    expect(res.json().message).toContain("consultores");

    const enBase = await prisma.approvalDelegation.findFirst({
      where: { projectId: escenario.projectId, toUserEmail: { contains: "fantasma" } },
    });
    expect(enBase).toBeNull();
  });

  /**
   * El límite del arreglo, escrito como prueba para que nadie lo descubra tarde.
   *
   * Poder **ser nombrado** delegado y poder **aprobar** son cosas distintas:
   * `PATCH /api/extra-hours/:id/approve` lleva `authorize([ADMIN, PM])`, así que
   * un delegado cuyo único rol es `CONSULTANT` —el rol que el aprovisionamiento
   * JIT le dará cuando por fin inicie sesión— choca contra el guard antes de que
   * `canReviewExtraHour` llegue a mirar su delegación.
   *
   * Es deliberado: ampliar `authorize` cambiaría quién puede aprobar horas
   * extra, y eso no es una decisión de desarrollo (D-13 en `PENDIENTES.md`).
   */
  it("un delegado con rol CONSULTANT todavía NO puede aprobar: la delegación no amplía permisos", async () => {
    const delegacion = await prisma.approvalDelegation.create({
      data: {
        projectId: escenario.projectId,
        fromUserEmail: pmEmail,
        toUserEmail: escenario.consultorB.email.toLowerCase(),
        startDate: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 86_400_000),
      },
    });
    const entrada = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 5, 10)),
    });

    try {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/extra-hours/${entrada.id}/approve`,
        headers: comoRol(AppRole.CONSULTANT, escenario.consultorB.email),
      });

      expect(res.statusCode).toBe(403);

      const enBase = await prisma.extraHourEntry.findUniqueOrThrow({ where: { id: entrada.id } });
      expect(enBase.status).toBe(ExtraHourStatus.PENDING_PM);
    } finally {
      await prisma.approvalDelegation.delete({ where: { id: delegacion.id } });
    }
  });
});
