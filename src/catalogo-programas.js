(() => {
  const grid = document.getElementById('productionGrid');
  const status = document.getElementById('productionStatus');
  const search = document.getElementById('productionSearch');
  const moreButton = document.getElementById('productionMore');
  if (!grid) return;

  const endpoint = String(window.TVD_CATALOGO_ENDPOINT || '').trim();
  const LIMITE_INICIAL = 12;
  const PASO = 12;

  let programas = [];
  let visibles = LIMITE_INICIAL;

  function textoSeguro(valor) {
    return String(valor ?? '').trim();
  }

  function normalizarTexto(valor) {
    return textoSeguro(valor)
      .toLocaleLowerCase('es-MX')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function imagenSegura(valor) {
    if (!valor) return '';
    if (typeof valor === 'string') return valor;
    if (typeof valor === 'object') {
      return textoSeguro(valor.src || valor.url || valor.imageInfo?.url || valor.image?.url);
    }
    return '';
  }

  function crearTarjeta(item) {
    const nombre = textoSeguro(item.nombrePrograma) || 'Programa';
    const descripcion = textoSeguro(item.descripcion);
    const playlist = textoSeguro(item.urlPlaylist);
    const imagen = imagenSegura(item.imagen);

    const article = document.createElement('article');
    article.className = 'program-card';

    const link = document.createElement('a');
    link.className = 'program-card-link';
    link.href = playlist || '#producciones';
    link.target = playlist ? '_blank' : '_self';
    link.rel = playlist ? 'noopener noreferrer' : '';
    link.setAttribute('aria-label', playlist ? `Abrir playlist de ${nombre}` : nombre);

    const art = document.createElement('div');
    art.className = 'program-card-art';

    if (imagen) {
      const img = document.createElement('img');
      img.src = imagen;
      img.alt = nombre;
      img.loading = 'lazy';
      img.decoding = 'async';
      art.appendChild(img);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'program-card-fallback';
      fallback.textContent = 'TV DIGITAL';
      art.appendChild(fallback);
    }

    const copy = document.createElement('div');
    copy.className = 'program-card-copy';

    const title = document.createElement('h3');
    title.textContent = nombre;
    copy.appendChild(title);

    if (descripcion) {
      const desc = document.createElement('p');
      desc.textContent = descripcion;
      copy.appendChild(desc);
    }

    const action = document.createElement('span');
    action.className = 'program-card-action';
    action.textContent = playlist ? 'Ver producciones →' : 'Playlist no disponible';
    copy.appendChild(action);

    link.appendChild(art);
    link.appendChild(copy);
    article.appendChild(link);

    return article;
  }

  function obtenerFiltrados() {
    const termino = normalizarTexto(search?.value || '');
    if (!termino) return programas;

    return programas.filter((item) => {
      const contenido = normalizarTexto([
        item.nombrePrograma,
        item.descripcion
      ].filter(Boolean).join(' '));
      return contenido.includes(termino);
    });
  }

  function actualizarBoton(totalFiltrados, buscando) {
    if (!moreButton) return;

    const hayMas = !buscando && visibles < totalFiltrados;
    moreButton.hidden = !hayMas;

    if (hayMas) {
      const restantes = totalFiltrados - visibles;
      moreButton.textContent = `Ver más (${restantes})`;
    }
  }

  function render() {
    const filtrados = obtenerFiltrados();
    const buscando = Boolean(textoSeguro(search?.value));
    const itemsMostrar = buscando ? filtrados : filtrados.slice(0, visibles);

    grid.replaceChildren();

    if (!filtrados.length) {
      if (status) status.textContent = buscando
        ? 'No encontramos programas con ese nombre.'
        : 'No hay programas disponibles por el momento.';
      actualizarBoton(0, buscando);
      return;
    }

    const fragment = document.createDocumentFragment();
    itemsMostrar.forEach(item => fragment.appendChild(crearTarjeta(item)));
    grid.appendChild(fragment);

    if (status) {
      status.textContent = buscando
        ? `${filtrados.length} resultado${filtrados.length === 1 ? '' : 's'}`
        : `${programas.length} programas · mostrando ${itemsMostrar.length}`;
    }

    actualizarBoton(filtrados.length, buscando);
  }

  async function cargar() {
    if (!endpoint) {
      if (status) status.textContent = 'Catálogo pendiente de conexión con Wix.';
      return;
    }

    if (status) status.textContent = 'Cargando programas…';

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      programas = Array.isArray(data)
        ? data
        : Array.isArray(data.programas)
          ? data.programas
          : Array.isArray(data.items)
            ? data.items
            : [];

      programas.sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0));
      render();
    } catch (error) {
      console.error('Catálogo de programas:', error);
      if (status) status.textContent = 'No fue posible cargar el catálogo.';
    }
  }

  search?.addEventListener('input', () => {
    visibles = LIMITE_INICIAL;
    render();
  });

  moreButton?.addEventListener('click', () => {
    visibles += PASO;
    render();
  });

  cargar();
})();
