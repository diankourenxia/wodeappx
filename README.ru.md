<p align="center">
  <img src="branding/wodeappx-logo-180.png" alt="WodeAppX" width="128" />
</p>

<h1 align="center">WodeAppX</h1>

<p align="center">
  <strong>Агент настраиваете вы. Модели комбинируете сами.</strong><br />
  Открытый ИИ-десктоп. Навыки, инструменты и скины — ваши. Текст, картинки и видео — на разных моделях.<br />
  Мастерские картинок и видео уже готовы. Сначала локально. Ваши ключи. Без стены входа.
</p>

<p align="center">
  <a href="README.md">中文</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.th.md">ไทย</a> · <a href="README.fr.md">Français</a> · <a href="README.ca.md">Català</a> · <a href="README.es.md">Español</a> · <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3"><img src="https://img.shields.io/github/v/release/diankourenxia/wodeappx?color=111111&label=release" alt="release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-111111" alt="Apache-2.0" /></a>
  <a href="https://github.com/diankourenxia/wodeappx/stargazers"><img src="https://img.shields.io/github/stars/diankourenxia/wodeappx?style=flat&color=111111" alt="stars" /></a>
</p>

<p align="center">
  <a href="https://x.wodeapp.ai/">Сайт</a>
  ·
  <a href="https://wodeapp.ai/chat">Попробовать в браузере</a>
  ·
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3">Скачать v1.0.3</a>
  ·
  <a href="https://youtu.be/gULs1_u1JYE">Трейлер</a>
  ·
  <a href="AGENTS.md">Для агентов</a>
  ·
  <a href="https://x.com/wodeappai">X</a>
</p>

<p align="center">
  <a href="https://youtu.be/gULs1_u1JYE">
    <img src="https://img.youtube.com/vi/gULs1_u1JYE/hqdefault.jpg" alt="Watch the WodeAppX trailer" width="720" />
  </a>
</p>

<p align="center">
  <img src="https://x.wodeapp.ai/product-hunt/en/01-workbench-en.jpg" alt="WodeAppX workbench" width="920" />
</p>

---

## Содержание

