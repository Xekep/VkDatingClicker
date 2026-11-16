const APP_HOST_RE = /^[a-z0-9-]+\.(?:pages-ac\.vk-apps\.com|pages\.vk-apps\.ru)$/i;
const DATING_APP_ID = "7058363";
const FRAME_STATUS = "VK_DATING_AUTOCLICKER_STATUS";
const FRAME_TOGGLE = "VK_DATING_AUTOCLICKER_TOGGLE";
const FRAME_STOP = "VK_DATING_AUTOCLICKER_STOP";
const FRAME_AUTHORIZE = "VK_DATING_AUTOCLICKER_AUTHORIZE";
const STATE_EVENT = "VK_DATING_AUTOCLICKER_STATE";
const INSPECT = "VK_DATING_AUTOCLICKER_INSPECT";
const CONTROL = "VK_DATING_AUTOCLICKER_CONTROL";

const REASONS = {
  outside_target: "Откройте vk.ru/dating или vk.com/dating.",
  frame_missing: "Приложение знакомств не найдено. Откройте раздел «Анкеты» и дождитесь загрузки.",
  script_missing: "Нет связи со страницей знакомств. Обновите вкладку VK после установки или обновления расширения. Также проверьте, разрешён ли расширению доступ к сайтам VK.",
  ambiguous: "Открыто несколько экземпляров приложения знакомств. Оставьте одну анкету в этой вкладке.",
  button_missing: "Кнопка лайка не найдена. Откройте раздел «Анкеты» с фотографией и кнопками реакций.",
  button_unavailable: "Кнопка лайка скрыта, заблокирована или перекрыта. Закройте окна поверх анкеты и прокрутите к кнопкам реакций.",
  profile_unrecognized: "Не удалось распознать имя, возраст или фото анкеты. Дождитесь загрузки и прокрутите к началу анкеты."
};

const ICONS = {
  running: {
    16: "icons/green16.png",
    32: "icons/green32.png",
    48: "icons/green48.png",
    128: "icons/green128.png"
  },
  stopped: {
    16: "icons/red16.png",
    32: "icons/red32.png",
    48: "icons/red48.png",
    128: "icons/red128.png"
  },
  unavailable: {
    16: "icons/gray16.png",
    32: "icons/gray32.png",
    48: "icons/gray48.png",
    128: "icons/gray128.png"
  }
};

const BADGE_COLORS = {
  running: "#138A52",
  stopped: "#B63838"
};

const tabFrameIds = new Map();
const tabStates = new Map();
const tabTasks = new Map();

function enqueueTab(tabId, task) {
  const pending = (tabTasks.get(tabId) ?? Promise.resolve()).then(task).catch(() => {
    // Tabs and frames can disappear while Chrome API requests are in flight.
    tabFrameIds.delete(tabId);
    tabStates.delete(tabId);
  });
  tabTasks.set(tabId, pending);
  pending.finally(() => {
    if (tabTasks.get(tabId) === pending) tabTasks.delete(tabId);
  });
  return pending;
}

function isTargetUrl(url = "") {
  try {
    const parsed = new URL(url);
    return (parsed.origin === "https://vk.com" || parsed.origin === "https://vk.ru") &&
      (parsed.pathname === "/dating" || parsed.pathname.startsWith("/dating/"));
  } catch {
    return false;
  }
}

function isAppFrameUrl(url = "") {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !APP_HOST_RE.test(parsed.hostname)) return false;
    const appId = parsed.searchParams.get("vk_app_id");
    return appId !== null ? appId === DATING_APP_ID :
      /(?:^|-)app7058363(?:-|\.)/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function defaultState(url = "") {
  return {
    available: isTargetUrl(url),
    frameReady: false,
    running: false,
    clicks: 0,
    buttonFound: false,
    eligible: false,
    reason: isTargetUrl(url) ? "frame_missing" : "outside_target"
  };
}

