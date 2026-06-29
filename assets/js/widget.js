(function () {
  "use strict";

  const els = {
    root: document.getElementById("hipe-playing-widget"),
    source: document.getElementById("hpw-source"),
    status: document.getElementById("hpw-status"),
    title: document.getElementById("hpw-title"),
    artist: document.getElementById("hpw-artist"),
    currentTime: document.getElementById("hpw-current-time"),
    durationTime: document.getElementById("hpw-duration-time"),
    progressBar: document.getElementById("hpw-progress-bar"),
    debug: document.getElementById("hpw-debug"),
    cover: document.getElementById("hpw-cover"),
    coverIcon: document.querySelector(".hpw-cover-icon"),
  };

  const params = new URLSearchParams(window.location.search);

  const config = {
    host: params.get("host") || "127.0.0.1",
    port: params.get("port") || "8080",
    endpoint: params.get("endpoint") || "/",
    debug: params.get("debug") === "1" || params.get("debug") === "true",
    layout: params.get("layout") || "normal",
    font: params.get("font") || "",
    scale: Number(params.get("scale") || 1),
    allowBrowsers: params.get("allowBrowsers") !== "0",
    hideAfterMs: params.has("hideAfter")
      ? Math.max(0, Number(params.get("hideAfter") || 0) * 1000)
      : null,
    enterAnimation: params.get("enterAnimation") || "slide",
    exitAnimation: params.get("exitAnimation") || "slide",
    animationMs: Number(params.get("animationMs") || 250),

    actionName: params.get("action") || "HP - Poll Music",
    pollMs: Number(params.get("poll") || 750),

    hideWhenPaused: true,
    staleAfterMs: 6000,
    reconnectMs: 2500,
    actionTimeoutMs: Number(params.get("actionTimeout") || 5000),

    // Portada online opcional. No toca Streamer.bot ni HP - Poll Music.
    // Para apagarlo: widget.html?onlineArtwork=0
    onlineArtwork: params.get("onlineArtwork") !== "0",
    // auto = Apple/iTunes primero y Deezer como segundo fallback.
    // Opciones: auto, itunes, deezer, off
    artworkProvider: params.get("artworkProvider") || "auto",
    artworkCountry: params.get("artworkCountry") || "mx",
    artworkCountries: params.get("artworkCountries") || "",
    artworkLimit: Number(params.get("artworkLimit") || 20),
    artworkSearchTimeoutMs: Number(params.get("artworkTimeout") || 1800),
    artworkCacheTtlMs: Number(params.get("artworkCacheTtlMs") || 1000 * 60 * 60 * 24 * 7),

    // Ajustes opcionales para encuadre del fondo derecho.
    // Ejemplo: &panelBgPosition=center%2042%25
    // Ejemplo: &panelBgSize=cover
    panelBgSize: params.get("panelBgSize") || "",
    panelBgPosition: params.get("panelBgPosition") || "",

    // Búsqueda más estricta: evita portadas de otra canción/artista.
    // Para desactivarlo: &artworkStrict=0
    artworkStrict: params.get("artworkStrict") !== "0",
  };

  let ws = null;
  let reconnectTimer = null;
  let pollTimer = null;
  let actionRequestInFlight = false;
  let actionRequestedAt = 0;
  let forceArtworkOnNextRequest = true;

  let nowPlaying = null;
  let receivedAt = 0;

  let displayPositionMs = 0;
  let progressTickAt = Date.now();
  let currentTrackKey = "";
  let currentVisibilityKey = "";
  let hiddenVisibilityKey = "";
  let visibilityTimer = null;
  let visibilityTimerKey = "";
  let currentAccentArtwork = "";
  let visibleArtwork = "";

  const artworkCache = new Map();
  const localArtworkCache = new Map();
  const accentCache = new Map();
  const artworkInFlight = new Map();
  const artworkCacheStorageKey = "hipePlayingArtworkCacheV13SmartArtworkFix";

  loadPersistentArtworkCache();

  function init() {
    if (!els.root) return;

    if (config.debug) {
      els.root.classList.add("hpw-debug-mode");
    }

    applyLayoutMode();
    applyAdminVisualOptions();

    setFallbackAccent();
    applyPanelBackgroundTuning();

    setDebug("Iniciando Hipe Playing Widget...");
    connect();

    setInterval(updateProgress, 250);
    setInterval(checkStaleData, 1000);

    window.addEventListener("beforeunload", function () {
      stopPollingAction();
    });
  }

  function applyLayoutMode() {
    if (!els.root) return;

    const layout = String(config.layout || "normal").toLowerCase();
    els.root.classList.remove("hpw-layout-normal", "hpw-layout-compact", "hpw-layout-minimal");

    if (layout === "compact") {
      els.root.classList.add("hpw-layout-compact");
      return;
    }

    if (layout === "minimal") {
      els.root.classList.add("hpw-layout-minimal");
      return;
    }

    els.root.classList.add("hpw-layout-normal");
  }

  function applyAdminVisualOptions() {
    if (!els.root) return;

    const scale = Number.isFinite(config.scale)
      ? Math.max(0.5, Math.min(2, config.scale))
      : 1;
    const animationMs = Number.isFinite(config.animationMs)
      ? Math.max(0, Math.min(5000, config.animationMs))
      : 260;

    els.root.style.setProperty("--hpw-scale", String(scale));
    els.root.style.setProperty("--hpw-slide-scale", String(scale * 0.992));
    els.root.style.setProperty("--hpw-pop-scale", String(scale * 0.94));
    els.root.style.setProperty("--hpw-animation-ms", animationMs + "ms");
    els.root.dataset.enterAnimation = normalizeAnimation(config.enterAnimation);
    els.root.dataset.exitAnimation = normalizeAnimation(config.exitAnimation);

    if (config.font) {
      const font = safeFontName(config.font);
      if (font) {
        loadWidgetFont(font);
        els.root.style.setProperty("--hpw-font", '"' + font.replace(/"/g, "") + '", "Segoe UI Variable", "Segoe UI", Arial, sans-serif');
      }
    }

  }

  function normalizeAnimation(value) {
    const clean = String(value || "").toLowerCase();
    return ["fade", "slide", "pop", "none"].includes(clean) ? clean : "slide";
  }

  function safeFontName(value) {
    return String(value || "")
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48);
  }

  function loadWidgetFont(font) {
    const id = "hpw-font-" + font.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (document.getElementById(id)) return;

    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(font).replace(/%20/g, "+") + ":wght@400;500;600;700;800;900&display=swap";
    document.head.appendChild(link);
  }

  function applyPanelBackgroundTuning() {
    if (!els.root) return;

    if (config.panelBgSize) {
      els.root.style.setProperty("--hpw-panel-bg-size", config.panelBgSize);
    }

    if (config.panelBgPosition) {
      els.root.style.setProperty("--hpw-panel-bg-position", config.panelBgPosition);
    }
  }

  function connect() {
    clearTimeout(reconnectTimer);

    const endpoint = config.endpoint.startsWith("/")
      ? config.endpoint
      : "/" + config.endpoint;

    const url = `ws://${config.host}:${config.port}${endpoint}`;

    setDebug(`Conectando a ${url}`);
    setStatus("Conectando...");

    try {
      ws = new WebSocket(url);
    } catch (error) {
      setDebug("Error creando WebSocket: " + error.message);
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", function () {
      setStatus("Conectado");
      setDebug("WebSocket conectado. Suscribiendo a General.Custom...");
      subscribeToCustomEvents();
      startPollingAction();
    });

    ws.addEventListener("message", function (event) {
      handleMessage(event.data);
    });

    ws.addEventListener("close", function () {
      stopPollingAction();
      setStatus("Desconectado");
      setDebug("WebSocket desconectado. Reintentando...");
      scheduleReconnect();
    });

    ws.addEventListener("error", function () {
      setStatus("Error WS");
      setDebug("Error en WebSocket.");
    });
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, config.reconnectMs);
  }

  function subscribeToCustomEvents() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const request = {
      request: "Subscribe",
      id: "hipe-playing-subscribe",
      events: {
        General: ["Custom"],
      },
    };

    ws.send(JSON.stringify(request));
    setDebug("Suscripción enviada: General.Custom");
  }

  function startPollingAction() {
    stopPollingAction();
    forceArtworkOnNextRequest = true;

    requestNowPlaying();

    pollTimer = setInterval(function () {
      requestNowPlaying();
    }, config.pollMs);

    setDebug(
      "Polling activo: " + config.actionName + " cada " + config.pollMs + "ms"
    );
  }

  function stopPollingAction() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    actionRequestInFlight = false;
    actionRequestedAt = 0;
  }

  function requestNowPlaying() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();

    if (
      actionRequestInFlight &&
      now - actionRequestedAt < config.actionTimeoutMs
    ) {
      return;
    }

    const request = {
      request: "DoAction",
      id: "hipe-playing-poll-" + now,
      action: {
        name: config.actionName,
      },
      args: {
        source: "hipePlayingWidget",
        forceArtwork: forceArtworkOnNextRequest,
        allowBrowsers: config.allowBrowsers,
      },
    };

    forceArtworkOnNextRequest = false;
    actionRequestInFlight = true;
    actionRequestedAt = now;
    ws.send(JSON.stringify(request));
  }

  function handleMessage(raw) {
    let payload;

    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    const data = payload && payload.data ? payload.data : payload;

    if (!data) return;
    if (data.widget !== "hipePlaying") return;
    if (data.action !== "nowPlaying") return;

    actionRequestInFlight = false;
    actionRequestedAt = 0;

    setDebug(buildDebugSummary(data));

    if (!data.shouldShow || !data.hasMedia) {
      resetPlayerState();
      hideWidget();
      return;
    }

    const incoming = {
      source: data.source || "music",
      app: data.app || "",
      title: data.title || "Sin título",
      artist: data.artist || "Artista desconocido",
      album: data.album || "",
      status: data.status || "Unknown",
      isPlaying: Boolean(data.isPlaying),
      positionMs: Number(data.positionMs || 0),
      durationMs: Number(data.durationMs || 0),
      lastUpdatedTime:
        typeof data.lastUpdatedTime === "string" ? data.lastUpdatedTime : "",
      currentSessionId:
        typeof data.currentSessionId === "string" ? data.currentSessionId : "",
      isCurrentSession: data.isCurrentSession === true,
      artwork: typeof data.artwork === "string" ? data.artwork : "",
      artworkKey: typeof data.artworkKey === "string" ? data.artworkKey : "",
      artworkChanged: Boolean(data.artworkChanged),
      hasLocalArtwork: data.hasLocalArtwork === true,
      artworkSource: data.artworkSource || "",
      artworkBytes: Number(data.artworkBytes || 0),
      resolvedArtwork: "",
      artworkLookupDone: false,
    };

    const incomingKey = makeTrackKey(incoming);
    const sameTrack = incomingKey && incomingKey === currentTrackKey;

    const now = Date.now();
    const localPosition = getDisplayPositionMs(now);
    const incomingPosition = getAnchoredIncomingPositionMs(incoming, now);

    if (!sameTrack) {
      displayPositionMs = incomingPosition;
      progressTickAt = now;
      currentTrackKey = incomingKey;
    } else {
      if (incoming.durationMs <= 0) {
        displayPositionMs = localPosition;
        progressTickAt = now;
        hydrateLocalArtworkFromPayload(incoming, sameTrack);

        nowPlaying = incoming;
        receivedAt = now;

        hydrateArtworkForCurrentTrack();
        renderNowPlaying();
        return;
      }

      const diff = incomingPosition - localPosition;

      if (diff > 2500) {
        displayPositionMs = incomingPosition;
      } else if (diff < -15000) {
        displayPositionMs = incomingPosition;
      } else {
        displayPositionMs = localPosition;
      }

      progressTickAt = now;
    }

    hydrateLocalArtworkFromPayload(incoming, sameTrack);

    nowPlaying = incoming;
    receivedAt = now;

    hydrateArtworkForCurrentTrack();
    renderNowPlaying();
  }

  function hydrateLocalArtworkFromPayload(incoming, sameTrack) {
    if (!incoming) return;

    const key = incoming.artworkKey || makeArtworkKey(incoming);

    if (isValidArtwork(incoming.artwork)) {
      if (key) {
        localArtworkCache.set(key, incoming.artwork);
      }

      incoming.resolvedArtwork = incoming.artwork;
      incoming.artworkLookupDone = true;
      return;
    }

    if (!incoming.hasLocalArtwork || !key) {
      return;
    }

    if (localArtworkCache.has(key)) {
      incoming.artwork = localArtworkCache.get(key) || "";
      incoming.resolvedArtwork = incoming.artwork;
      incoming.artworkLookupDone = true;
      return;
    }

    if (sameTrack && nowPlaying) {
      const currentArtwork = nowPlaying.resolvedArtwork || nowPlaying.artwork || "";

      if (isValidArtwork(currentArtwork)) {
        incoming.artwork = currentArtwork;
        incoming.resolvedArtwork = currentArtwork;
        incoming.artworkLookupDone = true;
      }
    }
  }

  function renderNowPlaying() {
    if (!nowPlaying) {
      hideWidget();
      return;
    }

    if (config.hideWhenPaused && !nowPlaying.isPlaying) {
      resetVisibilityState();
      hideWidget();
      return;
    }

    els.source.textContent = sourceLabel(nowPlaying.source);
    els.status.textContent = nowPlaying.isPlaying ? "Reproduciendo" : "Pausado";
    els.title.textContent = nowPlaying.title;
    els.artist.textContent = nowPlaying.artist;
    els.durationTime.textContent = formatDurationTime(nowPlaying);

    renderArtwork();
    updateProgress();
    updateTimedVisibility();
  }

  function updateTimedVisibility() {
    if (!nowPlaying) {
      hideWidget();
      return;
    }

    const key = makeVisibilityKey(nowPlaying);

    if (key && key !== currentVisibilityKey) {
      currentVisibilityKey = key;
      hiddenVisibilityKey = "";
      showWidget();
      startVisibilityTimer(key);
      return;
    }

    if (key && hiddenVisibilityKey === key) {
      hideWidget();
      return;
    }

    showWidget();
    startVisibilityTimer(key);
  }

  function startVisibilityTimer(key) {
    if (!key) return;
    if (config.hideAfterMs === null || config.hideAfterMs <= 0) return;
    if (visibilityTimer && visibilityTimerKey === key) return;

    clearVisibilityTimer();
    visibilityTimerKey = key;
    visibilityTimer = setTimeout(function () {
      if (currentVisibilityKey !== key) return;
      hiddenVisibilityKey = key;
      visibilityTimer = null;
      visibilityTimerKey = "";
      hideWidget();
    }, config.hideAfterMs);
  }

  function clearVisibilityTimer() {
    if (visibilityTimer) {
      clearTimeout(visibilityTimer);
      visibilityTimer = null;
    }

    visibilityTimerKey = "";
  }

  function resetVisibilityState() {
    currentVisibilityKey = "";
    hiddenVisibilityKey = "";
    clearVisibilityTimer();
  }

  function renderArtwork() {
    if (!els.cover) return;

    const artwork =
      nowPlaying && nowPlaying.resolvedArtwork
        ? nowPlaying.resolvedArtwork
        : nowPlaying && nowPlaying.artwork
          ? nowPlaying.artwork
          : "";

    if (isValidArtwork(artwork)) {
      setArtworkVisual(artwork);
      applyArtworkAccent(artwork);
      if (els.root) els.root.classList.remove("hpw-artwork-loading");
      return;
    }

    // Cuando cambia la canción, no limpiamos la portada anterior de golpe.
    // Así el texto aparece inmediato y la nueva portada entra cuando termine la búsqueda online.
    if (nowPlaying && !nowPlaying.artworkLookupDone && visibleArtwork) {
      if (els.root) els.root.classList.add("hpw-artwork-loading");
      return;
    }

    clearArtworkVisual();
  }

  function setArtworkVisual(artwork) {
    const cssUrl = makeCssUrl(artwork);

    visibleArtwork = artwork;
    els.cover.style.backgroundImage = cssUrl;
    els.cover.classList.add("hpw-has-artwork");

    if (els.root) {
      els.root.style.setProperty("--hpw-artwork", cssUrl);
      els.root.classList.remove("hpw-artwork-loading");
    }

    if (els.coverIcon) {
      els.coverIcon.style.display = "none";
    }

  }

  function clearArtworkVisual() {
    visibleArtwork = "";

    els.cover.style.backgroundImage = "";
    els.cover.classList.remove("hpw-has-artwork");

    if (els.root) {
      els.root.style.removeProperty("--hpw-artwork");
      els.root.classList.remove("hpw-artwork-loading");
    }

    currentAccentArtwork = "";
    setFallbackAccent();

    if (els.coverIcon) {
      els.coverIcon.style.display = "";
    }
  }

  function hydrateArtworkForCurrentTrack() {
    if (!nowPlaying) return;

    const localArtwork = nowPlaying.artwork || "";

    if (isValidArtwork(localArtwork)) {
      nowPlaying.resolvedArtwork = localArtwork;
      nowPlaying.artworkLookupDone = true;
      return;
    }

    if (nowPlaying.hasLocalArtwork) {
      // Streamer.bot omitió el base64 para evitar payloads grandes.
      // Esperamos el reenvío periódico local en vez de buscar online.
      nowPlaying.resolvedArtwork = "";
      nowPlaying.artworkLookupDone = false;
      return;
    }

    if (!config.onlineArtwork || config.artworkProvider === "off") {
      nowPlaying.resolvedArtwork = "";
      nowPlaying.artworkLookupDone = true;
      return;
    }

    if (!shouldSearchArtwork(nowPlaying)) {
      nowPlaying.resolvedArtwork = "";
      nowPlaying.artworkLookupDone = true;
      return;
    }

    const key = makeArtworkKey(nowPlaying);

    const cachedArtwork = getCachedArtwork(key);

    if (cachedArtwork !== null) {
      nowPlaying.resolvedArtwork = cachedArtwork || "";
      nowPlaying.artworkLookupDone = true;
      return;
    }

    if (artworkInFlight.has(key)) {
      nowPlaying.artworkLookupDone = false;
      return;
    }

    nowPlaying.artworkLookupDone = false;
    setDebug("Buscando portada: " + safeText(nowPlaying.artist + " - " + nowPlaying.title));

    const requestTrack = {
      source: nowPlaying.source,
      title: nowPlaying.title,
      artist: nowPlaying.artist,
      album: nowPlaying.album,
      durationMs: nowPlaying.durationMs,
    };

    const request = resolveArtworkOnline(requestTrack)
      .then(async function (artworkUrl) {
        if (artworkUrl) {
          await preloadArtwork(artworkUrl, 1800);
        }

        if (!artworkUrl) {
          setDebug("Sin portada confiable: " + safeText(requestTrack.artist + " - " + requestTrack.title));
        }

        setCachedArtwork(key, artworkUrl || "");

        if (nowPlaying && makeArtworkKey(nowPlaying) === key) {
          nowPlaying.resolvedArtwork = artworkUrl || "";
          nowPlaying.artworkLookupDone = true;
          renderArtwork();
        }
      })
      .catch(function () {
        setCachedArtwork(key, "");

        if (nowPlaying && makeArtworkKey(nowPlaying) === key) {
          nowPlaying.resolvedArtwork = "";
          nowPlaying.artworkLookupDone = true;
          renderArtwork();
        }
      })
      .finally(function () {
        artworkInFlight.delete(key);
      });

    artworkInFlight.set(key, request);
  }

  async function resolveArtworkOnline(track) {
    const provider = String(config.artworkProvider || "auto").toLowerCase();

    if (provider === "off") {
      return "";
    }

    if (provider === "itunes") {
      return searchItunesArtwork(track);
    }

    if (provider === "deezer") {
      return searchDeezerArtwork(track);
    }

    // auto: Apple/iTunes primero. Si no encuentra, Deezer como segundo fallback.
    const itunesArtwork = await searchItunesArtwork(track);

    if (itunesArtwork) {
      return itunesArtwork;
    }

    return searchDeezerArtwork(track);
  }

  async function searchItunesArtwork(track) {
    const countries = getArtworkCountries();

    for (const country of countries) {
      const songResult = await searchItunesSongsByCountry(track, country);

      if (songResult) {
        return songResult;
      }
    }

    // Segundo intento dentro de Apple: buscar álbum, no track.
    // Esto ayuda cuando el track no aparece, pero el álbum sí tiene portada.
    for (const country of countries) {
      const albumResult = await searchItunesAlbumsByCountry(track, country);

      if (albumResult) {
        return albumResult;
      }
    }

    return "";
  }

  async function searchItunesSongsByCountry(track, country) {
    const terms = buildArtworkSearchTerms(track);

    for (const term of terms) {
      const url =
        "https://itunes.apple.com/search" +
        "?term=" +
        encodeURIComponent(term) +
        "&media=music" +
        "&entity=song" +
        "&limit=" +
        encodeURIComponent(String(config.artworkLimit)) +
        "&country=" +
        encodeURIComponent(country || "us");

      try {
        const json = await fetchJson(url);
        const results = Array.isArray(json.results) ? json.results : [];
        const best = pickBestItunesResult(track, results, "song");

        if (best && best.artworkUrl100) {
          setDebug("Portada Apple: " + safeText(best.artistName + " - " + best.trackName));
          return upgradeItunesArtwork(best.artworkUrl100);
        }
      } catch {
        // Silencioso: si falla internet/CORS/API, el widget sigue sin portada.
      }
    }

    return "";
  }

  async function searchItunesAlbumsByCountry(track, country) {
    const terms = buildAlbumSearchTerms(track);

    for (const term of terms) {
      const url =
        "https://itunes.apple.com/search" +
        "?term=" +
        encodeURIComponent(term) +
        "&media=music" +
        "&entity=album" +
        "&limit=" +
        encodeURIComponent(String(config.artworkLimit)) +
        "&country=" +
        encodeURIComponent(country || "us");

      try {
        const json = await fetchJson(url);
        const results = Array.isArray(json.results) ? json.results : [];
        const best = pickBestItunesResult(track, results, "album");

        if (best && best.artworkUrl100) {
          setDebug("Portada Apple álbum: " + safeText(best.artistName + " - " + best.collectionName));
          return upgradeItunesArtwork(best.artworkUrl100);
        }
      } catch {
        // Silencioso.
      }
    }

    return "";
  }

  async function searchDeezerArtwork(track) {
    const terms = buildDeezerSearchTerms(track);

    for (const term of terms) {
      const url =
        "https://api.deezer.com/search" +
        "?q=" +
        encodeURIComponent(term) +
        "&limit=" +
        encodeURIComponent(String(config.artworkLimit));

      try {
        const json = await fetchJson(url);
        const results = Array.isArray(json.data) ? json.data : [];
        const best = pickBestDeezerResult(track, results);
        const artwork = best && best.album
          ? best.album.cover_xl || best.album.cover_big || best.album.cover_medium || best.album.cover
          : "";

        if (artwork) {
          setDebug("Portada Deezer: " + safeText(best.artist && best.artist.name ? best.artist.name + " - " + best.title : best.title));
          return artwork;
        }
      } catch {
        // Silencioso.
      }
    }

    return "";
  }

  function preloadArtwork(url, timeoutMs) {
    return new Promise(function (resolve) {
      if (!url) {
        resolve(false);
        return;
      }

      const img = new Image();
      let done = false;
      const timeout = setTimeout(function () {
        if (done) return;
        done = true;
        resolve(false);
      }, Math.max(500, Number(timeoutMs || 1800)));

      img.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        resolve(true);
      };

      img.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        resolve(false);
      };

      img.src = url;
    });
  }

  async function fetchJson(url) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutMs = Math.max(750, Number(config.artworkSearchTimeoutMs || 2500));
    let timeout = null;

    if (controller) {
      timeout = setTimeout(function () {
        try { controller.abort(); } catch {}
      }, timeoutMs);
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "force-cache",
        signal: controller ? controller.signal : undefined,
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      return response.json();
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  function buildArtworkSearchTerms(track) {
    const titles = buildTitleVariants(track.title);
    const artists = buildArtistVariants(track.artist);
    const albums = buildAlbumVariants(track.album);

    const terms = [];

    // Modo seguro: siempre artista + título.
    for (const artist of artists.slice(0, 4)) {
      for (const title of titles.slice(0, 5)) {
        if (artist && title) {
          terms.push(artist + " " + title);
          terms.push(title + " " + artist);
        }

        if (artist && title && albums[0]) {
          terms.push(artist + " " + title + " " + albums[0]);
        }
      }
    }

    // Artista + álbum como intento extra, pero sin título solo.
    for (const artist of artists.slice(0, 3)) {
      for (const album of albums.slice(0, 2)) {
        if (artist && album) {
          terms.push(artist + " " + album);
          terms.push(album + " " + artist);
        }
      }
    }

    // Modo loose real: esto se usa solo con &artworkStrict=0.
    // Sirve para comprobar si Apple/Deezer sí tienen una portada, aunque sea con más riesgo.
    if (!config.artworkStrict) {
      for (const title of titles.slice(0, 4)) {
        if (title && albums[0]) {
          terms.push(title + " " + albums[0]);
        }

        if (title) {
          terms.push(title);
        }
      }
    }

    return uniqueList(terms).slice(0, config.artworkStrict ? 14 : 18);
  }

  function buildAlbumSearchTerms(track) {
    const artists = buildArtistVariants(track.artist);
    const albums = buildAlbumVariants(track.album);
    const titles = buildTitleVariants(track.title);

    const terms = [];

    for (const artist of artists.slice(0, 3)) {
      for (const album of albums.slice(0, 3)) {
        if (artist && album) {
          terms.push(artist + " " + album);
          terms.push(album + " " + artist);
        }
      }

      for (const title of titles.slice(0, 2)) {
        if (artist && title) {
          terms.push(artist + " " + title);
        }
      }
    }

    return uniqueList(terms).slice(0, 8);
  }

  function buildDeezerSearchTerms(track) {
    const titles = buildTitleVariants(track.title);
    const artists = buildArtistVariants(track.artist);
    const albums = buildAlbumVariants(track.album);
    const terms = [];

    for (const artist of artists.slice(0, 4)) {
      for (const title of titles.slice(0, 5)) {
        if (artist && title) {
          terms.push('artist:"' + artist + '" track:"' + title + '"');
          terms.push(artist + " " + title);
          terms.push(title + " " + artist);
        }
      }

      if (artist && albums[0]) {
        terms.push('artist:"' + artist + '" album:"' + albums[0] + '"');
        terms.push(artist + " " + albums[0]);
      }
    }

    if (!config.artworkStrict) {
      for (const title of titles.slice(0, 4)) {
        if (title) {
          terms.push(title);
        }
      }
    }

    return uniqueList(terms).slice(0, config.artworkStrict ? 14 : 18);
  }

  function buildTitleVariants(value) {
    const raw = cleanSearchTerm(value);
    const variants = [raw];

    if (raw.includes(" - ")) {
      const beforeDash = raw.split(" - ")[0].trim();
      const afterDash = raw.split(" - ").slice(1).join(" - ").trim();

      if (beforeDash) variants.push(beforeDash);
      if (afterDash) variants.push(beforeDash + " " + afterDash);
    }

    variants.push(
      raw
        .replace(/\b(reguet[oó]n|reggaeton|remix|version|versi[oó]n|edit|radio edit|sped up|slowed|nightcore|live|en vivo|acoustic|cover)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
    );

    variants.push(
      raw
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .replace(/\s*\[[^\]]*\]\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );

    return uniqueList(variants);
  }

  function buildArtistVariants(value) {
    const raw = cleanSearchTerm(value);
    const variants = [raw];

    const split = raw
      .replace(/\b(feat\.?|ft\.?|featuring|con)\b/gi, ",")
      .replace(/\s+x\s+/gi, ",")
      .replace(/\s+&\s+/g, ",")
      .replace(/\s+y\s+/gi, ",")
      .split(",")
      .map(function (item) { return item.trim(); })
      .filter(Boolean);

    for (const item of split) {
      variants.push(item);
    }

    return uniqueList(variants);
  }

  function buildAlbumVariants(value) {
    const raw = cleanSearchTerm(value);
    const variants = [raw];

    variants.push(
      raw
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .replace(/\s*\[[^\]]*\]\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );

    return uniqueList(variants);
  }

  function pickBestItunesResult(track, results, mode) {
    let best = null;
    let bestScore = 0;

    for (const result of results) {
      const verdict = scoreItunesResult(track, result, mode);

      if (!verdict.accept) {
        continue;
      }

      if (verdict.score > bestScore) {
        best = result;
        bestScore = verdict.score;
      }
    }

    const threshold = config.artworkStrict
      ? (mode === "album" ? 13 : 14)
      : (mode === "album" ? 6 : 7);

    return bestScore >= threshold ? best : null;
  }

  function scoreItunesResult(track, result, mode) {
    const trackTitle = normalizeCompare(track.title);
    const trackArtist = normalizeCompare(track.artist);
    const trackAlbum = normalizeCompare(track.album);

    const resultTitle = normalizeCompare(result.trackName || result.collectionName);
    const resultArtist = normalizeCompare(result.artistName);
    const resultAlbum = normalizeCompare(result.collectionName);

    const titleMatch = mode === "album"
      ? bestTitleMatch(trackTitle, resultAlbum || resultTitle)
      : bestTitleMatch(trackTitle, resultTitle);

    const artistMatch = bestArtistMatch(trackArtist, resultArtist);
    const albumMatch = bestTitleMatch(trackAlbum, resultAlbum);

    const durationScore = scoreDurationMs(track.durationMs, result.trackTimeMillis);

    // Regla importante:
    // Si está activo strict, artista y título tienen que coincidir.
    // El título solo NO puede ganar.
    if (config.artworkStrict) {
      if (!artistMatch.ok) return { accept: false, score: 0 };
      if (mode !== "album" && !titleMatch.ok) return { accept: false, score: 0 };

      if (mode === "album") {
        const albumIsUseful = albumMatch.ok || titleMatch.ok;
        if (!albumIsUseful) return { accept: false, score: 0 };
      }
    }

    let score = 0;

    score += titleMatch.score;
    score += artistMatch.score;
    score += albumMatch.score > 0 ? Math.min(albumMatch.score, 4) : 0;
    score += durationScore;

    // Bonus para coincidencia fuerte de artista + título.
    if (artistMatch.strong && titleMatch.strong) score += 3;

    return { accept: score > 0, score: score };
  }

  function pickBestDeezerResult(track, results) {
    let best = null;
    let bestScore = 0;

    for (const result of results) {
      const verdict = scoreDeezerResult(track, result);

      if (!verdict.accept) {
        continue;
      }

      if (verdict.score > bestScore) {
        best = result;
        bestScore = verdict.score;
      }
    }

    return bestScore >= (config.artworkStrict ? 14 : 7) ? best : null;
  }

  function scoreDeezerResult(track, result) {
    const trackTitle = normalizeCompare(track.title);
    const trackArtist = normalizeCompare(track.artist);
    const trackAlbum = normalizeCompare(track.album);

    const resultTitle = normalizeCompare(result.title_short || result.title);
    const resultArtist = normalizeCompare(result.artist && result.artist.name);
    const resultAlbum = normalizeCompare(result.album && result.album.title);

    const titleMatch = bestTitleMatch(trackTitle, resultTitle);
    const artistMatch = bestArtistMatch(trackArtist, resultArtist);
    const albumMatch = bestTitleMatch(trackAlbum, resultAlbum);
    const durationScore = scoreDurationMs(
      track.durationMs,
      result.duration ? Number(result.duration) * 1000 : 0
    );

    if (config.artworkStrict) {
      if (!artistMatch.ok) return { accept: false, score: 0 };
      if (!titleMatch.ok) return { accept: false, score: 0 };
    }

    let score = 0;

    score += titleMatch.score;
    score += artistMatch.score;
    score += albumMatch.score > 0 ? Math.min(albumMatch.score, 4) : 0;
    score += durationScore;

    if (artistMatch.strong && titleMatch.strong) score += 3;

    return { accept: score > 0, score: score };
  }

  function bestTitleMatch(left, right) {
    return bestTextMatch(left, right, {
      exact: 10,
      contains: 8,
      strong: 6,
      weak: 0,
      strongRatio: 0.72,
      weakRatio: 0.58,
    });
  }

  function bestArtistMatch(left, right) {
    const leftCandidates = artistCompareCandidates(left);
    const rightCandidates = artistCompareCandidates(right);

    let best = { ok: false, strong: false, score: 0, ratio: 0 };

    for (const a of leftCandidates) {
      for (const b of rightCandidates) {
        const match = bestTextMatch(a, b, {
          exact: 10,
          contains: 8,
          strong: 6,
          weak: 0,
          strongRatio: 0.70,
          weakRatio: 0.58,
        });

        if (match.score > best.score) {
          best = match;
        }
      }
    }

    return best;
  }

  function bestTextMatch(left, right, weights) {
    if (!left || !right) {
      return { ok: false, strong: false, score: 0, ratio: 0 };
    }

    if (left === right) {
      return { ok: true, strong: true, score: weights.exact, ratio: 1 };
    }

    if (left.includes(right) || right.includes(left)) {
      const short = Math.min(left.length, right.length);
      const long = Math.max(left.length, right.length);
      const sizeRatio = long > 0 ? short / long : 0;

      // Permite "david guetta" dentro de "david guetta kim petras",
      // pero no deja que una palabra genérica gane por sí sola.
      if (sizeRatio >= 0.42 || usefulTokens(left).length === 1 || usefulTokens(right).length === 1) {
        return {
          ok: true,
          strong: sizeRatio >= 0.58,
          score: weights.contains,
          ratio: sizeRatio,
        };
      }
    }

    const ratio = tokenOverlapRatio(left, right);

    if (ratio >= weights.strongRatio) {
      return { ok: true, strong: true, score: weights.strong, ratio: ratio };
    }

    if (ratio >= weights.weakRatio && weights.weak > 0) {
      return { ok: true, strong: false, score: weights.weak, ratio: ratio };
    }

    return { ok: false, strong: false, score: 0, ratio: ratio };
  }

  function scoreTextMatch(left, right, exactScore, containsScore, strongTokenScore, weakTokenScore) {
    const match = bestTextMatch(left, right, {
      exact: exactScore,
      contains: containsScore,
      strong: strongTokenScore,
      weak: weakTokenScore,
      strongRatio: 0.65,
      weakRatio: 0.4,
    });

    return match.score;
  }

  function scoreDurationMs(leftMs, rightMs) {
    if (!leftMs || !rightMs) return 0;

    const diff = Math.abs(Number(leftMs) - Number(rightMs));

    if (diff <= 2500) return 2;
    if (diff <= 7000) return 1;

    return 0;
  }

  function artistCompareCandidates(value) {
    const normalized = normalizeCompare(value);

    if (!normalized) return [];

    const pieces = normalized
      .replace(/\b(feat|ft|featuring|with|con)\b/g, ",")
      .replace(/\s+x\s+/g, ",")
      .replace(/\s+and\s+/g, ",")
      .replace(/\s+y\s+/g, ",")
      .split(",")
      .map(function (item) { return item.trim(); })
      .filter(Boolean);

    return uniqueList([normalized].concat(pieces));
  }

  function tokenOverlapRatio(a, b) {
    const left = usefulTokens(a);
    const right = usefulTokens(b);

    if (!left.length || !right.length) return 0;

    const leftSet = new Set(left);
    let hits = 0;

    for (const token of right) {
      if (leftSet.has(token)) {
        hits += 1;
      }
    }

    return hits / Math.max(left.length, right.length);
  }

  function usefulTokens(value) {
    return String(value || "")
      .split(" ")
      .filter(function (token) {
        return token.length >= 2 && !isWeakToken(token);
      });
  }

  function isWeakToken(token) {
    return [
      "the", "and", "for", "con", "feat", "ft", "remix", "version", "version", "official", "audio",
      "video", "music", "reggaeton", "regueton", "regueton", "live", "edit", "song", "logical",
      "feat", "featuring", "prod", "original", "mix"
    ].includes(String(token || "").toLowerCase());
  }

  function upgradeItunesArtwork(url) {
    const clean = String(url || "").trim();

    if (!clean) return "";

    return clean.replace(/\d+x\d+bb\.(jpg|jpeg|png|webp)$/i, "1000x1000bb.$1");
  }

  function getArtworkCountries() {
    const fromParam = String(config.artworkCountries || "")
      .split(",")
      .map(function (item) { return item.trim(); })
      .filter(Boolean);

    return uniqueList([config.artworkCountry].concat(
      fromParam,
      ["mx", "us", "es", "co", "ar", "cl", "pe", "br", "gb"]
    ));
  }

  function shouldSearchArtwork(track) {
    const title = cleanSearchTerm(track.title);
    const artist = cleanSearchTerm(track.artist);

    if (!title) return false;
    if (!artist) return false;
    if (artist.toLowerCase() === "artista desconocido") return false;
    if (title.toLowerCase() === "sin título") return false;

    return true;
  }

  function makeArtworkKey(track) {
    return [
      track.source || "",
      track.title || "",
      track.artist || "",
      track.album || "",
      track.durationMs || 0,
    ]
      .join("|")
      .toLowerCase();
  }


  function getCachedArtwork(key) {
    if (!artworkCache.has(key)) {
      return null;
    }

    return artworkCache.get(key) || "";
  }

  function setCachedArtwork(key, artwork) {
    artworkCache.set(key, artwork || "");

    // Persistimos solo portadas encontradas. Los fallos se quedan en memoria
    // para no bloquear futuras búsquedas si un catálogo se actualiza.
    if (artwork) {
      savePersistentArtworkCache();
    }
  }

  function loadPersistentArtworkCache() {
    try {
      const raw = localStorage.getItem(artworkCacheStorageKey);

      if (!raw) return;

      const parsed = JSON.parse(raw);
      const now = Date.now();
      const items = parsed && parsed.items ? parsed.items : {};

      for (const key of Object.keys(items)) {
        const item = items[key];

        if (!item || !item.artwork || !item.savedAt) continue;
        if (now - Number(item.savedAt) > config.artworkCacheTtlMs) continue;

        artworkCache.set(key, item.artwork);
      }
    } catch {
      // Si localStorage falla, usamos solo caché en memoria.
    }
  }

  function savePersistentArtworkCache() {
    try {
      const items = {};
      const now = Date.now();
      let count = 0;

      for (const [key, artwork] of artworkCache.entries()) {
        if (!artwork) continue;

        items[key] = {
          artwork: artwork,
          savedAt: now,
        };

        count += 1;

        // Evita que localStorage crezca demasiado.
        if (count >= 250) break;
      }

      localStorage.setItem(artworkCacheStorageKey, JSON.stringify({ items: items }));
    } catch {
      // Silencioso.
    }
  }

  function updateProgress() {
    if (!nowPlaying) return;

    let positionMs = getDisplayPositionMs(Date.now());
    const durationMs = nowPlaying.durationMs;

    if (durationMs > 0) {
      positionMs = Math.min(positionMs, durationMs);

      const percent = Math.max(
        0,
        Math.min(100, (positionMs / durationMs) * 100)
      );

      els.progressBar.style.width = percent + "%";
    } else {
      els.progressBar.style.width = "0%";
    }

    els.currentTime.textContent = formatTime(positionMs);
    els.durationTime.textContent = formatDurationTime(nowPlaying);
  }

  function getDisplayPositionMs(now) {
    if (!nowPlaying) return 0;

    let position = displayPositionMs;

    if (nowPlaying.isPlaying) {
      position += now - progressTickAt;
    }

    if (nowPlaying.durationMs > 0) {
      position = Math.min(position, nowPlaying.durationMs);
    }

    return Math.max(0, position);
  }

  function getAnchoredIncomingPositionMs(track, now) {
    if (!track) return 0;

    let position = Number(track.positionMs || 0);
    const updatedAt = Date.parse(track.lastUpdatedTime || "");

    if (track.durationMs <= 0) {
      return 0;
    }

    if (track.isPlaying && Number.isFinite(updatedAt)) {
      position += Math.max(0, now - updatedAt);
    }

    position = Math.min(position, track.durationMs);

    return Math.max(0, position);
  }

  function makeTrackKey(track) {
    return [
      track.source || "",
      track.title || "",
      track.artist || "",
      track.album || "",
    ]
      .join("|")
      .toLowerCase();
  }

  function makeVisibilityKey(track) {
    return [
      track.source || "",
      track.app || "",
      track.currentSessionId || "",
      track.title || "",
      track.artist || "",
      track.album || "",
    ]
      .join("|")
      .toLowerCase();
  }

  function checkStaleData() {
    if (!nowPlaying) return;
    if (config.staleAfterMs <= 0) return;

    const age = Date.now() - receivedAt;

    if (age > config.staleAfterMs) {
      setDebug("Datos viejos. Ocultando widget.");
      resetPlayerState();
      hideWidget();
    }
  }

  function resetPlayerState() {
    nowPlaying = null;
    receivedAt = 0;
    displayPositionMs = 0;
    progressTickAt = Date.now();
    currentTrackKey = "";
    resetVisibilityState();

    if (els.progressBar) {
      els.progressBar.style.width = "0%";
    }

    if (els.currentTime) {
      els.currentTime.textContent = "0:00";
    }

    visibleArtwork = "";

    if (els.cover) {
      els.cover.style.backgroundImage = "";
      els.cover.classList.remove("hpw-has-artwork");
    }

    if (els.root) {
      els.root.style.removeProperty("--hpw-artwork");
      els.root.classList.remove("hpw-artwork-loading");
    }

    currentAccentArtwork = "";
    setFallbackAccent();

    if (els.coverIcon) {
      els.coverIcon.style.display = "";
    }
  }

  function showWidget() {
    if (els.root.classList.contains("hpw-hidden")) {
      els.root.dataset.motion = "enter";
      void els.root.offsetWidth;
    }

    els.root.classList.remove("hpw-hidden");
  }

  function hideWidget() {
    if (!els.root.classList.contains("hpw-hidden")) {
      els.root.dataset.motion = "exit";
    }

    els.root.classList.add("hpw-hidden");
  }

  function setStatus(text) {
    if (els.status) {
      els.status.textContent = text;
    }
  }

  function setDebug(text) {
    if (els.debug) {
      els.debug.textContent = text;
    }
  }

  function buildDebugSummary(data) {
    const title = safeText(data && (data.title || data.reason || "nowPlaying"));

    return "Recibido Hipe Playing: " + title;
  }

  function sourceLabel(source) {
    const value = String(source || "").toLowerCase();

    if (value === "spotify") return "SPOTIFY";
    if (value === "youtubemusic") return "YOUTUBE MUSIC";
    if (value === "amazonmusic") return "AMAZON MUSIC";
    if (value === "applemusic") return "APPLE MUSIC";
    if (value === "chrome") return "CHROME";
    if (value === "brave") return "BRAVE";
    if (value === "opera") return "OPERA";
    if (value === "vivaldi") return "VIVALDI";
    if (value === "edge") return "EDGE";
    if (value === "firefox") return "FIREFOX";

    return "HIPE PLAYING";
  }

  function isAmazonMusic(track) {
    return String(track && track.source || "").toLowerCase() === "amazonmusic";
  }

  function formatDurationTime(track) {
    const durationMs = Number(track && track.durationMs || 0);

    if (isAmazonMusic(track) && durationMs <= 0) {
      return "-:--";
    }

    return durationMs > 0 ? formatTime(durationMs) : "0:00";
  }

  function isValidArtwork(value) {
    if (!value) return false;

    const clean = String(value).trim();

    return (
      clean.startsWith("data:image/") ||
      clean.startsWith("http://") ||
      clean.startsWith("https://")
    );
  }

  function makeCssUrl(value) {
    const clean = String(value || "").replace(/"/g, '\\"');
    return 'url("' + clean + '")';
  }

  function cleanSearchTerm(value) {
    return String(value || "")
      .replace(/\s*\([^)]*(official|video oficial|official music video|lyrics?|lyric video|visualizer|audio only)[^)]*\)\s*/gi, " ")
      .replace(/\s*\[[^\]]*(official|video oficial|official music video|lyrics?|lyric video|visualizer|audio only)[^\]]*\]\s*/gi, " ")
      .replace(/\b(official video|official music video|video oficial|lyrics?|lyric video|visualizer|audio only|clean version|explicit)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeCompare(value) {
    return cleanSearchTerm(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9áéíóúüñ\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function uniqueList(values) {
    const seen = new Set();
    const list = [];

    for (const value of values) {
      const clean = String(value || "").trim();
      const key = clean.toLowerCase();

      if (!clean || seen.has(key)) continue;

      seen.add(key);
      list.push(clean);
    }

    return list;
  }


  function applyArtworkAccent(artwork) {
    const key = String(artwork || "").trim();

    if (!key) {
      currentAccentArtwork = "";
      setFallbackAccent();
      return;
    }

    if (key === currentAccentArtwork) {
      return;
    }

    currentAccentArtwork = key;

    if (accentCache.has(key)) {
      setAccentColor(accentCache.get(key));
      return;
    }

    // Mientras se calcula el color real, usamos un fallback neutro.
    setFallbackAccent();

    extractAccentFromArtwork(key)
      .then(function (color) {
        if (!color) return;
        accentCache.set(key, color);

        if (currentAccentArtwork === key) {
          setAccentColor(color);
        }
      })
      .catch(function () {
        // Si CORS o el canvas no permiten leer pixeles, dejamos el fallback.
      });
  }

  function setFallbackAccent() {
    setAccentColor({ r: 255, g: 255, b: 255 });
  }

  function setAccentColor(color) {
    if (!els.root || !color) return;

    const r = clampByte(color.r);
    const g = clampByte(color.g);
    const b = clampByte(color.b);

    els.root.style.setProperty("--hpw-accent", `rgb(${r}, ${g}, ${b})`);
    els.root.style.setProperty("--hpw-accent-rgb", `${r}, ${g}, ${b}`);
  }

  function extractAccentFromArtwork(src) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";

      img.onload = function () {
        try {
          const size = 32;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;

          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) {
            resolve(null);
            return;
          }

          ctx.drawImage(img, 0, 0, size, size);
          const data = ctx.getImageData(0, 0, size, size).data;
          resolve(pickAccentColor(data));
        } catch {
          resolve(null);
        }
      };

      img.onerror = function () {
        resolve(null);
      };

      img.src = src;
    });
  }

  function pickAccentColor(data) {
    const buckets = new Map();

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 210) continue;

      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lightnessRaw = (max + min) / 2;
      const saturationRaw = max === 0 ? 0 : (max - min) / max;

      // Evita negros, blancos y grises casi sin color.
      if (lightnessRaw < 34 || lightnessRaw > 238 || saturationRaw < 0.12) {
        continue;
      }

      const qr = Math.round(r / 24) * 24;
      const qg = Math.round(g / 24) * 24;
      const qb = Math.round(b / 24) * 24;
      const key = `${qr},${qg},${qb}`;

      const hsl = rgbToHsl(r, g, b);
      const saturationScore = hsl.s;
      const lightnessScore = 1 - Math.abs(hsl.l - 0.56);
      const score = 1 + saturationScore * 2.4 + lightnessScore * 1.2;

      const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0, score: 0 };
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
      bucket.score += score;
      buckets.set(key, bucket);
    }

    let best = null;

    for (const bucket of buckets.values()) {
      const value = bucket.score * Math.sqrt(bucket.count);
      if (!best || value > best.value) {
        best = { value, bucket };
      }
    }

    if (!best) {
      return null;
    }

    let r = Math.round(best.bucket.r / best.bucket.count);
    let g = Math.round(best.bucket.g / best.bucket.count);
    let b = Math.round(best.bucket.b / best.bucket.count);

    const hsl = rgbToHsl(r, g, b);
    hsl.s = Math.max(hsl.s, 0.42);
    hsl.l = Math.max(0.46, Math.min(0.68, hsl.l));

    return hslToRgb(hsl.h, hsl.s, hsl.l);
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        default:
          h = (r - g) / d + 4;
          break;
      }

      h /= 6;
    }

    return { h, s, l };
  }

  function hslToRgb(h, s, l) {
    let r;
    let g;
    let b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = function (p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
    };
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  }

  function formatTime(ms) {
    ms = Number(ms || 0);

    if (!Number.isFinite(ms) || ms < 0) {
      ms = 0;
    }

    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const minuteText =
      minutes < 10 ? String(minutes).padStart(2, "0") : String(minutes);

    return minuteText + ":" + String(seconds).padStart(2, "0");
  }

  function safeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  init();
})();
