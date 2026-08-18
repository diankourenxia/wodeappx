<p align="center">
  <img src="branding/wodeappx-logo-180.png" alt="WodeAppX" width="128" />
</p>

<h1 align="center">WodeAppX</h1>

<p align="center">
  <strong>Personaliza el agente. Combina los modelos.</strong><br />
  Escritorio de IA de código abierto. Tú defines skills, herramientas y skins. Mezcla modelos para texto, imagen y vídeo.<br />
  Los talleres de imagen y vídeo vienen listos. Primero lo local. Tus claves. Sin muro de inicio de sesión.
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
  <a href="https://x.wodeapp.ai/">Sitio</a>
  ·
  <a href="https://wodeapp.ai/chat">Probar en el navegador</a>
  ·
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3">Descargar v1.0.3</a>
  ·
  <a href="https://youtu.be/gULs1_u1JYE">Tráiler</a>
  ·
  <a href="AGENTS.md">Para agentes</a>
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

## Contenido

- [Empieza aquí](#empieza-aquí)
- [Qué puedes hacer](#qué-puedes-hacer)
- [Por qué WodeAppX](#por-qué-wodeappx)
- [Descargar](#descargar)
- [Después de abrir](#después-de-abrir)
- [Ejecutar desde el código](#ejecutar-desde-el-código)
- [Para agentes / colaboradores](#para-agentes--colaboradores)
- [Preguntas](#preguntas)
- [Documentos](#documentos)
- [License](#license)

## Empieza aquí

| Camino | Para | Qué pasa |
|---|---|---|
| [Descargar el escritorio](#descargar) | Uso diario | Instalar → clave local (o sesión en la nube) → hablar |
| [Probar en el navegador](https://wodeapp.ai/chat) | Un vistazo | Chat oficial en la barra. China: [wodeapp.cn/chat](https://wodeapp.cn/chat) |
| [Ejecutar desde el código](#ejecutar-desde-el-código) | Cambiar / contribuir | `pnpm run setup && pnpm dev` |

Sitios: [x.wodeapp.ai](https://x.wodeapp.ai/) · China [x.wodeapp.cn](https://x.wodeapp.cn/). Comparar: [vs Cursor](https://x.wodeapp.ai/vs-cursor/) · [vs Claude Code](https://x.wodeapp.ai/vs-claude-code/) · [vs Codex](https://x.wodeapp.ai/vs-codex/).

## Qué puedes hacer

- **Personalizar el agente** — skills, herramientas, MCP, conectores, skins
- **Combinar modelos** — texto, imagen y vídeo cada uno en el suyo; sin candado
- **Imagen y vídeo listos** — lotes, storyboards, imagen a vídeo ya cableados; agentes de imagen / vídeo / short / lienzo / multimodelo
- **Activos digitales** — guarda imagen y vídeo de un toque; reutilízalos en el chat
- **Automatización del navegador** — la extensión de Chrome pulsa, lee y captura páginas reales
- **Skills en lote** — el mismo flujo sobre un conjunto; permisos, coste y reintentos a la vista
- **Autoevolución** — apunta el espacio de trabajo al código de este producto; el agente puede cambiar la app (instantánea → verificar → revertir)
- **Trabajo real en el ordenador** — carpetas, archivos, terminal, navegador — no solo chat
- **Sitios y medios pueden quedarse en local** — publicar y producir en tu máquina o autoalojado; la nube es opcional

Las skills definen qué puede correr; el agente lo ejecuta. Di lo que quieres hacer.

## Por qué WodeAppX

Cursor / Claude Code / Codex editan tu repo. WodeAppX es un taller de agente de escritorio: personaliza el agente, combina modelos, trae talleres de imagen/vídeo y puede cambiar el propio producto. El software es gratis (Apache-2.0). Solo pagas los modelos que traes. Sin muro de suscripción.

- **Tú das forma al asistente** — skills, herramientas y skins son de primera
- **El modelo adecuado para cada trabajo** — texto, imagen y vídeo no tienen que compartir proveedor
- **Una línea de producción, no un cascarón** — los talleres de imagen y vídeo vienen listos
- **Los datos pueden quedarse en privado** — sesiones, archivos, terminal y navegador en tu máquina; el OSS arranca sin login
- **Tus claves** — clave local o autoalojado primero; la nube oficial es extra, no una puerta
- **Puede cambiar esta app** — la autoevolución tiene instantánea y rollback
- **Abierto y auditable** — Apache-2.0; inspecciona, haz fork, redistribuye

<table>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/05-customize-en.jpg" alt="Personalizar el agente" />
      <p><strong>Personalizar el agente</strong><br />Monta skills, herramientas y skins. El agente también puede cambiar este producto (instantánea → verificar → revertir).</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/03-assets-en.png" alt="Activos digitales" />
      <p><strong>Activos digitales</strong><br />Guarda imagen y vídeo de un toque. Reutilízalos en el chat.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/04-image-workbench-en.jpg" alt="Taller de imagen" />
      <p><strong>Taller de imagen</strong><br />Listo para lotes. Varios modelos ya cableados.</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/06-video-workbench-en.jpg" alt="Taller de vídeo" />
      <p><strong>Taller de vídeo</strong><br />Storyboards, imagen a vídeo y colas en un sitio.</p>
    </td>
  </tr>
</table>

## Descargar

Build oficial: [v1.0.3](https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3) (macOS notariado). Sitio: [x.wodeapp.ai](https://x.wodeapp.ai/) · China: [x.wodeapp.cn](https://x.wodeapp.cn/)

| Plataforma | Instalador |
|---|---|
| macOS Apple Silicon | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-arm64-1.0.3.dmg) |
| macOS Intel | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-x64-1.0.3.dmg) |
| Windows x64 | [EXE](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-win-x64-1.0.3.exe) |
| Linux x64 | [AppImage](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-linux-x86_64-1.0.3.AppImage) |

Al abrir: clave local o sesión en la nube. No hace falta cuenta para empezar.

## Después de abrir

1. **Clave local (por defecto)**  
   Barra **Local** o **Configurar claves locales**. Valen DeepSeek, Volcano Ark, Kimi / Moonshot, DashScope, OpenRouter (una clave para GPT / Claude / Grok) y OpenAI conectado.  
   También puedes añadir un **proveedor propio**: nombre + URL base + clave; sondamos `/models` compatible con OpenAI.  
   Las claves quedan en `~/.wodeapp/keys.json` en tu máquina. No se suben a WodeApp.

2. **Chrome (opcional)**  
   Instala la extensión desde Capacidades para que el agente pulse, lea y capture páginas reales. Puedes saltarlo e instalarlo después.

3. **Nube (opcional)**  
   Barra **Nube** y elige sitio: International [wodeapp.ai](https://wodeapp.ai/) (Stripe) o China [wodeapp.cn](https://wodeapp.cn/) (Alipay / WeChat). El login abre el navegador del sistema. WodeApp es un proveedor más. Entrar no te devuelve el modelo por defecto a la nube.

4. **Hablar**  
   Di lo que necesitas en un chat vacío, o abre Imagen / Vídeo / Activos / Capacidades. El selector muestra las familias actuales y las casa con las claves que de verdad conectaste.

Chat, imagen y vídeo comparten claves y enrutado. Si falta una clave, la UI pide configurarla — no solo iniciar sesión.

## Ejecutar desde el código

Node.js 22, pnpm 9.15, Bun 1.3.9+, Go 1.23. No uses Node 26. El comando es `pnpm run setup`, no `pnpm setup`.

```bash
git clone https://github.com/diankourenxia/wodeappx.git
cd wodeappx
pnpm run setup
pnpm dev
```

`pnpm run setup` trae el shell de escritorio, aplica parches e instala dependencias. `vendor/` es generado: no lo trates como fuente. Luego crea un espacio local y añade claves.

Ver [CONTRIBUTING.md](CONTRIBUTING.md).

## Para agentes / colaboradores

Tras clonar, lee **[AGENTS.md](AGENTS.md)** (mapa del repo, dónde editar, reglas), luego [docs/README.md](docs/README.md).

| Cambio | Dónde |
|---|---|
| Funciones propias, claves locales, extensión | `integrations/`, `capture-engine/`, `scripts/` |
| Capas de UI de escritorio | `integrations/openwork/fork/`, registradas en el script apply |
| Pin del shell upstream | `openwork.lock.json` (no lo subas a la ligera) |

La autoevolución in-app va con puerta (instantánea → verificar → revertir). Editar este clone en tu editor es un cambio de fuente normal.

## Preguntas

**¿Sustituye a Cursor / Codex?**  
Sí, y más. Usa WodeAppX para el repo, agentes, imagen y vídeo, y sitios. Arma tu taller: skills, herramientas, skins, modelos. Trae tu clave.

**¿Hace falta login en la nube?**  
No. El OSS funciona con las claves que traes. La nube es opcional.

**¿La autoevolución entrena un modelo?**  
No. Son ediciones con puerta del código de este producto (copia → verificar → revertir), no entrenar pesos.

**¿Salen mis datos de este ordenador?**  
El OSS es local primero. Sesiones y archivos pueden quedarse en tu máquina. Solo salen las APIs de modelo que configures. El login en la nube no es una puerta.

**¿Está lista la edición visual de skills?**  
Skills / MCP / herramientas ya corren. El editor de grafo de flujo está en la hoja de ruta.

**¿Windows dice que el instalador no está firmado?**  
Windows aún no tiene Authenticode. macOS está notariado. Puedes ejecutar desde el código o leer las notas de Releases.

## Documentos

| Público | Docs |
|---|---|
| Primer archivo tras clonar | Esta página (idiomas en la cabecera) · [Sitio](https://x.wodeapp.ai/) |
| Agentes / colaboradores | [AGENTS.md](AGENTS.md) · [CONTRIBUTING.md](CONTRIBUTING.md) |
| Capacidades y claves locales | [docs/CAPABILITIES.md](docs/CAPABILITIES.md) · [docs/LOCAL_KEY_INVOKE.md](docs/LOCAL_KEY_INVOKE.md) |
| Índice de escritorio | [docs/README.md](docs/README.md) |
| Plan open source | [docs/OPEN_SOURCE_PLAN.md](docs/OPEN_SOURCE_PLAN.md) |
| Seguridad / privacidad / marca | [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md) · [TRADEMARK.md](TRADEMARK.md) |

## License

El código original está bajo [Apache License 2.0](LICENSE). Avisos de terceros: [NOTICE](NOTICE) y [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/).
