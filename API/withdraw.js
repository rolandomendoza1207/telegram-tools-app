// api/withdraw.js
// POST { initData, amount, payoutDetails } -> valida firma y crea una
// solicitud de retiro, descontando el saldo de forma atómica.
const { supabase } = require('./_supabase');
const { verifyTelegramInitData } = require('./_verifyTelegram');

const MIN_WITHDRAWAL = Number(process.env.MIN_WITHDRAWAL || 5.0);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { initData, amount, payoutDetails } = req.body || {};
    const user = verifyTelegramInitData(initData, process.env.BOT_TOKEN);

    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ ok: false, error: 'INVALID_AMOUNT' });
    }
    if (!payoutDetails || typeof payoutDetails !== 'string' || payoutDetails.trim().length < 3) {
      return res.status(400).json({ ok: false, error: 'INVALID_PAYOUT_DETAILS' });
    }

    const { data, error } = await supabase.rpc('request_withdrawal', {
      p_telegram_id: user.id,
      p_amount: parsedAmount,
      p_payout_details: payoutDetails.trim(),
      p_min_amount: MIN_WITHDRAWAL,
    });

    if (error) {
      const msg = error.message || '';
      if (msg.includes('BELOW_MINIMUM')) {
        return res.status(400).json({ ok: false, error: 'BELOW_MINIMUM', min: MIN_WITHDRAWAL });
      }
      if (msg.includes('INSUFFICIENT_BALANCE')) {
        return res.status(400).json({ ok: false, error: 'INSUFFICIENT_BALANCE' });
      }
      if (msg.includes('USER_NOT_FOUND')) {
        return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
      }
      console.error('[withdraw] rpc error:', error);
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }

    return res.status(200).json({ ok: true, transactionId: data });
  } catch (err) {
    console.error('[withdraw] error:', err.message);
    return res.status(401).json({ ok: false, error: err.message });
  }
};
