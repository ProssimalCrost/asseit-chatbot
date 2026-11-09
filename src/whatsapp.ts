import { config } from "./config";

/** Envia texto pela Cloud API. Retorna o id da mensagem (wamid). */
export async function sendText(to: string, body: string): Promise<string | undefined> {
  if (config.dryRun) {
    console.log(`\n[DRY_RUN] → ${to}\n${body}\n`);
    return undefined;
  }

  const response = await fetch(
    `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body, preview_url: false },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Falha ao enviar mensagem (${response.status}): ${await response.text()}`);
  }
  const json = (await response.json()) as { messages?: { id: string }[] };
  return json.messages?.[0]?.id;
}
