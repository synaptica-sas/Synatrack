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
 * D-13 — A quién se puede **nombrar** delegado de aprobación.
 *
 * Historia en dos pasos:
 *
 * 1. **R-024** (el bug): `POST /api/delegations` exigía que el correo del
 *    delegado tuviera fila en `User`, y esa fila solo nace cuando la persona
 *    inicia sesión por primera vez (aprovisionamiento JIT). El desplegable se
 *    rellenaba con consultores que casi nunca habían entrado, así que **el
 *    formulario ofrecía justo lo que el backend rechazaba**.
 * 2. **D-13** (la decisión): se arregló poder nombrar, pero el nombrado seguía
 *    sin poder aprobar, porque aprobar horas extra está reservado al PM del
 *    proyecto y al Administrador. El dueño del producto decidió **no ampliar
 *    permisos**: la delegación se restringe a quien ya es PM.
 *
 * Y "ser PM" significa **figurar como responsable de algún proyecto**
 * (`Project.projectManagerEmail`), no tener el rol en la cuenta — si fuera el
 * rol, volvería el bug del paso 1, porque el rol vive en una cuenta que no
 * existe hasta el primer inicio de sesión.
 *
 * Lo que estas pruebas tienen que sostener a la vez: que se puede delegar en un
 * PM que nunca ha entrado a la aplicación (paso 1 sigue arreglado), que no se
 * puede delegar en quien no es PM (paso 2), y que **los roles que pueden
 * aprobar no cambiaron** (el último bloque).
 */
