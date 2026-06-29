(() => {
  "use strict";

  const STORAGE_KEY = "hipePlayingAdmin.v6";
  const $ = (id) => document.getElementById(id);

  const assetExtensions = ["png", "gif", "webp", "jpg", "jpeg", "svg"];
  const assetPreferredExtensions = {
    logo: ["png", "webp", "jpg", "jpeg", "svg", "gif"],
    mc: ["png", "webp", "jpg", "jpeg", "svg", "gif"],
    user: ["png", "webp", "jpg", "jpeg", "svg", "gif"]
  };

  function resolveAsset(img, name, index = 0) {
    if (!img || !name) return;
    const extensions = assetPreferredExtensions[name] || assetExtensions;
    if (index >= extensions.length) {
      img.style.display = "none";
      const fallback = img.parentElement?.querySelector(".brand-fallback");
      if (fallback) fallback.style.display = "grid";
      return;
    }

    const ext = extensions[index];
    img.dataset.assetIndex = String(index);
    img.src = `assets/images/${name}.${ext}`;
  }

  document.querySelectorAll("img.asset-img").forEach((img) => {
    const name = img.dataset.asset;
    img.addEventListener("error", () => {
      const current = Number(img.dataset.assetIndex || 0);
      resolveAsset(img, name, current + 1);
    });
    resolveAsset(img, name);
  });

  const fields = ["font", "scale", "allowBrowsers", "hideAfter", "enterAnimation", "exitAnimation", "animationMs", "host", "port"];
  const layoutInputs = Array.from(document.querySelectorAll('input[name="layout"]'));

  const livePreview = $("livePreview");
  const frameTitle = $("frameTitle");
  const frameSub = $("frameSub");
  const scaleValue = $("scaleValue");
  const frameScale = $("frameScale");
  const connectionBadge = $("connectionBadge");
  const connectionText = $("connectionText");
  const topConnectionBadge = $("liveState");
  const topConnectionText = $("liveStateText");
  const identityDot = $("identityDot") || document.querySelector(".identity-status-dot");
  const streamerAvatar = $("streamerAvatar");
  const streamerName = $("streamerName");
  const streamerPlatform = $("streamerPlatform");

  let connectionSocket = null;
  let reconnectTimer = null;
  let reconnectRequested = true;
  let connectionAttempt = 0;

  function readLayout() {
    return layoutInputs.find((input) => input.checked)?.value || "normal";
  }

  function boolParam(id) {
    return $(id)?.checked ? "1" : "0";
  }

  function safeNumber(id, fallback, min, max) {
    const value = Number($(id)?.value);
    if (!Number.isFinite(value)) return fallback;
    if (typeof min === "number" && value < min) return min;
    if (typeof max === "number" && value > max) return max;
    return value;
  }

  function textValue(id, fallback = "") {
    const value = String($(id)?.value || "").trim();
    return value || fallback;
  }

  function widgetBase(absolute = false) {
    const file = "widget.html";
    return absolute ? new URL(file, window.location.href).href : file;
  }

  function buildUrl(options = {}) {
    const params = new URLSearchParams();
    const scale = safeNumber("scale", 1, 0.8, 1.2);
    const animationMs = Math.round(safeNumber("animationMs", 250, 100, 1500));
    const hideAfter = Math.round(safeNumber("hideAfter", 0, 0, 999));

    params.set("host", textValue("host", "127.0.0.1"));
    params.set("port", String(Math.round(safeNumber("port", 8080, 1, 65535))));
    params.set("layout", readLayout());
    params.set("font", textValue("font", "Inter"));
    params.set("scale", String(scale));
    params.set("allowBrowsers", boolParam("allowBrowsers"));
    params.set("hideAfter", String(hideAfter));
    params.set("enterAnimation", textValue("enterAnimation", "fade"));
    params.set("exitAnimation", textValue("exitAnimation", "fade"));
    params.set("animationMs", String(animationMs));
    params.set("poll", "350");
    params.set("action", "Hipe Playing - Poll Music");

    return `${widgetBase(options.absolute === true)}?${params.toString()}`;
  }

  function closeCustomSelects(except = null) {
    document.querySelectorAll(".custom-select.open").forEach((select) => {
      if (select === except) return;
      select.classList.remove("open");
      select.querySelector(".custom-select-button")?.setAttribute("aria-expanded", "false");
    });
  }

  function syncCustomSelect(select) {
    const targetId = select.dataset.target;
    const input = $(targetId);
    const label = select.querySelector(".custom-select-label");
    const value = input?.value || "fade";
    const active =
      select.querySelector(`[data-value="${CSS.escape(value)}"]`) ||
      select.querySelector("[data-value]");

    if (label && active) label.textContent = active.textContent;

    select.querySelectorAll("[data-value]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.value === value);
    });
  }

  function syncAllCustomSelects() {
    document.querySelectorAll(".custom-select").forEach(syncCustomSelect);
  }

  function initCustomSelects() {
    document.querySelectorAll(".custom-select").forEach((select) => {
      const button = select.querySelector(".custom-select-button");
      const target = $(select.dataset.target);
      if (!button || !target) return;

      syncCustomSelect(select);

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const willOpen = !select.classList.contains("open");
        closeCustomSelects(select);
        select.classList.toggle("open", willOpen);
        button.setAttribute("aria-expanded", willOpen ? "true" : "false");
      });

      select.querySelectorAll("[data-value]").forEach((option) => {
        option.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();

          target.value = option.dataset.value || "";
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));

          syncCustomSelect(select);
          closeCustomSelects();
        });
      });
    });

    document.addEventListener("click", () => closeCustomSelects());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeCustomSelects();
    });
  }

  function save() {
    const data = { layout: readLayout() };
    fields.forEach((id) => {
      const el = $(id);
      if (!el) return;
      data[id] = el.type === "checkbox" ? el.checked : el.value;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (data.layout) {
        const input = layoutInputs.find((item) => item.value === data.layout);
        if (input) input.checked = true;
      }
      fields.forEach((id) => {
        const el = $(id);
        if (!el || data[id] === undefined) return;
        if (el.type === "checkbox") el.checked = Boolean(data[id]);
        else el.value = data[id];
      });
    } catch {
      // Si localStorage está corrupto, se ignora.
    }
  }

  function layoutText(layout) {
    if (layout === "compact") return ["Preview compacto", "Una línea · pendiente de conectar"];
    if (layout === "minimal") return ["Preview minimalista", "Solo texto · 3 líneas"];
    return ["Preview normal", "Base actual · 1200 × 300"];
  }

  function updateFrameScale() {
    const wrap = document.querySelector(".live-frame-wrap");
    if (!wrap || !frameScale) return;

    // Escala visual del preview dentro del admin.
    // No modifica widget.html ni la URL que se copia para OBS.
    const previewScale = 0.50;

    const availableW = Math.max(320, wrap.clientWidth - 52);
    const availableH = Math.max(120, wrap.clientHeight - 52);
    const fitScale = Math.min(availableW / 1200, availableH / 300, previewScale);

    frameScale.style.transform = `scale(${fitScale})`;
  }

  function setConnection(status, text) {
    const normalized = status || "warn";

    if (connectionBadge) {
      connectionBadge.classList.remove("good", "bad", "warn");
      connectionBadge.classList.add(normalized);
    }

    if (topConnectionBadge) {
      topConnectionBadge.className = `live ${normalized}`;
    }

    if (connectionText) connectionText.textContent = text;
    if (topConnectionText) topConnectionText.textContent = text;

    if (identityDot) {
      identityDot.className = `identity-status-dot ${normalized === "good" ? "" : normalized}`.trim();
    }
  }

  function setStreamerFallback() {
    if (streamerName && !streamerName.textContent.trim()) streamerName.textContent = "jsmoctezuma";
    if (streamerPlatform && !streamerPlatform.textContent.trim()) streamerPlatform.textContent = "Twitch";
  }

  function updateStreamerInfo(data) {
    const source = data && data.data ? data.data : data;
    const platformChoice = pickBroadcasterPlatform(source);
    const platformKey = platformChoice.key;
    const platformData = platformChoice.data;
    const broadcaster = source && (
      platformData ||
      source.broadcaster ||
      source.streamer ||
      source.channel ||
      source.user ||
      source.twitchBroadcaster ||
      source.youtubeBroadcaster ||
      source
    );
    if (!broadcaster || typeof broadcaster !== "object") return;

    const name = firstValue(
      broadcaster.displayName,
      broadcaster.display_name,
      broadcaster.broadcastUser,
      broadcaster.broadcastUserName,
      broadcaster.broadcasterLogin,
      broadcaster.broadcasterUserName,
      broadcaster.name,
      broadcaster.login,
      broadcaster.userName,
      broadcaster.username,
      source.displayName,
      source.name
    );
    const platform = firstValue(
      platformKey,
      broadcaster.platform,
      broadcaster.type,
      broadcaster.service,
      source.platform,
      source.type,
      source.service
    );
    const avatar = firstValue(
      broadcaster.profileImageUrl,
      broadcaster.profile_image_url,
      broadcaster.profilePictureUrl,
      broadcaster.profile_image,
      broadcaster.broadcastUserProfileImage,
      broadcaster.broadcasterProfileUrl,
      broadcaster.avatar,
      broadcaster.image,
      broadcaster.logo,
      broadcaster.thumbnailUrl,
      source.profileImageUrl,
      source.profile_image_url,
      source.avatar,
      source.image,
      source.logo
    );

    if (name && streamerName) streamerName.textContent = String(name);
    if (platform && streamerPlatform) streamerPlatform.textContent = String(platform);
    if (avatar && streamerAvatar) streamerAvatar.src = String(avatar);
  }

  function pickBroadcasterPlatform(source) {
    const empty = { key: "", data: null };
    if (!source || !source.platforms || typeof source.platforms !== "object") return empty;

    const connected = Array.isArray(source.connected) && source.connected.length
      ? source.connected
      : Object.keys(source.platforms);

    let firstWithName = empty;

    for (const key of connected) {
      const data = source.platforms[key];
      if (!data || typeof data !== "object") continue;

      if (firstWithName.data === null) {
        firstWithName = { key, data };
      }

      if (firstValue(
        data.profileImageUrl,
        data.profile_image_url,
        data.profilePictureUrl,
        data.profile_image,
        data.broadcastUserProfileImage,
        data.broadcasterProfileUrl,
        data.avatar,
        data.image,
        data.logo,
        data.thumbnailUrl
      )) {
        return { key, data };
      }
    }

    return firstWithName;
  }

  function firstValue(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }

    return "";
  }

  function isBroadcasterResponse(payload) {
    return payload && (
      payload.id === "hipe-playing-admin-broadcaster" ||
      payload.request === "GetBroadcaster" ||
      payload.requestType === "GetBroadcaster"
    );
  }

  function handleBroadcasterResponse(payload) {
    if (!isBroadcasterResponse(payload)) return;
    updateStreamerInfo(payload);
  }

  function requestStreamerInfo() {
    if (!connectionSocket || connectionSocket.readyState !== WebSocket.OPEN) return;

    try {
      connectionSocket.send(JSON.stringify({ request: "GetBroadcaster", id: "hipe-playing-admin-broadcaster" }));
    } catch {
      // Streamer.bot puede no exponer este dato por WebSocket; mantenemos fallback local.
    }
  }

  function update() {
    const scale = safeNumber("scale", 1, 0.8, 1.2);
    const hideAfter = Math.round(safeNumber("hideAfter", 0, 0, 999));
    const animationMs = Math.round(safeNumber("animationMs", 250, 100, 1500));

    $("scale").value = String(scale);
    $("hideAfter").value = String(hideAfter);
    $("animationMs").value = String(animationMs);
    if (!textValue("host")) $("host").value = "127.0.0.1";

    scaleValue.textContent = `${Math.round(scale * 100)}%`;
    const [title, sub] = layoutText(readLayout());
    frameTitle.textContent = title;
    frameSub.textContent = sub;

    window.clearTimeout(update.timer);
    update.timer = window.setTimeout(() => {
      livePreview.src = buildUrl();
    }, 180);

    save();
    updateFrameScale();
  }

  function showToast(message, status = "good") {
    const toast = $("toast");
    if (!toast) return;

    const icon = $("toastIcon");
    const textEl = $("toastText") || toast.querySelector("span:nth-child(2)");
    if (textEl) textEl.textContent = message;

    toast.className = `toast ${status === "good" ? "" : status}`.trim();
    if (icon) {
      icon.className = "toast-icon iconify";
      icon.dataset.icon = status === "good" ? "mdi:check-circle-outline" : status === "warn" ? "mdi:alert-outline" : "mdi:alert-circle-outline";
    }

    toast.style.display = "flex";
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.style.display = "none";
    }, 2600);
  }

  $("toast")?.querySelector("button")?.addEventListener("click", () => { $("toast").style.display = "none"; });

  async function copyText(text, label = "Texto") {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copiado`);
    } catch {
      showToast("No se pudo copiar. Revisa permisos del navegador.", "warn");
    }
  }

  function closeConnectionSocket() {
    try { connectionSocket?.close(); } catch {}
    connectionSocket = null;
  }

  function scheduleReconnect(delay = 5000) {
    window.clearTimeout(reconnectTimer);
    if (!reconnectRequested) return;
    reconnectTimer = window.setTimeout(connectAdminSocket, delay);
  }

  function connectAdminSocket() {
    const host = textValue("host", "127.0.0.1");
    const port = Math.round(safeNumber("port", 8080, 1, 65535));

    if (connectionSocket && (
      connectionSocket.readyState === WebSocket.OPEN ||
      connectionSocket.readyState === WebSocket.CONNECTING
    )) {
      return;
    }

    closeConnectionSocket();
    setConnection("warn", "Conectando");
    connectionAttempt += 1;
    const attempt = connectionAttempt;

    try {
      connectionSocket = new WebSocket(`ws://${host}:${port}/`);
      connectionSocket.addEventListener("open", () => {
        if (attempt !== connectionAttempt) return;
        setConnection("good", "Conectado");
        requestStreamerInfo();
      });

      connectionSocket.addEventListener("message", (event) => {
        try {
          handleBroadcasterResponse(JSON.parse(event.data));
        } catch {
          // Ignoramos mensajes que no sean JSON del API.
        }
      });

      connectionSocket.addEventListener("close", () => {
        if (attempt !== connectionAttempt) return;
        connectionSocket = null;
        setConnection("bad", "Sin conexión");
        scheduleReconnect(5000);
      });

      connectionSocket.addEventListener("error", () => {
        if (attempt !== connectionAttempt) return;
        setConnection("bad", "Sin conexión");
        try { connectionSocket?.close(); } catch {}
      });

      window.setTimeout(() => {
        if (attempt !== connectionAttempt) return;
        if (connectionSocket && connectionSocket.readyState === WebSocket.CONNECTING) {
          try { connectionSocket.close(); } catch {}
        }
      }, 2200);
    } catch {
      setConnection("bad", "Sin conexión");
      scheduleReconnect(5000);
    }
  }

  function testConnection() {
    connectionAttempt += 1;
    closeConnectionSocket();
    setConnection("warn", "Conectando");
    window.setTimeout(connectAdminSocket, 50);
  }

  function scheduleAutoConnection() {
    window.clearTimeout(scheduleAutoConnection.timer);
    setConnection("warn", "Conectando");
    scheduleAutoConnection.timer = window.setTimeout(testConnection, 450);
  }

  fields.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      update();
      if (id === "host" || id === "port") scheduleAutoConnection();
    });
    el.addEventListener("change", () => {
      update();
      if (id === "host" || id === "port") scheduleAutoConnection();
    });
  });

  layoutInputs.forEach((input) => input.addEventListener("change", update));

  document.querySelectorAll("[data-copy-field]").forEach((btn) => {
    btn.addEventListener("click", () => copyText(textValue(btn.dataset.copyField), btn.dataset.copyField));
  });

  $("copyObsBtn").addEventListener("click", () => copyText(buildUrl({ absolute: true }), "URL para OBS"));
  $("testConnectionBtn").addEventListener("click", testConnection);
  window.addEventListener("resize", updateFrameScale);

  load();
  setStreamerFallback();
  initCustomSelects();
  syncAllCustomSelects();
  update();
  updateFrameScale();
  scheduleAutoConnection();
})();
