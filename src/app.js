const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.topbar nav');

const API_ENDPOINTS = [
  'https://www.scad.mx/_functions/qtdTransmision',
  'https://scad.mx/_functions/qtdTransmision'
];

const INTERVALO_REVISION_MS = 5000;
const TOLERANCIA_DESFASE_SEGUNDOS = 3;
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
  `;
  document.head.appendChild(estiloMonitor);
}

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
let modoActualReproductor = '';

const ui = {
  status: document.getElementById('broadcastStatus'),
  description: document.getElementById('broadcastDescription'),
  nowTitle: document.getElementById('nowTitle'),
  nextTitle: document.getElementById('nextTitle'),
  fallback: document.getElementById('playerFallback'),
  playerStatus: document.getElementById('playerStatus'),
  playerAction: document.getElementById('playerAction'),
  playerCaption: document.getElementById('playerCaption'),
  soundInvitation: document.getElementById('soundInvitation'),
  liveBadge: document.getElementById('liveBadge')
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

function texto(valor, respaldo = '') {
  const salida = String(valor ?? '').trim();
  return salida || respaldo;
}

function booleano(valor, respaldo = false) {
  if (typeof valor === 'boolean') return valor;
  if (valor === 1 || valor === '1') return true;
  if (valor === 0 || valor === '0') return false;

  const normalizado = String(valor ?? '').trim().toLowerCase();

  if (['true', 'si', 'sí', 'yes', 'activo', 'activa'].includes(normalizado)) {
    return true;
  }

  if (['false', 'no', 'inactivo', 'inactiva'].includes(normalizado)) {
    return false;
  }

  return respaldo;
}

function normalizarModo(valor = '') {
  const modo = String(valor)
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');

  if (['PLAYLIST', 'PLAYLIST_CONTINUA', 'CONTINUA', 'TRANSMISION_CONTINUA'].includes(modo)) {
    return 'PLAYLIST';
  }

  if (
    [
      'SENAL_EXTERNA',
      'SEÑAL_EXTERNA',
      'EXTERNA',
      'EN_VIVO',
      'ENVIVO',
      'LIVE'
    ].includes(modo)
  ) {
    return 'SENAL_EXTERNA';
  }

  if (['FUERA_DEL_AIRE', 'OFF_AIR', 'SIN_SENAL', 'SIN_SEÑAL'].includes(modo)) {
    return 'FUERA_DEL_AIRE';
  }

  return modo || 'FUERA_DEL_AIRE';
}

function normalizarTipoFuente(valor = '') {
  const fuente = String(valor)
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (fuente.includes('YOUTUBE')) return 'YOUTUBE';
  if (fuente.includes('VIMEO')) return 'VIMEO';
  if (fuente.includes('HLS')) return 'HLS';
  if (fuente.includes('MP4')) return 'MP4';
  if (fuente.includes('IFRAME')) return 'IFRAME';

  return fuente || 'OTRO';
}

function extraerYoutubeId(referencia = '') {
  const valor = String(referencia).trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(valor)) {
    return valor;
  }

  try {
    const url = new URL(valor);
    const host = url.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      return url.pathname.split('/').filter(Boolean)[0] || '';
    }

    if (host.endsWith('youtube.com')) {
      const parametroV = url.searchParams.get('v');
      if (parametroV) return parametroV;

      const partes = url.pathname.split('/').filter(Boolean);
      const marcador = partes.findIndex((parte) =>
        ['live', 'embed', 'shorts'].includes(parte)
      );

      if (marcador >= 0) {
        return partes[marcador + 1] || '';
      }
    }
  } catch (_) {}

  return '';
}

function obtenerReferenciaExterna(transmision = {}) {
  return texto(
    transmision.urlTransmision ??
      transmision.urlSenal ??
      transmision.urlSeñal ??
      transmision.urlExterna ??
      transmision.referenciaVideo ??
      transmision.videoUrl ??
      transmision.url ??
      transmision.enlace
  );
}

function obtenerTipoFuenteExterna(transmision = {}) {
  return normalizarTipoFuente(
    transmision.tipoFuente ??
      transmision.fuenteTipo ??
      transmision.tipoSenal ??
      transmision.tipoSeñal ??
      'YOUTUBE'
  );
}

function duracionElemento(elemento) {
  const duracion = Number(elemento?.duracionSegundos);
  return Number.isFinite(duracion) && duracion > 0
    ? Math.floor(duracion)
    : 0;
}

function ahoraCanalMs() {
  return Date.now() + desfaseRelojServidorMs;
}

function obtenerInicioEmisionMs() {
  const inicio = Date.parse(configuracion?.transmision?.inicioEmision || '');

  if (!Number.isFinite(inicio)) {
    throw new Error(
      'La transmisión no tiene una hora de inicio configurada.'
    );
  }

  return inicio;
}

function firmaConfiguracion(datos) {
  const transmision = datos?.transmision || {};

  return JSON.stringify({
    transmisionId: transmision.id || '',
    activa:
      transmision.activa ??
      transmision.transmisionActiva ??
      transmision.esActiva ??
      true,
    modoEmision: normalizarModo(transmision.modoEmision),
    inicioEmision: transmision.inicioEmision || '',
    playlistId:
      transmision.playlistId ??
      datos?.playlist?.id ??
      '',
    tipoFuente: obtenerTipoFuenteExterna(transmision),
    urlExterna: obtenerReferenciaExterna(transmision),
    leyendaEstado: transmision.leyendaEstado || '',
    descripcion: transmision.descripcion || '',
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
  if (!datos?.transmision) {
    throw new Error('No se recibió una configuración de transmisión válida.');
  }

  const transmision = datos.transmision;
  const activa = booleano(
    transmision.activa ??
      transmision.transmisionActiva ??
      transmision.esActiva,
    true
  );

  if (!activa) {
    throw new Error('La transmisión se encuentra desactivada.');
  }

  const nuevaFirma = firmaConfiguracion(datos);
  const cambio =
    firmaConfiguracionActual !== '' &&
    nuevaFirma !== firmaConfiguracionActual;

  configuracion = datos;
  elementos = Array.isArray(datos.elementos)
    ? datos.elementos.filter((item) => item.referenciaVideo)
    : [];

  firmaConfiguracionActual = nuevaFirma;

  return cambio;
}

function calcularPosicionCanal() {
  const duraciones = elementos.map(duracionElemento);
  const duracionTotal = duraciones.reduce(
    (total, duracion) => total + duracion,
    0
  );

  if (!duracionTotal || duraciones.some((duracion) => duracion <= 0)) {
    throw new Error(
      'Todos los videos activos deben tener una duración válida para sincronizar la señal.'
    );
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

  let posicionCiclo = repetir
    ? transcurridoTotal % duracionTotal
    : transcurridoTotal;

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

  return {
    programada: false,
    finalizada: false,
    indice: 0,
    segundo: 0,
    duracionTotal
  };
}

async function consultarTransmision() {
  let ultimoError = null;

  for (const endpoint of API_ENDPOINTS) {
    try {
      const inicioSolicitud = Date.now();

      const respuesta = await fetch(`${endpoint}?t=${inicioSolicitud}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/json'
        }
      });

      const finSolicitud = Date.now();
      const fechaServidor = Date.parse(
        respuesta.headers.get('date') || ''
      );

      if (Number.isFinite(fechaServidor)) {
        const puntoMedioCliente =
          inicioSolicitud + (finSolicitud - inicioSolicitud) / 2;

        desfaseRelojServidorMs =
          fechaServidor - puntoMedioCliente;
      }

      const datos = await respuesta.json().catch(() => ({}));

      if (!respuesta.ok || !datos.ok) {
        throw new Error(
          datos.mensaje || `Respuesta HTTP ${respuesta.status}`
        );
      }

      return datos;
    } catch (error) {
      ultimoError = error;
    }
  }

  throw (
    ultimoError ||
    new Error('No fue posible consultar la transmisión.')
  );
}

