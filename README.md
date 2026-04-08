# VK Dating AutoClicker

Расширение для `vk.com/dating`, которое запускает автокликер по кнопке `like` одним нажатием на иконку браузера.

## Demo

<video src="https://github.com/user-attachments/assets/d0a8b376-1196-43cf-8c8c-7d1e4c9fea5b" width="100%" autoplay loop muted playsinline></video>

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

Артефакты появятся в `dist/`.

## GitHub Actions Release

Workflow [`release-crx.yml`](./.github/workflows/release-crx.yml):

- запускается при пуше тега `v*` или вручную
- берет версию из [`src/manifest.json`](./src/manifest.json)
- собирает `.zip` и `.crx`
- создает или обновляет GitHub Release
- загружает артефакты в релиз

Secret:

- `CRX_PRIVATE_KEY`: содержимое PEM-ключа
