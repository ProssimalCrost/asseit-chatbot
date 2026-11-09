# Chatbot ASSEIT (WhatsApp Cloud API)

Node.js + TypeScript + Express + Prisma + PostgreSQL (Neon). Deploy no Render.

## Rodar localmente (sem Meta)
```bash
npm install
cp .env.example .env        # preencha DATABASE_URL e DIRECT_URL (Neon); mantenha DRY_RUN=true
npx prisma migrate dev --name init
npm run db:seed
npm run dev
npm run simulate -- 5531999999999 "oi"      # em outro terminal; respostas saem no console do servidor
```

## Deploy no Render
- Build: `npm install && npm run build`
- Start: `npx prisma migrate deploy && npm start`
- Variáveis: as do `.env.example`, com `DRY_RUN=false`.
- Webhook na Meta: `https://SEU-APP.onrender.com/webhook` + `WHATSAPP_VERIFY_TOKEN`.
  Assinar os campos `messages` e (coexistência) `smb_message_echoes`.

## Fila sem painel (proposta a validar)
Funcionários listados em `STAFF_PHONES` enviam comandos ao número do bot, de seus celulares:
`FILA`, `PROXIMO`, `ASSUMIR 12`, `CONCLUIR 12`, `CANCELAR 12`.
Se a coexistência entregar o evento de eco, a primeira resposta pelo app marca o chamado como `IN_PROGRESS`.
`CONCLUIR` é sempre explícito.

## Decisões assumidas (revisar)
- Fora do horário o bot registra o chamado para o próximo expediente (`bot_settings.offHoursTickets`).
- Com chamado aberto o bot fica em silêncio (só aceita MENU e SAIR; SAIR não cancela o protocolo).
- Conteúdos institucionais estão como `[PREENCHER]` em `bot_contents` (Pendência 3).
- Campos/eventos da coexistência (`smb_message_echoes`) e a versão da Graph API precisam ser conferidos na documentação atual da Meta.

## Ainda não feito
Testes automatizados, retenção/expurgo de mensagens (LGPD), envio de template após a janela de 24 h.
