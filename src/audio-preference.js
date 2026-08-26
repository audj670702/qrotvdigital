// QRO TV DIGITAL — Persistencia de preferencia de audio
// Mantiene el autoplay inicial en mute, pero respeta la decisión del usuario
// de activar el sonido durante recuperaciones/reconexiones HLS posteriores.

(() => {
  const player = document.getElementById('channelPlayer');
  if (!player) return;

  let audioUsuarioActivo = false;
  let restaurandoAudio = false;

  function restaurarAudioUsuario() {
    if (!audioUsuarioActivo || restaurandoAudio) return;
    if (!player.muted && !player.defaultMuted && !player.hasAttribute('muted')) return;

    restaurandoAudio = true;
    try {
      player.muted = false;
      player.defaultMuted = false;
      player.removeAttribute('muted');
    } finally {
      queueMicrotask(() => {
        restaurandoAudio = false;
      });
    }
  }

  // Un cambio real a sonido activo mediante los controles nativos del video
  // establece la preferencia para el resto de la sesión de la app.
  player.addEventListener('volumechange', () => {
    if (restaurandoAudio) return;

    if (!player.muted && player.volume > 0) {
      audioUsuarioActivo = true;
      player.defaultMuted = false;
      player.removeAttribute('muted');
      return;
    }

    // Si el código de recuperación vuelve a imponer mute después de que el
    // usuario ya activó audio, restauramos inmediatamente su elección.
    if (audioUsuarioActivo && player.muted) {
      restaurarAudioUsuario();
    }
  });

  // Las reconstrucciones del HLS nativo pueden volver a escribir el atributo
  // muted. Observamos exclusivamente ese atributo para conservar la elección.
  const observer = new MutationObserver((mutations) => {
    if (!audioUsuarioActivo) return;
    if (mutations.some((mutation) => mutation.attributeName === 'muted')) {
      restaurarAudioUsuario();
    }
  });

  observer.observe(player, { attributes: true, attributeFilter: ['muted'] });

  // Eventos de recuperación habituales en iOS/PWA.
  ['loadedmetadata', 'loadeddata', 'canplay', 'playing'].forEach((evento) => {
    player.addEventListener(evento, restaurarAudioUsuario);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') restaurarAudioUsuario();
  });

  window.addEventListener('pageshow', restaurarAudioUsuario);
})();