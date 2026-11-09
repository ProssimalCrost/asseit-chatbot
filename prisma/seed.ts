import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PENDENTE = "[PREENCHER: conteúdo a ser fornecido pela secretaria]";
const APP =
  "Esse serviço é feito pelo aplicativo ASSEIT. Procure por *ASSEIT* na Play Store (Android) ou na App Store (iPhone). " +
  "Se precisar de ajuda, fale com a secretaria.";

const contents = [
  { key: "payments", title: "Mensalidades e pagamentos", body: `Segunda via de mensalidade e pagamentos: ${APP}` },
  { key: "hours", title: "Horários e instalações", body: PENDENTE },
  { key: "party_hall", title: "Salão de festas", body: `${PENDENTE}\n\nReservas: use o aplicativo ASSEIT ou fale com a secretaria.` },
  { key: "fields", title: "Campo society e quadra de areia", body: `Reservas: ${APP}` },
  { key: "invites", title: "Convites para visitantes", body: PENDENTE },
  { key: "schools_events", title: "Escolinhas esportivas e eventos", body: PENDENTE },
  { key: "dependents", title: "Recadastramento de dependentes", body: `Recadastramento: ${APP}` },
];

const menu = [
  { key: "1", label: "Segunda via de mensalidade e pagamentos", keywords: ["MENSALIDADE", "PAGAMENTO", "SEGUNDA VIA", "BOLETO"], contentKey: "payments" },
  { key: "2", label: "Horários das piscinas, saunas e instalações", keywords: ["HORARIO", "PISCINA", "SAUNA", "INSTALACAO", "INSTALACOES"], contentKey: "hours" },
  { key: "3", label: "Reserva do salão de festas", keywords: ["SALAO", "FESTA"], contentKey: "party_hall" },
  { key: "4", label: "Reserva do campo society e quadra de areia", keywords: ["CAMPO", "SOCIETY", "QUADRA"], contentKey: "fields" },
  { key: "5", label: "Convites para visitantes", keywords: ["CONVITE", "VISITANTE"], contentKey: "invites" },
  { key: "6", label: "Escolinhas esportivas e eventos", keywords: ["ESCOLINHA", "EVENTO"], contentKey: "schools_events" },
  { key: "7", label: "Recadastramento de dependentes", keywords: ["DEPENDENTE", "RECADASTRAMENTO"], contentKey: "dependents" },
  { key: "8", label: "Falar com a secretaria", keywords: ["SECRETARIA", "ATENDENTE"], contentKey: null },
];

async function main() {
  for (const c of contents) {
    // update vazio: não sobrescreve conteúdo já editado
    await prisma.botContent.upsert({ where: { key: c.key }, create: c, update: {} });
  }
  for (const [i, m] of menu.entries()) {
    await prisma.menuOption.upsert({
      where: { key: m.key },
      create: { ...m, action: m.contentKey ? "CONTENT" : "HANDOFF", sortOrder: i + 1 },
      update: {},
    });
  }
  // Decisão pendente (itens 3.1 x 3.3 do documento): fora do horário o bot registra o chamado para o próximo expediente?
  await prisma.botSetting.upsert({
    where: { key: "offHoursTickets" },
    create: { key: "offHoursTickets", value: true },
    update: {},
  });
  console.log("Seed concluído.");
}

main().finally(() => prisma.$disconnect());
