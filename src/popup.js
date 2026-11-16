const version = document.getElementById("version");
const statusText = document.getElementById("status");
const details = document.getElementById("details");
const toggle = document.getElementById("toggle");
const refresh = document.getElementById("refresh");

version.textContent = `Версия ${chrome.runtime.getManifest().version}`;

async function update(type = "VK_DATING_AUTOCLICKER_INSPECT") {
  toggle.disabled = true;
  refresh.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response || response.error) throw new Error(response?.error || "Нет связи с расширением.");
    const { state } = response;
    const ready = state.available && state.frameReady && state.eligible;
    statusText.textContent = state.running ? "Автокликер работает" : ready ? "Готов к запуску" : "Автокликер пока недоступен";
    details.textContent = response.explanation || (state.running
      ? `Переходов к другой анкете: ${state.clicks}. Нажмите «Остановить», чтобы завершить.`
      : "Нажмите «Запустить». Когда окно закрыто, красная иконка запускает кликер, зелёная — останавливает.");
    toggle.hidden = !(ready || state.running);
    toggle.textContent = state.running ? "Остановить" : "Запустить";
  } catch (error) {
    statusText.textContent = "Не удалось проверить страницу";
    details.textContent = error.message;
    toggle.hidden = true;
  } finally {
    toggle.disabled = false;
    refresh.disabled = false;
  }
}

toggle.addEventListener("click", () => update("VK_DATING_AUTOCLICKER_CONTROL"));
refresh.addEventListener("click", () => update());
update();
