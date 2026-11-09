import express from "express";
import { config } from "./config";
import { prisma } from "./db";
import { webhookRouter } from "./webhook";

const app = express();

// Guarda o corpo bruto: necessário para validar a assinatura X-Hub-Signature-256
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
);

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "db_unavailable" });
  }
});

app.use(webhookRouter);

app.listen(config.port, () => console.log(`Chatbot ASSEIT ouvindo na porta ${config.port}`));
