(() => {
  const APP_HOST_RE = /^[a-z0-9-]+\.(?:pages-ac\.vk-apps\.com|pages\.vk-apps\.ru)$/i;
  const FRAME_STATUS = "VK_DATING_AUTOCLICKER_STATUS";
  const FRAME_TOGGLE = "VK_DATING_AUTOCLICKER_TOGGLE";
  const FRAME_STOP = "VK_DATING_AUTOCLICKER_STOP";
  const FRAME_AUTHORIZE = "VK_DATING_AUTOCLICKER_AUTHORIZE";
  const STATE_EVENT = "VK_DATING_AUTOCLICKER_STATE";

  function isDatingFrame(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || !APP_HOST_RE.test(parsed.hostname)) return false;
      const appId = parsed.searchParams.get("vk_app_id");
      return appId !== null ? appId === "7058363" :
        /(?:^|-)app7058363(?:-|\.)/i.test(parsed.hostname);
    } catch {
      return false;
    }
  }

  if (!isDatingFrame(window.location.href)) {
    return;
  }

  if (window.__vkDatingAutoClickerInstalled) {
    return;
  }

  window.__vkDatingAutoClickerInstalled = true;

  const config = {
    reaction: "like",
    minDelay: 0,
    maxDelay: 8,
    retryDelayMin: 60,
    retryDelayMax: 100,
    confirmMinDelay: 60,
    confirmStableDelay: 60,
    confirmTimeout: 1600,
    maxFailures: 3,
    maxClicks: Infinity,
    debug: false
  };

  const state = {
    active: false,
    clicks: 0,
    timer: null,
    delayTimer: null,
    statusTimer: null,
    waitingDelay: false,
    buttonFound: false,
    eligible: false,
    reason: "button_missing",
    missingSince: 0,
    pendingClick: false,
    pendingAcrossSkip: false,
    pendingSkip: null,
    skipSince: 0,
    skipSignature: "",
    skipFailures: 0,
    skipRetryAt: 0,
    pendingSince: 0,
    pendingSignature: "",
    candidateSignature: "",
    candidateSince: 0,
    failures: 0,
    authorizing: false,
    generation: 0,
    panelHiddenByCursor: false,
    panel: null,
    panelText: null
  };

  function log(...args) {
    if (config.debug) {
      console.log("[VK Dating AutoClicker]", ...args);
    }
  }

  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function getButton() {
    return Array.from(document.querySelectorAll(`[data-reaction="${config.reaction}"]`))
      .find(isUsableControl) ?? null;
  }

  function getSkipButton() {
    return Array.from(document.querySelectorAll("button#common-skip, .vkuiPlaceholder__action button"))
      .find((button) => /^(?:Пропустить|Не сейчас|Продолжить)$/i.test(
        (button.textContent || "").replace(/\s+/g, " ").trim()
      ) && isUsableControl(button)) ?? null;
  }

  function getSkipSignature(button) {
    const prompt = button.closest(".vkuiPlaceholder__host") || button.parentElement || button;
    return (prompt.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isUsableControl(button) {
    if (!getVisibleRect(button) || button.matches(":disabled") ||
        button.closest('[inert], [aria-disabled="true"], [aria-hidden="true"]')) {
      return false;
    }
    // These inherited properties can be overridden by a child. Checking
    // every ancestor rejects controls that are actually clickable.
    const buttonStyle = getComputedStyle(button);
    if (buttonStyle.visibility !== "visible" || buttonStyle.pointerEvents === "none") {
      return false;
    }
    for (let element = button; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === "none" || Number(style.opacity) === 0) {
        return false;
      }
    }
    const rect = button.getBoundingClientRect();
    const x = (Math.max(0, rect.left) + Math.min(window.innerWidth, rect.right)) / 2;
    const y = (Math.max(0, rect.top) + Math.min(window.innerHeight, rect.bottom)) / 2;
    const hit = document.elementFromPoint(x, y);
    return hit === button || button.contains(hit);
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
      buttonFound: state.buttonFound,
      eligible: state.eligible,
      reason: state.reason
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
    const button = getButton();
    if (!button) return [];
    // The deck keeps the next profile in the DOM. Find the photo belonging
    // to the usable reaction controls instead of inspecting the whole page.
    let images = [];
    for (let root = button.parentElement; root && root !== document.body; root = root.parentElement) {
      images = Array.from(root.querySelectorAll("img"));
      if (images.length) break;
    }
    return images
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

  function getProfilePrimary() {
    const primaryPattern = /^[^,\d\r\n]{1,60},\s*\d{1,2}$/u;
    // In the current markup the name is a div and the age a sibling span.
    // Their parent textContent joins them without innerText's block breaks.
    for (const span of document.querySelectorAll("span")) {
      if (!/^,\s*\d{1,2}$/.test((span.textContent || "").trim())) continue;
      const parent = span.parentElement;
      if (!parent || !getVisibleRect(parent)) continue;
      const text = (parent.textContent || "").replace(/\s+/g, " ").trim();
      if (primaryPattern.test(text)) return text;
    }
    return (document.body.innerText || "")
      .replace(/\u00A0/g, " ")
      .replace(/\s*\n\s*(?=,\s*\d{1,2}(?:\s|$))/g, "")
      .split(/\n+/)
      .map((line) => line.trim())
      .find((line) => primaryPattern.test(line)) || "";
  }

  function getCardSignature() {
    const images = getProfileImages();
    const primary = getProfilePrimary();
    // A notification or a carousel change is not a new profile. Fail closed
    // when the page does not expose enough information to identify a card.
    if (!images.length || !primary) {
      return "";
    }
    return JSON.stringify({ primary, image: images[0] });
  }

  function isNewProfile(signature, previous) {
    if (!signature || !previous) {
      return false;
    }
    const next = JSON.parse(signature);
    const before = JSON.parse(previous);
    return next.primary !== before.primary && next.image !== before.image;
  }

  function scheduleUnlock(minDelay = config.minDelay, maxDelay = config.maxDelay) {
    clearDelayTimer();
    state.delayTimer = setTimeout(() => {
      state.waitingDelay = false;
    }, rand(minDelay, maxDelay));
  }

  function beginClickAttempt(signature) {
    state.pendingClick = true;
    state.pendingAcrossSkip = false;
    state.pendingSince = performance.now();
    state.pendingSignature = signature;
    state.candidateSignature = "";
    state.candidateSince = 0;
    state.waitingDelay = true;
    updatePanel();
  }

  function finishClickAttempt(confirmed) {
    state.pendingClick = false;
    state.pendingAcrossSkip = false;
    state.pendingSince = 0;
    state.pendingSignature = "";
    state.candidateSignature = "";
    if (confirmed) {
      state.failures = 0;
      state.clicks += 1;
      log(`Confirmed profile transition #${state.clicks} (${config.reaction})`);
    } else {
      log("Same profile restored after skip; resuming without counting a like");
    }
    emitState();
    updatePanel();
    scheduleUnlock();
  }

  function failClickAttempt() {
    state.pendingClick = false;
    state.pendingAcrossSkip = false;
    state.pendingSince = 0;
    state.pendingSignature = "";
    state.candidateSignature = "";
    state.failures += 1;
    if (state.failures >= config.maxFailures) {
      log("Confirmation failure limit reached");
      stop();
      return;
    }
    log("Profile transition was not confirmed, retrying");
    updatePanel();
    scheduleUnlock(config.retryDelayMin, config.retryDelayMax);
  }

  function refreshStatus() {
    const previous = state.buttonFound;
    const previouslyEligible = state.eligible;
    const previousReason = state.reason;
    const skip = getSkipButton();
    state.buttonFound = Boolean(skip || getButton());
    state.eligible = Boolean(skip) || (state.buttonFound && Boolean(getCardSignature()));
    state.reason = state.eligible ? "" : state.buttonFound ? "profile_unrecognized" :
      document.querySelectorAll(`[data-reaction="${config.reaction}"]`).length ? "button_unavailable" : "button_missing";
    updatePanel();
    return previous !== state.buttonFound || previouslyEligible !== state.eligible || previousReason !== state.reason;
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
    state.generation += 1;
    state.authorizing = false;
    if (state.timer) {
      cancelAnimationFrame(state.timer);
      state.timer = null;
    }

    clearDelayTimer();
    state.waitingDelay = false;
    state.missingSince = 0;
    state.pendingClick = false;
    state.pendingAcrossSkip = false;
    state.pendingSkip = null;
    state.skipSince = 0;
    state.skipSignature = "";
    state.skipFailures = 0;
    state.skipRetryAt = 0;
    state.pendingSince = 0;
    state.pendingSignature = "";
    state.candidateSignature = "";
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

    const skip = getSkipButton();
    if (skip) {
      state.missingSince = 0;
      if (refreshStatus()) emitState();
      // A prompt is not a new profile. Preserve any pending like and wait for
      // the next actual profile after the prompt has been dismissed.
      if (state.pendingClick) {
        state.pendingSince = performance.now();
        state.candidateSignature = "";
      }
      // React can reuse the same skip button for consecutive suggestions.
      // A replacement control or changed prompt text means the prior skip worked.
      if (state.pendingSkip && (state.pendingSkip !== skip || state.skipSignature !== getSkipSignature(skip))) {
        state.pendingSkip = null;
        state.skipFailures = 0;
        state.skipRetryAt = performance.now() + rand(config.minDelay, config.maxDelay);
      }
      if (state.pendingSkip) {
        if (performance.now() - state.skipSince >= config.confirmTimeout) {
          state.pendingSkip = null;
          state.skipFailures += 1;
          if (state.skipFailures >= config.maxFailures) {
            log("Skip failure limit reached");
            stop();
            return;
          }
          state.skipRetryAt = performance.now() + rand(config.retryDelayMin, config.retryDelayMax);
        }
      } else if (!state.authorizing && performance.now() >= state.skipRetryAt) {
        requestClick("skip");
      }
      state.timer = requestAnimationFrame(loop);
      return;
    }
    if (state.pendingSkip || state.skipFailures) {
      state.pendingSkip = null;
      state.skipSignature = "";
      state.skipFailures = 0;
      state.skipRetryAt = 0;
      if (!state.pendingClick) {
        clearDelayTimer();
        state.waitingDelay = false;
      }
    }

    const button = getButton();
    const signature = getCardSignature();
    const eligible = Boolean(button && signature);
    if (state.buttonFound !== Boolean(button) || state.eligible !== eligible) {
      state.buttonFound = Boolean(button);
      state.eligible = eligible;
      emitState();
    }
    updatePanel();

    if (state.pendingClick) {
      const elapsed = performance.now() - state.pendingSince;

      const newProfile = isNewProfile(signature, state.pendingSignature);
      // Dismissing a prompt can restore the same profile. In that case the
      // old click cannot be confirmed, but it must not block the next attempt
      // for confirmTimeout. Use the same stability window as a new profile.
      if (button && signature && (newProfile || state.pendingAcrossSkip)) {
        if (state.candidateSignature !== signature) {
          state.candidateSignature = signature;
          state.candidateSince = performance.now();
        }
      } else {
        state.candidateSignature = "";
      }
      if (state.candidateSignature && elapsed >= config.confirmMinDelay &&
          performance.now() - state.candidateSince >= config.confirmStableDelay) {
        finishClickAttempt(newProfile);
      } else if (elapsed >= config.confirmTimeout) {
        failClickAttempt();
      }
      if (!state.active) return;
      state.timer = requestAnimationFrame(loop);
      return;
    }

    if (!button || !signature) {
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

    if (!state.waitingDelay && !state.authorizing) {
      requestClick("like");
    }

    state.timer = requestAnimationFrame(loop);
  }

  function requestClick(kind) {
    // Recheck the top-level URL before every click, including skip buttons.
    state.authorizing = true;
    const generation = state.generation;
    chrome.runtime.sendMessage({ type: FRAME_AUTHORIZE }, (response) => {
      const failed = chrome.runtime.lastError;
      if (generation !== state.generation || !state.active) return;
      state.authorizing = false;
      if (failed || !response?.allowed) {
        stop();
        return;
      }
      const skip = getSkipButton();
      if (kind === "skip") {
        if (!skip) return;
        if (state.pendingClick) state.pendingAcrossSkip = true;
        state.pendingSkip = skip;
        state.skipSince = performance.now();
        state.skipSignature = getSkipSignature(skip);
        skip.click();
        log("Prompt skip fired");
        return;
      }
      // The prompt may have appeared while authorization was in flight.
      if (skip) return;
      const currentButton = getButton();
      const currentSignature = getCardSignature();
      if (!currentButton || !currentSignature) return;
      beginClickAttempt(currentSignature);
      currentButton.click();
      log("Click attempt fired");
    });
  }

  function start() {
    if (state.active) {
      log("Already running");
      return status();
    }

    refreshStatus();
    if (!state.eligible) return status();
    state.failures = 0;
    state.active = true;
    log("Starting...");
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
    if (message?.type === FRAME_STOP) {
      sendResponse(state.active ? stop() : status());
      return false;
    }
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
