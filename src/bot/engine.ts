import type { Contact, Conversation } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { normalize } from "../text";
import { HOURS_TEXT, isOpenNow } from "../hours";
import { createTicket, findOpenTicket, queuePosition } from "../tickets";
import { getSetting } from "../settings";

// Palavras-chave já normalizadas (maiúsculas, sem acento). Podem ser sobrescritas em bot_settings.
const DEFAULT_SENSITIVE_KEYWORDS = [
  "INADIMPLENCIA", "INADIMPLENTE", "CANCELAMENTO DE TITULO", "CANCELAR TITULO",
  "CONTESTACAO", "CONTESTAR", "ACIDENTE", "INFRACAO", "DISCIPLINAR", "SUSPENSAO",
  "ORCAMENTO", "EVENTO CORPORATIVO", "DIRETORIA", "ESTATUTO",
];
const PRIVACY_KEYWORDS = ["LGPD", "PRIVACIDADE", "MEUS DADOS", "EXCLUIR MEUS DADOS", "APAGAR MEUS DADOS"];
const HUMAN_WORDS = new Set(["ATENDENTE", "OPERADOR", "PESSOA", "SECRETARIA", "HUMANO"]);
const GREETINGS = ["OI", "OLA", "BOM DIA", "BOA TARDE", "BOA NOITE"];

const FOOTER = "\n\nDigite *MENU* para voltar ao menu ou *ATENDENTE* para falar com a secretaria.";

async function menuText(): Promise<string> {
  const options = await prisma.menuOption.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const lines = options.map((o) => `${o.key}. ${o.label}`).join("\n");
  return `*Menu principal*\n${lines}\n\nResponda com o número da opção.\nComandos: MENU, VOLTAR, ATENDENTE, SAIR.`;
}

function privacyNotice(): string {
  const link = config.privacyUrl ? `\nPolítica de privacidade do clube: ${config.privacyUrl}` : "";
  return (
    "Olá! Sou o assistente virtual da secretaria do Clube ASSEIT. " +
    "Usamos seu telefone e suas mensagens apenas para prestar este atendimento." +
    link
  );
}

async function setState(conversation: Conversation, state: string, failCount = 0) {
  await prisma.conversation.update({ where: { id: conversation.id }, data: { state, failCount } });
}

async function handoff(
  contact: Contact,
  conversation: Conversation,
  reason: string,
): Promise<string[]> {
  const open = await isOpenNow();
  const offHoursTickets = await getSetting<boolean>("offHoursTickets", true);

  if (!open && !offHoursTickets) {
    return [
      `A secretaria atende ${HOURS_TEXT}. No momento estamos fora desse horário. ` +
        "Escreva novamente durante o expediente ou use o aplicativo ASSEIT para o que for possível.",
    ];
  }

  const { ticket, created } = await createTicket({
    contactId: contact.id,
    conversationId: conversation.id,
    reason,
    outsideHours: !open,
  });
  await setState(conversation, "MENU");

  if (!created) {
    return [`Você já tem um atendimento em andamento, protocolo *${ticket.protocol}*. Aguarde o retorno da secretaria por aqui.`];
  }
  if (open) {
    const position = await queuePosition(ticket);
    return [
      `Certo! Registrei seu atendimento com o protocolo *${ticket.protocol}* (posição ${position} na fila). ` +
        "Um atendente da secretaria continuará a conversa por aqui.",
    ];
  }
  return [
    `Registrei seu atendimento com o protocolo *${ticket.protocol}*. ` +
      `A secretaria atende ${HOURS_TEXT}. Seu chamado ficará na fila e será retomado no próximo período de atendimento.`,
  ];
}

async function privacyRequest(contact: Contact, conversation: Conversation, text: string) {
  await prisma.privacyRequest.create({ data: { contactId: contact.id, note: text.slice(0, 500) } });
  const replies = await handoff(contact, conversation, "PRIVACIDADE");
  return [
    "Sua solicitação sobre dados pessoais foi registrada e será encaminhada ao responsável pelo tratamento de dados do clube.",
    ...replies,
  ];
}

/** Decide o que o bot responde. Retorna a lista de mensagens a enviar (pode ser vazia = silêncio). */
export async function handleCustomerMessage(
  contact: Contact,
  conversation: Conversation,
  rawText: string,
): Promise<string[]> {
  const text = normalize(rawText);
  const replies: string[] = [];

  if (!contact.privacyNoticeSentAt) {
    replies.push(privacyNotice());
    await prisma.contact.update({ where: { id: contact.id }, data: { privacyNoticeSentAt: new Date() } });
  }

  // Com chamado aberto, o bot fica em silêncio para não atrapalhar o funcionário.
  const openTicket = await findOpenTicket(contact.id);
  if (openTicket) {
    if (text === "SAIR") {
      await setState(conversation, "ENDED");
      return [...replies, `Atendimento automatizado encerrado. Seu protocolo *${openTicket.protocol}* continua aberto.`];
    }
    if (text === "MENU") {
      await setState(conversation, "MENU");
      return [...replies, await menuText()];
    }
    return replies;
  }

  // Comandos globais
  if (text === "SAIR") {
    await setState(conversation, "ENDED");
    return [...replies, "Atendimento automatizado encerrado. Quando precisar, é só enviar uma mensagem. 👋"];
  }
  if (text === "MENU" || text === "VOLTAR") {
    await setState(conversation, "MENU");
    return [...replies, await menuText()];
  }

  // Gatilhos de encaminhamento
  if (text === "ATENDENTE" || text.split(" ").some((w) => HUMAN_WORDS.has(w)) || text.includes("FALAR COM")) {
    return [...replies, ...(await handoff(contact, conversation, "SOLICITADO_PELO_USUARIO"))];
  }
  if (PRIVACY_KEYWORDS.some((k) => text.includes(k))) {
    return [...replies, ...(await privacyRequest(contact, conversation, rawText))];
  }
  const sensitive = await getSetting<string[]>("sensitiveKeywords", DEFAULT_SENSITIVE_KEYWORDS);
  if (sensitive.some((k) => text.includes(k))) {
    return [...replies, ...(await handoff(contact, conversation, "ASSUNTO_SENSIVEL_OU_FORA_DO_ESCOPO"))];
  }

  // Primeira mensagem, retorno após SAIR ou simples saudação: mostra o menu sem contar como erro.
  if (conversation.state === "NEW" || conversation.state === "ENDED" || GREETINGS.some((g) => text.startsWith(g))) {
    await setState(conversation, "MENU");
    return [...replies, await menuText()];
  }

  // Opções do menu
  const options = await prisma.menuOption.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const option = options.find((o) => o.key === text || o.keywords.some((k) => text.includes(k)));

  if (option) {
    if (option.action === "HANDOFF") {
      return [...replies, ...(await handoff(contact, conversation, "MENU_SECRETARIA"))];
    }
    const content = option.contentKey
      ? await prisma.botContent.findUnique({ where: { key: option.contentKey } })
      : null;
    await setState(conversation, "CONTENT");
    const body = content ? `*${content.title}*\n\n${content.body}` : "Conteúdo ainda não cadastrado.";
    return [...replies, body + FOOTER];
  }

  // Incompreensão: 1ª = tenta de novo; 2ª consecutiva = encaminha
  const failCount = conversation.failCount + 1;
  if (failCount >= 2) {
    return [...replies, ...(await handoff(contact, conversation, "DUAS_INCOMPREENSOES"))];
  }
  await setState(conversation, "MENU", failCount);
  return [...replies, "Não entendi. Tente novamente ou escolha uma opção do menu.", await menuText()];
}