async function actualizarConfiguracionRemota() {
  if (actualizandoConfiguracion) return false;

  actualizandoConfiguracion = true;

  try {
    return aplicarConfiguracion(
      await consultarTransmision()
    );
  } finally {
    actualizandoConfiguracion = false;
  }
}

function ocultarInvitacionSonido() {
  if (ui.soundInvitation) {
    ui.soundInvitation.hidden = true;
  }
}

function mostrarInvitacionSonido() {
  if (!ui.soundInvitation || sonidoActivado) return;
  ui.soundInvitation.hidden = false;
}

function pausarReproductor() {
  try {
    youtubePlayer?.pauseVideo?.();
  } catch (_) {}
}

function actualizarIndicadorEnVivo() {
  if (!ui.liveBadge) return;

  const modo = normalizarModo(
    configuracion?.transmision?.modoEmision
  );

  const visible =
    modo !== 'FUERA_DEL_AIRE' &&
    configuracion?.transmision?.enVivo === true;

  ui.liveBadge.hidden = !visible;
}

function mostrarError(mensaje) {
  if (ui.liveBadge) ui.liveBadge.hidden = true;
  ui.status.textContent = 'SEÑAL NO DISPONIBLE';
  ui.description.textContent = mensaje;
  ui.nowTitle.textContent = 'Sin transmisión';
  ui.nextTitle.textContent =
    'Intenta nuevamente en unos momentos.';

  ui.playerStatus.textContent = 'SIN SEÑAL';
  ui.playerCaption.textContent = mensaje;
  ui.playerAction.textContent = '↻';
  ui.playerAction.hidden = false;
  ui.fallback.hidden = false;

  ocultarInvitacionSonido();
}

