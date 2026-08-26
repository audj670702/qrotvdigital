const QTD_PUBLIC_STATUS_URL = 'https://www.scad.mx/_functions/qtdTransmision';
const REFRESH_ON_AIR_MS = 15000;

const onAirTitle = document.getElementById('nowTitle');
const onAirDetail = document.getElementById('nextTitle');
const onAirDescription = document.getElementById('broadcastDescription');
const onAirPlayer = document.getElementById('channelPlayer');

function texto(valor) {
  return String(valor ?? '').trim();
}

function obtenerTransmision(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return payload.transmision || payload.data?.transmision || payload.data || payload;
}

function aplicarContenidoAlAire(payload) {
  const t = obtenerTransmision(payload);
  const titulo = texto(t.tituloActual || t.titulo || t.nombreVideo || t.nombre);
  const descripcion = texto(t.descripcionActual || t.descripcion || '');

  if (onAirTitle) {
    onAirTitle.textContent = titulo || 'Contenido en transmisión';
  }

  if (onAirDetail) {
    onAirDetail.textContent = descripcion;
  }

  if (onAirDescription) {
    onAirDescription.textContent = descripcion || 'Señal en transmisión.';
  }
}

async function actualizarContenidoAlAire() {
  try {
    const respuesta = await fetch(`${QTD_PUBLIC_STATUS_URL}?t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });

    if (!respuesta.ok) throw new Error(`HTTP_${respuesta.status}`);

    const payload = await respuesta.json();
    aplicarContenidoAlAire(payload);
  } catch (error) {
    console.warn('TVD: no fue posible actualizar la referencia del contenido al aire.', error);

    if (onAirTitle && /QRO TV DIGITAL/i.test(onAirTitle.textContent || '')) {
      onAirTitle.textContent = 'Contenido en transmisión';
    }
    if (onAirDetail && /motor de continuidad/i.test(onAirDetail.textContent || '')) {
      onAirDetail.textContent = '';
    }
    if (onAirDescription && /QRO TV DIGITAL/i.test(onAirDescription.textContent || '')) {
      onAirDescription.textContent = 'Señal en transmisión.';
    }
  }
}

actualizarContenidoAlAire();
setInterval(actualizarContenidoAlAire, REFRESH_ON_AIR_MS);

onAirPlayer?.addEventListener('playing', () => {
  setTimeout(actualizarContenidoAlAire, 150);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') actualizarContenidoAlAire();
});
