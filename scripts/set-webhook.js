// scripts/set-webhook.js
// Ejecutar localmente: node scripts/set-webhook.js
// Requiere BOT_TOKEN y WEBAPP_URL en el entorno (o en un .env cargado antes).
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL; // https://tu-dominio.vercel.app

if (!BOT_TOKEN || !WEBAPP_URL) {
  console.error('Faltan BOT_TOKEN o WEBAPP_URL en el entorno.');
  process.exit(1);
}

const url = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;
const webhookUrl = `${WEBAPP_URL}/api/bot`;

fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: webhookUrl }),
})
  .then((r) => r.json())
  .then((data) => console.log('Respuesta de Telegram:', data))
  .catch((err) => console.error('Error configurando webhook:', err));