function mostrarFueraDelAire() {
  modoActualReproductor = 'FUERA_DEL_AIRE';
  if (ui.liveBadge) ui.liveBadge.hidden = true;
  pausarReproductor();

  ui.status.textContent = 'FUERA DEL AIRE';
  ui.description.textContent =
    configuracion?.transmision?.descripcion ||
    'La señal no se encuentra disponible en este momento.';

  ui.nowTitle.textContent = 'Programación no disponible';
  ui.nextTitle.textContent =
    'Consulta nuevamente más tarde.';

  ui.playerStatus.textContent = 'FUERA DEL AIRE';
  ui.playerCaption.textContent =
    'La transmisión se encuentra temporalmente fuera del aire.';
  ui.playerAction.hidden = true;
  ui.fallback.hidden = false;

  ocultarInvitacionSonido();
}

function mostrarTransmisionProgramada(inicioEmisionMs) {
  const inicioTexto = new Date(inicioEmisionMs).toLocaleString(
    'es-MX',
    {
      timeZone: 'America/Mexico_City',
      dateStyle: 'medium',
      timeStyle: 'short'
    }
  );

  ui.status.textContent = 'TRANSMISIÓN PROGRAMADA';
  ui.description.textContent =
    `La señal comenzará el ${inicioTexto}.`;
  ui.nowTitle.textContent = 'Próxima transmisión';
  ui.nextTitle.textContent =
    configuracion?.playlist?.nombre ||
    'Playlist programada';

  ui.playerStatus.textContent = 'PROGRAMADA';
  ui.playerCaption.textContent = `Inicio: ${inicioTexto}`;
  ui.playerAction.hidden = true;
  ui.fallback.hidden = false;

  ocultarInvitacionSonido();
  pausarReproductor();
}

function mostrarProgramacionFinalizada() {
  ui.status.textContent = 'PROGRAMACIÓN FINALIZADA';
  ui.description.textContent =
    configuracion?.transmision?.descripcion ||
    'La playlist llegó al final.';
  ui.nowTitle.textContent = 'Fin de programación';
  ui.nextTitle.textContent =
    'Espera la siguiente programación.';

  ui.fallback.hidden = false;
  ui.playerStatus.textContent = 'PROGRAMACIÓN FINALIZADA';
  ui.playerCaption.textContent =
    'La playlist llegó al final.';
  ui.playerAction.hidden = true;

  ocultarInvitacionSonido();
  pausarReproductor();
}

function actualizarInformacionPlaylist() {
  const actual = elementos[indiceActual];
  const siguiente =
    elementos[(indiceActual + 1) % elementos.length];

  ui.status.textContent =
    configuracion?.transmision?.leyendaEstado ||
    'TRANSMISIÓN CONTINUA';

  ui.description.textContent =
    configuracion?.transmision?.descripcion ||
    configuracion?.playlist?.descripcion ||
    'Programación digital continua de QRO TV DIGITAL.';

  ui.nowTitle.textContent =
    actual?.titulo ||
    'Contenido sin título';

  if (elementos.length > 1) {
    ui.nextTitle.textContent =
      `Siguiente: ${siguiente?.titulo || 'Contenido siguiente'}`;
  } else if (configuracion?.playlist?.repetir !== false) {
    ui.nextTitle.textContent =
      'Esta transmisión se repetirá al finalizar.';
  } else {
    ui.nextTitle.textContent =
      'Último contenido de la playlist.';
  }
}

