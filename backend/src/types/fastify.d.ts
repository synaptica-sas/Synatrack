import type { AppRole } from "@prisma/client";
import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: {
      id: string;
      email: string;
      displayName: string;
      roles: AppRole[];
      /**
       * Ficha de consultor enlazada a este usuario (`Consultant.userId`), si
       * tiene una. Reemplaza la comparación por email que hacía cada módulo.
       */
      consultantId: string | null;
    };
  }
}
