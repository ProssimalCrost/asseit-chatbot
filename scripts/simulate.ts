// Uso: npm run simulate -- 5531999999999 "oi"
// Envia um webhook assinado para o servidor local (use DRY_RUN=true para não chamar a Meta).
import "dotenv/config";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const [phone = "5531999999999", ...rest] = process.argv.slice(2);
const text = rest.join(" ") || "oi";

const startSimTime = new Date(Date.now() - 1000); // 1s de tolerância de relógio

const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{
    id: "WABA_ID",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        contacts: [{ wa_id: phone, profile: { name: "Associado Teste" } }],
        messages: [{
          from: phone,
          id: `wamid.SIM.${crypto.randomUUID()}`,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: text },
        }],
      },
    }],
  }],
});

const signature = "sha256=" + crypto.createHmac("sha256", process.env.WHATSAPP_APP_SECRET!).update(body).digest("hex");

async function main() {
  const res = await fetch(`http://localhost:${process.env.PORT ?? 3000}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
    body,
  });

  console.log(`HTTP ${res.status}`);
  if (!res.ok) return;

  // Aguarda o servidor processar a mensagem no banco
  await new Promise((resolve) => setTimeout(resolve, 600));

  const contact = await prisma.contact.findUnique({
    where: { phone },
    include: {
      conversations: {
        orderBy: { id: "desc" },
        take: 1,
        include: {
          messages: {
            where: {
              direction: { in: ["OUT_BOT", "OUT_HUMAN"] },
              createdAt: { gte: startSimTime },
            },
            orderBy: { id: "asc" },
          },
        },
      },
    },
  });

  const replies = contact?.conversations[0]?.messages ?? [];
  if (replies.length > 0) {
    console.log("\n--- [RESPOSTA DO BOT] ---");
    for (const reply of replies) {
      console.log(`\n${reply.body}\n`);
    }
    console.log("-------------------------\n");
  } else {
    // Se for funcionário ou se o bot ficou em silêncio por regra de chamado aberto
    console.log("\n(Verifique também o terminal do servidor 'npm run dev' caso seja comando de equipe ou bot em silêncio)\n");
  }
}

main()
  .catch((err) => {
    console.error("Erro na simulação:", err.message ?? err);
  })
  .finally(() => prisma.$disconnect());
