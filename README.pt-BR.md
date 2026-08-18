<p align="center">
  <img src="branding/wodeappx-logo-180.png" alt="WodeAppX" width="128" />
</p>

<h1 align="center">WodeAppX</h1>

<p align="center">
  <strong>Personalize o agente. Combine os modelos.</strong><br />
  Desktop de IA de código aberto. Skills, ferramentas e skins você define. Misture modelos para texto, imagem e vídeo.<br />
  As bancadas de imagem e vídeo já vêm prontas. Local primeiro. Suas chaves. Sem muro de login.
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
  <a href="https://x.wodeapp.ai/">Site</a>
  ·
  <a href="https://wodeapp.ai/chat">Testar no navegador</a>
  ·
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3">Baixar v1.0.3</a>
  ·
  <a href="https://youtu.be/gULs1_u1JYE">Trailer</a>
  ·
  <a href="AGENTS.md">Para agents</a>
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

## Conteúdo

- [Comece aqui](#comece-aqui)
- [O que você pode fazer](#o-que-você-pode-fazer)
- [Por que WodeAppX](#por-que-wodeappx)
- [Baixar](#baixar)
- [Depois de abrir](#depois-de-abrir)
- [Rodar do código](#rodar-do-código)
- [Para agents / colaboradores](#para-agents--colaboradores)
- [Perguntas](#perguntas)
- [Docs](#docs)
- [License](#license)

## Comece aqui

| Caminho | Para | O que acontece |
|---|---|---|
| [Baixar o desktop](#baixar) | Uso diário | Instalar → chave local (ou login na nuvem) → falar |
| [Testar no navegador](https://wodeapp.ai/chat) | Uma olhada | Chat oficial na barra. China: [wodeapp.cn/chat](https://wodeapp.cn/chat) |
| [Rodar do código](#rodar-do-código) | Mudar / contribuir | `pnpm run setup && pnpm dev` |

Sites: [x.wodeapp.ai](https://x.wodeapp.ai/) · China [x.wodeapp.cn](https://x.wodeapp.cn/). Comparar: [vs Cursor](https://x.wodeapp.ai/vs-cursor/) · [vs Claude Code](https://x.wodeapp.ai/vs-claude-code/) · [vs Codex](https://x.wodeapp.ai/vs-codex/).

## O que você pode fazer

- **Personalizar o agente** — skills, ferramentas, MCP, conectores, skins
- **Combinar modelos** — texto, imagem e vídeo cada um no seu; sem lock-in
- **Imagem e vídeo prontos** — lote, storyboard, imagem-para-vídeo já ligados; agentes de imagem / vídeo / short / canvas / multimodelo
- **Ativos digitais** — salve imagem e vídeo num toque; reuse no chat
- **Automação do navegador** — a extensão do Chrome clica, lê e captura páginas reais
- **Skills em lote** — o mesmo fluxo num conjunto; permissões, custo e retries visíveis
- **Autoevolução** — aponte o workspace para o código deste produto; o agente pode mudar o app (snapshot → verificar → reverter)
- **Trabalho de verdade no computador** — pastas, arquivos, terminal, navegador — não só chat
- **Sites e mídia podem ficar locais** — publicar e produzir na máquina ou self-hosted; nuvem é opcional

Skills definem o que pode rodar; o agente executa. Diga o que você quer fazer.

## Por que WodeAppX

Cursor / Claude Code / Codex editam o seu repo. WodeAppX é uma bancada de agente no desktop: personalize o agente, combine modelos, já tem imagem/vídeo e pode mudar o próprio produto. O software é grátis (Apache-2.0). Você paga só os modelos que trouxer. Sem muro de assinatura.

- **Você molda o assistente** — skills, ferramentas e skins são de primeira classe
- **O modelo certo para cada tarefa** — texto, imagem e vídeo não precisam do mesmo fornecedor
- **Uma linha, não um casco vazio** — as bancadas de imagem e vídeo já vêm prontas
- **Os dados podem ficar privados** — sessões, arquivos, terminal e navegador na sua máquina; o OSS começa sem login
- **Suas chaves** — chave local ou self-host primeiro; a nuvem oficial é extra, não um portão
- **Pode mudar este app** — autoevolução tem snapshot e rollback
- **Aberto e auditável** — Apache-2.0; inspecione, faça fork, redistribua

<table>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/05-customize-en.jpg" alt="Personalizar o agente" />
      <p><strong>Personalizar o agente</strong><br />Monte skills, ferramentas e skins. O agente também pode mudar este produto (snapshot → verificar → reverter).</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/03-assets-en.png" alt="Ativos digitais" />
      <p><strong>Ativos digitais</strong><br />Salve imagem e vídeo num toque. Reuse no chat.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/04-image-workbench-en.jpg" alt="Bancada de imagem" />
      <p><strong>Bancada de imagem</strong><br />Pronta para lote. Vários modelos já ligados.</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/06-video-workbench-en.jpg" alt="Bancada de vídeo" />
      <p><strong>Bancada de vídeo</strong><br />Storyboards, imagem-para-vídeo e filas no mesmo lugar.</p>
    </td>
  </tr>
</table>

## Baixar

Build oficial: [v1.0.3](https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3) (macOS notariado). Site: [x.wodeapp.ai](https://x.wodeapp.ai/) · China: [x.wodeapp.cn](https://x.wodeapp.cn/)

| Plataforma | Instalador |
|---|---|
| macOS Apple Silicon | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-arm64-1.0.3.dmg) |
| macOS Intel | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-x64-1.0.3.dmg) |
| Windows x64 | [EXE](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-win-x64-1.0.3.exe) |
| Linux x64 | [AppImage](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-linux-x86_64-1.0.3.AppImage) |

Na primeira abertura: chave local ou login na nuvem. Conta não é obrigatória para começar.

## Depois de abrir

1. **Chave local (padrão)**  
   Barra **Local** ou **Configurar chaves locais**. DeepSeek, Volcano Ark, Kimi / Moonshot, DashScope, OpenRouter (uma chave para GPT / Claude / Grok) e OpenAI conectado funcionam.  
   Dá para adicionar um **fornecedor próprio**: nome + URL base + chave; sondamos `/models` compatível com OpenAI.  
   As chaves ficam em `~/.wodeapp/keys.json` na sua máquina. Não sobem para o WodeApp.

2. **Chrome (opcional)**  
   Instale a extensão em Capacidades para o agente clicar, ler e capturar páginas reais. Pode pular e instalar depois.

3. **Nuvem (opcional)**  
   Barra **Nuvem** e escolha o site: International [wodeapp.ai](https://wodeapp.ai/) (Stripe) ou China [wodeapp.cn](https://wodeapp.cn/) (Alipay / WeChat). O login abre o navegador do sistema. WodeApp é um provedor entre outros. Entrar não devolve o modelo padrão para a nuvem.

4. **Falar**  
   Diga o que precisa num chat vazio, ou abra Imagem / Vídeo / Ativos / Capacidades. O seletor mostra as famílias atuais e casa com as chaves que você realmente conectou.

Chat, imagem e vídeo compartilham as mesmas chaves e o mesmo roteamento. Se faltar chave, a UI pede para configurar — não só para entrar.

## Rodar do código

Node.js 22, pnpm 9.15, Bun 1.3.9+, Go 1.23. Não use Node 26. O comando é `pnpm run setup`, não `pnpm setup`.

```bash
git clone https://github.com/diankourenxia/wodeappx.git
cd wodeappx
pnpm run setup
pnpm dev
```

`pnpm run setup` busca o shell do desktop, aplica patches e instala dependências. `vendor/` é gerado — não trate como fonte. Depois crie um workspace local e adicione chaves.

Veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Para agents / colaboradores

Depois do clone, leia **[AGENTS.md](AGENTS.md)** (mapa do repo, onde editar, regras), depois [docs/README.md](docs/README.md).

| Mudança | Onde |
|---|---|
| Funções próprias, chaves locais, extensão | `integrations/`, `capture-engine/`, `scripts/` |
| Overlays de UI do desktop | `integrations/openwork/fork/`, registrados no script apply |
| Pin do shell upstream | `openwork.lock.json` (não suba sem motivo) |

A autoevolução no app tem portão (snapshot → verificar → reverter). Editar este clone no editor é mudança normal de código.

## Perguntas

**Substitui Cursor / Codex?**  
Sim — e mais. Use o WodeAppX no repo, agentes, imagem e vídeo, e sites. Monte sua bancada: skills, ferramentas, skins, modelos. Traga sua chave.

**Precisa de login na nuvem?**  
Não. O OSS funciona com as chaves que você traz. Nuvem é opcional.

**Autoevolução treina modelo?**  
Não. São edições com portão do código deste produto (backup → verificar → reverter), não treino de pesos.

**Meus dados saem deste computador?**  
O OSS é local primeiro. Sessões e arquivos podem ficar na máquina. Só saem as APIs de modelo que você configurar. Login na nuvem não é portão.

**A edição visual de skills está pronta?**  
Skills / MCP / ferramentas já rodam. O editor de grafo de fluxo está no roadmap.

**O Windows diz que o instalador não é assinado?**  
Windows ainda sem Authenticode. macOS é notariado. Dá para rodar do código ou ler as notas de Releases.

## Docs

| Público | Docs |
|---|---|
| Primeiro arquivo após o clone | Esta página (idiomas no topo) · [Site](https://x.wodeapp.ai/) |
| Agents / colaboradores | [AGENTS.md](AGENTS.md) · [CONTRIBUTING.md](CONTRIBUTING.md) |
| Capacidades e chaves locais | [docs/CAPABILITIES.md](docs/CAPABILITIES.md) · [docs/LOCAL_KEY_INVOKE.md](docs/LOCAL_KEY_INVOKE.md) |
| Índice do desktop | [docs/README.md](docs/README.md) |
| Plano open source | [docs/OPEN_SOURCE_PLAN.md](docs/OPEN_SOURCE_PLAN.md) |
| Segurança / privacidade / marca | [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md) · [TRADEMARK.md](TRADEMARK.md) |

## License

O código original está sob [Apache License 2.0](LICENSE). Avisos de terceiros: [NOTICE](NOTICE) e [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/).
