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
let intentoReconectar = 0;
let ultimaReproduccion = 0;
let inicializando = false;
let usuarioInteractuo = false;
let watchdogHls = null;
let ultimoTiempoHls = 0;
let ultimaMarcaAvanceHls = 0;

const MAX_REINTENTOS = 6;
const TIEMPO_ESTABLE = 5000;
const INTERVALO_WATCHDOG_HLS = 2000;
const LIMITE_CONGELADO_HLS = 8000;

function urlHlsNueva() {
  return CANAL_HLS_URL;
}

function actualizarEstadoDisponible() {
  intentoReconectar = 0;
  ultimaReproduccion = Date.now();

  if (broadcastStatus) broadcastStatus.textContent = 'TRANSMISIÓN CONTINUA';
  if (broadcastDescription) {
    broadcastDescription.textContent = 'Señal permanente de QRO TV DIGITAL.';
  }
  if (nowTitle) nowTitle.textContent = 'QRO TV DIGITAL';
  if (nextTitle) nextTitle.textContent = 'Señal procesada por el motor de continuidad.';
  if (fallback) fallback.hidden = true;
}

function mostrarAccionReproduccion(mensaje = 'Toca para reproducir la señal.') {
  if (!fallback) return;
  fallback.hidden = false;
  if (playerStatus) playerStatus.textContent = 'TOCA PARA REPRODUCIR';
  if (playerCaption) playerCaption.textContent = mensaje;
  if (playerAction) {
    playerAction.textContent = '▶';
    playerAction.hidden = false;
  }
}

function actualizarEstadoCarga(mensaje = 'Conectando con la señal del canal…') {
  if (!fallback) return;
  fallback.hidden = false;
  if (playerStatus) playerStatus.textContent = 'CARGANDO';
  if (playerCaption) playerCaption.textContent = mensaje;
  if (playerAction) playerAction.hidden = true;
}

function actualizarEstadoError(mensaje = 'No fue posible conectar con la señal del canal.') {
  if (broadcastStatus) broadcastStatus.textContent = 'SEÑAL NO DISPONIBLE';
  if (broadcastDescription) broadcastDescription.textContent = mensaje;
  if (nowTitle) nowTitle.textContent = 'Sin transmisión';
  if (nextTitle) nextTitle.textContent = 'Reconectando automáticamente.';

  if (fallback) fallback.hidden = false;
  if (playerStatus) playerStatus.textContent = 'SIN SEÑAL';
  if (playerCaption) playerCaption.textContent = mensaje;
  if (playerAction) {
    playerAction.textContent = '↻';
    playerAction.hidden = false;
  }
}

function detenerWatchdogHls() {
  if (watchdogHls) {
    clearInterval(watchdogHls);
    watchdogHls = null;
  }
  ultimoTiempoHls = 0;
  ultimaMarcaAvanceHls = 0;
}

function iniciarWatchdogHls() {
  detenerWatchdogHls();

  ultimoTiempoHls = Number(player?.currentTime || 0);
  ultimaMarcaAvanceHls = Date.now();

  watchdogHls = setInterval(() => {
    if (!player || inicializando) return;
    if (document.visibilityState !== 'visible') return;
    if (player.paused) return;

    const tiempoActual = Number(player.currentTime || 0);

    if (tiempoActual > ultimoTiempoHls + 0.25) {
      ultimoTiempoHls = tiempoActual;
      ultimaMarcaAvanceHls = Date.now();
      return;
    }

    if (Date.now() - ultimaMarcaAvanceHls >= LIMITE_CONGELADO_HLS) {
      console.warn(
        hls
          ? 'HLS watchdog: reproducción detenida, reconstruyendo sesión.'
          : 'HLS nativo watchdog: reproducción detenida, reconstruyendo sesión.'
      );
      iniciarCanal({ reinicio: true });
    }
  }, INTERVALO_WATCHDOG_HLS);
}

function limpiarReproductorHls() {
  clearTimeout(reintento);
  reintento = null;
  detenerWatchdogHls();

  if (hls) {
    try {
      hls.stopLoad();
      hls.destroy();
    } catch (_) {}
    hls = null;
  }
}

async function intentarPlay({ forzarMute = true } = {}) {
  if (!player) return false;

  try {
    if (forzarMute) {
      player.muted = true;
      player.defaultMuted = true;
    }
    await player.play();
    return true;
  } catch (_) {
    if (!ES_MONITOR) {
      mostrarAccionReproduccion('El navegador móvil requiere tocar reproducir.');
    }
    return false;
  }
}

function programarReconexion(motivo = 'Reconectando con la señal…') {
  if (reintento || inicializando) return;

  intentoReconectar = Math.min(intentoReconectar + 1, MAX_REINTENTOS);
  const espera = Math.min(1500 * Math.pow(1.5, intentoReconectar - 1), 8000);

  actualizarEstadoCarga(motivo);

  reintento = setTimeout(() => {
    reintento = null;
    iniciarCanal({ reinicio: true });
  }, espera);
}

