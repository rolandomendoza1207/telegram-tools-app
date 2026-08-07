// public/app.js
// Toda la lógica de la Mini App. Procesamiento de imágenes 100% en el
// navegador (Canvas API). Solo se llama al backend para acreditar puntos
// (tras ver un anuncio) y para solicitar retiros.

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const BOT_USERNAME = 'TU_BOT_USERNAME'; // <-- reemplaza por el username real de tu bot (sin @)
const MIN_WITHDRAWAL = 5.0; // debe coincidir con MIN_WITHDRAWAL del backend, solo informativo

// ---------------------------------------------------------------
// Utilidades generales
// ---------------------------------------------------------------
function showToast(msg, ms = 2500) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add('hidden'), ms);
}

function getInitData() {
  return tg?.initData || '';
}

function currentUser() {
  return tg?.initDataUnsafe?.user || null;
}

// ---------------------------------------------------------------
// Navegación por pestañas
// ---------------------------------------------------------------
const tabButtons = document.querySelectorAll('.tab-btn');
const tabSections = {
  'tab-tools': document.getElementById('tab-tools'),
  'tab-dashboard': document.getElementById('tab-dashboard'),
};

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => b.classList.remove('active', 'text-indigo-400'));
    tabButtons.forEach((b) => b.classList.add('text-slate-400'));
    btn.classList.add('active', 'text-indigo-400');
    btn.classList.remove('text-slate-400');

    Object.values(tabSections).forEach((s) => s.classList.add('hidden'));
    tabSections[btn.dataset.tab].classList.remove('hidden');

    if (btn.dataset.tab === 'tab-dashboard') refreshDashboard();
  });
});
document.querySelector('.tab-btn[data-tab="tab-tools"]').classList.add('active');

// =================================================================
// MONETAG - Mostrar anuncio recompensado antes de descargar
// =================================================================
/**
 * Muestra el anuncio rewarded de Monetag. Devuelve una Promise que se
 * resuelve cuando el usuario completó el anuncio (recompensa otorgable)
 * y se rechaza si lo cerró antes o hubo error.
 *
 * El SDK de Monetag inyecta una función global cuyo nombre coincide con
 * data-sdk en el <script> del index.html (por defecto "show_rewarded_ad").
 */
function showRewardedAd() {
  return new Promise((resolve, reject) => {
    if (typeof window.show_rewarded_ad !== 'function') {
      // Sin SDK cargado (ej. en desarrollo local): simula éxito para no
      // bloquear las pruebas, pero avisa en consola.
      console.warn('[monetag] SDK no disponible, simulando anuncio completado');
      return resolve();
    }

    window
      .show_rewarded_ad()
      .then(() => resolve())
      .catch((err) => reject(err));
  });
}

/**
 * Flujo completo: muestra anuncio -> si se completa, llama a /api/reward
 * para acreditar puntos de forma segura en el backend.
 */
async function unlockDownloadWithAd() {
  showToast('Cargando anuncio...');
  await showRewardedAd();

  const initData = getInitData();
  if (!initData) {
    showToast('No se pudo verificar tu sesión de Telegram.');
    throw new Error('NO_INIT_DATA');
  }

  const resp = await fetch('/api/reward', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData }),
  });
  const data = await resp.json();

  if (!resp.ok || !data.ok) {
    if (data.error === 'COOLDOWN_ACTIVE') {
      showToast('Espera unos segundos antes de ver otro anuncio.');
    } else {
      showToast('No se pudo acreditar la recompensa.');
    }
    throw new Error(data.error || 'REWARD_FAILED');
  }

  showToast(`+${Number(data.credited).toFixed(4)} pts acreditados 🎉`);
  return data;
}

function downloadCanvas(canvas, filename, mime, quality) {
  canvas.toBlob(
    (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    mime,
    quality
  );
}

// =================================================================
// HERRAMIENTA 1: Convertidor de formato (WEBP/PNG/JPG)
// =================================================================
const convertInput = document.getElementById('convertInput');
const convertCanvas = document.getElementById('convertCanvas');
const convertFormat = document.getElementById('convertFormat');
const convertBtn = document.getElementById('convertBtn');
let convertLoadedImage = null;

convertInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    convertLoadedImage = img;
    const ctx = convertCanvas.getContext('2d');
    convertCanvas.width = img.naturalWidth;
    convertCanvas.height = img.naturalHeight;
    ctx.clearRect(0, 0, convertCanvas.width, convertCanvas.height);
    ctx.drawImage(img, 0, 0);
    convertCanvas.classList.remove('hidden');
    convertBtn.disabled = false;
  };
  img.onerror = () => showToast('No se pudo cargar la imagen.');
  img.src = URL.createObjectURL(file);
});