- [С чего начать](#с-чего-начать)
- [Что можно делать](#что-можно-делать)
- [Почему WodeAppX](#почему-wodeappx)
- [Скачать](#скачать)
- [После запуска](#после-запуска)
- [Запуск из исходников](#запуск-из-исходников)
- [Для агентов / контрибьюторов](#для-агентов--контрибьюторов)
- [Частые вопросы](#частые-вопросы)
- [Документы](#документы)
- [License](#license)

## С чего начать

| Путь | Для кого | Что будет |
|---|---|---|
| [Скачать десктоп](#скачать) | Каждый день | Установить → локальный ключ (или облачный вход) → говорить |
| [Попробовать в браузере](https://wodeapp.ai/chat) | Быстрый взгляд | Официальный чат в боковой панели. Китай: [wodeapp.cn/chat](https://wodeapp.cn/chat) |
| [Запуск из исходников](#запуск-из-исходников) | Менять продукт / контрибутить | `pnpm run setup && pnpm dev` |

Сайты: [x.wodeapp.ai](https://x.wodeapp.ai/) · Китай [x.wodeapp.cn](https://x.wodeapp.cn/). Сравнение: [vs Cursor](https://x.wodeapp.ai/vs-cursor/) · [vs Claude Code](https://x.wodeapp.ai/vs-claude-code/) · [vs Codex](https://x.wodeapp.ai/vs-codex/).

## Что можно делать

- **Настроить агента** — навыки, инструменты, MCP, коннекторы, скины
- **Комбинировать модели** — текст, картинка и видео на своих моделях; без привязки
- **Картинки и видео сразу** — пакеты, раскадровки, image-to-video уже подключены; агенты изображение / видео / короткометражка / холст / мультимодель
- **Цифровые активы** — сохранять результат в один тап и подставлять в чат
- **Автоматизация браузера** — расширение Chrome кликает, читает и снимает реальные страницы
- **Навыки пакетом** — один поток на набор; права, стоимость, повторы видны
- **Самоэволюция** — рабочая область на исходниках этого продукта; агент может менять само приложение (снимок → проверка → откат)
- **Настоящая работа на компьютере** — папки, файлы, терминал, браузер — не только чат
- **Сайты и медиа могут остаться локально** — публикация и продакшн на машине или своём хосте; облако необязательно

Навыки задают, что можно запустить; агент это выполняет. Скажите, что нужно сделать.

## Почему WodeAppX

Cursor / Claude Code / Codex правят ваш репозиторий. WodeAppX — десктопная мастерская агента: настроить агента, смешать модели, сразу иметь картинки/видео и менять сам продукт. Софт бесплатный (Apache-2.0). Платите только за свои модели. Стены подписки нет.

- **Вы формируете помощника** — навыки, инструменты и скины — полноценные сущности
- **Своя модель на задачу** — текст, картинка и видео не обязаны делить одного вендора
- **Линия, не пустая оболочка** — мастерские картинок и видео уже внутри
- **Данные могут не уходить** — сессии, файлы, терминал и браузер на вашей машине; OSS стартует без входа
- **Ключи ваши** — сначала локальный ключ или свой хост; официальное облако — бонус, не порог
- **Может менять это приложение** — у самоэволюции есть снимок и откат
- **Открыто и проверяемо** — Apache-2.0; смотреть, форкать, распространять

<table>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/05-customize-en.jpg" alt="Настроить агента" />
      <p><strong>Настроить агента</strong><br />Соберите навыки, инструменты и скины. Агент может менять и сам продукт (снимок → проверка → откат).</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/03-assets-en.png" alt="Цифровые активы" />
      <p><strong>Цифровые активы</strong><br />Сохраняйте картинки и видео в один тап. Используйте их в чате.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/04-image-workbench-en.jpg" alt="Мастерская картинок" />
      <p><strong>Мастерская картинок</strong><br />Пакеты готовы. Несколько моделей уже подключены.</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/06-video-workbench-en.jpg" alt="Мастерская видео" />
      <p><strong>Мастерская видео</strong><br />Раскадровки, image-to-video и очереди в одном месте.</p>
    </td>
  </tr>
</table>

## Скачать

Официальная сборка: [v1.0.3](https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3) (macOS нотаризован). Сайт: [x.wodeapp.ai](https://x.wodeapp.ai/) · Китай: [x.wodeapp.cn](https://x.wodeapp.cn/)

| Платформа | Установщик |
|---|---|
| macOS Apple Silicon | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-arm64-1.0.3.dmg) |
| macOS Intel | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-x64-1.0.3.dmg) |
| Windows x64 | [EXE](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-win-x64-1.0.3.exe) |
| Linux x64 | [AppImage](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-linux-x86_64-1.0.3.AppImage) |

При первом запуске: локальный ключ или облачный вход. Аккаунт не обязателен.

## После запуска

1. **Локальный ключ (по умолчанию)**  
   Боковая панель **Локально** или **Настроить локальные ключи**. Работают DeepSeek, Volcano Ark, Kimi / Moonshot, DashScope, OpenRouter (один ключ на GPT / Claude / Grok) и подключённый OpenAI.  
   Можно добавить **свой вендор**: имя + Base URL + ключ; опрашиваем OpenAI-совместимый `/models`.  
   Ключи лежат в `~/.wodeapp/keys.json` на машине. На WodeApp они не уходят.

2. **Chrome (по желанию)**  
   Поставьте расширение в «Возможности», чтобы агент кликал, читал и снимал реальные страницы. Можно пропустить и поставить позже.

3. **Облако (по желанию)**  
   Панель **Облако**, затем сайт: International [wodeapp.ai](https://wodeapp.ai/) (Stripe) или Китай [wodeapp.cn](https://wodeapp.cn/) (Alipay / WeChat). Вход открывает системный браузер. WodeApp — один из провайдеров. Логин не сбрасывает модель по умолчанию в облако.

4. **Говорить**  
   Скажите задачу в пустом чате или откройте Изображение / Видео / Активы / Возможности. Селектор показывает текущие семейства и сопоставляет их с реально подключёнными ключами.

Чат, картинки и видео идут по одним ключам и маршрутам. Нет ключа — просим настроить, а не только войти.

## Запуск из исходников

Node.js 22, pnpm 9.15, Bun 1.3.9+, Go 1.23. Не используйте Node 26. Команда — `pnpm run setup`, не `pnpm setup`.

```bash
git clone https://github.com/diankourenxia/wodeappx.git
cd wodeappx
pnpm run setup
pnpm dev
```

`pnpm run setup` тянет десктопный шелл, накладывает патчи и ставит зависимости. `vendor/` генерируется — это не исходники. Затем создайте локальную область и добавьте ключи.

См. [CONTRIBUTING.md](CONTRIBUTING.md).

## Для агентов / контрибьюторов

После клона сначала **[AGENTS.md](AGENTS.md)** (карта репо, куда править, красные линии), затем [docs/README.md](docs/README.md).

| Что менять | Куда |
|---|---|
| Свои возможности, локальные ключи, расширение | `integrations/`, `capture-engine/`, `scripts/` |
| Оверлеи UI десктопа | `integrations/openwork/fork/`, регистрация в apply-скрипте |
| Пин апстрим-шелла | `openwork.lock.json` (не поднимать просто так) |

Самоэволюция в приложении — под затвором (снимок → проверка → откат). Правка этого клона в редакторе — обычное изменение исходников.

## Частые вопросы

**Это замена Cursor / Codex?**  
Да, и больше. Репозиторий, свои агенты, картинки и видео, сайты — в WodeAppX. Соберите мастерскую: навыки, инструменты, скины, модели. Принесите свой ключ.

**Нужен ли облачный вход?**  
Нет. OSS работает с вашими ключами. Облако необязательно.

**Самоэволюция — это обучение модели?**  
Нет. Это правки исходников этого продукта под затвором (бэкап → проверка → откат), не обучение весов.

**Уходят ли данные с этого компьютера?**  
OSS — сначала локально. Сессии и файлы могут остаться на машине. В сеть идут только API моделей, которые вы сами настроили. Облачный вход — не порог.

**Готов ли визуальный редактор навыков?**  
Skills / MCP / инструменты уже работают. Редактор графа потока — в дорожной карте.

**Windows пишет, что установщик не подписан?**  
Windows ещё без Authenticode. macOS нотаризован. Можно запускать из исходников или смотреть Releases.

## Документы

| Кому | Документы |
|---|---|
| Первый файл после клона | Эта страница (языки в шапке) · [Сайт](https://x.wodeapp.ai/) |
| Агенты / контрибьюторы | [AGENTS.md](AGENTS.md) · [CONTRIBUTING.md](CONTRIBUTING.md) |
| Возможности и локальные ключи | [docs/CAPABILITIES.md](docs/CAPABILITIES.md) · [docs/LOCAL_KEY_INVOKE.md](docs/LOCAL_KEY_INVOKE.md) |
| Полный индекс десктопа | [docs/README.md](docs/README.md) |
| План open source | [docs/OPEN_SOURCE_PLAN.md](docs/OPEN_SOURCE_PLAN.md) |
| Безопасность / приватность / товарный знак | [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md) · [TRADEMARK.md](TRADEMARK.md) |

## License

Оригинальный код — [Apache License 2.0](LICENSE). Сторонние уведомления: [NOTICE](NOTICE) и [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/).
