const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.topbar nav');

const API_ENDPOINTS = [
  'https://www.scad.mx/_functions/qtdTransmision',
  'https://scad.mx/_functions/qtdTransmision'
];

let configuracion = null;
let elementos = [];
let indiceActual = 0;
let youtubePlayer = null;
let youtubeApiLista = false;
let reproduccionSolicitada = false;

const ui = {
  status: document.getElementById('broadcastStatus'),
  description: document.getElementById('broadcastDescription'),
  nowTitle: document.getElementById('nowTitle'),
  nextTitle: document.getElementById('nextTitle'),
  shell: document.getElementById('playerShell'),
  fallback: document.getElementById('playerFallback'),
  playerStatus: document.getElementById('playerStatus'),
  playerAction: document.getElementById('playerAction'),
  playerCaption: document.getElementById('playerCaption')
};

menuButton?.addEventListener('click', () => {
  const isOpen = navigation.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
  menuButton.textContent = isOpen ? '✕' : '☰';
});

navigation?.addEventListener('click', (event) => {
  if (event.target.matches('a')) {
    navigation.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
    if (menuButton) menuButton.textContent = '☰';
  }
});

window.onYouTubeIframeAPIReady = () => {
  youtubeApiLista = true;
  if (reproduccionSolicitada) iniciarReproduccion();
};

function extraerYoutubeId(referencia = '') {
  const valor = String(referencia).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(valor)) return valor;
  try {
    const url = new URL(valor);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (host.endsWith('youtube.com')) {
      if (url.searchParams.get('v')) return url.searchParams.get('v');
      const partes = url.pathname.split('/').filter(Boolean);
      const marcador = partes.findIndex(p => ['live', 'embed', 'shorts'].includes(p));
      if (marcador >= 0) return partes[marcador + 1] || '';
    }
  } catch (_) {
    return '';
  }
  return '';
}