function formatBadgeText(clicks) {
  if (clicks <= 0) {
    return "0";
  }

  if (clicks < 1000) {
    return String(clicks);
  }

  if (clicks < 10000) {
    return `${Math.floor(clicks / 1000)}k`;
  }

  return "9k+";
}

function normalizeState(url, state) {
  return {
    ...defaultState(url),
    ...(state ?? {}),
    available: isTargetUrl(url)
  };
}

function getActionPresentation(state) {
  if (!state.available) {
    return {
      enabled: false,
      icon: ICONS.unavailable,
      title: "VK Dating AutoClicker is available only on vk.com/dating or vk.ru/dating",
      badgeText: "",
      badgeColor: BADGE_COLORS.stopped
    };
  }

  if (!state.frameReady) {
    return {
      enabled: true,
      needsHelp: true,
      icon: ICONS.unavailable,
      title: REASONS[state.reason] || REASONS.script_missing,
      badgeText: "",
      badgeColor: BADGE_COLORS.stopped
    };
  }

  if ((!state.buttonFound || !state.eligible) && !state.running) {
    return {
      enabled: true,
      needsHelp: true,
      icon: ICONS.unavailable,
      title: REASONS[state.reason] || REASONS.button_missing,
      badgeText: "",
      badgeColor: BADGE_COLORS.stopped
    };
  }

  if (state.running) {
    return {
      enabled: true,
      icon: ICONS.running,
      title: `VK Dating AutoClicker: running, clicks ${state.clicks}`,
      badgeText: formatBadgeText(state.clicks),
      badgeColor: BADGE_COLORS.running
    };
  }

  return {
    enabled: true,
    icon: ICONS.stopped,
    title: `VK Dating AutoClicker: stopped, clicks ${state.clicks}. Click to start`,
    badgeText: formatBadgeText(state.clicks),
    badgeColor: BADGE_COLORS.stopped
  };
}

async function applyActionState(tabId, state) {
  if (typeof tabId !== "number") {
    return;
  }

  const presentation = getActionPresentation(state);

  if (presentation.enabled) {
    await chrome.action.enable(tabId);
  } else {
    await chrome.action.disable(tabId);
  }

  await Promise.all([
    chrome.action.setIcon({ tabId, path: presentation.icon }),
    chrome.action.setTitle({ tabId, title: presentation.title }),
    chrome.action.setPopup({ tabId, popup: presentation.needsHelp ? "popup.html" : "" }),
    chrome.action.setBadgeText({ tabId, text: presentation.badgeText }),
    chrome.action.setBadgeBackgroundColor({
      tabId,
      color: presentation.badgeColor
    })
  ]);
}

async function findAppFrame(tabId) {
  const frames = await getAppFrames(tabId);
  const candidates = await Promise.all(frames.map(async (frame) => ({
    ...frame,
    state: await sendFrameMessage(tabId, frame.frameId, { type: FRAME_STATUS })
  })));
  const ready = candidates.filter((frame) => frame.state?.eligible || frame.state?.running);
  const responding = candidates.filter((frame) => frame.state);
  // Even for app 7058363, refuse ambiguous frames rather than guessing.
  if (ready.length !== 1) {
    await Promise.all(candidates.filter((frame) => frame.state?.running)
      .map((frame) => sendFrameMessage(tabId, frame.frameId, { type: FRAME_STOP })));
    if (ready.length === 0 && responding.length === 1) {
      return { frame: responding[0] };
    }
    return { frame: null, reason: !frames.length ? "frame_missing" :
      !responding.length ? "script_missing" : "ambiguous" };
  }
  return { frame: ready[0] };
}

async function getAppFrames(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
  return (frames ?? []).filter((frame) => frame.frameId !== 0 && isAppFrameUrl(frame.url));
}

async function stopAppFrames(tabId) {
  const frames = await getAppFrames(tabId);
  await Promise.all(frames.map((frame) =>
    sendFrameMessage(tabId, frame.frameId, { type: FRAME_STOP })));
}

