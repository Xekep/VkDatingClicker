const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = (file) => fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
const rect = { left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 };

function contentHarness(href = "https://prod-app7058363-8402a5925651.pages.vk-apps.ru/index.html") {
  let now = 1, nextId = 0, attempts = 0, skips = 0, allowed = true;
  let deferred = false, authorizeCallback;
  let messageListener, pollStatus;
  const rafs = new Map(), delays = new Map();
  const events = [];
  class Element {
    constructor() {
      this.style = {};
      this.isConnected = true;
      this.visible = true;
      this.disabled = false;
      this.parentElement = null;
    }
    getBoundingClientRect() { return this.visible ? rect : { ...rect, width: 0, height: 0 }; }
    matches() { return this.disabled; }
    closest() { return null; }
    contains(hit) { return hit === this; }
    click() { attempts++; }
    append() {}
  }
  const button = new Element();
  const skip = Object.assign(new Element(), { textContent: "Пропустить", visible: false });
  skip.click = () => { skips++; };
  skip.getBoundingClientRect = () => skip.visible ?
    { ...rect, left: 300, right: 500 } : { ...rect, width: 0, height: 0 };
  const image = Object.assign(new Element(), { src: "https://img.test/anna.jpg" });
  const card = new Element();
  button.parentElement = card;
  const document = {
    body: { innerText: "Anna, 25\nMoscow" },
    images: [image],
    querySelectorAll: (selector) => selector === "span" ? [] : selector === "button#common-skip, .vkuiPlaceholder__action button" ? [skip] : [button],
    elementFromPoint: (x) => x >= 300 ? skip : button,
    createElement: () => new Element(),
    documentElement: { appendChild() {} },
    addEventListener() {}
  };
  card.querySelectorAll = () => document.images;
  const window = {
    location: { href },
    innerHeight: 800, innerWidth: 1000, addEventListener() {}
  };
  const context = {
    window, document, Element, URL, console: { log() {} },
    getComputedStyle: (element) => ({ display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto", ...element.style }),
    performance: { now: () => now },
    setInterval(fn) { pollStatus = fn; return ++nextId; },
    setTimeout(fn) { const id = ++nextId; delays.set(id, fn); return id; },
    clearTimeout(id) { delays.delete(id); },
    requestAnimationFrame(fn) { const id = ++nextId; rafs.set(id, fn); return id; },
    cancelAnimationFrame(id) { rafs.delete(id); },
    chrome: { runtime: {
      sendMessage(message, callback) {
        events.push(message);
        if (deferred && message.type.endsWith("AUTHORIZE")) {
          authorizeCallback = callback;
          return;
        }
        callback(message.type.endsWith("AUTHORIZE") ? { allowed } : undefined);
      },
      onMessage: { addListener(fn) { messageListener = fn; } }
    } }
  };
  vm.runInNewContext(source("content.js"), context);
  return {
    api: window.vkDatingAutoClicker, document, button, skip, image, card, Element, events,
    setAllowed(value) { allowed = value; },
    pollStatus() { pollStatus(); },
    deferAuthorization() { deferred = true; },
    resolveAuthorization() { authorizeCallback({ allowed: true }); },
    attempts: () => attempts,
    skips: () => skips,
    step(time) {
      now = time;
      const pending = [...rafs.values()]; rafs.clear();
      pending.forEach((fn) => fn());
    },
    unlock() { const pending = [...delays.values()]; delays.clear(); pending.forEach((fn) => fn()); },
    message(type) { let result; messageListener({ type }, {}, (value) => { result = value; }); return result; }
  };
}

test("notifications and carousel changes do not confirm a like", () => {
  const h = contentHarness();
  h.api.start();
  h.document.body.innerText += "\nNetwork error";
  h.step(130); h.step(260);
  assert.equal(h.api.status().clicks, 0);
  h.image.src = "https://img.test/anna-2.jpg";
  h.step(400); h.step(530);
  assert.equal(h.api.status().clicks, 0);
});

test("a new profile must change both identity and photo and remain stable", () => {
  const h = contentHarness(); h.api.start();
  h.document.body.innerText = "Maria, 27";
  h.step(130); h.step(260);
  assert.equal(h.api.status().clicks, 0);
  h.image.src = "https://img.test/maria.jpg";
  h.step(300); h.step(359);
  assert.equal(h.api.status().clicks, 0);
  h.step(360); h.step(390);
  assert.equal(h.api.status().clicks, 1);
});

test("a transient profile change does not count", () => {
  const h = contentHarness(); h.api.start();
  h.document.body.innerText = "Maria, 27"; h.image.src = "maria.jpg"; h.step(130);
  h.document.body.innerText = "Anna, 25"; h.image.src = "https://img.test/anna.jpg";
  h.step(300);
  assert.equal(h.api.status().clicks, 0);
});

test("split name and age nodes distinguish profiles with the same age", () => {
  const h = contentHarness();
  const nameRow = Object.assign(new h.Element(), { textContent: "Anna, 25" });
  const age = { textContent: ", 25", parentElement: nameRow };
  h.document.querySelectorAll = (selector) => selector === "span" ? [age] : [h.button];
  h.document.body.innerText = "Anna\n, 25";
  h.api.start();
  nameRow.textContent = "Maria, 25";
  h.image.src = "https://img.test/maria.jpg";
  h.step(130); h.step(260);
  assert.equal(h.api.status().clicks, 1);
});

test("split name and age are joined when DOM identity nodes are unavailable", () => {
  const h = contentHarness(); h.document.body.innerText = "Anna\n, 25";
  h.api.start();
  assert.equal(h.attempts(), 1);
  h.document.body.innerText = "Maria\n, 25";
  h.image.src = "https://img.test/maria.jpg";
  h.step(130); h.step(260);
  assert.equal(h.api.status().clicks, 1);
});

test("preloaded deck photos do not identify the active profile", () => {
  const h = contentHarness();
  const nextImage = Object.assign(new h.Element(), { src: "https://img.test/next.jpg" });
  h.card.querySelectorAll = () => [h.image];
  h.document.images = [nextImage, h.image];
  h.api.start();
  h.document.body.innerText = "Maria, 27";
  nextImage.src = "https://img.test/next-2.jpg";
  h.step(130); h.step(260);
  assert.equal(h.api.status().clicks, 0);
  h.image.src = "https://img.test/maria.jpg";
  h.step(300); h.step(430);
  assert.equal(h.api.status().clicks, 1);
});

test("a covered duplicate reaction button is skipped", () => {
  const h = contentHarness();
  const covered = new h.Element();
  covered.parentElement = h.card;
  covered.click = () => assert.fail("covered button must not be clicked");
  h.document.querySelectorAll = (selector) => selector === "span" ? [] : [covered, h.button];
  h.api.start();
  assert.equal(h.attempts(), 1);
});

test("interactive children remain usable inside a pointer-events none wrapper", () => {
  const h = contentHarness();
  h.card.style.pointerEvents = "none";
  h.button.style.pointerEvents = "auto";
  h.api.start();
  assert.equal(h.attempts(), 1);
  assert.equal(h.api.status().running, true);
});

test("a child can override inherited visibility hidden", () => {
  const h = contentHarness();
  h.card.style.visibility = "hidden";
  h.button.style.visibility = "visible";
  h.api.start();
  assert.equal(h.attempts(), 1);
});

for (const [name, disable] of [
  ["hidden", (h) => { h.button.visible = false; }],
  ["disabled", (h) => { h.button.disabled = true; }],
  ["transparent", (h) => { h.button.style.opacity = "0"; }],
  ["covered", (h) => { h.document.elementFromPoint = () => ({}); }]
]) {
  test(`${name} buttons cannot start the clicker`, () => {
    const h = contentHarness(); disable(h); h.api.start();
    assert.equal(h.attempts(), 0);
    assert.equal(h.api.status().running, false);
  });
}

test("three unconfirmed attempts stop the loop", () => {
  const h = contentHarness(); h.api.start();
  for (let i = 1; i <= 3; i++) {
    h.step(i * 2000); h.unlock(); h.step(i * 2000 + 150);
  }
  assert.equal(h.attempts(), 3);
  assert.equal(h.api.status().running, false);
  assert.equal(h.api.status().clicks, 0);
});

test("denied authorization prevents further clicks after navigation", () => {
  const h = contentHarness(); h.api.start();
  h.step(1700); h.unlock(); h.setAllowed(false); h.step(1900);
  assert.equal(h.attempts(), 1);
  assert.equal(h.api.status().running, false);
});

test("repeated stop messages do not produce a state feedback loop", () => {
  const h = contentHarness(); h.api.start();
  h.message("VK_DATING_AUTOCLICKER_STOP");
  const count = h.events.length;
  h.message("VK_DATING_AUTOCLICKER_STOP");
  assert.equal(h.events.length, count);
  assert.equal(h.api.status().running, false);
});

test("a delayed authorization cannot click after stop", () => {
  const h = contentHarness(); h.deferAuthorization(); h.api.start();
  h.api.stop(); h.resolveAuthorization(); h.step(100);
  assert.equal(h.attempts(), 0);
  assert.equal(h.api.status().running, false);
});

test("content script ignores other VK apps", () => {
  const h = contentHarness("https://prod-app123-abc.pages.vk-apps.ru/index.html?vk_app_id=123");
  assert.equal(h.api, undefined);
  assert.equal(h.events.length, 0);
});

test("profile readiness is announced even when the button never changes", () => {
  const h = contentHarness();
  h.document.images = []; h.pollStatus();
  assert.equal(h.events.at(-1).state.eligible, false);
  h.document.images = [h.image]; h.pollStatus();
  assert.equal(h.events.at(-1).state.eligible, true);
});

test("prompts can be skipped only after the user starts the clicker", () => {
  const h = contentHarness(); h.skip.visible = true;
  h.document.images = []; h.document.body.innerText = "A different suggestion";
  h.pollStatus();
  assert.equal(h.api.status().eligible, true);
  assert.equal(h.skips(), 0);
  h.api.start();
  assert.equal(h.skips(), 1);
  assert.equal(h.attempts(), 0);
  assert.equal(h.api.status().clicks, 0);
});

test("skip takes priority over profile buttons behind the prompt", () => {
  const h = contentHarness(); h.skip.visible = true; h.api.start();
  h.step(100); h.step(200);
  assert.equal(h.skips(), 1);
  assert.equal(h.attempts(), 0);
  assert.equal(h.api.status().clicks, 0);
});

test("skipping resumes likes without increasing the like counter", () => {
  const h = contentHarness(); h.skip.visible = true; h.api.start();
  h.skip.visible = false; h.step(100); h.unlock(); h.step(200);
  assert.equal(h.skips(), 1);
  assert.equal(h.attempts(), 1);
  assert.equal(h.api.status().clicks, 0);
  h.document.body.innerText = "Maria, 27"; h.image.src = "maria.jpg";
  h.step(330); h.step(460);
  assert.equal(h.api.status().clicks, 1);
});

test("a prompt pauses a pending like until a real new profile appears", () => {
  const h = contentHarness(); h.api.start();
  h.skip.visible = true; h.step(100); h.step(1200);
  assert.equal(h.api.status().clicks, 0);
  h.skip.visible = false;
  h.document.body.innerText = "Maria, 27"; h.image.src = "maria.jpg";
  h.step(1400); h.step(1530);
  assert.equal(h.skips(), 1);
  assert.equal(h.attempts(), 1);
  assert.equal(h.api.status().clicks, 1);
});

test("returning to the same profile after skip does not wait for the click timeout", () => {
  const h = contentHarness(); h.api.start();
  h.skip.visible = true; h.step(100);
  h.skip.visible = false; h.step(200); h.step(259);
  assert.equal(h.attempts(), 1);
  h.step(260); h.unlock(); h.step(276);
  assert.equal(h.skips(), 1);
  assert.equal(h.attempts(), 2);
  assert.equal(h.api.status().clicks, 0);
  assert.equal(h.api.status().running, true);
});

test("ineffective skips are retried at most three times", () => {
  const h = contentHarness(); h.skip.visible = true; h.api.start();
  for (let i = 1; i <= 3; i++) { h.step(i * 2000); h.step(i * 2000 + 150); }
  assert.equal(h.skips(), 3);
  assert.equal(h.attempts(), 0);
  assert.equal(h.api.status().running, false);
});

test("consecutive suggestions can reuse the same skip button", () => {
  const h = contentHarness(); h.skip.visible = true;
  const prompt = Object.assign(new h.Element(), { textContent: "First suggestion: Пропустить" });
  h.skip.parentElement = prompt;
  h.api.start();
  for (let i = 1; i <= 5; i++) {
    prompt.textContent = `Suggestion ${i}: Пропустить`;
    h.step(i * 100); h.step(i * 100 + 30);
  }
  assert.equal(h.skips(), 6);
  assert.equal(h.api.status().running, true);
  assert.equal(h.api.status().clicks, 0);
});

test("Not now dismisses a suggestion without liking the profile behind it", () => {
  const h = contentHarness(); h.skip.visible = true; h.skip.textContent = "Не\u00a0сейчас";
  h.api.start();
  assert.equal(h.skips(), 1);
  assert.equal(h.attempts(), 0);
  assert.equal(h.api.status().clicks, 0);
});

test("Not now is not pressed while the clicker is stopped", () => {
  const h = contentHarness(); h.skip.visible = true; h.skip.textContent = "Не сейчас";
  h.pollStatus();
  assert.equal(h.api.status().eligible, true);
  assert.equal(h.skips(), 0);
});

test("Not now can follow a skip with a reused control", () => {
  const h = contentHarness(); h.skip.visible = true; h.api.start();
  h.skip.textContent = "Не сейчас";
  h.step(100); h.step(130);
  assert.equal(h.skips(), 2);
  assert.equal(h.api.status().running, true);
  assert.equal(h.api.status().clicks, 0);
});

test("Continue dismisses a suggestion without increasing the like counter", () => {
  const h = contentHarness(); h.skip.visible = true; h.skip.textContent = "Продолжить";
  h.api.start();
  assert.equal(h.skips(), 1);
  assert.equal(h.attempts(), 0);
  assert.equal(h.api.status().clicks, 0);
});

test("Continue is not pressed before start or after stop", () => {
  const h = contentHarness(); h.skip.visible = true; h.skip.textContent = "Продолжить";
  h.pollStatus();
  assert.equal(h.skips(), 0);
  h.api.start(); h.api.stop(); h.step(100);
  assert.equal(h.skips(), 1);
});

test("likes resume on the first frame after a prompt disappears", () => {
  const h = contentHarness(); h.skip.visible = true; h.api.start();
  h.skip.visible = false; h.step(100);
  assert.equal(h.attempts(), 1);
  assert.equal(h.api.status().clicks, 0);
});

test("faster confirmation still waits for 60ms of stable profile identity", () => {
  const h = contentHarness(); h.api.start();
  h.document.body.innerText = "Maria, 27"; h.image.src = "maria.jpg";
  h.step(100); h.step(159);
  assert.equal(h.attempts(), 1);
  assert.equal(h.api.status().clicks, 0);
  h.step(160);
  assert.equal(h.api.status().clicks, 1);
  h.unlock(); h.step(176);
  assert.equal(h.attempts(), 2);
});

test("offer acceptance buttons are never treated as skip controls", () => {
  const h = contentHarness(); h.skip.visible = true; h.skip.textContent = "Получить стикеры";
  h.button.visible = false; h.api.start();
  assert.equal(h.skips(), 0);
  assert.equal(h.attempts(), 0);
});

test("skip authorization is denied after leaving the target page", () => {
  const h = contentHarness(); h.skip.visible = true; h.setAllowed(false);
  h.api.start();
  assert.equal(h.skips(), 0);
  assert.equal(h.api.status().running, false);
});

test("a delayed like authorization cannot like a profile behind a new prompt", () => {
  const h = contentHarness(); h.deferAuthorization(); h.api.start();
  h.skip.visible = true; h.resolveAuthorization();
  assert.equal(h.attempts(), 0);
});

test("a delayed skip authorization cannot fire after stop", () => {
  const h = contentHarness(); h.skip.visible = true; h.deferAuthorization(); h.api.start();
  h.api.stop(); h.resolveAuthorization();
  assert.equal(h.skips(), 0);
});

for (const [name, disable] of [
  ["hidden", h => { h.skip.visible = false; }],
  ["disabled", h => { h.skip.disabled = true; }],
  ["covered", h => { h.document.elementFromPoint = () => ({}); }]
]) {
  test(`${name} skip controls are never clicked`, () => {
    const h = contentHarness(); h.skip.visible = true;
    h.button.visible = false; disable(h); h.api.start();
    assert.equal(h.skips(), 0);
    assert.equal(h.attempts(), 0);
  });
}

function backgroundHarness() {
  const handlers = {}, messages = [], enabled = [], popups = [];
  let url = "https://vk.com/dating";
  const frames = [
    { frameId: 10, url: "https://other.pages-ac.vk-apps.com/", eligible: false, running: false },
    { frameId: 20, url: "https://prod-app7058363-8402a5925651.pages.vk-apps.ru/index.html?vk_app_id=7058363", eligible: true, running: false }
  ];
  const event = (name) => ({ addListener(fn) { handlers[name] = fn; } });
  const chrome = {
    runtime: { getManifest: () => JSON.parse(source("manifest.json")), onInstalled: event("install"), onStartup: event("startup"), onMessage: event("message") },
    action: {
      enable: async () => { enabled.push(true); }, disable: async () => { enabled.push(false); },
      setIcon: async () => {}, setTitle: async () => {}, setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {}, onClicked: event("click"),
      setPopup: async (options) => { popups.push(options); }
    },
    tabs: {
      get: async () => ({ id: 1, url }), query: async () => [{ id: 1, url }],
      onUpdated: event("updated"), onActivated: event("activated"), onRemoved: event("removed"),
      sendMessage(tabId, message, options, callback) {
        messages.push({ ...message, frameId: options.frameId });
        const frame = frames.find((entry) => entry.frameId === options.frameId);
        if (!frame || frame.respond === false) { callback(null); return; }
        if (message.type.endsWith("TOGGLE")) frame.running = !frame.running;
        if (message.type.endsWith("STOP")) frame.running = false;
        callback({ eligible: frame.eligible, buttonFound: frame.eligible, running: frame.running, clicks: 0,
          reason: frame.eligible ? "" : "button_unavailable" });
      }
    },
    webNavigation: { getAllFrames: async () => frames }
  };
  const context = vm.createContext({ chrome, URL });
  vm.runInContext(source("background.js"), context);
  return {
    handlers, frames, messages, enabled, popups, context,
    inspect(type = "VK_DATING_AUTOCLICKER_INSPECT") {
      return new Promise((resolve) => handlers.message({ type }, {}, resolve));
    },
    setUrl(value) { url = value; },
    async flush() { await vm.runInContext("Promise.all([...tabTasks.values()])", context); },
    authorize(frameId = 20) {
      return new Promise((resolve) => {
        const pending = handlers.message({ type: "VK_DATING_AUTOCLICKER_AUTHORIZE" },
          { tab: { id: 1 }, frameId, url: frames.find((frame) => frame.frameId === frameId).url }, resolve);
        if (!pending) resolve({ allowed: false });
      });
    }
  };
}

test("target URL parsing accepts hashes and rejects lookalikes", () => {
  const h = backgroundHarness();
  for (const url of ["https://vk.com/dating#profiles", "https://vk.ru/dating#profiles", "https://vk.com/dating?x=1", "https://vk.com/dating/profile"]) {
    assert.equal(vm.runInContext(`isTargetUrl(${JSON.stringify(url)})`, h.context), true);
  }
  for (const url of ["https://vk.com/dating-other", "https://vk.com.evil.test/dating", "invalid"]) {
    assert.equal(vm.runInContext(`isTargetUrl(${JSON.stringify(url)})`, h.context), false);
  }
});

test("Dating iframe detection supports the attached HTML and legacy host", () => {
  const h = backgroundHarness();
  for (const url of [
    "https://prod-app7058363-8402a5925651.pages.vk-apps.ru/index.html?vk_app_id=7058363",
    "https://prod-app7058363-otherhash.pages.vk-apps.ru/index.html",
    "https://prod-app7058363-legacy.pages-ac.vk-apps.com/index.html?vk_app_id=7058363"
  ]) {
    assert.equal(vm.runInContext(`isAppFrameUrl(${JSON.stringify(url)})`, h.context), true);
    assert.ok(contentHarness(url).api);
  }
  for (const url of [
    "https://other.pages-ac.vk-apps.com/",
    "https://prod-app123-hash.pages.vk-apps.ru/index.html?vk_app_id=123",
    "https://prod-app7058363-hash.pages.vk-apps.ru/index.html?vk_app_id=123",
    "https://prod-app7058363-hash.pages.vk-apps.ru.evil.test/index.html",
    "http://prod-app7058363-hash.pages.vk-apps.ru/index.html",
    "invalid"
  ]) {
    assert.equal(vm.runInContext(`isAppFrameUrl(${JSON.stringify(url)})`, h.context), false);
    assert.equal(contentHarness(url).api, undefined);
  }
});

test("manifest includes the observed iframe origin and both VK origins", () => {
  const manifest = JSON.parse(source("manifest.json"));
  for (const pattern of ["https://vk.com/dating*", "https://vk.ru/dating*", "https://*.pages.vk-apps.ru/*"]) {
    assert.ok(manifest.host_permissions.includes(pattern));
    assert.ok(manifest.content_scripts[0].matches.includes(pattern));
  }
});

test("discovery skips unrelated frames and ignores their claimed state", async () => {
  const h = backgroundHarness();
  h.handlers.message({ type: "VK_DATING_AUTOCLICKER_STATE", state: { running: true, buttonFound: true } },
    { tab: { id: 1 }, frameId: 10, url: h.frames[0].url });
  await h.flush(); await h.handlers.click({ id: 1 });
  assert.equal(h.messages.find((message) => message.type.endsWith("TOGGLE")).frameId, 20);
  assert.equal((await h.authorize(10)).allowed, false);
});

test("ambiguous frames are stopped and cannot be started", async () => {
  const h = backgroundHarness();
  h.frames[0].url = "https://prod-app7058363-second.pages.vk-apps.ru/index.html";
  h.frames[0].eligible = true; h.frames[1].running = true;
  await h.handlers.click({ id: 1 });
  assert.equal(h.frames[1].running, false);
  assert.equal(h.messages.some((message) => message.type.endsWith("TOGGLE")), false);
  assert.equal((await h.authorize()).allowed, false);
});

test("leaving Dating stops retained app frames and denies authorization", async () => {
  const h = backgroundHarness(); await h.handlers.click({ id: 1 });
  h.setUrl("https://vk.com/feed"); h.handlers.updated(1, { url: "https://vk.com/feed" }, {});
  await h.flush();
  assert.equal(h.frames[1].running, false);
  assert.equal(h.enabled.at(-1), false);
  assert.equal((await h.authorize()).allowed, false);
});

test("authorization recovers routing after a worker restart", async () => {
  const h = backgroundHarness(); h.frames[1].running = true;
  assert.equal((await h.authorize()).allowed, true);
});

test("a running clicker remains stoppable while its button is absent", () => {
  const h = backgroundHarness();
  assert.equal(vm.runInContext("getActionPresentation({ available: true, frameReady: true, running: true, buttonFound: false, clicks: 0 }).enabled", h.context), true);
});

test("a responding iframe without controls shows a reason instead of still loading", async () => {
  const h = backgroundHarness(); h.frames[1].eligible = false;
  const result = await h.inspect();
  assert.equal(result.state.frameReady, true);
  assert.equal(result.state.reason, "button_unavailable");
  assert.ok(result.explanation.length > 0);
  assert.equal(h.enabled.at(-1), true);
  assert.equal(h.popups.at(-1).popup, "popup.html");
});

test("missing content script opens troubleshooting and asks to reload the tab", async () => {
  const h = backgroundHarness(); h.frames[1].respond = false;
  const result = await h.inspect();
  assert.equal(result.state.reason, "script_missing");
  assert.equal(result.version, "1.0.0.0");
  assert.ok(result.explanation.length > 0);
  assert.equal(h.popups.at(-1).popup, "popup.html");
});

test("a missing app iframe has a different diagnostic from a missing script", async () => {
  const h = backgroundHarness(); h.frames.splice(0);
  const result = await h.inspect();
  assert.equal(result.state.reason, "frame_missing");
  assert.equal(h.enabled.at(-1), true);
});

test("popup controls can start and stop after readiness is restored", async () => {
  const h = backgroundHarness(); h.frames[1].eligible = false;
  await h.inspect();
  h.frames[1].eligible = true;
  let result = await h.inspect("VK_DATING_AUTOCLICKER_CONTROL");
  assert.equal(result.state.running, true);
  assert.equal(h.popups.at(-1).popup, "");
  result = await h.inspect("VK_DATING_AUTOCLICKER_CONTROL");
  assert.equal(result.state.running, false);
});