async function consultarTransmision() {
  let ultimoError = null;
  for (const endpoint of API_ENDPOINTS) {
    try {
      const respuesta = await fetch(`${endpoint}?t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || `Respuesta HTTP ${respuesta.status}`);
      return datos;
    } catch (error) {
      ultimoError = error;
    }
  }
  throw ultimoError || new Error('No fue posible consultar la transmisión.');
}

function mostrarError(mensaje) {
  ui.status.textContent = 'SEÑAL NO DISPONIBLE';
  ui.description.textContent = mensaje;
  ui.nowTitle.textContent = 'Sin transmisión';
  ui.nextTitle.textContent = 'Intenta nuevamente en unos momentos.';
  ui.playerStatus.textContent = 'SIN SEÑAL';
  ui.playerCaption.textContent = mensaje;
  ui.playerAction.textContent = '↻';
  ui.playerAction.hidden = false;
  ui.fallback.hidden = false;
}

function actualizarInformacion() {
  const actual = elementos[indiceActual];
  const siguiente = elementos[(indiceActual + 1) % elementos.length];
  ui.status.textContent = configuracion?.transmision?.leyendaEstado || (configuracion?.transmision?.enVivo ? 'EN VIVO' : 'TRANSMISIÓN CONTINUA');
  ui.description.textContent = configuracion?.transmision?.descripcion || configuracion?.playlist?.descripcion || 'Programación digital continua de QRO TV DIGITAL.';
  ui.nowTitle.textContent = actual?.titulo || 'Contenido sin título';
  if (elementos.length > 1) ui.nextTitle.textContent = `Siguiente: ${siguiente?.titulo || 'Contenido siguiente'}`;
  else if (configuracion?.playlist?.repetir !== false) ui.nextTitle.textContent = 'Esta transmisión se repetirá al finalizar.';
  else ui.nextTitle.textContent = 'Último contenido de la playlist.';
}

function reproducirYoutube(elemento) {
  const videoId = extraerYoutubeId(elemento?.referenciaVideo);
  if (!videoId) return avanzar();
  actualizarInformacion();
  ui.fallback.hidden = true;
  if (!youtubePlayer) {
    youtubePlayer = new YT.Player('youtubePlayer', {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: (event) => event.target.playVideo(),
        onStateChange: (event) => { if (event.data === YT.PlayerState.ENDED) avanzar(); },
        onError: () => avanzar()
      }
    });
  } else youtubePlayer.loadVideoById(videoId);
}

function avanzar() {
  if (!elementos.length) return;
  if (indiceActual < elementos.length - 1) {
    indiceActual += 1;
    reproducirActual();
    return;
  }
  if (configuracion?.playlist?.repetir !== false) {
    indiceActual = 0;
    reproducirActual();
    return;
  }
  ui.fallback.hidden = false;
  ui.playerStatus.textContent = 'PROGRAMACIÓN FINALIZADA';
  ui.playerCaption.textContent = 'La playlist llegó al final.';
  ui.playerAction.hidden = false;
}

function reproducirActual() {
  const elemento = elementos[indiceActual];
  if (!elemento) return mostrarError('La playlist no contiene elementos reproducibles.');
  if (elemento.tipoFuente === 'YOUTUBE') {
    if (!youtubeApiLista || !window.YT?.Player) {
      reproduccionSolicitada = true;
      ui.playerCaption.textContent = 'Preparando YouTube…';
      return;
    }
    reproduccionSolicitada = false;
    reproducirYoutube(elemento);
    return;
  }
  mostrarError(`El origen ${elemento.tipoFuente || 'desconocido'} todavía no está habilitado en esta versión.`);
}

async function iniciarReproduccion() {
  try {
    ui.playerStatus.textContent = 'CARGANDO';
    ui.playerCaption.textContent = 'Consultando programación…';
    ui.playerAction.hidden = true;
    configuracion = await consultarTransmision();
    const transmision = configuracion.transmision || {};
    const modo = transmision.modoEmision || 'FUERA_DEL_AIRE';
    if (modo === 'FUERA_DEL_AIRE') return mostrarError('La señal se encuentra fuera del aire.');
    if (modo !== 'PLAYLIST') return mostrarError('La señal externa todavía no está habilitada en esta versión de la app.');
    elementos = Array.isArray(configuracion.elementos) ? configuracion.elementos.filter(item => item.referenciaVideo) : [];
    if (!configuracion.playlist || !elementos.length) return mostrarError('La transmisión activa no contiene videos disponibles.');
    indiceActual = 0;
    reproducirActual();
  } catch (error) {
    console.error('No fue posible iniciar la transmisión:', error);
    mostrarError('No fue posible conectar con la señal. Verifica que el endpoint público de Wix esté publicado.');
  }
}

ui.playerAction?.addEventListener('click', () => {
  if (youtubePlayer?.playVideo) youtubePlayer.playVideo();
  else iniciarReproduccion();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && youtubePlayer?.playVideo) youtubePlayer.playVideo();
});

iniciarReproduccion();

let deferredInstallPrompt = null;
const installButton = document.getElementById('installAppButton');
const installModal = document.getElementById('installModal');
const closeInstallModal = document.getElementById('closeInstallModal');
const installModalAction = document.getElementById('installModalAction');
const iosInstallSteps = document.getElementById('iosInstallSteps');
const installModalText = document.getElementById('installModalText');
const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const esStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function abrirModalInstalacion() {
  if (!installModal) return;
  if (esIOS && !esStandalone) {
    iosInstallSteps.hidden = false;
    installModalAction.textContent = 'Entendido';
    installModalText.textContent = 'En iPhone y iPad la instalación se realiza desde el menú Compartir de Safari.';
  } else {
    iosInstallSteps.hidden = true;
    installModalAction.textContent = deferredInstallPrompt ? 'Instalar' : 'Cerrar';
    installModalText.textContent = deferredInstallPrompt ? 'Instala QRO TV DIGITAL para abrirla desde tu pantalla de inicio.' : 'Abre el menú del navegador y elige Instalar aplicación o Agregar a pantalla de inicio. En Chrome también puede aparecer el icono de instalación en la barra de direcciones.';
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
    installButton.hidden = false;
    installButton.disabled = true;
    installButton.textContent = '✓ Instalada';
  }
  cerrarModalInstalacion();
});

installButton?.addEventListener('click', abrirModalInstalacion);
closeInstallModal?.addEventListener('click', cerrarModalInstalacion);
installModal?.addEventListener('click', (event) => { if (event.target === installModal) cerrarModalInstalacion(); });
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
