const TARGET_RE = /^https:\/\/vk\.com\/dating(\/|$|\?)/;
const APP_FRAME_RE = /^https:\/\/[a-z0-9-]+\.pages-ac\.vk-apps\.com\//i;
const FRAME_STATUS = "VK_DATING_AUTOCLICKER_STATUS";
const FRAME_TOGGLE = "VK_DATING_AUTOCLICKER_TOGGLE";
const STATE_EVENT = "VK_DATING_AUTOCLICKER_STATE";

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

function isTargetUrl(url = "") {
  return TARGET_RE.test(url);
}

function isAppFrameUrl(url = "") {
  return APP_FRAME_RE.test(url);
}

function defaultState(url = "") {
  return {
    available: isTargetUrl(url),
    frameReady: false,
    running: false,
    clicks: 0,
    buttonFound: false
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
      title: "VK Dating AutoClicker is available only on vk.com/dating",
      badgeText: "",
      badgeColor: BADGE_COLORS.stopped
    };
  }

  if (!state.frameReady) {
    return {
      enabled: false,
      icon: ICONS.unavailable,
      title: "VK Dating AutoClicker: dating app is still loading",
      badgeText: "",
      badgeColor: BADGE_COLORS.stopped
    };
  }

  if (!state.buttonFound) {
    return {
      enabled: false,
      icon: ICONS.unavailable,
      title: "VK Dating AutoClicker: open a profile card to use the action",
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
    chrome.action.setBadgeText({ tabId, text: presentation.badgeText }),
    chrome.action.setBadgeBackgroundColor({
      tabId,
      color: presentation.badgeColor
    })
  ]);
}

async function findAppFrame(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
  return (
    frames.find((frame) => isAppFrameUrl(frame.url)) ?? null
  );
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

async function syncActionForTab(tabId, url = "") {
  if (typeof tabId !== "number") {
    return;
  }

  if (!isTargetUrl(url)) {
    tabFrameIds.delete(tabId);
    tabStates.delete(tabId);
    await applyActionState(tabId, defaultState(url));
    return;
  }

  const frame = await findAppFrame(tabId);
  if (!frame) {
    const state = normalizeState(url, tabStates.get(tabId));
    state.frameReady = false;
    await applyActionState(tabId, state);
    return;
  }

  tabFrameIds.set(tabId, frame.frameId);

  const frameState = await sendFrameMessage(tabId, frame.frameId, {
    type: FRAME_STATUS
  });
  const nextState = normalizeState(url, {
    ...tabStates.get(tabId),
    ...(frameState ?? {}),
    frameReady: true
  });

  tabStates.set(tabId, nextState);
  await applyActionState(tabId, nextState);
}

async function syncAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => syncActionForTab(tab.id, tab.url)));
}

chrome.runtime.onInstalled.addListener(() => {
  syncAllTabs();
});

chrome.runtime.onStartup.addListener(() => {
  syncAllTabs();
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== STATE_EVENT) {
    return false;
  }

  const tabId = sender.tab?.id;
  const tabUrl = sender.tab?.url ?? "";

  if (typeof tabId !== "number") {
    return false;
  }

  tabFrameIds.set(tabId, sender.frameId ?? 0);

  const state = normalizeState(tabUrl, {
    ...message.state,
    frameReady: true
  });

  tabStates.set(tabId, state);
  applyActionState(tabId, state);

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    syncActionForTab(tabId, changeInfo.url || tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabFrameIds.delete(tabId);
  tabStates.delete(tabId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) {
    syncActionForTab(tab.id, tab.url);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !isTargetUrl(tab.url)) {
    return;
  }

  const cachedFrameId = tabFrameIds.get(tab.id);
  const frame =
    typeof cachedFrameId === "number"
      ? { frameId: cachedFrameId }
      : await findAppFrame(tab.id);

  if (!frame) {
    await syncActionForTab(tab.id, tab.url);
    return;
  }

  tabFrameIds.set(tab.id, frame.frameId);

  const state = await sendFrameMessage(tab.id, frame.frameId, {
    type: FRAME_TOGGLE
  });

  if (!state) {
    await syncActionForTab(tab.id, tab.url);
    return;
  }

  const nextState = normalizeState(tab.url, {
    ...state,
    frameReady: true
  });

  tabStates.set(tab.id, nextState);
  await applyActionState(tab.id, nextState);
});
