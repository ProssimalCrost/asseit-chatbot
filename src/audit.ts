import { Prisma } from "@prisma/client";
import { prisma } from "./db";

export async function audit(
  action: string,
  actor: string,
  entity?: string,
  entityId?: number,
  meta?: Record<string, unknown>,
) {
  await prisma.auditLog.create({
    data: { action, actor, entity, entityId, meta: meta as Prisma.InputJsonValue | undefined },
  });
}
