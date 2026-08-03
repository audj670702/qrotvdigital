const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.topbar nav');

const API_ENDPOINTS = [
  'https://www.scad.mx/_functions/qtdTransmision',
  'https://scad.mx/_functions/qtdTransmision'
];

const EPOCA_CANAL_UTC = Date.parse('2026-01-01T00:00:00.000Z');
const INTERVALO_REVISION_MS = 10000;
const TOLERANCIA_DESFASE_SEGUNDOS = 3;

let configuracion = null;
let elementos = [];
let indiceActual = 0;
let segundoActual = 0;
let youtubePlayer = null;
let youtubeApiLista = false;
let reproduccionSolicitada = false;
let sonidoActivado = false;
let desfaseRelojServidorMs = 0;
let temporizadorSincronizacion = null;
let sincronizando = false;

const ui = {
  status: document.getElementById('broadcastStatus'),
  description: document.getElementById('broadcastDescription'),
  nowTitle: document.getElementById('nowTitle'),
  nextTitle: document.getElementById('nextTitle'),
  fallback: document.getElementById('playerFallback'),
  playerStatus: document.getElementById('playerStatus'),
  playerAction: document.getElementById('playerAction'),
  playerCaption: document.getElementById('playerCaption'),
  soundInvitation: document.getElementById('soundInvitation')
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
  if (reproduccionSolicitada) sincronizarCanal({ forzarCarga: true });
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
      const marcador = partes.findIndex((p) => ['live', 'embed', 'shorts'].includes(p));
      if (marcador >= 0) return partes[marcador + 1] || '';
    }
  } catch (_) {
    return '';
  }
  return '';
}

function duracionElemento(elemento) {
  const duracion = Number(elemento?.duracionSegundos);
  return Number.isFinite(duracion) && duracion > 0 ? Math.floor(duracion) : 0;
}

function ahoraCanalMs() {
  return Date.now() + desfaseRelojServidorMs;
}

function calcularPosicionCanal() {
  const duraciones = elementos.map(duracionElemento);
  const duracionTotal = duraciones.reduce((total, duracion) => total + duracion, 0);

  if (!duracionTotal || duraciones.some((duracion) => duracion <= 0)) {
    throw new Error('Todos los videos activos deben tener una duración válida para sincronizar la señal.');
  }

  const transcurridoTotal = Math.max(0, Math.floor((ahoraCanalMs() - EPOCA_CANAL_UTC) / 1000));
  const repetir = configuracion?.playlist?.repetir !== false;

  if (!repetir && transcurridoTotal >= duracionTotal) {
    return { finalizada: true, indice: elementos.length - 1, segundo: duraciones.at(-1), duracionTotal };
  }

  let posicionCiclo = repetir ? transcurridoTotal % duracionTotal : transcurridoTotal;

  for (let indice = 0; indice < duraciones.length; indice += 1) {
    if (posicionCiclo < duraciones[indice]) {
      return {
        finalizada: false,
        indice,
        segundo: posicionCiclo,
        duracionTotal
      };
    }
    posicionCiclo -= duraciones[indice];
  }

  return { finalizada: false, indice: 0, segundo: 0, duracionTotal };
}