function actualizarInformacionEnVivo() {
  const transmision = configuracion?.transmision || {};

  ui.status.textContent =
    transmision.leyendaEstado ||
    transmision.estadoPublico ||
    'EN VIVO';

  ui.description.textContent =
    transmision.descripcion ||
    'Transmisión en vivo de QRO TV DIGITAL.';

  ui.nowTitle.textContent =
    transmision.nombre ||
    transmision.nombreInterno ||
    'Señal en vivo';

  ui.nextTitle.textContent =
    'Transmisión en tiempo real.';
}

function crearReproductorYoutube(videoId, segundoInicio = 0) {
  youtubePlayerListo = false;

  youtubePlayer = new YT.Player('youtubePlayer', {
    videoId,
    width: '100%',
    height: '100%',
    playerVars: {
      autoplay: 1,
      mute: 1,
      start: Math.max(0, Math.floor(segundoInicio)),
      playsinline: 1,
      rel: 0,
      modestbranding: 1
    },
    events: {
      onReady: (event) => {
        youtubePlayerListo = true;

        if (!sonidoActivado) {
          event.target.mute?.();
        }

        if (segundoInicio > 0) {
          event.target.seekTo?.(segundoInicio, true);
        }

        event.target.playVideo?.();

        ui.fallback.hidden = true;
        mostrarInvitacionSonido();
      },

      onStateChange: (event) => {
        if (
          event.data === YT.PlayerState.PLAYING &&
          !sonidoActivado
        ) {
          mostrarInvitacionSonido();
        }

        if (
          event.data === YT.PlayerState.ENDED &&
          modoActualReproductor === 'PLAYLIST'
        ) {
          sincronizarCanal({ forzarCarga: true });
        }
      },

      onAutoplayBlocked: () => {
        ui.fallback.hidden = false;
        ui.playerStatus.textContent =
          'TOCA PARA REPRODUCIR';
        ui.playerCaption.textContent =
          'El navegador bloqueó la reproducción automática.';
        ui.playerAction.textContent = '▶';
        ui.playerAction.hidden = false;
      },

      onError: (event) => {
        console.error(
          'Error del reproductor YouTube:',
          event?.data
        );

        ui.fallback.hidden = false;
        ui.playerStatus.textContent = 'ERROR DE VIDEO';
        ui.playerCaption.textContent =
          'YouTube no permitió reproducir esta señal.';
        ui.playerAction.textContent = '↻';
        ui.playerAction.hidden = false;
      }
    }
  });
}

function cargarYoutube(videoId, segundoInicio = 0) {
  if (!videoId) {
    mostrarError(
      'La referencia del video no es válida.'
    );
    return;
  }

  if (!youtubeApiLista || !window.YT?.Player) {
    reproduccionSolicitada = true;
    ui.playerCaption.textContent =
      'Preparando YouTube…';
    return;
  }

  reproduccionSolicitada = false;
  ui.fallback.hidden = true;

  if (!youtubePlayer) {
    crearReproductorYoutube(
      videoId,
      segundoInicio
    );
    return;
  }

  if (!youtubePlayerListo) {
    reproduccionSolicitada = true;
    ui.playerCaption.textContent =
      'Preparando reproductor…';
    return;
  }

  if (!sonidoActivado) {
    youtubePlayer.mute?.();
  }

  youtubePlayer.loadVideoById?.({
    videoId,
    startSeconds: Math.max(0, segundoInicio)
  });

  if (sonidoActivado) {
    youtubePlayer.unMute?.();
  }

  mostrarInvitacionSonido();
}

