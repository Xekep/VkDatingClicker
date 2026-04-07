(() => {
  const APP_FRAME_RE = /^https:\/\/[a-z0-9-]+\.pages-ac\.vk-apps\.com\//i;
  const FRAME_STATUS = "VK_DATING_AUTOCLICKER_STATUS";
  const FRAME_TOGGLE = "VK_DATING_AUTOCLICKER_TOGGLE";
  const STATE_EVENT = "VK_DATING_AUTOCLICKER_STATE";

  if (!APP_FRAME_RE.test(window.location.href)) {
    return;
  }

  if (window.__vkDatingAutoClickerInstalled) {
    return;
  }

  window.__vkDatingAutoClickerInstalled = true;

  const config = {
    reaction: "like",
    minDelay: 12,
    maxDelay: 24,
    retryDelayMin: 90,
    retryDelayMax: 140,
    confirmMinDelay: 120,
    confirmTimeout: 1600,
    maxClicks: Infinity,
    debug: true
  };

  const state = {
    active: false,
    clicks: 0,
    timer: null,
    delayTimer: null,
    statusTimer: null,
    waitingDelay: false,
    buttonFound: false,
    missingSince: 0,
    pendingClick: false,
    pendingSince: 0,
    pendingSignature: "",
    lastConfirmedSignature: "",
    panelHiddenByCursor: false,
    panel: null,
    panelText: null
  };

  const STATIC_TEXT = new Set([
    "Анкеты",
    "Лайки",
    "Чаты",
    "Профиль",
    "Личное",
    "Поделиться",
    "Пожаловаться",
    "Включить управление с клавиатуры"
  ]);

  function log(...args) {
    if (config.debug) {
      console.log("[VK Dating AutoClicker]", ...args);
    }
  }

  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function getButton() {
    return document.querySelector(`[data-reaction="${config.reaction}"]`);
  }

  function ensurePanel() {
    if (state.panel?.isConnected && state.panelText) {
      return;
    }

    const panel = document.createElement("div");
    const value = document.createElement("div");

    panel.id = "vk-dating-autoclicker-panel";
    panel.style.position = "fixed";
    panel.style.top = "16px";
    panel.style.right = "16px";
    panel.style.zIndex = "2147483647";
    panel.style.minWidth = "72px";
    panel.style.padding = "10px 14px";
    panel.style.borderRadius = "12px";
    panel.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.18)";
    panel.style.fontFamily = "Segoe UI, Arial, sans-serif";
    panel.style.color = "#ffffff";
    panel.style.pointerEvents = "none";
    panel.style.textAlign = "center";

    value.style.fontSize = "28px";
    value.style.lineHeight = "1";
    value.style.fontWeight = "700";
    value.style.fontVariantNumeric = "tabular-nums";

    panel.append(value);
    document.documentElement.appendChild(panel);

    state.panel = panel;
    state.panelText = value;
  }

  function updatePanel() {
    ensurePanel();

    state.panel.style.display = state.buttonFound ? "block" : "none";

    state.panel.style.background = state.active
      ? "rgba(18, 128, 78, 0.92)"
      : "rgba(177, 44, 44, 0.92)";

    state.panel.style.opacity = state.panelHiddenByCursor
      ? "0"
      : state.pendingClick
        ? "0.82"
        : "1";
    state.panelText.textContent = String(state.clicks);
  }

  function syncPanelVisibilityWithCursor(clientX, clientY) {
    ensurePanel();

    const rect = state.panel.getBoundingClientRect();
    const hidden =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    if (hidden === state.panelHiddenByCursor) {
      return;
    }

    state.panelHiddenByCursor = hidden;
    updatePanel();
  }

  function handlePointerMove(event) {
    syncPanelVisibilityWithCursor(event.clientX, event.clientY);
  }

  function revealPanel() {
    if (!state.panelHiddenByCursor) {
      return;
    }

    state.panelHiddenByCursor = false;
    updatePanel();
  }

  function handlePointerLeave(event) {
    if (event?.relatedTarget) {
      return;
    }

    revealPanel();
  }

  function status() {
    return {
      running: state.active,
      clicks: state.clicks,
      reaction: config.reaction,
      buttonFound: state.buttonFound
    };
  }

  function emitState() {
    chrome.runtime.sendMessage(
      {
        type: STATE_EVENT,
        state: status()
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  }

  function clearDelayTimer() {
    if (state.delayTimer) {
      clearTimeout(state.delayTimer);
      state.delayTimer = null;
    }
  }

  function getVisibleRect(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    if (
      rect.width < 24 ||
      rect.height < 24 ||
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= window.innerHeight ||
      rect.left >= window.innerWidth
    ) {
      return null;
    }

    return rect;
  }

  function getProfileImages() {
    return Array.from(document.images)
      .map((image) => {
        const rect = getVisibleRect(image);
        if (!rect || rect.width < 120 || rect.height < 120) {
          return null;
        }

        const source = image.currentSrc || image.src || "";
        if (!source) {
          return null;
        }

        return {
          source,
          top: rect.top,
          left: rect.left,
          area: rect.width * rect.height
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        return left.top - right.top || left.left - right.left || right.area - left.area;
      })
      .slice(0, 4)
      .map((image) => image.source);
  }

  function getProfileTextLines() {
    const lines = (document.body.innerText || "")
      .replace(/\u00A0/g, " ")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !STATIC_TEXT.has(line))
      .filter((line) => line.length <= 80)
      .filter((line) => !/^\d+$/.test(line));
    const primary = lines.find((line) => /,\s*\d{1,2}\b/.test(line)) || "";
    const distance = lines.find((line) => /\b\d+\s*км\b/i.test(line)) || "";
    const details = lines
      .filter((line) => line !== primary && line !== distance)
      .filter((line) => line.length >= 3)
      .slice(0, 4);

    return [primary, distance, ...details].filter(Boolean);
  }

  function getCardSignature() {
    const images = getProfileImages();
    const lines = getProfileTextLines();

    if (!images.length && !lines.length) {
      return "";
    }

    return JSON.stringify({
      images,
      lines
    });
  }

  function scheduleUnlock(minDelay = config.minDelay, maxDelay = config.maxDelay) {
    clearDelayTimer();
    state.delayTimer = setTimeout(() => {
      state.waitingDelay = false;
    }, rand(minDelay, maxDelay));
  }

  function beginClickAttempt(signature) {
    state.pendingClick = true;
    state.pendingSince = performance.now();
    state.pendingSignature = signature;
    state.waitingDelay = true;
    updatePanel();
  }

  function finishConfirmedClick(signature) {
    state.pendingClick = false;
    state.pendingSince = 0;
    state.pendingSignature = "";
    state.lastConfirmedSignature = signature || state.lastConfirmedSignature;
    state.clicks += 1;

    log(`Confirmed click #${state.clicks} (${config.reaction})`);
    emitState();
    updatePanel();
    scheduleUnlock();
  }

  function failClickAttempt() {
    state.pendingClick = false;
    state.pendingSince = 0;
    state.pendingSignature = "";

    log("Click was not confirmed, retrying");
    updatePanel();
    scheduleUnlock(config.retryDelayMin, config.retryDelayMax);
  }

  function refreshStatus() {
    const previous = state.buttonFound;
    const signature = getCardSignature();
    state.buttonFound = Boolean(getButton());
    if (signature && !state.pendingClick) {
      state.lastConfirmedSignature = signature;
    }
    updatePanel();
    return previous !== state.buttonFound;
  }

  function ensureStatusTimer() {
    if (state.statusTimer) {
      return;
    }

    state.statusTimer = setInterval(() => {
      if (refreshStatus()) {
        emitState();
      }
    }, 300);
  }

  function stopLoop() {
    if (state.timer) {
      cancelAnimationFrame(state.timer);
      state.timer = null;
    }

    clearDelayTimer();
    state.waitingDelay = false;
    state.missingSince = 0;
    state.pendingClick = false;
    state.pendingSince = 0;
    state.pendingSignature = "";
    refreshStatus();
  }

  function loop() {
    if (!state.active) {
      state.timer = null;
      return;
    }

    if (state.clicks >= config.maxClicks) {
      state.active = false;
      stopLoop();
      log("Click limit reached:", state.clicks);
      emitState();
      return;
    }

    const button = getButton();
    const signature = getCardSignature();
    state.buttonFound = Boolean(button);
    if (signature && !state.pendingClick) {
      state.lastConfirmedSignature = signature;
    }
    updatePanel();

    if (state.pendingClick) {
      const elapsed = performance.now() - state.pendingSince;

      if (
        elapsed >= config.confirmMinDelay &&
        signature &&
        signature !== state.pendingSignature
      ) {
        finishConfirmedClick(signature);
      } else if (elapsed >= config.confirmTimeout) {
        failClickAttempt();
      }

      state.timer = requestAnimationFrame(loop);
      return;
    }

    if (!button) {
      if (!state.missingSince) {
        state.missingSince = performance.now();
      }

      if (performance.now() - state.missingSince >= 1200) {
        state.active = false;
        stopLoop();
        log("Profile card is no longer visible, autoclicker stopped");
        emitState();
        return;
      }

      state.timer = requestAnimationFrame(loop);
      return;
    }

    state.missingSince = 0;

    if (button && !state.waitingDelay) {
      beginClickAttempt(signature || state.lastConfirmedSignature);
      button.click();
      log("Click attempt fired");
    }

    state.timer = requestAnimationFrame(loop);
  }

  function start() {
    if (state.active) {
      log("Already running");
      return status();
    }

    state.active = true;
    log("Starting...");
    refreshStatus();
    emitState();
    loop();
    return status();
  }

  function stop() {
    if (!state.active && !state.timer && !state.waitingDelay) {
      log("Already stopped");
      refreshStatus();
      emitState();
      return status();
    }

    state.active = false;
    stopLoop();
    log("Stopped");
    emitState();
    return status();
  }

  function toggle() {
    return state.active ? stop() : start();
  }

  window.vkDatingAutoClicker = {
    config,
    start,
    stop,
    toggle,
    status
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === FRAME_TOGGLE) {
      sendResponse(toggle());
      return false;
    }

    if (message?.type === FRAME_STATUS) {
      refreshStatus();
      sendResponse(status());
      return false;
    }

    return false;
  });

  refreshStatus();
  ensureStatusTimer();
  window.addEventListener("mousemove", handlePointerMove, { passive: true });
  window.addEventListener("mouseout", handlePointerLeave, true);
  window.addEventListener("blur", revealPanel);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      revealPanel();
    }
  });
  emitState();
})();
