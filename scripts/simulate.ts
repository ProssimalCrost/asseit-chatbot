// Uso: npm run simulate -- 5531999999999 "oi"
// Envia um webhook assinado para o servidor local (use DRY_RUN=true para não chamar a Meta).
import "dotenv/config";
import crypto from "crypto";

const [phone = "5531999999999", ...rest] = process.argv.slice(2);
const text = rest.join(" ") || "oi";

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

fetch(`http://localhost:${process.env.PORT ?? 3000}/webhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature },
  body,
}).then((r) => console.log("HTTP", r.status));