convertBtn.addEventListener('click', async () => {
  if (!convertLoadedImage) return;
  convertBtn.disabled = true;
  const originalText = convertBtn.textContent;
  convertBtn.textContent = 'Esperando anuncio...';

  try {
    await unlockDownloadWithAd();
    const mime = convertFormat.value;
    const ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
    downloadCanvas(convertCanvas, `imagen-convertida.${ext}`, mime, 0.92);
  } catch (err) {
    console.error(err);
  } finally {
    convertBtn.disabled = false;
    convertBtn.textContent = originalText;
  }
});

// =================================================================
// HERRAMIENTA 2: Borrador de marcas de agua (pincel sobre Canvas)
// =================================================================
const eraseInput = document.getElementById('eraseInput');
const eraseCanvas = document.getElementById('eraseCanvas');
const brushSize = document.getElementById('brushSize');
const undoBtn = document.getElementById('undoBtn');
const eraseDownloadBtn = document.getElementById('eraseDownloadBtn');

let eraseCtx = null;
let isDrawing = false;
let undoStack = [];
let eraseImageLoaded = false;

eraseInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    eraseCanvas.width = img.naturalWidth;
    eraseCanvas.height = img.naturalHeight;
    eraseCtx = eraseCanvas.getContext('2d');
    eraseCtx.drawImage(img, 0, 0);
    eraseCanvas.classList.remove('hidden');
    eraseDownloadBtn.disabled = false;
    eraseImageLoaded = true;
    undoStack = [eraseCtx.getImageData(0, 0, eraseCanvas.width, eraseCanvas.height)];
  };
  img.onerror = () => showToast('No se pudo cargar la imagen.');
  img.src = URL.createObjectURL(file);
});

function getCanvasCoords(evt) {
  const rect = eraseCanvas.getBoundingClientRect();
  const scaleX = eraseCanvas.width / rect.width;
  const scaleY = eraseCanvas.height / rect.height;
  const point = evt.touches ? evt.touches[0] : evt;
  return {
    x: (point.clientX - rect.left) * scaleX,
    y: (point.clientY - rect.top) * scaleY,
  };
}

/**
 * "Borra" la marca de agua tomando el color promedio de una vecindad
 * fuera del área del pincel (muestreo en anillo) y rellenando el
 * círculo del pincel con ese color + un ligero difuminado, simulando
 * un content-aware fill simplificado, 100% client-side.
 */
function healBrushStroke(x, y, radius) {
  const ctx = eraseCtx;
  const sampleRadius = radius * 1.8;

  // Muestra 8 puntos alrededor del pincel para estimar el color de fondo
  const samples = [];
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8;
    const sx = Math.round(x + Math.cos(angle) * sampleRadius);
    const sy = Math.round(y + Math.sin(angle) * sampleRadius);
    if (sx >= 0 && sy >= 0 && sx < eraseCanvas.width && sy < eraseCanvas.height) {
      const px = ctx.getImageData(sx, sy, 1, 1).data;
      samples.push(px);
    }
  }
  if (samples.length === 0) return;

  const avg = samples.reduce(
    (acc, px) => {
      acc[0] += px[0];
      acc[1] += px[1];
      acc[2] += px[2];
      return acc;
    },
    [0, 0, 0]
  );
  const n = samples.length;
  const color = `rgba(${Math.round(avg[0] / n)}, ${Math.round(avg[1] / n)}, ${Math.round(avg[2] / n)}, 1)`;

  // Relleno suave con degradado radial para que no quede un parche duro
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, color);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Un leve blur local usando filter (soportado en navegadores modernos)
  ctx.save();
  ctx.filter = 'blur(2px)';
  ctx.drawImage(eraseCanvas, 0, 0);
  ctx.restore();
}

function startDraw(evt) {
  if (!eraseImageLoaded) return;
  isDrawing = true;
  draw(evt);
}
function stopDraw() {
  if (!isDrawing) return;
  isDrawing = false;
  undoStack.push(eraseCtx.getImageData(0, 0, eraseCanvas.width, eraseCanvas.height));
  if (undoStack.length > 15) undoStack.shift();
}
function draw(evt) {
  if (!isDrawing) return;
  evt.preventDefault();
  const { x, y } = getCanvasCoords(evt);
  healBrushStroke(x, y, Number(brushSize.value));
}

eraseCanvas.addEventListener('mousedown', startDraw);
eraseCanvas.addEventListener('mousemove', draw);
window.addEventListener('mouseup', stopDraw);

