import { randomUUID } from "crypto";
import { Ticket, TicketStatus } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";

export const OPEN_STATUSES: TicketStatus[] = ["WAITING", "IN_PROGRESS"];

export async function findOpenTicket(contactId: number) {
  return prisma.ticket.findFirst({ where: { contactId, status: { in: OPEN_STATUSES } } });
}

export async function createTicket(params: {
  contactId: number;
  conversationId: number;
  reason: string;
  outsideHours: boolean;
}): Promise<{ ticket: Ticket; created: boolean }> {
  const existing = await findOpenTicket(params.contactId);
  if (existing) return { ticket: existing, created: false };

  const ticket = await prisma.$transaction(async (tx) => {
    const draft = await tx.ticket.create({ data: { protocol: randomUUID(), ...params } });
    const year = new Date().getFullYear();
    return tx.ticket.update({
      where: { id: draft.id },
      data: { protocol: `ASS-${year}-${String(draft.id).padStart(5, "0")}` },
    });
  });

  await audit("TICKET_CREATED", "bot", "Ticket", ticket.id, { reason: params.reason });
  return { ticket, created: true };
}

/** Posição na fila FIFO entre os chamados aguardando (1 = próximo). */
export async function queuePosition(ticket: Ticket): Promise<number> {
  const ahead = await prisma.ticket.count({
    where: { status: "WAITING", createdAt: { lt: ticket.createdAt } },
  });
  return ahead + 1;
}

export async function listQueue() {
  return prisma.ticket.findMany({
    where: { status: { in: OPEN_STATUSES } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { contact: true },
  });
}

/** Assume o chamado mais antigo em espera (FIFO). Seguro contra dois funcionários ao mesmo tempo. */
export async function claimNext(staff: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await prisma.ticket.findFirst({
      where: { status: "WAITING" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { contact: true },
    });
    if (!next) return null;
    const result = await prisma.ticket.updateMany({
      where: { id: next.id, status: "WAITING" },
      data: { status: "IN_PROGRESS", assignedTo: staff, assignedAt: new Date() },
    });
    if (result.count === 1) {
      await audit("TICKET_CLAIMED", staff, "Ticket", next.id);
      return next;
    }
  }
  return null;
}

export type TransitionResult =
  | { ok: true; ticket: Ticket & { contact: { phone: string } } }
  | { ok: false; reason: string };

async function transition(
  id: number,
  staff: string,
  from: TicketStatus[],
  to: TicketStatus,
): Promise<TransitionResult> {
  const current = await prisma.ticket.findUnique({ where: { id }, include: { contact: true } });
  if (!current) return { ok: false, reason: `Chamado #${id} não encontrado.` };

  const data: Record<string, unknown> = { status: to };
  if (to === "IN_PROGRESS") {
    data.assignedTo = staff;
    data.assignedAt = new Date();
  } else {
    data.completedAt = new Date();
  }

  const result = await prisma.ticket.updateMany({ where: { id, status: { in: from } }, data });
  if (result.count !== 1) {
    return { ok: false, reason: `Chamado #${id} está em ${current.status} e não pode ir para ${to}.` };
  }
  await audit(`TICKET_${to}`, staff, "Ticket", id);
  return { ok: true, ticket: { ...current, status: to } };
}

export const claimById = (id: number, staff: string) =>
  transition(id, staff, ["WAITING"], "IN_PROGRESS");
export const completeTicket = (id: number, staff: string) =>
  transition(id, staff, ["WAITING", "IN_PROGRESS"], "COMPLETED");
export const cancelTicket = (id: number, staff: string) =>
  transition(id, staff, ["WAITING", "IN_PROGRESS"], "CANCELLED");