function prepararVideo() {
  if (!player) return;

  player.autoplay = true;
  player.preload = 'auto';
  player.playsInline = true;
  player.muted = true;
  player.defaultMuted = true;
  player.controls = !ES_MONITOR;
  player.setAttribute('autoplay', '');
  player.setAttribute('muted', '');
  player.setAttribute('playsinline', '');
  player.setAttribute('webkit-playsinline', '');
}

function iniciarCanal({ reinicio = false } = {}) {
  if (!player || inicializando) return;

  inicializando = true;

  try {
    limpiarReproductorHls();
    actualizarEstadoCarga(reinicio ? 'Restableciendo la señal…' : 'Conectando con la señal del canal…');
    prepararVideo();

    if (reinicio) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }

    const fuente = urlHlsNueva();

    if (player.canPlayType('application/vnd.apple.mpegurl')) {
      player.src = fuente;
      player.load();

      const reproducirCuandoListo = () => {
        iniciarWatchdogHls();
        intentarPlay();
      };

      player.addEventListener('loadedmetadata', reproducirCuandoListo, { once: true });
      player.addEventListener('canplay', reproducirCuandoListo, { once: true });
      return;
    }

    if (window.Hls?.isSupported()) {
      hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        maxLiveSyncPlaybackRate: 1.15,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 1000,
        manifestLoadingMaxRetryTimeout: 8000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 1000,
        levelLoadingMaxRetryTimeout: 8000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 8000
      });

      hls.loadSource(fuente);
      hls.attachMedia(player);

      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        iniciarWatchdogHls();
        intentarPlay();
      });

      hls.on(window.Hls.Events.FRAG_LOADED, () => {
        if (player.paused && document.visibilityState === 'visible' && usuarioInteractuo) {
          intentarPlay({ forzarMute: false });
        }
      });

      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data) return;

        console.warn('HLS:', data.type, data.details, data.fatal);

        if (!data.fatal) return;

        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          try {
            hls.startLoad();
          } catch (_) {}
          programarReconexion('Restableciendo conexión con la señal…');
          return;
        }

        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          try {
            hls.recoverMediaError();
            return;
          } catch (_) {}
        }

        programarReconexion('Restableciendo el reproductor…');
      });

      return;
    }

    actualizarEstadoError('Este navegador no dispone de reproducción HLS compatible.');
  } finally {
    inicializando = false;
  }
}

player?.addEventListener('loadeddata', () => {
  if (player.paused && document.visibilityState === 'visible') {
    intentarPlay();
  }
});

player?.addEventListener('playing', () => {
  actualizarEstadoDisponible();
  ultimoTiempoHls = Number(player.currentTime || 0);
  ultimaMarcaAvanceHls = Date.now();

  if (!watchdogHls) {
    iniciarWatchdogHls();
  }
});

player?.addEventListener('timeupdate', () => {
  if (!player) return;
  const tiempoActual = Number(player.currentTime || 0);
  if (tiempoActual > ultimoTiempoHls + 0.1) {
    ultimoTiempoHls = tiempoActual;
    ultimaMarcaAvanceHls = Date.now();
  }
});

player?.addEventListener('waiting', () => {
  if (ultimaReproduccion && Date.now() - ultimaReproduccion < TIEMPO_ESTABLE) return;

  if (broadcastStatus) broadcastStatus.textContent = 'TRANSMISIÓN CONTINUA';
  if (broadcastDescription) broadcastDescription.textContent = 'Recibiendo señal del canal…';
});

player?.addEventListener('stalled', () => {
  if (!ultimaReproduccion || Date.now() - ultimaReproduccion >= TIEMPO_ESTABLE) {
    programarReconexion('Señal detenida. Restableciendo conexión…');
  }
});

player?.addEventListener('error', () => {
  programarReconexion('Restableciendo la señal…');
});

player?.addEventListener('pointerdown', () => {
  usuarioInteractuo = true;
});

player?.addEventListener('click', () => {
  usuarioInteractuo = true;
  intentarPlay({ forzarMute: false });
});

playerAction?.addEventListener('click', () => {
  usuarioInteractuo = true;

  if (player?.canPlayType('application/vnd.apple.mpegurl')) {
    iniciarCanal({ reinicio: true });
    return;
  }

  if (player?.src || hls) {
    intentarPlay({ forzarMute: false });
    return;
  }

  iniciarCanal({ reinicio: true });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;

  if (hls) {
    try {
      hls.startLoad();
    } catch (_) {}
  }

  if (player?.paused || player?.readyState < 2) {
    if (player?.canPlayType('application/vnd.apple.mpegurl')) {
      iniciarCanal({ reinicio: true });
    } else if (usuarioInteractuo) {
      intentarPlay({ forzarMute: false });
    } else {
      mostrarAccionReproduccion('Toca para continuar la transmisión.');
    }
  }
});

window.addEventListener('online', () => iniciarCanal({ reinicio: true }));
window.addEventListener('pageshow', () => {
  if (player?.paused) {
    if (player?.canPlayType('application/vnd.apple.mpegurl')) {
      iniciarCanal({ reinicio: true });
    } else if (usuarioInteractuo) {
      intentarPlay({ forzarMute: false });
    } else {
      mostrarAccionReproduccion('Toca para reproducir la transmisión.');
    }
  }
});

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