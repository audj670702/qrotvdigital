const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.topbar nav');

const API_ENDPOINTS = [
  'https://www.scad.mx/_functions/qtdTransmision',
  'https://scad.mx/_functions/qtdTransmision'
];

const INTERVALO_REVISION_MS = 10000;
const TOLERANCIA_DESFASE_SEGUNDOS = 3;

let configuracion = null;
let elementos = [];
let indiceActual = 0;
let segundoActual = 0;
let youtubePlayer = null;
let youtubeApiLista = false;
let youtubePlayerListo = false;
let reproduccionSolicitada = false;
let sonidoActivado = false;
let desfaseRelojServidorMs = 0;
let temporizadorSincronizacion = null;
let sincronizando = false;
let actualizandoConfiguracion = false;
let firmaConfiguracionActual = '';

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

    if (host === 'youtu.be') {
      return url.pathname.split('/').filter(Boolean)[0] || '';
    }

    if (host.endsWith('youtube.com')) {
      if (url.searchParams.get('v')) return url.searchParams.get('v');
      const partes = url.pathname.split('/').filter(Boolean);
      const marcador = partes.findIndex((p) => ['live', 'embed', 'shorts'].includes(p));
      if (marcador >= 0) return partes[marcador + 1] || '';
    }
  } catch (_) {}

  return '';
}

function duracionElemento(elemento) {
  const duracion = Number(elemento?.duracionSegundos);
  return Number.isFinite(duracion) && duracion > 0 ? Math.floor(duracion) : 0;
}

function ahoraCanalMs() {
  return Date.now() + desfaseRelojServidorMs;
}

function obtenerInicioEmisionMs() {
  const inicio = Date.parse(configuracion?.transmision?.inicioEmision || '');
  if (!Number.isFinite(inicio)) {
    throw new Error('La transmisión no tiene una hora de inicio configurada.');
  }
  return inicio;
}

function firmaConfiguracion(datos) {
  return JSON.stringify({
    transmisionId: datos?.transmision?.id || '',
    playlistId: datos?.transmision?.playlistId || datos?.playlist?.id || '',
    modoEmision: datos?.transmision?.modoEmision || '',
    inicioEmision: datos?.transmision?.inicioEmision || '',
    repetir: datos?.playlist?.repetir !== false,
    elementos: Array.isArray(datos?.elementos)
      ? datos.elementos.map((item) => ({
          id: item.id || '',
          orden: Number(item.orden) || 0,
          duracionSegundos: duracionElemento(item),
          referenciaVideo: item.referenciaVideo || '',
          tipoFuente: item.tipoFuente || ''
        }))
      : []
  });
}

function aplicarConfiguracion(datos) {
  const transmision = datos?.transmision || {};
  const modo = transmision.modoEmision || 'FUERA_DEL_AIRE';

  if (modo === 'FUERA_DEL_AIRE') throw new Error('La señal se encuentra fuera del aire.');
  if (modo !== 'PLAYLIST') throw new Error('La señal externa todavía no está habilitada.');

  const nuevosElementos = Array.isArray(datos?.elementos)
    ? datos.elementos.filter((item) => item.referenciaVideo)
    : [];

  if (!datos?.playlist || !nuevosElementos.length) {
    throw new Error('La transmisión activa no contiene videos disponibles.');
  }

  const nuevaFirma = firmaConfiguracion(datos);
  const cambio = firmaConfiguracionActual !== '' && nuevaFirma !== firmaConfiguracionActual;

  configuracion = datos;
  elementos = nuevosElementos;
  firmaConfiguracionActual = nuevaFirma;

  return cambio;
}