async function consultarTransmision() {
  let ultimoError = null;
  for (const endpoint of API_ENDPOINTS) {
    try {
      const inicioSolicitud = Date.now();
      const respuesta = await fetch(`${endpoint}?t=${inicioSolicitud}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      const finSolicitud = Date.now();
      const fechaServidor = Date.parse(respuesta.headers.get('date') || '');
      if (Number.isFinite(fechaServidor)) {
        const puntoMedioCliente = inicioSolicitud + ((finSolicitud - inicioSolicitud) / 2);
        desfaseRelojServidorMs = fechaServidor - puntoMedioCliente;
      }
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok || !datos.ok) {
        throw new Error(datos.mensaje || `Respuesta HTTP ${respuesta.status}`);
      }
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
  ui.soundInvitation.hidden = true;
}

function actualizarInformacion() {
  const actual = elementos[indiceActual];
  const siguiente = elementos[(indiceActual + 1) % elementos.length];
  ui.status.textContent = configuracion?.transmision?.leyendaEstado || 'TRANSMISIÓN CONTINUA';
  ui.description.textContent = configuracion?.transmision?.descripcion || configuracion?.playlist?.descripcion || 'Programación digital continua de QRO TV DIGITAL.';
  ui.nowTitle.textContent = actual?.titulo || 'Contenido sin título';
  if (elementos.length > 1) ui.nextTitle.textContent = `Siguiente: ${siguiente?.titulo || 'Contenido siguiente'}`;
  else if (configuracion?.playlist?.repetir !== false) ui.nextTitle.textContent = 'Esta transmisión se repetirá al finalizar.';
  else ui.nextTitle.textContent = 'Último contenido de la playlist.';
}

function mostrarInvitacionSonido() {
  if (!ui.soundInvitation || sonidoActivado) return;
  ui.soundInvitation.hidden = false;
}

function ocultarInvitacionSonido() {
  if (ui.soundInvitation) ui.soundInvitation.hidden = true;
}

function mostrarProgramacionFinalizada() {
  ui.fallback.hidden = false;
  ui.playerStatus.textContent = 'PROGRAMACIÓN FINALIZADA';
  ui.playerCaption.textContent = 'La playlist llegó al final.';
  ui.playerAction.hidden = false;
  ocultarInvitacionSonido();
  try { youtubePlayer?.pauseVideo?.(); } catch (_) {}
}

function cargarYoutube(elemento, segundoInicio = 0) {
  const videoId = extraerYoutubeId(elemento?.referenciaVideo);
  if (!videoId) return sincronizarCanal({ forzarCarga: true });

  actualizarInformacion();
  ui.fallback.hidden = true;

  if (!youtubePlayer) {
    youtubePlayer = new YT.Player('youtubePlayer', {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        mute: 1,
        start: Math.floor(segundoInicio),
        playsinline: 1,
        rel: 0,
        modestbranding: 1
      },
      events: {
        onReady: (event) => {
          event.target.mute();
          if (segundoInicio > 0) event.target.seekTo(segundoInicio, true);
          event.target.playVideo();
          mostrarInvitacionSonido();
        },
        onStateChange: (event) => {
          if (event.data === YT.PlayerState.PLAYING && !sonidoActivado) mostrarInvitacionSonido();
          if (event.data === YT.PlayerState.ENDED) sincronizarCanal({ forzarCarga: true });
        },
        onAutoplayBlocked: () => {
          ui.fallback.hidden = false;
          ui.playerStatus.textContent = 'TOCA PARA REPRODUCIR';
          ui.playerCaption.textContent = 'El navegador bloqueó la reproducción automática.';
          ui.playerAction.textContent = '▶';
          ui.playerAction.hidden = false;
        },
        onError: () => sincronizarCanal({ forzarCarga: true })
      }
    });
  } else {
    if (!sonidoActivado) youtubePlayer.mute();
    youtubePlayer.loadVideoById({ videoId, startSeconds: Math.max(0, segundoInicio) });
    if (sonidoActivado) youtubePlayer.unMute();
    mostrarInvitacionSonido();
  }
}

function sincronizarCanal({ forzarCarga = false } = {}) {
  if (sincronizando || !elementos.length) return;
  sincronizando = true;

  try {
    const posicion = calcularPosicionCanal();
    if (posicion.finalizada) {
      mostrarProgramacionFinalizada();
      return;
    }

    const cambioElemento = posicion.indice !== indiceActual;
    indiceActual = posicion.indice;
    segundoActual = posicion.segundo;
    actualizarInformacion();

    if (!youtubeApiLista || !window.YT?.Player) {
      reproduccionSolicitada = true;
      ui.playerCaption.textContent = 'Preparando YouTube…';
      return;
    }

    reproduccionSolicitada = false;
    const elemento = elementos[indiceActual];
    if (elemento?.tipoFuente !== 'YOUTUBE') {
      mostrarError(`El origen ${elemento?.tipoFuente || 'desconocido'} todavía no está habilitado.`);
      return;
    }

    if (!youtubePlayer || cambioElemento || forzarCarga) {
      cargarYoutube(elemento, segundoActual);
      return;
    }

    const tiempoReproductor = Number(youtubePlayer.getCurrentTime?.());
    const desfase = Number.isFinite(tiempoReproductor)
      ? Math.abs(tiempoReproductor - segundoActual)
      : Infinity;

    if (desfase > TOLERANCIA_DESFASE_SEGUNDOS) {
      youtubePlayer.seekTo(segundoActual, true);
    }

    const estado = youtubePlayer.getPlayerState?.();
    if (estado !== YT.PlayerState.PLAYING && estado !== YT.PlayerState.BUFFERING) {
      youtubePlayer.playVideo();
    }
  } catch (error) {
    console.error('No fue posible sincronizar el canal:', error);
    mostrarError(error?.message || 'No fue posible sincronizar la señal.');
  } finally {
    sincronizando = false;
  }
}

function iniciarMonitorSincronizacion() {
  clearInterval(temporizadorSincronizacion);
  temporizadorSincronizacion = setInterval(() => {
    if (!document.hidden) sincronizarCanal();
  }, INTERVALO_REVISION_MS);
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
    if (modo !== 'PLAYLIST') return mostrarError('La señal externa todavía no está habilitada.');
    elementos = Array.isArray(configuracion.elementos)
      ? configuracion.elementos.filter((item) => item.referenciaVideo)
      : [];
    if (!configuracion.playlist || !elementos.length) {
      return mostrarError('La transmisión activa no contiene videos disponibles.');
    }
    sincronizarCanal({ forzarCarga: true });
    iniciarMonitorSincronizacion();
  } catch (error) {
    console.error('No fue posible iniciar la transmisión:', error);
    mostrarError(error?.message || 'No fue posible conectar con la señal.');
  }
}

ui.soundInvitation?.addEventListener('click', () => {
  if (!youtubePlayer) return;
  try {
    youtubePlayer.unMute();
    youtubePlayer.setVolume(100);
    youtubePlayer.playVideo();
    sonidoActivado = true;
    ocultarInvitacionSonido();
  } catch (error) {
    console.warn('No fue posible activar el sonido:', error);
  }
});

ui.playerAction?.addEventListener('click', () => {
  if (youtubePlayer?.playVideo) {
    sincronizarCanal({ forzarCarga: true });
    ui.fallback.hidden = true;
    mostrarInvitacionSonido();
  } else {
    iniciarReproduccion();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) sincronizarCanal({ forzarCarga: true });
});

window.addEventListener('pageshow', () => sincronizarCanal({ forzarCarga: true }));
window.addEventListener('online', () => iniciarReproduccion());

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
