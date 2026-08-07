// api/reward.js
// POST { initData } -> valida la firma de Telegram y, si es válida,
// acredita puntos al usuario (y comisión a su referente) de forma
// atómica vía la función RPC credit_ad_reward en Supabase.
const { supabase } = require('./_supabase');
const { verifyTelegramInitData } = require('./_verifyTelegram');

module.exports = async (req, res) => {
  // CORS básico (la Mini App se sirve desde el mismo dominio, pero por si acaso)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { initData } = req.body || {};
    const user = verifyTelegramInitData(initData, process.env.BOT_TOKEN);

    const { data, error } = await supabase.rpc('credit_ad_reward', {
      p_telegram_id: user.id,
    });

    if (error) {
      const msg = error.message || '';
      if (msg.includes('COOLDOWN_ACTIVE')) {
        return res.status(429).json({ ok: false, error: 'COOLDOWN_ACTIVE' });
      }
      if (msg.includes('USER_NOT_FOUND')) {
        return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
      }
      console.error('[reward] rpc error:', error);
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('points')
      .eq('telegram_id', user.id)
      .single();

    return res.status(200).json({
      ok: true,
      credited: data,
      points: userRow ? Number(userRow.points) : null,
    });
  } catch (err) {
    console.error('[reward] error:', err.message);
    return res.status(401).json({ ok: false, error: err.message });
  }
};