function reproducirPlaylist({ forzarCarga = false } = {}) {
  if (!configuracion?.playlist || !elementos.length) {
    throw new Error(
      'La transmisión activa no contiene una playlist disponible.'
    );
  }

  const posicion = calcularPosicionCanal();

  if (posicion.programada) {
    mostrarTransmisionProgramada(
      posicion.inicioEmisionMs
    );
    return;
  }

  if (posicion.finalizada) {
    mostrarProgramacionFinalizada();
    return;
  }

  const cambioModo =
    modoActualReproductor !== 'PLAYLIST';

  const cambioElemento =
    posicion.indice !== indiceActual;

  modoActualReproductor = 'PLAYLIST';
  indiceActual = posicion.indice;
  segundoActual = posicion.segundo;

  actualizarInformacionPlaylist();

  const elemento = elementos[indiceActual];

  if (
    normalizarTipoFuente(elemento?.tipoFuente) !== 'YOUTUBE'
  ) {
    throw new Error(
      `El origen ${elemento?.tipoFuente || 'desconocido'} todavía no está habilitado para playlists.`
    );
  }

  const videoId = extraerYoutubeId(
    elemento?.referenciaVideo
  );

  if (
    !youtubePlayer ||
    cambioModo ||
    cambioElemento ||
    forzarCarga
  ) {
    cargarYoutube(videoId, segundoActual);
    return;
  }

  if (!youtubePlayerListo) return;

  const tiempoReproductor = Number(
    youtubePlayer.getCurrentTime?.()
  );

  const desfase = Number.isFinite(tiempoReproductor)
    ? Math.abs(tiempoReproductor - segundoActual)
    : Infinity;

  if (desfase > TOLERANCIA_DESFASE_SEGUNDOS) {
    youtubePlayer.seekTo?.(
      segundoActual,
      true
    );
  }

  const estadoReproductor =
    youtubePlayer.getPlayerState?.();

  if (
    estadoReproductor !== YT.PlayerState.PLAYING &&
    estadoReproductor !== YT.PlayerState.BUFFERING
  ) {
    youtubePlayer.playVideo?.();
  }
}

function reproducirSenalExterna({ forzarCarga = false } = {}) {
  const transmision = configuracion?.transmision || {};
  const tipoFuente =
    obtenerTipoFuenteExterna(transmision);
  const referencia =
    obtenerReferenciaExterna(transmision);

  if (!referencia) {
    throw new Error(
      'La señal externa no tiene una URL configurada.'
    );
  }

  if (tipoFuente !== 'YOUTUBE') {
    throw new Error(
      `La fuente externa ${tipoFuente} todavía no está habilitada en la App.`
    );
  }

  const videoId = extraerYoutubeId(referencia);

  if (!videoId) {
    throw new Error(
      'La URL de YouTube configurada para la señal externa no es válida.'
    );
  }

  const cambioModo =
    modoActualReproductor !== 'SENAL_EXTERNA';

  modoActualReproductor = 'SENAL_EXTERNA';
  actualizarInformacionEnVivo();

  if (
    !youtubePlayer ||
    cambioModo ||
    forzarCarga
  ) {
    cargarYoutube(videoId, 0);
    return;
  }

  if (!youtubePlayerListo) return;

  const datosVideo =
    youtubePlayer.getVideoData?.() || {};

  if (datosVideo.video_id !== videoId) {
    cargarYoutube(videoId, 0);
    return;
  }

  const estadoReproductor =
    youtubePlayer.getPlayerState?.();

  if (
    estadoReproductor !== YT.PlayerState.PLAYING &&
    estadoReproductor !== YT.PlayerState.BUFFERING
  ) {
    youtubePlayer.playVideo?.();
  }
}

function sincronizarCanal({ forzarCarga = false } = {}) {
  if (sincronizando || !configuracion?.transmision) {
    return;
  }

  sincronizando = true;

  try {
    const modo = normalizarModo(
      configuracion.transmision.modoEmision
    );

    actualizarIndicadorEnVivo();

    if (modo === 'PLAYLIST') {
      reproducirPlaylist({ forzarCarga });
      return;
    }

    if (modo === 'SENAL_EXTERNA') {
      reproducirSenalExterna({ forzarCarga });
      return;
    }

    if (modo === 'FUERA_DEL_AIRE') {
      mostrarFueraDelAire();
      return;
    }

    throw new Error(
      `El modo de emisión ${modo} no está reconocido.`
    );
  } catch (error) {
    console.error(
      'No fue posible actualizar la salida del canal:',
      error
    );

    mostrarError(
      error?.message ||
      'No fue posible actualizar la señal.'
    );
  } finally {
    sincronizando = false;
  }
}

function iniciarMonitorSincronizacion() {
  clearInterval(temporizadorSincronizacion);

  temporizadorSincronizacion = setInterval(
    async () => {
      if (document.hidden) return;

      try {
        const cambioConfiguracion =
          await actualizarConfiguracionRemota();

        sincronizarCanal({
          forzarCarga: cambioConfiguracion
        });
      } catch (error) {
        console.warn(
          'No fue posible actualizar la transmisión remota:',
          error
        );

        sincronizarCanal();
      }
    },
    INTERVALO_REVISION_MS
  );
}

