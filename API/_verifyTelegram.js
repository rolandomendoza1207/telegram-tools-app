// api/_verifyTelegram.js
// Verifica la firma de initData enviada por la Mini App, según el
// algoritmo oficial de Telegram:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const crypto = require('crypto');

/**
 * Valida initData y devuelve el objeto `user` de Telegram si es válido.
 * Lanza un Error si la firma no coincide o initData expiró.
 *
 * @param {string} initData - string crudo enviado por Telegram.WebApp.initData
 * @param {string} botToken - token del bot (BOT_TOKEN)
 * @param {number} maxAgeSeconds - antigüedad máxima permitida (anti-replay)
 */
function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!initData || typeof initData !== 'string') {
    throw new Error('INIT_DATA_MISSING');
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('HASH_MISSING');
  params.delete('hash');

  // Orden alfabético de las claves restantes, formato key=value
  const dataCheckArr = [];
  for (const [key, value] of [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    dataCheckArr.push(`${key}=${value}`);
  }
  const dataCheckString = dataCheckArr.join('\n');

  // secret_key = HMAC_SHA256("WebAppData", bot_token)
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) {
    throw new Error('SIGNATURE_INVALID');
  }

  const authDate = Number(params.get('auth_date') || 0);
  const now = Math.floor(Date.now() / 1000);
  if (authDate && now - authDate > maxAgeSeconds) {
    throw new Error('INIT_DATA_EXPIRED');
  }

  const userRaw = params.get('user');
  const user = userRaw ? JSON.parse(userRaw) : null;
  if (!user || !user.id) throw new Error('USER_MISSING');

  return user;
}

module.exports = { verifyTelegramInitData };
