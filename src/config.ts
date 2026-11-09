import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
  appSecret: required("WHATSAPP_APP_SECRET"),
  accessToken: required("WHATSAPP_ACCESS_TOKEN"),
  phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
  graphVersion: process.env.GRAPH_API_VERSION ?? "v23.0",
  staffPhones: new Set(
    (process.env.STAFF_PHONES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  ),
  privacyUrl: process.env.PRIVACY_URL ?? "",
  dryRun: process.env.DRY_RUN === "true",
  timeZone: "America/Sao_Paulo",
};
