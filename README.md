# VK Dating AutoClicker

Расширение для `vk.com/dating`, которое запускает автокликер по кнопке `like` одним нажатием на иконку.

## Что умеет

- работает только на `https://vk.com/dating`
- ищет реальную кнопку внутри app iframe `pages-ac.vk-apps.com`
- включает и выключает кликер по клику на action-иконку
- делает иконку недоступной, если пользователь не на карточке анкеты
- показывает статус цветом: зеленый `running`, красный `stopped`, серый `unavailable`
- выводит число подтвержденных лайков на badge и в overlay внутри анкеты
- считает клик только после подтвержденного перехода на следующую анкету

## Текущие параметры

- `reaction`: `like`
- `minDelay`: `12`
- `maxDelay`: `24`
- `retryDelayMin`: `90`
- `retryDelayMax`: `140`
- `confirmMinDelay`: `120`
- `confirmTimeout`: `1600`
- `maxClicks`: `Infinity`

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
└─ .github/workflows/
   └─ release-crx.yml
```

## Локальный запуск

1. Открой `chrome://extensions/`.
2. Включи developer mode.
3. Нажми `Load unpacked`.
4. Выбери папку [`src`](./src).

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

- `CRX_PRIVATE_KEY`: содержимое PEM-ключа целиком

Релизный процесс:

1. Подними версию в [`src/manifest.json`](./src/manifest.json).
2. При необходимости выровняй версию в [`package.json`](./package.json).
3. Создай тег вида `v1.0.0`.
4. Запушь ветку и тег.
5. Дождись завершения workflow и проверь assets релиза.

## Ограничение CRX

GitHub Actions может собрать корректный `.crx`, но обычный Chrome не всегда разрешает прямую установку сторонних `.crx`, не пришедших из Chrome Web Store. Поэтому практический fallback такой:

- `src/` для developer mode
- `zip` как переносимый артефакт
- `crx` как подписанный релизный артефакт со стабильным extension id