describe("POST /api/delegations: a quién se puede nombrar delegado (R-024 + D-13)", () => {
  let app: FastifyInstance;
  let escenario: EscenarioBasico;
  let pmEmail: string;
  /** Correo del PM de OTRO proyecto: candidato válido que nunca ha iniciado sesión. */
  let pmAjenoEmail: string;
  let proyectoAjenoId: string;
  /** Ids de proyectos creados aquí, para borrarlos al final. */
  const proyectosCreados: string[] = [];
  /** Correos de `User` creados aquí, para borrarlos al final. */
  const usuariosCreados: string[] = [];

  const rangoVigente = () => ({
    startDate: new Date(Date.now() - 86_400_000).toISOString(),
    endDate: new Date(Date.now() + 86_400_000).toISOString(),
  });

  /** Crea un proyecto suelto con el PM indicado y lo deja apuntado para limpieza. */
  async function crearProyectoConPM(sufijo: string, managerEmail: string) {
    const proyecto = await prisma.project.create({
      data: {
        name: `Proyecto ${sufijo} ${escenario.prefijo}`,
        company: "Synaptica",
        country: "Colombia",
        currency: "USD",
        budget: 1000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: new Date(Date.UTC(2026, 11, 31)),
        projectManagerEmail: managerEmail,
      },
    });
    proyectosCreados.push(proyecto.id);
    return proyecto;
  }

  /** Crea una cuenta `User` con los roles indicados y la deja apuntada para limpieza. */
  async function crearUsuarioConRoles(correo: string, roles: AppRole[]) {
    const usuario = await prisma.user.create({ data: { email: correo, displayName: `Cuenta ${correo}` } });
    usuariosCreados.push(correo);
    for (const nombre of roles) {
      const rol = await prisma.role.upsert({
        where: { name: nombre },
        update: {},
        create: { name: nombre },
      });
      await prisma.userRole.create({ data: { userId: usuario.id, roleId: rol.id } });
    }
    return usuario;
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();
    escenario = await crearEscenarioBasico("deleg-dest");
    const proyecto = await prisma.project.findUniqueOrThrow({ where: { id: escenario.projectId } });
    pmEmail = proyecto.projectManagerEmail!;

    pmAjenoEmail = `pm.ajeno.${escenario.prefijo}@synaptica.test`;
    const ajeno = await crearProyectoConPM("Ajeno", pmAjenoEmail);
    proyectoAjenoId = ajeno.id;
  });

  afterAll(async () => {
    await prisma.approvalDelegation.deleteMany({
      where: { projectId: { in: [escenario.projectId, ...proyectosCreados] } },
    });
    if (usuariosCreados.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: usuariosCreados } } });
    }
    if (proyectosCreados.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: proyectosCreados } } });
    }
    await limpiarEscenario(escenario);
    await app.close();
  });

  // ── Quién SÍ puede ser nombrado ────────────────────────────────────────────

  it("deja delegar en el PM de otro proyecto aunque nunca haya iniciado sesión (el caso de R-024)", async () => {
    // Este es el corazón de la decisión: `pmAjenoEmail` es responsable de un
    // proyecto y **no** tiene fila en `User`, porque nunca ha entrado. Si la
    // regla mirara el rol de la cuenta en vez de `projectManagerEmail`, aquí
    // reaparecería el bug que R-024 vino a arreglar.
    const sinUsuario = await prisma.user.findUnique({ where: { email: pmAjenoEmail } });
    expect(sinUsuario).toBeNull();

    const res = await app.inject({
      method: "POST",
      url: "/api/delegations",
      headers: comoRol(AppRole.PM, pmEmail),
      payload: {
        projectId: escenario.projectId,
        toUserEmail: pmAjenoEmail,
        ...rangoVigente(),
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.toUserEmail).toBe(pmAjenoEmail);

    // Y quedó guardada de verdad, no solo contestada.
    const enBase = await prisma.approvalDelegation.findFirst({
      where: { projectId: escenario.projectId, toUserEmail: pmAjenoEmail },
    });
    expect(enBase).not.toBeNull();
    await prisma.approvalDelegation.delete({ where: { id: enBase!.id } });
  });

  it("vale ser PM de CUALQUIER proyecto, no solo de uno del delegante", async () => {
    // `proyectoAjenoId` no tiene nada que ver con el delegante: la regla es una
    // propiedad de la persona ("dirige proyectos"), no del proyecto delegado.
    // Exigir "PM de este proyecto" dejaría como único candidato al propio
    // delegante, porque un proyecto tiene un solo `projectManagerEmail`.
    const ajeno = await prisma.project.findUniqueOrThrow({ where: { id: proyectoAjenoId } });
    expect(ajeno.projectManagerEmail).toBe(pmAjenoEmail);
    expect(ajeno.id).not.toBe(escenario.projectId);

    const res = await app.inject({
      method: "POST",
      url: "/api/delegations",
      headers: comoRol(AppRole.PM, pmEmail),
      payload: { projectId: escenario.projectId, toUserEmail: pmAjenoEmail, ...rangoVigente() },
    });

    expect(res.statusCode).toBe(201);
    await prisma.approvalDelegation.delete({ where: { id: res.json().data.id } });
  });

  it("encuentra al PM aunque su correo esté guardado con otras mayúsculas", async () => {
    // `projectManagerEmail` es un campo de correo libre, no una relación: nadie
    // garantiza en qué mayúsculas se escribió.
    const correoMixto = `PM.Mixto.${escenario.prefijo}@Synaptica.TEST`;
    await crearProyectoConPM("Mixto", correoMixto);

    const res = await app.inject({
      method: "POST",
      url: "/api/delegations",
      headers: comoRol(AppRole.PM, pmEmail),
      payload: {
        projectId: escenario.projectId,
        // El schema Zod lo pasa a minúscula; el proyecto lo tiene en mixto.
        toUserEmail: correoMixto,
        ...rangoVigente(),
      },
    });

    expect(res.statusCode).toBe(201);
    await prisma.approvalDelegation.delete({ where: { id: res.json().data.id } });
  });

  it("deja delegar en una cuenta con rol ADMIN aunque no dirija ningún proyecto", async () => {
    // El Administrador puede aprobar cualquier hora extra sin delegación alguna,
    // así que rechazarlo sería negar una delegación que funcionaría. Es un
    // camino **añadido** al de `projectManagerEmail`, nunca el único: por eso no
    // reintroduce la dependencia de haber iniciado sesión.
    const correo = `admin.sin.proyectos.${escenario.prefijo}@synaptica.test`;
    await crearUsuarioConRoles(correo, [AppRole.ADMIN]);

    const sinProyecto = await prisma.project.findFirst({
      where: { projectManagerEmail: { equals: correo, mode: "insensitive" } },
    });
    expect(sinProyecto).toBeNull();

    const res = await app.inject({
      method: "POST",
      url: "/api/delegations",
      headers: comoRol(AppRole.PM, pmEmail),
      payload: { projectId: escenario.projectId, toUserEmail: correo, ...rangoVigente() },
    });

    expect(res.statusCode).toBe(201);
    await prisma.approvalDelegation.delete({ where: { id: res.json().data.id } });
  });

  // ── Quién NO puede ser nombrado ────────────────────────────────────────────

  it("rechaza a un consultor que no es PM de ningún proyecto, explicando el motivo", async () => {
    // Este es el cambio de D-13. `consultorA` existe como ficha de consultor
    // —antes bastaba con eso— pero no dirige proyectos, así que nombrarlo
    // produciría una delegación que no sirve para nada.
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

    expect(res.statusCode).toBe(400);
    // El mensaje tiene que dar el motivo real. Un "no existe" genérico es
    // exactamente el error que R-024 vino a corregir: la persona sí existe.
    const mensaje: string = res.json().message;
    expect(mensaje).toContain("no es PM");
    expect(mensaje).toContain("responsable");
    expect(mensaje).not.toContain("No hay nadie registrado");

    const enBase = await prisma.approvalDelegation.findFirst({
      where: { projectId: escenario.projectId, toUserEmail: escenario.consultorA.email.toLowerCase() },
    });
    expect(enBase).toBeNull();
  });

  it("rechaza una cuenta que existe en User pero sin rol que habilite", async () => {
    // Antes de D-13 esto pasaba por el solo hecho de existir en `User`.
    const correo = `cuenta.sin.rol.${escenario.prefijo}@synaptica.test`;
    await crearUsuarioConRoles(correo, []);

    const res = await app.inject({
      method: "POST",
      url: "/api/delegations",
      headers: comoRol(AppRole.PM, pmEmail),
      payload: { projectId: escenario.projectId, toUserEmail: correo, ...rangoVigente() },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("no es PM");
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
    expect(res.json().message).toContain("no es PM");

    const enBase = await prisma.approvalDelegation.findFirst({
      where: { projectId: escenario.projectId, toUserEmail: { contains: "fantasma" } },
    });
    expect(enBase).toBeNull();
  });

  // ── La lista que rellena el desplegable ────────────────────────────────────

  it("GET /candidates ofrece a los PM y no al consultor que el POST rechaza", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/delegations/candidates",
      headers: comoRol(AppRole.PM, pmEmail),
    });

    expect(res.statusCode).toBe(200);
    const correos: string[] = res.json().data.map((c: { email: string }) => c.email);

    expect(correos).toContain(pmAjenoEmail);
    expect(correos).toContain(pmEmail.toLowerCase());
    expect(correos).not.toContain(escenario.consultorA.email.toLowerCase());
    expect(correos).not.toContain(escenario.consultorB.email.toLowerCase());
  });

  it("cada candidato que ofrece la lista es aceptado por el POST (lista y validación no divergen)", async () => {
    // La causa de R-024 fue que el formulario ofrecía opciones que el backend
    // rechazaba. Esta prueba ata las dos puntas: se comprueba sobre los
    // candidatos de este escenario, que son los que controlamos.
    const res = await app.inject({
      method: "GET",
      url: "/api/delegations/candidates",
      headers: comoRol(AppRole.PM, pmEmail),
    });
    const candidatos: { email: string }[] = res
      .json()
      .data.filter((c: { email: string }) => c.email.includes(escenario.prefijo));

    expect(candidatos.length).toBeGreaterThan(0);

    for (const candidato of candidatos) {
      const alta = await app.inject({
        method: "POST",
        url: "/api/delegations",
        headers: comoRol(AppRole.PM, pmEmail),
        payload: { projectId: escenario.projectId, toUserEmail: candidato.email, ...rangoVigente() },
      });
      expect(alta.statusCode, `el candidato ${candidato.email} fue ofrecido pero rechazado`).toBe(201);
      await prisma.approvalDelegation.delete({ where: { id: alta.json().data.id } });
    }
  });

  // ── Lo que NO cambió: quién puede aprobar ──────────────────────────────────

  /**
   * El límite de todo esto, escrito como prueba para que nadie lo descubra tarde.
   *
   * Poder **ser nombrado** delegado y poder **aprobar** son cosas distintas:
   * `PATCH /api/extra-hours/:id/approve` lleva `authorize([ADMIN, PM])`, así que
   * un delegado cuyo único rol es `CONSULTANT` —el rol que el aprovisionamiento
   * JIT le dará cuando por fin inicie sesión— choca contra el guard antes de que
   * `canReviewExtraHour` llegue a mirar su delegación.
   *
   * D-13 decidió justamente eso: **no ampliar permisos**. Esta prueba y la
   * siguiente son el candado de esa decisión; si alguien toca el `authorize` de
   * la ruta de aprobación, fallan.
   */
  it("un delegado con rol CONSULTANT sigue sin poder aprobar: la delegación no amplía permisos", async () => {
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

  it("ni FINANCE ni VIEWER pueden aprobar con una delegación vigente: los roles son los mismos de antes", async () => {
    const delegacion = await prisma.approvalDelegation.create({
      data: {
        projectId: escenario.projectId,
        fromUserEmail: pmEmail,
        toUserEmail: pmAjenoEmail,
        startDate: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 86_400_000),
      },
    });

    try {
      for (const rol of [AppRole.FINANCE, AppRole.VIEWER]) {
        const entrada = await crearHoraExtra({
          consultantId: escenario.consultorA.id,
          projectId: escenario.projectId,
          fecha: new Date(Date.UTC(2026, 5, rol === AppRole.FINANCE ? 11 : 12)),
        });
        const res = await app.inject({
          method: "PATCH",
          url: `/api/extra-hours/${entrada.id}/approve`,
          headers: comoRol(rol, pmAjenoEmail),
        });
        expect(res.statusCode, `el rol ${rol} no debería poder aprobar`).toBe(403);

        const enBase = await prisma.extraHourEntry.findUniqueOrThrow({ where: { id: entrada.id } });
        expect(enBase.status).toBe(ExtraHourStatus.PENDING_PM);
      }
    } finally {
      await prisma.approvalDelegation.delete({ where: { id: delegacion.id } });
    }
  });

  it("y el camino que sí debe seguir funcionando: delegado con rol PM y delegación vigente aprueba", async () => {
    const delegacion = await prisma.approvalDelegation.create({
      data: {
        projectId: escenario.projectId,
        fromUserEmail: pmEmail,
        toUserEmail: pmAjenoEmail,
        startDate: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 86_400_000),
      },
    });
    const entrada = await crearHoraExtra({
      consultantId: escenario.consultorA.id,
      projectId: escenario.projectId,
      fecha: new Date(Date.UTC(2026, 5, 13)),
    });

    try {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/extra-hours/${entrada.id}/approve`,
        headers: comoRol(AppRole.PM, pmAjenoEmail),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe(ExtraHourStatus.APPROVED);
    } finally {
      await prisma.approvalDelegation.delete({ where: { id: delegacion.id } });
    }
  });
});