function calcularPosicionCanal() {
  const duraciones = elementos.map(duracionElemento);
  const duracionTotal = duraciones.reduce((total, duracion) => total + duracion, 0);

  if (!duracionTotal || duraciones.some((duracion) => duracion <= 0)) {
    throw new Error('Todos los videos activos deben tener una duración válida para sincronizar la señal.');
  }

  const inicioEmisionMs = obtenerInicioEmisionMs();
  const diferenciaMs = ahoraCanalMs() - inicioEmisionMs;

  if (diferenciaMs < 0) {
    return {
      programada: true,
      inicioEmisionMs,
      finalizada: false,
      indice: 0,
      segundo: 0,
      duracionTotal
    };
  }

  const transcurridoTotal = Math.floor(diferenciaMs / 1000);
  const repetir = configuracion?.playlist?.repetir !== false;

  if (!repetir && transcurridoTotal >= duracionTotal) {
    return {
      programada: false,
      finalizada: true,
      indice: elementos.length - 1,
      segundo: duraciones.at(-1),
      duracionTotal
    };
  }

  let posicionCiclo = repetir ? transcurridoTotal % duracionTotal : transcurridoTotal;

  for (let indice = 0; indice < duraciones.length; indice += 1) {
    if (posicionCiclo < duraciones[indice]) {
      return {
        programada: false,
        finalizada: false,
        indice,
        segundo: posicionCiclo,
        duracionTotal
      };
    }
    posicionCiclo -= duraciones[indice];
  }

  return { programada: false, finalizada: false, indice: 0, segundo: 0, duracionTotal };
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

async function actualizarConfiguracionRemota() {
  if (actualizandoConfiguracion) return false;
  actualizandoConfiguracion = true;

  try {
    return aplicarConfiguracion(await consultarTransmision());
  } finally {
    actualizandoConfiguracion = false;
  }
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
  ui.description.textContent =
    configuracion?.transmision?.descripcion ||
    configuracion?.playlist?.descripcion ||
    'Programación digital continua de QRO TV DIGITAL.';
  ui.nowTitle.textContent = actual?.titulo || 'Contenido sin título';

  if (elementos.length > 1) {
    ui.nextTitle.textContent = `Siguiente: ${siguiente?.titulo || 'Contenido siguiente'}`;
  } else if (configuracion?.playlist?.repetir !== false) {
    ui.nextTitle.textContent = 'Esta transmisión se repetirá al finalizar.';
  } else {
    ui.nextTitle.textContent = 'Último contenido de la playlist.';
  }
}

function mostrarInvitacionSonido() {
  if (!ui.soundInvitation || sonidoActivado) return;
  ui.soundInvitation.hidden = false;
}

function ocultarInvitacionSonido() {
  if (ui.soundInvitation) ui.soundInvitation.hidden = true;
}

function mostrarTransmisionProgramada(inicioEmisionMs) {
  const inicioTexto = new Date(inicioEmisionMs).toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  ui.status.textContent = 'TRANSMISIÓN PROGRAMADA';
  ui.description.textContent = `La señal comenzará el ${inicioTexto}.`;
  ui.nowTitle.textContent = 'Próxima transmisión';
  ui.nextTitle.textContent = configuracion?.playlist?.nombre || 'Playlist programada';
  ui.playerStatus.textContent = 'PROGRAMADA';
  ui.playerCaption.textContent = `Inicio: ${inicioTexto}`;
  ui.playerAction.hidden = true;
  ui.fallback.hidden = false;
  ocultarInvitacionSonido();
  youtubePlayer?.pauseVideo?.();
}

function mostrarProgramacionFinalizada() {
  ui.fallback.hidden = false;
  ui.playerStatus.textContent = 'PROGRAMACIÓN FINALIZADA';
  ui.playerCaption.textContent = 'La playlist llegó al final.';
  ui.playerAction.hidden = false;
  ocultarInvitacionSonido();
  youtubePlayer?.pauseVideo?.();
}

function cargarYoutube(elemento, segundoInicio = 0) {
  const videoId = extraerYoutubeId(elemento?.referenciaVideo);

  if (!videoId) {
    mostrarError('La referencia del video actual no es válida.');
    return;
  }

  actualizarInformacion();
  ui.fallback.hidden = true;

  if (!youtubePlayer) {
    youtubePlayerListo = false;
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
          youtubePlayerListo = true;
          event.target.mute?.();
          if (segundoInicio > 0) event.target.seekTo?.(segundoInicio, true);
          event.target.playVideo?.();
          mostrarInvitacionSonido();
        },
        onStateChange: (event) => {
          if (event.data === YT.PlayerState.PLAYING && !sonidoActivado) {
            mostrarInvitacionSonido();
          }
          if (event.data === YT.PlayerState.ENDED) {
            sincronizarCanal({ forzarCarga: true });
          }
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
    return;
  }

  if (!youtubePlayerListo) {
    reproduccionSolicitada = true;
    ui.playerCaption.textContent = 'Preparando YouTube…';
    return;
  }

  if (!sonidoActivado) youtubePlayer.mute?.();
  youtubePlayer.loadVideoById?.({
    videoId,
    startSeconds: Math.max(0, segundoInicio)
  });
  if (sonidoActivado) youtubePlayer.unMute?.();
  mostrarInvitacionSonido();
}

function sincronizarCanal({ forzarCarga = false } = {}) {
  if (sincronizando || !elementos.length) return;
  sincronizando = true;

  try {
    const posicion = calcularPosicionCanal();

    if (posicion.programada) {
      mostrarTransmisionProgramada(posicion.inicioEmisionMs);
      return;
    }

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

    if (!youtubePlayerListo) return;

    const tiempoReproductor = Number(youtubePlayer.getCurrentTime?.());
    const desfase = Number.isFinite(tiempoReproductor)
      ? Math.abs(tiempoReproductor - segundoActual)
      : Infinity;

    if (desfase > TOLERANCIA_DESFASE_SEGUNDOS) {
      youtubePlayer.seekTo?.(segundoActual, true);
    }

    const estadoReproductor = youtubePlayer.getPlayerState?.();
    if (
      estadoReproductor !== YT.PlayerState.PLAYING &&
      estadoReproductor !== YT.PlayerState.BUFFERING
    ) {
      youtubePlayer.playVideo?.();
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

  temporizadorSincronizacion = setInterval(async () => {
    if (document.hidden) return;

    try {
      const cambioConfiguracion = await actualizarConfiguracionRemota();
      sincronizarCanal({ forzarCarga: cambioConfiguracion });
    } catch (error) {
      console.warn('No fue posible actualizar la programación remota:', error);
      sincronizarCanal();
    }
  }, INTERVALO_REVISION_MS);
}

async function iniciarReproduccion() {
  try {
    ui.playerStatus.textContent = 'CARGANDO';
    ui.playerCaption.textContent = 'Consultando programación…';
    ui.playerAction.hidden = true;

    aplicarConfiguracion(await consultarTransmision());
    sincronizarCanal({ forzarCarga: true });
    iniciarMonitorSincronizacion();
  } catch (error) {
    console.error('No fue posible iniciar la transmisión:', error);
    mostrarError(error?.message || 'No fue posible conectar con la señal.');
  }
}

ui.soundInvitation?.addEventListener('click', () => {
  if (!youtubePlayerListo || !youtubePlayer) return;

  try {
    youtubePlayer.unMute?.();
    youtubePlayer.setVolume?.(100);
    youtubePlayer.playVideo?.();
    sonidoActivado = true;
    ocultarInvitacionSonido();
  } catch (error) {
    console.warn('No fue posible activar el sonido:', error);
  }
});

ui.playerAction?.addEventListener('click', () => {
  if (youtubePlayerListo && youtubePlayer?.playVideo) {
    sincronizarCanal({ forzarCarga: true });
    ui.fallback.hidden = true;
    mostrarInvitacionSonido();
  } else {
    iniciarReproduccion();
  }
});

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;

  try {
    await actualizarConfiguracionRemota();
  } catch (_) {}
  sincronizarCanal({ forzarCarga: true });
});

window.addEventListener('pageshow', async () => {
  try {
    await actualizarConfiguracionRemota();
  } catch (_) {}
  sincronizarCanal({ forzarCarga: true });
});

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
  if (event.key === 'Escape' && !installModal?.hidden) {
    cerrarModalInstalacion();
  }
});

actualizarBotonInstalacion();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((error) => {
      console.warn('No fue posible registrar el service worker:', error);
    });
  });
}
