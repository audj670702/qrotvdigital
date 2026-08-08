const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.topbar nav');

const CANAL_HLS_URL = 'https://motortv.scad.mx/hls/canal.m3u8';
const ES_MONITOR = new URLSearchParams(window.location.search).get('monitor') === '1';

if (ES_MONITOR) {
  document.documentElement.classList.add('monitor-mode');

  const estiloMonitor = document.createElement('style');
  estiloMonitor.textContent = `
    html.monitor-mode,
    html.monitor-mode body {
      margin: 0;
      min-height: 100%;
      overflow: hidden;
      background: #000;
    }

    html.monitor-mode .topbar,
    html.monitor-mode .broadcast-copy,
    html.monitor-mode .content-section,
    html.monitor-mode .clips-section,
    html.monitor-mode .magazine,
    html.monitor-mode footer,
    html.monitor-mode .install-app-button,
    html.monitor-mode .install-modal {
      display: none !important;
    }

    html.monitor-mode main {
      min-height: 100vh;
      overflow: hidden;
      background: #000;
    }

    html.monitor-mode .broadcast {
      display: block;
      width: 100vw;
      max-width: none;
      min-height: 100vh;
      margin: 0;
      padding: 0;
    }

    html.monitor-mode .player-shell {
      width: 100vw;
      height: 100vh;
      min-height: 0;
      border-radius: 0;
      box-shadow: none;
      aspect-ratio: auto;
    }

    html.monitor-mode #channelPlayer {
      width: 100vw;
      height: 100vh;
    }
  `;
  document.head.appendChild(estiloMonitor);
}

menuButton?.addEventListener('click', () => {
  const abierto = navigation.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(abierto));
  menuButton.textContent = abierto ? '✕' : '☰';
});

navigation?.addEventListener('click', (event) => {
  if (!event.target.matches('a')) return;
  navigation.classList.remove('open');
  menuButton?.setAttribute('aria-expanded', 'false');
  if (menuButton) menuButton.textContent = '☰';
});

const player = document.getElementById('channelPlayer');
const fallback = document.getElementById('playerFallback');
const playerStatus = document.getElementById('playerStatus');
const playerAction = document.getElementById('playerAction');
const playerCaption = document.getElementById('playerCaption');
const broadcastStatus = document.getElementById('broadcastStatus');
const broadcastDescription = document.getElementById('broadcastDescription');
const nowTitle = document.getElementById('nowTitle');
const nextTitle = document.getElementById('nextTitle');

let hls = null;
let reintento = null;

function actualizarEstadoDisponible() {
  if (broadcastStatus) broadcastStatus.textContent = 'TRANSMISIÓN CONTINUA';
  if (broadcastDescription) {
    broadcastDescription.textContent = 'Señal permanente de QRO TV DIGITAL.';
  }
  if (nowTitle) nowTitle.textContent = 'QRO TV DIGITAL';
  if (nextTitle) nextTitle.textContent = 'Señal procesada por el motor de continuidad.';
  if (fallback) fallback.hidden = true;
}

function actualizarEstadoCarga() {
  if (!fallback) return;
  fallback.hidden = false;
  if (playerStatus) playerStatus.textContent = 'CARGANDO';
  if (playerCaption) playerCaption.textContent = 'Conectando con la señal del canal…';
  if (playerAction) playerAction.hidden = true;
}

function actualizarEstadoError(mensaje = 'No fue posible conectar con la señal del canal.') {
  if (broadcastStatus) broadcastStatus.textContent = 'SEÑAL NO DISPONIBLE';
  if (broadcastDescription) broadcastDescription.textContent = mensaje;
  if (nowTitle) nowTitle.textContent = 'Sin transmisión';
  if (nextTitle) nextTitle.textContent = 'Intenta nuevamente en unos momentos.';

  if (fallback) fallback.hidden = false;
  if (playerStatus) playerStatus.textContent = 'SIN SEÑAL';
  if (playerCaption) playerCaption.textContent = mensaje;
  if (playerAction) {
    playerAction.textContent = '↻';
    playerAction.hidden = false;
  }
}

function limpiarReproductorHls() {
  clearTimeout(reintento);
  reintento = null;

  if (hls) {
    try {
      hls.destroy();
    } catch (_) {}
    hls = null;
  }
}

async function intentarPlay() {
  if (!player) return;

  try {
    await player.play();
  } catch (_) {
    if (!ES_MONITOR) {
      if (fallback) fallback.hidden = false;
      if (playerStatus) playerStatus.textContent = 'TOCA PARA REPRODUCIR';
      if (playerCaption) playerCaption.textContent = 'El navegador bloqueó la reproducción automática.';
      if (playerAction) {
        playerAction.textContent = '▶';
        playerAction.hidden = false;
      }
    }
  }
}

