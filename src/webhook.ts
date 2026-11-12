import crypto from "crypto";
import { Request, Router } from "express";
import { Prisma } from "@prisma/client";
import { config } from "./config";
import { prisma } from "./db";
import { withLock } from "./lock";
import { sendText } from "./whatsapp";
import { handleCustomerMessage } from "./bot/engine";
import { handleStaffCommand } from "./staff";
import { audit } from "./audit";

export const webhookRouter = Router();

// Verificação inicial exigida pela Meta
webhookRouter.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const tokenOk = req.query["hub.verify_token"] === config.verifyToken;
  console.log(`[webhook GET] mode=${mode} tokenOk=${tokenOk} ua=${req.header("user-agent")}`);

  if (mode === "subscribe" && tokenOk) {
    return res.status(200).send(String(req.query["hub.challenge"]));
  }
  return res.sendStatus(403);
});

webhookRouter.post("/webhook", (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // responde rápido; o processamento segue em segundo plano
  processPayload(req.body).catch((err) => console.error("Erro ao processar webhook:", err));
});

function validSignature(req: Request): boolean {
  const header = req.header("x-hub-signature-256");
  const raw: Buffer | undefined = (req as any).rawBody;
  if (!header || !raw) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", config.appSecret).update(raw).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function processPayload(body: any) {
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change.value ?? {};

      if (change.field === "messages") {
        const names = new Map<string, string>(
          (value.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]),
        );
        for (const message of value.messages ?? []) {
          await register(message.id, "messages", message, () =>
            withLock(message.from, () => handleInbound(message, names.get(message.from))),
          );
        }
      }

      // Coexistência: mensagens enviadas pelos funcionários no app WhatsApp Business.
      // ⚠️ Nome do campo e formato do payload precisam ser confirmados no teste de coexistência.
      if (change.field === "smb_message_echoes") {
        for (const message of value.message_echoes ?? []) {
          await register(message.id, "smb_message_echoes", message, () =>
            withLock(message.to, () => handleEcho(message)),
          );
        }
      }
    }
  }
}

/** Registra o evento (deduplicação) e executa o tratamento. */
async function register(externalId: string, field: string, payload: unknown, run: () => Promise<void>) {
  try {
    await prisma.webhookEvent.create({
      data: { externalId, field, payload: payload as Prisma.InputJsonValue },
    });
  } catch (err: any) {
    if (err.code === "P2002") return; // evento duplicado: a Meta reenviou
    throw err;
  }

  try {
    await run();
    await prisma.webhookEvent.update({
      where: { externalId },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
  } catch (err: any) {
    console.error(`Falha no evento ${externalId}:`, err);
    await prisma.webhookEvent.update({
      where: { externalId },
      data: { status: "FAILED", error: String(err?.message ?? err).slice(0, 500) },
    });
  }
}

function extractText(message: any): string {
  if (message.type === "text") return message.text?.body ?? "";
  if (message.type === "interactive") {
    return message.interactive?.list_reply?.title ?? message.interactive?.button_reply?.title ?? "";
  }
  if (message.type === "button") return message.button?.text ?? "";
  return ""; // áudio, imagem etc.: tratado como não compreendido
}

async function handleInbound(message: any, profileName?: string) {
  const phone: string = message.from;
  const text = extractText(message);

  // Funcionários autorizados operam a fila por comandos
  if (config.staffPhones.has(phone)) {
    await sendText(phone, await handleStaffCommand(phone, text));
    return;
  }

  const contact = await prisma.contact.upsert({
    where: { phone },
    create: { phone, name: profileName },
    update: profileName ? { name: profileName } : {},
  });
  const conversation =
    (await prisma.conversation.findFirst({ where: { contactId: contact.id }, orderBy: { id: "desc" } })) ??
    (await prisma.conversation.create({ data: { contactId: contact.id } }));

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      waMessageId: message.id,
      direction: "IN",
      body: text || `[${message.type}]`,
    },
  });

  const replies = await handleCustomerMessage(contact, conversation, text);
  for (const reply of replies) {
    const waMessageId = await sendText(phone, reply);
    await prisma.message.create({
      data: { conversationId: conversation.id, waMessageId, direction: "OUT_BOT", body: reply },
    });
  }
}

/** Mensagem enviada por um funcionário no app: registra e marca o chamado como em atendimento. */
async function handleEcho(message: any) {
  const contact = await prisma.contact.findUnique({ where: { phone: message.to } });
  if (!contact) return;

  const existing = await prisma.message.findUnique({ where: { waMessageId: message.id } });
  if (existing) return; // já registrada como resposta do bot

  const conversation = await prisma.conversation.findFirst({
    where: { contactId: contact.id },
    orderBy: { id: "desc" },
  });
  if (!conversation) return;

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      waMessageId: message.id,
      direction: "OUT_HUMAN",
      body: message.text?.body ?? `[${message.type}]`,
    },
  });

  const claimed = await prisma.ticket.updateMany({
    where: { contactId: contact.id, status: "WAITING" },
    data: { status: "IN_PROGRESS", assignedTo: "app", assignedAt: new Date() },
  });
  if (claimed.count > 0) await audit("TICKET_AUTO_IN_PROGRESS", "app", "Contact", contact.id);
}
