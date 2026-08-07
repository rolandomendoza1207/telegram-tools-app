# Telegram Mini App — Herramientas de Imagen + Referidos + Monetag

Mini App 100% gratuita: convierte imágenes (WEBP/PNG/JPG) y borra marcas de
agua directamente en el navegador del usuario (Canvas API, sin gastar
recursos de servidor), con sistema de puntos, referidos y monetización vía
anuncios recompensados de Monetag.

## Estructura del proyecto

```
telegram-miniapp/
├── api/
│   ├── _supabase.js        # Cliente Supabase (service role) compartido
│   ├── _verifyTelegram.js  # Validación HMAC de Telegram.WebApp.initData
│   ├── bot.js               # Webhook del bot (grammY) — /start con referidos
│   ├── reward.js            # POST: acredita puntos tras ver anuncio Monetag
│   └── withdraw.js          # POST: solicita retiro (atómico)
├── public/
│   ├── index.html            # UI de la Mini App (tabs: Herramientas / Dashboard)
│   ├── app.js                 # Lógica client-side (Canvas, Monetag, fetch API)
│   └── styles.css
├── scripts/
│   └── set-webhook.js         # Utilidad para registrar el webhook en Telegram
├── supabase/
│   └── schema.sql             # Tablas + funciones RPC atómicas
├── package.json
├── vercel.json
└── .env.example
```

## 1. Supabase

1. Crea un proyecto gratuito en [supabase.com](https://supabase.com).
2. Ve a **SQL Editor** y ejecuta el contenido completo de `supabase/schema.sql`.
3. En **Settings → API**, copia `Project URL` y `service_role key` (no la `anon key`)
   para tus variables de entorno.

## 2. Bot de Telegram

1. Habla con [@BotFather](https://t.me/BotFather), crea un bot y guarda el `BOT_TOKEN`.
2. Con `/newapp` o `/mybots → Bot Settings → Menu Button`, configura el botón
   de Mini App apuntando a tu dominio de Vercel (lo tendrás tras el paso 3).

## 3. Despliegue en Vercel

```bash
npm install
vercel --prod
```

Configura las variables de entorno del `.env.example` en el dashboard de
Vercel (Project → Settings → Environment Variables):

- `BOT_TOKEN`
- `WEBAPP_URL` (la URL que te asigna Vercel tras el primer deploy)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MIN_WITHDRAWAL`

Vuelve a desplegar (`vercel --prod`) después de setear `WEBAPP_URL` para que
quede disponible en la función del bot.

## 4. Registrar el Webhook

```bash
BOT_TOKEN=xxx WEBAPP_URL=https://tu-dominio.vercel.app node scripts/set-webhook.js
```

Esto le dice a Telegram que envíe las actualizaciones a `POST /api/bot`.

## 5. Monetag

1. Regístrate en [Monetag](https://monetag.com) y agrega tu Mini App / sitio.
2. Copia tu **Zone ID** de un formato *Rewarded Interstitial*.
3. En `public/index.html`, reemplaza:
   ```html
   <script src="//libtl.com/sdk.js" data-zone="REEMPLAZA_CON_TU_ZONE_ID" data-sdk="show_rewarded_ad"></script>
   ```
   por tu Zone ID real. Si Monetag te asigna un nombre de función distinto
   (revísalo en tu panel), actualiza también `data-sdk` y las referencias a
   `show_rewarded_ad` en `public/app.js`.

## 6. Ajustar economía

En `supabase/schema.sql`, dentro de la función `credit_ad_reward`:

- `v_reward_per_ad` → puntos otorgados por anuncio visto.
- `v_commission_pct` → % de comisión para el referente.
- `v_cooldown_seconds` → tiempo mínimo entre anuncios por usuario (anti-abuso).

Y en `request_withdrawal` / variable de entorno `MIN_WITHDRAWAL`, el mínimo
de retiro.

En `public/app.js`, actualiza `BOT_USERNAME` con el username real de tu bot
para que el enlace de referidos (`t.me/<bot>?start=<id>`) sea correcto.

## Notas de seguridad

- Todo el procesamiento de imágenes ocurre en el navegador (`Canvas API`);
  el servidor nunca recibe ni almacena las imágenes de los usuarios.
- Los endpoints `/api/reward` y `/api/withdraw` validan la firma HMAC de
  `Telegram.WebApp.initData` (ver `api/_verifyTelegram.js`) para evitar que
  alguien falsifique su `telegram_id` y reclame puntos ajenos.
- Las sumas de puntos y descuentos de saldo se hacen con funciones `plpgsql`
  (`credit_ad_reward`, `request_withdrawal`) que bloquean la fila (`for update`)
  para evitar condiciones de carrera / doble gasto.
- La `SUPABASE_SERVICE_ROLE_KEY` solo se usa en funciones serverless
  (`api/*.js`), nunca se expone al frontend.
