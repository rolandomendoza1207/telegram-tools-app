// api/bot.js
// Webhook del bot de Telegram, corriendo como función serverless en Vercel.
// Usa grammY. Vercel invoca este handler en cada POST que Telegram envíe
// a https://tu-dominio.vercel.app/api/bot
const { Bot, webhookCallback, InlineKeyboard } = require('grammy');
const { supabase } = require('./_supabase');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL; // ej: https://tu-dominio.vercel.app

if (!BOT_TOKEN) {
  console.warn('[bot] Falta BOT_TOKEN en variables de entorno');
}

const bot = new Bot(BOT_TOKEN);

bot.command('start', async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || null;

  // El payload viene como "/start 123456789" -> ctx.match
  const payload = ctx.match ? String(ctx.match).trim() : '';
  const refId = payload && /^\d+$/.test(payload) ? Number(payload) : null;

  try {
    const { error } = await supabase.rpc('register_user', {
      p_telegram_id: telegramId,
      p_username: username,
      p_ref_id: refId,
    });
    if (error) console.error('[register_user] error:', error);
  } catch (err) {
    console.error('[register_user] excepción:', err);
  }

  const keyboard = new InlineKeyboard().webApp(
    '🛠️ Abrir Herramientas',
    WEBAPP_URL
  );

  await ctx.reply(
    '👋 ¡Bienvenido!\n\n' +
      'Convierte imágenes (WEBP/PNG/JPG) y borra marcas de agua directamente ' +
      'desde tu navegador, gana puntos viendo anuncios y gana comisión por cada ' +
      'amigo que invites.\n\n' +
      'Pulsa el botón para comenzar 👇',
    { reply_markup: keyboard }
  );
});

bot.command('saldo', async (ctx) => {
  const { data, error } = await supabase
    .from('users')
    .select('points, total_referrals')
    .eq('telegram_id', ctx.from.id)
    .single();

  if (error || !data) {
    return ctx.reply('Aún no tienes una cuenta. Usa /start primero.');
  }
  await ctx.reply(
    `💰 Puntos: ${Number(data.points).toFixed(4)}\n👥 Referidos: ${data.total_referrals}`
  );
});

// Handler HTTP para Vercel (Node.js serverless function)
const handleUpdate = webhookCallback(bot, 'http');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('Bot webhook activo. Usa POST para actualizaciones de Telegram.');
    return;
  }
  try {
    await handleUpdate(req, res);
  } catch (err) {
    console.error('[webhook] error procesando update:', err);
    res.status(200).send('ok'); // Telegram no debe reintentar infinito
  }
};
