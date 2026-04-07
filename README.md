# VK Dating AutoClicker

Расширение для `vk.com/dating`, которое запускает автокликер по кнопке `like` одним нажатием на иконку браузера.

Работает внутри реального app iframe `pages-ac.vk-apps.com`, поэтому не ломается на экране, где кнопки отсутствуют в верхнем документе `vk.com/dating`.

## Demo

<video src="vk-dating-autoclicker-demo.mp4" width="100%" autoplay loop muted playsinline></video>

## Что делает

- работает только на `https://vk.com/dating`
- включает и выключает кликер по клику на action-иконку
- делает иконку недоступной, если пользователь не на карточке анкеты
- показывает статус цветом: зеленый `running`, красный `stopped`, серый `unavailable`
- считает только подтвержденные лайки, а не просто попытки `click()`
- показывает число подтвержденных лайков на badge и в overlay внутри анкеты
- прячет overlay-счетчик, если курсор попадает в его прямоугольник

## Параметры

Текущая версия: `1.0.0`

- `reaction`: `like`
- `minDelay`: `12`
- `maxDelay`: `24`
- `retryDelayMin`: `90`
- `retryDelayMax`: `140`
- `confirmMinDelay`: `120`
- `confirmTimeout`: `1600`
- `maxClicks`: `Infinity`

## Установка

### Load unpacked

1. Открой `chrome://extensions/`.
2. Включи developer mode.
3. Нажми `Load unpacked`.
4. Выбери папку [`src`](./src).

### Из релизного архива

- используй `.zip` или `.crx` из GitHub Releases
- для локальной ручной установки практичнее `src/` или `.zip`, потому что обычный Chrome не всегда любит сторонние `.crx` вне Chrome Web Store

## Локальная сборка

Требования:

- Node.js `22+`
- приватный PEM-ключ для подписи CRX

Установка зависимостей:

```powershell
npm.cmd ci
```

Сборка:

```powershell
$env:CRX_KEY_PATH = "$PWD\\privatekey.pem"
npm.cmd run pack
```

Если нужно дополнительно проверить соответствие тега и версии:

```powershell
$env:RELEASE_TAG = "v1.0.0"
```

Артефакты появятся в `dist/`.

## GitHub Actions Release

Workflow [`release-crx.yml`](./.github/workflows/release-crx.yml):

- запускается при пуше тега `v*` или вручную
- берет версию из [`src/manifest.json`](./src/manifest.json)
- собирает `.zip` и `.crx`
- создает или обновляет GitHub Release
- загружает артефакты в релиз

Нужный secret:

- `CRX_PRIVATE_KEY`: содержимое PEM-ключа целиком, с реальными переносами строк

Релизный процесс:

1. Подними версию в [`src/manifest.json`](./src/manifest.json).
2. При необходимости выровняй версию в [`package.json`](./package.json).
3. Создай тег вида `v1.0.0`.
4. Запушь ветку и тег.
5. Дождись завершения workflow и проверь assets релиза.

## Структура

```text
.
├─ src/
│  ├─ manifest.json
│  ├─ background.js
│  ├─ content.js
│  └─ icons/
├─ scripts/
│  └─ pack-release.cjs
├─ .github/workflows/
│  └─ release-crx.yml
└─ vk-dating-autoclicker-demo.mp4
```
