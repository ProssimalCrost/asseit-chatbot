import { prisma } from "./db";
import { HOURS_TEXT } from "./hours";
import { audit } from "./audit";
import { cancelTicket, claimById, claimNext, completeTicket, listQueue } from "./tickets";
import { normalize } from "./text";

const HELP =
  "*Comandos da secretaria*\n" +
  "FILA – lista os chamados abertos (mais antigo primeiro)\n" +
  "PROXIMO – assume o chamado mais antigo em espera\n" +
  "ASSUMIR 12 – assume o chamado #12\n" +
  "CONCLUIR 12 – conclui o chamado #12\n" +
  "CANCELAR 12 – cancela o chamado #12";

function link(phone: string) {
  return `https://wa.me/${phone}`;
}

function who(ticket: { contact: { phone: string; name: string | null } }) {
  return `${ticket.contact.name ?? "Sem nome"} (${link(ticket.contact.phone)})`;
}

/** Interpreta comandos enviados por funcionários autorizados (STAFF_PHONES). */
export async function handleStaffCommand(staffPhone: string, rawText: string): Promise<string> {
  const [command, arg] = normalize(rawText).split(" ");
  const id = arg ? Number(arg.replace("#", "")) : NaN;

  switch (command) {
    case "FILA": {
      const queue = await listQueue();
      if (queue.length === 0) return "Fila vazia. ✅";
      const lines = queue.map((t, i) => {
        const flag = t.status === "WAITING" ? "⏳" : `🟡 ${t.assignedTo ?? ""}`;
        const late = t.outsideHours ? " (fora do horário)" : "";
        return `${i + 1}. #${t.id} ${t.protocol} ${flag}${late}\n   ${who(t)} – ${t.reason}`;
      });
      return `*Fila (${queue.length})*\n${lines.join("\n")}`;
    }
    case "PROXIMO": {
      const ticket = await claimNext(staffPhone);
      if (!ticket) return "Nenhum chamado aguardando.";
      return `Você assumiu #${ticket.id} ${ticket.protocol}.\nCliente: ${who(ticket)}\nMotivo: ${ticket.reason}\nResponda pelo WhatsApp Business. Ao terminar: CONCLUIR ${ticket.id}`;
    }
    case "ASSUMIR":
    case "CONCLUIR":
    case "CANCELAR": {
      if (!Number.isInteger(id)) return `Informe o número do chamado. Exemplo: ${command} 12`;
      const action = command === "ASSUMIR" ? claimById : command === "CONCLUIR" ? completeTicket : cancelTicket;
      const result = await action(id, staffPhone);
      if (!result.ok) return result.reason;
      const contact = await prisma.contact.findUnique({ where: { id: result.ticket.contactId } });
      const label = command === "ASSUMIR" ? "assumido" : command === "CONCLUIR" ? "concluído" : "cancelado";
      return `Chamado #${id} ${label}.${command === "ASSUMIR" && contact ? `\nCliente: ${link(contact.phone)}` : ""}`;
    }
    default:
      await audit("STAFF_UNKNOWN_COMMAND", staffPhone);
      return `${HELP}\n\nExpediente: ${HOURS_TEXT}.`;
  }
}