eraseCanvas.addEventListener('touchstart', startDraw, { passive: false });
eraseCanvas.addEventListener('touchmove', draw, { passive: false });
eraseCanvas.addEventListener('touchend', stopDraw);

undoBtn.addEventListener('click', () => {
  if (undoStack.length <= 1) return;
  undoStack.pop(); // descarta el estado actual
  const prev = undoStack[undoStack.length - 1];
  eraseCtx.putImageData(prev, 0, 0);
});

eraseDownloadBtn.addEventListener('click', async () => {
  if (!eraseImageLoaded) return;
  eraseDownloadBtn.disabled = true;
  const originalText = eraseDownloadBtn.textContent;
  eraseDownloadBtn.textContent = 'Esperando anuncio...';

  try {
    await unlockDownloadWithAd();
    downloadCanvas(eraseCanvas, 'imagen-sin-marca.png', 'image/png');
  } catch (err) {
    console.error(err);
  } finally {
    eraseDownloadBtn.disabled = false;
    eraseDownloadBtn.textContent = originalText;
  }
});

// =================================================================
// DASHBOARD: saldo, referidos, enlace, retiro
// =================================================================
async function refreshDashboard() {
  const user = currentUser();
  if (user) {
    document.getElementById('userBadge').textContent = `@${user.username || user.first_name}`;
    document.getElementById('refLinkInput').value = `https://t.me/${BOT_USERNAME}?start=${user.id}`;
  }
  document.getElementById('minWithdrawLabel').textContent = MIN_WITHDRAWAL.toFixed(2);

  // El saldo se obtiene junto a la respuesta de /api/reward tras cada anuncio;
  // para una lectura fresca al entrar al dashboard, pedimos un "reward" de
  // solo lectura no es ideal, así que en su lugar exponemos un pequeño fetch
  // opcional aquí si se agrega un endpoint /api/me en el futuro.
  // Por simplicidad, mostramos el último valor conocido en memoria.
  if (window.__lastKnownPoints !== undefined) {
    updatePointsUI(window.__lastKnownPoints);
  }
}

function updatePointsUI(points) {
  window.__lastKnownPoints = points;
  document.getElementById('pointsValue').textContent = `${Number(points).toFixed(4)} pts`;
  document.getElementById('usdValue').textContent = Number(points).toFixed(2);
}

document.getElementById('copyRefBtn').addEventListener('click', () => {
  const input = document.getElementById('refLinkInput');
  input.select();
  navigator.clipboard?.writeText(input.value).then(() => showToast('Enlace copiado ✅'));
});

document.getElementById('withdrawBtn').addEventListener('click', async () => {
  const amount = Number(document.getElementById('withdrawAmount').value);
  const details = document.getElementById('withdrawDetails').value.trim();
  const msgEl = document.getElementById('withdrawMsg');

  if (!amount || amount <= 0) {
    msgEl.textContent = 'Ingresa un monto válido.';
    msgEl.className = 'text-xs mt-2 text-red-400';
    return;
  }
  if (!details) {
    msgEl.textContent = 'Ingresa tus datos de pago.';
    msgEl.className = 'text-xs mt-2 text-red-400';
    return;
  }

  const initData = getInitData();
  msgEl.textContent = 'Enviando solicitud...';
  msgEl.className = 'text-xs mt-2 text-slate-400';

  try {
    const resp = await fetch('/api/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, amount, payoutDetails: details }),
    });
    const data = await resp.json();

    if (!resp.ok || !data.ok) {
      const errors = {
        BELOW_MINIMUM: `El monto mínimo es ${MIN_WITHDRAWAL.toFixed(2)} pts.`,
        INSUFFICIENT_BALANCE: 'No tienes saldo suficiente.',
        INVALID_AMOUNT: 'Monto inválido.',
        INVALID_PAYOUT_DETAILS: 'Datos de pago inválidos.',
      };
      msgEl.textContent = errors[data.error] || 'No se pudo procesar la solicitud.';
      msgEl.className = 'text-xs mt-2 text-red-400';
      return;
    }

    msgEl.textContent = '✅ Solicitud enviada, será revisada pronto.';
    msgEl.className = 'text-xs mt-2 text-emerald-400';
    document.getElementById('withdrawAmount').value = '';
    document.getElementById('withdrawDetails').value = '';
  } catch (err) {
    console.error(err);
    msgEl.textContent = 'Error de red, intenta de nuevo.';
    msgEl.className = 'text-xs mt-2 text-red-400';
  }
});

// Estado inicial
refreshDashboard();