function sendFrameMessage(tabId, frameId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }

      resolve(response ?? null);
    });
  });
}

async function syncActionForTab(tabId) {
  if (typeof tabId !== "number") {
    return;
  }

  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? "";
  if (!isTargetUrl(url)) {
    tabFrameIds.delete(tabId);
    tabStates.delete(tabId);
    await stopAppFrames(tabId);
    await applyActionState(tabId, defaultState(url));
    return;
  }

  const { frame, reason } = await findAppFrame(tabId);
  if (!frame) {
    tabFrameIds.delete(tabId);
    const state = defaultState(url);
    state.reason = reason;
    tabStates.set(tabId, state);
    await applyActionState(tabId, state);
    return;
  }

  tabFrameIds.set(tabId, frame.frameId);

  const nextState = normalizeState(url, {
    ...frame.state,
    frameReady: true
  });

  tabStates.set(tabId, nextState);
  await applyActionState(tabId, nextState);
}

async function syncAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => enqueueTab(tab.id, () => syncActionForTab(tab.id))));
}

chrome.runtime.onInstalled.addListener(() => {
  syncAllTabs();
});

chrome.runtime.onStartup.addListener(() => {
  syncAllTabs();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === INSPECT || message?.type === CONTROL) {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (typeof tab?.id !== "number") throw new Error("Нет активной вкладки.");
      await enqueueTab(tab.id, () => message.type === CONTROL ? toggleForTab(tab.id) : syncActionForTab(tab.id));
      const state = tabStates.get(tab.id) ?? defaultState(tab.url);
      sendResponse({ version: chrome.runtime.getManifest().version, state,
        explanation: REASONS[state.reason] || "" });
    })().catch(() => sendResponse({ error: "Не удалось проверить вкладку. Обновите страницу и попробуйте снова." }));
    return true;
  }
  if (message?.type !== STATE_EVENT && message?.type !== FRAME_AUTHORIZE) {
    return false;
  }

  const tabId = sender.tab?.id;
  if (typeof tabId !== "number" || !isAppFrameUrl(sender.url) || !sender.frameId) {
    return false;
  }

  if (message.type === FRAME_AUTHORIZE) {
    let responded = false;
    enqueueTab(tabId, async () => {
      let tab = await chrome.tabs.get(tabId);
      if (!tabFrameIds.has(tabId) && isTargetUrl(tab.url)) {
        await syncActionForTab(tabId);
        tab = await chrome.tabs.get(tabId);
      }
      responded = true;
      sendResponse({ allowed: isTargetUrl(tab.url) &&
        tabFrameIds.get(tabId) === sender.frameId });
    }).then(() => {
      if (!responded) sendResponse({ allowed: false });
    });
    return true;
  }
  // Discover candidates instead of allowing any app iframe to replace routing.
  enqueueTab(tabId, async () => {
    await syncActionForTab(tabId);
  });
  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    enqueueTab(tabId, () => syncActionForTab(tabId));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabFrameIds.delete(tabId);
  tabStates.delete(tabId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) {
    enqueueTab(tab.id, () => syncActionForTab(tab.id));
  }
});

async function toggleForTab(tabId) {
  await syncActionForTab(tabId);
  const current = await chrome.tabs.get(tabId);
  const frameId = tabFrameIds.get(tabId);
  if (!isTargetUrl(current.url) || typeof frameId !== "number") return;
  const state = await sendFrameMessage(tabId, frameId, { type: FRAME_TOGGLE });
  if (!state) {
    await syncActionForTab(tabId);
    return;
  }
  const nextState = normalizeState(current.url, { ...state, frameReady: true });
  tabStates.set(tabId, nextState);
  await applyActionState(tabId, nextState);
}

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab?.id !== "number") return;
  return enqueueTab(tab.id, () => toggleForTab(tab.id));
});
