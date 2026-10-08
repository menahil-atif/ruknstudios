# Rukn Studios webhook

The Vercel function at `/api/webhook` verifies ElevenLabs post-call webhook signatures and emails lead details over SMTP.

## Environment variables

- `ELEVENLABS_WEBHOOK_SECRET`: ElevenLabs webhook signing secret.
- `SMTP_HOST`: SMTP server hostname.
- `SMTP_PORT`: SMTP server port; port `465` uses TLS.
- `SMTP_USER`: SMTP username and email sender address.
- `SMTP_PASS`: SMTP password.
- `NOTIFY_TO`: notification recipient; defaults to `hello@ruknstudios.com`.

Copy `.env.example` to `.env` and fill in your values. Run `vercel dev` in one terminal, then run `npm run test:webhook` in another to send a signed sample event to `http://localhost:3000/api/webhook`.