async function iniciarReproduccion() {
  try {
    ui.playerStatus.textContent = 'CARGANDO';
    ui.playerCaption.textContent =
      'Consultando programación…';
    ui.playerAction.hidden = true;

    aplicarConfiguracion(
      await consultarTransmision()
    );

    sincronizarCanal({
      forzarCarga: true
    });

    iniciarMonitorSincronizacion();
  } catch (error) {
    console.error(
      'No fue posible iniciar la transmisión:',
      error
    );

    mostrarError(
      error?.message ||
      'No fue posible conectar con la señal.'
    );
  }
}

ui.soundInvitation?.addEventListener(
  'click',
  () => {
    if (!youtubePlayerListo || !youtubePlayer) {
      return;
    }

    try {
      youtubePlayer.unMute?.();
      youtubePlayer.setVolume?.(100);
      youtubePlayer.playVideo?.();

      sonidoActivado = true;
      ocultarInvitacionSonido();
    } catch (error) {
      console.warn(
        'No fue posible activar el sonido:',
        error
      );
    }
  }
);

ui.playerAction?.addEventListener(
  'click',
  () => {
    if (
      youtubePlayerListo &&
      youtubePlayer?.playVideo
    ) {
      sincronizarCanal({
        forzarCarga: true
      });

      ui.fallback.hidden = true;
      mostrarInvitacionSonido();
    } else {
      iniciarReproduccion();
    }
  }
);

document.addEventListener(
  'visibilitychange',
  async () => {
    if (document.hidden) return;

    try {
      await actualizarConfiguracionRemota();
    } catch (_) {}

    sincronizarCanal({
      forzarCarga: true
    });
  }
);

window.addEventListener(
  'pageshow',
  async () => {
    try {
      await actualizarConfiguracionRemota();
    } catch (_) {}

    sincronizarCanal({
      forzarCarga: true
    });
  }
);

window.addEventListener(
  'online',
  () => iniciarReproduccion()
);

iniciarReproduccion();

/* ============================================================
   INSTALACIÓN PWA
   ============================================================ */

let deferredInstallPrompt = null;

const installButton =
  document.getElementById('installAppButton');

const installModal =
  document.getElementById('installModal');

const closeInstallModal =
  document.getElementById('closeInstallModal');

const installModalAction =
  document.getElementById('installModalAction');

const iosInstallSteps =
  document.getElementById('iosInstallSteps');

const installModalText =
  document.getElementById('installModalText');

const esIOS =
  /iphone|ipad|ipod/i.test(navigator.userAgent);

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
    installModalAction.textContent =
      deferredInstallPrompt
        ? 'Instalar'
        : 'Cerrar';

    installModalText.textContent =
      deferredInstallPrompt
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
  installButton.innerHTML =
    '<span aria-hidden="true">＋</span> Instalar';
}

window.addEventListener(
  'beforeinstallprompt',
  (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    actualizarBotonInstalacion();
  }
);

window.addEventListener(
  'appinstalled',
  () => {
    deferredInstallPrompt = null;

    if (installButton) {
      installButton.disabled = true;
      installButton.textContent = '✓ Instalada';
    }

    cerrarModalInstalacion();
  }
);

installButton?.addEventListener(
  'click',
  abrirModalInstalacion
);

closeInstallModal?.addEventListener(
  'click',
  cerrarModalInstalacion
);

installModal?.addEventListener(
  'click',
  (event) => {
    if (event.target === installModal) {
      cerrarModalInstalacion();
    }
  }
);

installModalAction?.addEventListener(
  'click',
  async () => {
    if (esIOS || !deferredInstallPrompt) {
      cerrarModalInstalacion();
      return;
    }

    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;

    deferredInstallPrompt = null;
    cerrarModalInstalacion();
    actualizarBotonInstalacion();
  }
);

document.addEventListener(
  'keydown',
  (event) => {
    if (
      event.key === 'Escape' &&
      !installModal?.hidden
    ) {
      cerrarModalInstalacion();
    }
  }
);

actualizarBotonInstalacion();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./service-worker.js')
      .catch((error) => {
        console.warn(
          'No fue posible registrar el service worker:',
          error
        );
      });
  });
}