function programarReconexion() {
  clearTimeout(reintento);
  reintento = setTimeout(() => iniciarCanal({ reinicio: true }), 3000);
}

function iniciarCanal({ reinicio = false } = {}) {
  if (!player) return;

  limpiarReproductorHls();
  actualizarEstadoCarga();

  player.autoplay = true;
  player.playsInline = true;
  player.muted = true;
  player.controls = !ES_MONITOR;

  if (reinicio) {
    player.removeAttribute('src');
    player.load();
  }

  if (player.canPlayType('application/vnd.apple.mpegurl')) {
    player.src = `${CANAL_HLS_URL}?t=${Date.now()}`;
    player.addEventListener('loadedmetadata', intentarPlay, { once: true });
    return;
  }

  if (window.Hls?.isSupported()) {
    hls = new window.Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 8
    });

    hls.loadSource(CANAL_HLS_URL);
    hls.attachMedia(player);

    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      intentarPlay();
    });

    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data?.fatal) return;

      console.error('Error fatal HLS:', data);

      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
        actualizarEstadoError('La señal del VPS no respondió. Reconectando…');
        programarReconexion();
        return;
      }

      if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
        try {
          hls.recoverMediaError();
          return;
        } catch (_) {}
      }

      actualizarEstadoError();
      programarReconexion();
    });

    return;
  }

  actualizarEstadoError('Este navegador no dispone de reproducción HLS compatible.');
}

player?.addEventListener('playing', () => {
  actualizarEstadoDisponible();
});

player?.addEventListener('waiting', () => {
  if (playerCaption && !fallback?.hidden) {
    playerCaption.textContent = 'Recibiendo señal…';
  }
});

player?.addEventListener('stalled', () => {
  programarReconexion();
});

player?.addEventListener('error', () => {
  if (!window.Hls?.isSupported()) {
    actualizarEstadoError();
    programarReconexion();
  }
});

playerAction?.addEventListener('click', () => {
  if (player?.src || hls) {
    intentarPlay();
    return;
  }

  iniciarCanal({ reinicio: true });
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && player?.paused) {
    intentarPlay();
  }
});

window.addEventListener('online', () => iniciarCanal({ reinicio: true }));

iniciarCanal();

/* ============================================================
   INSTALACIÓN PWA
   ============================================================ */

let deferredInstallPrompt = null;

const installButton = document.getElementById('installAppButton');
const installModal = document.getElementById('installModal');
const closeInstallModal = document.getElementById('closeInstallModal');
const installModalAction = document.getElementById('installModalAction');
const iosInstallSteps = document.getElementById('iosInstallSteps');
const installModalText = document.getElementById('installModalText');

const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const esStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

function abrirModalInstalacion() {
  if (!installModal) return;

  if (esIOS && !esStandalone) {
    iosInstallSteps.hidden = false;
    installModalAction.textContent = 'Entendido';
    installModalText.textContent =
      'En iPhone y iPad la instalación se realiza desde el menú Compartir de Safari.';
  } else {
    iosInstallSteps.hidden = true;
    installModalAction.textContent = deferredInstallPrompt ? 'Instalar' : 'Cerrar';
    installModalText.textContent = deferredInstallPrompt
      ? 'Instala QRO TV DIGITAL para abrirla desde tu pantalla de inicio.'
      : 'Abre el menú del navegador y elige Instalar aplicación o Agregar a pantalla de inicio.';
  }

  installModal.hidden = false;
  document.body.classList.add('modal-abierto');
}

function cerrarModalInstalacion() {
  if (!installModal) return;
  installModal.hidden = true;
  document.body.classList.remove('modal-abierto');
}

function actualizarBotonInstalacion() {
  if (!installButton) return;

  installButton.hidden = false;

  if (esStandalone) {
    installButton.disabled = true;
    installButton.textContent = '✓ Instalada';
    return;
  }

  installButton.disabled = false;
  installButton.innerHTML = '<span aria-hidden="true">＋</span> Instalar';
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  actualizarBotonInstalacion();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;

  if (installButton) {
    installButton.disabled = true;
    installButton.textContent = '✓ Instalada';
  }

  cerrarModalInstalacion();
});

installButton?.addEventListener('click', abrirModalInstalacion);
closeInstallModal?.addEventListener('click', cerrarModalInstalacion);

installModal?.addEventListener('click', (event) => {
  if (event.target === installModal) cerrarModalInstalacion();
});

installModalAction?.addEventListener('click', async () => {
  if (esIOS || !deferredInstallPrompt) {
    cerrarModalInstalacion();
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;

  deferredInstallPrompt = null;
  cerrarModalInstalacion();
  actualizarBotonInstalacion();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !installModal?.hidden) cerrarModalInstalacion();
});

actualizarBotonInstalacion();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((error) => {
      console.warn('No fue posible registrar el service worker:', error);
    });
  });
}
