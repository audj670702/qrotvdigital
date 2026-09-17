const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.topbar nav');

const CANALES = {
  digital: {
    tipo: 'hls',
    nombre: 'TV Digital Internet',
    url: 'https://motortv.scad.mx/hls/canal.m3u8'
  },
  parrilla: {
    tipo: 'pendiente',
    nombre: 'Canal Parrilla',
    url: ''
  }
};

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
const channelSelect = document.getElementById('channelSelect');

let hls = null;
let canalActual = 'digital';

function destruirFuente() {
  if (hls) {
    hls.destroy();
    hls = null;
  }

  if (!player) return;
  player.pause();
  player.removeAttribute('src');
  player.load();
}

function mostrarFallback(estado, texto, accion = false) {
  if (!fallback) return;
  fallback.hidden = false;
  if (playerStatus) playerStatus.textContent = estado;
  if (playerCaption) playerCaption.textContent = texto;
  if (playerAction) playerAction.hidden = !accion;
}

function ocultarFallback() {
  if (fallback) fallback.hidden = true;
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

function reproducirHls(url) {
  destruirFuente();
  prepararVideo();

  if (!url) {
    mostrarFallback('SIN SEÑAL', 'No hay una fuente configurada para este canal.');
    return;
  }

  mostrarFallback('CARGANDO', 'Conectando con la señal del canal…');

  if (player.canPlayType('application/vnd.apple.mpegurl')) {
    player.src = url;
    player.play().catch(() => {
      if (!ES_MONITOR) mostrarFallback('TOCA PARA REPRODUCIR', 'Toca para reproducir la señal.', true);
    });
    return;
  }

  if (window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 30
    });

    hls.loadSource(url);
    hls.attachMedia(player);
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      player.play().catch(() => {
        if (!ES_MONITOR) mostrarFallback('TOCA PARA REPRODUCIR', 'Toca para reproducir la señal.', true);
      });
    });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (data?.fatal) mostrarFallback('SIN SEÑAL', 'No fue posible reproducir la señal del canal.');
    });
    return;
  }

  mostrarFallback('NO COMPATIBLE', 'Este navegador no dispone de reproducción HLS compatible.');
}

function seleccionarCanal(canal) {
  const config = CANALES[canal] || CANALES.digital;
  canalActual = CANALES[canal] ? canal : 'digital';

  if (channelSelect && channelSelect.value !== canalActual) {
    channelSelect.value = canalActual;
  }

  if (nowTitle) nowTitle.textContent = config.nombre;

  if (config.tipo === 'hls') {
    if (broadcastStatus) broadcastStatus.textContent = 'TRANSMISIÓN CONTINUA';
    if (broadcastDescription) broadcastDescription.textContent = 'Señal permanente de TV Digital Internet.';
    if (nextTitle) nextTitle.textContent = 'Canal Digital';
    reproducirHls(config.url);
    return;
  }

  destruirFuente();
  if (broadcastStatus) broadcastStatus.textContent = 'CANAL PARRILLA';
  if (broadcastDescription) broadcastDescription.textContent = 'Canal preparado para la fuente de parrilla.';
  if (nextTitle) nextTitle.textContent = 'Fuente pendiente de configuración';
  mostrarFallback('CANAL PARRILLA', 'Fuente de parrilla pendiente de configuración.');
}

player?.addEventListener('playing', () => {
  ocultarFallback();
  if (broadcastStatus) broadcastStatus.textContent = 'TRANSMISIÓN CONTINUA';
});

playerAction?.addEventListener('click', () => {
  player?.play().catch(() => {});
});

channelSelect?.addEventListener('change', (event) => {
  seleccionarCanal(event.target.value);
});

seleccionarCanal('digital');

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
      ? 'Instala TV Digital INTERNET para abrirla desde tu pantalla de inicio.'
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
