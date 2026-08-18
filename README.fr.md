<p align="center">
  <img src="branding/wodeappx-logo-180.png" alt="WodeAppX" width="128" />
</p>

<h1 align="center">WodeAppX</h1>

<p align="center">
  <strong>Personnalisez l’agent. Combinez les modèles.</strong><br />
  Bureau IA open source. Compétences, outils et habillages à vous. Un modèle pour le texte, un autre pour l’image ou la vidéo.<br />
  Les ateliers image et vidéo sont prêts. Local d’abord. Vos clés. Pas de mur de connexion.
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
  <a href="https://wodeapp.ai/chat">Essayer dans le navigateur</a>
  ·
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3">Télécharger v1.0.3</a>
  ·
  <a href="https://youtu.be/gULs1_u1JYE">Bande-annonce</a>
  ·
  <a href="AGENTS.md">Pour les agents</a>
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

## Sommaire

- [Par où commencer](#par-où-commencer)
- [Ce que vous pouvez faire](#ce-que-vous-pouvez-faire)
- [Pourquoi WodeAppX](#pourquoi-wodeappx)
- [Télécharger](#télécharger)
- [Après l’ouverture](#après-louverture)
- [Lancer depuis les sources](#lancer-depuis-les-sources)
- [Pour les agents / contributeurs](#pour-les-agents--contributeurs)
- [FAQ](#faq)
- [Documentation](#documentation)
- [License](#license)

## Par où commencer

| Chemin | Pour | Ensuite |
|---|---|---|
| [Télécharger l’app bureau](#télécharger) | Usage quotidien | Installer → clé locale (ou connexion cloud) → parler |
| [Essayer dans le navigateur](https://wodeapp.ai/chat) | Un coup d’œil | Chat officiel dans la barre latérale. Chine : [wodeapp.cn/chat](https://wodeapp.cn/chat) |
| [Lancer depuis les sources](#lancer-depuis-les-sources) | Modifier / contribuer | `pnpm run setup && pnpm dev` |

Sites : [x.wodeapp.ai](https://x.wodeapp.ai/) · Chine [x.wodeapp.cn](https://x.wodeapp.cn/). Comparer : [vs Cursor](https://x.wodeapp.ai/vs-cursor/) · [vs Claude Code](https://x.wodeapp.ai/vs-claude-code/) · [vs Codex](https://x.wodeapp.ai/vs-codex/).

## Ce que vous pouvez faire

- **Personnaliser l’agent** — compétences, outils, MCP, connecteurs, habillages
- **Combiner les modèles** — texte, image et vidéo chacun sur le sien ; pas de verrouillage
- **Image et vidéo prêts** — lots, storyboards, image-vers-vidéo déjà branchés ; agents image / vidéo / short / canvas / multi-modèles
- **Actifs numériques** — enregistrer images et vidéos en un geste ; les réutiliser dans le chat
- **Automatisation navigateur** — l’extension Chrome clique, lit et capture les vraies pages
- **Compétences en lot** — le même flux sur un ensemble ; permissions, coût, relances visibles
- **Auto-évolution** — pointer l’espace de travail sur le source de ce produit ; l’agent peut modifier l’app (instantané → vérifier → revenir)
- **Vrai travail sur l’ordinateur** — dossiers, fichiers, terminal, navigateur — pas seulement le chat
- **Sites et médias peuvent rester locaux** — publier et produire sur la machine ou en auto-hébergé ; le cloud est optionnel

Les compétences définissent ce qui peut tourner ; l’agent l’exécute. Dites ce que vous voulez faire.

## Pourquoi WodeAppX

Cursor / Claude Code / Codex éditent votre dépôt. WodeAppX est un atelier d’agent bureau : personnaliser l’agent, combiner les modèles, livrer les ateliers image/vidéo, et modifier le produit lui-même. Le logiciel est gratuit (Apache-2.0). Vous payez seulement les modèles que vous apportez. Pas de mur d’abonnement.

- **Vous formez l’assistant** — compétences, outils et habillages sont de première classe
- **Le bon modèle pour chaque tâche** — texte, image et vidéo n’ont pas à partager un fournisseur
- **Une chaîne, pas une coquille vide** — les ateliers image et vidéo sont prêts
- **Les données peuvent rester privées** — sessions, fichiers, terminal et navigateur sur votre machine ; l’OSS démarre sans connexion
- **Vos clés** — clé locale ou auto-hébergement d’abord ; le cloud officiel est en plus, pas une barrière
- **Il peut changer cette app** — l’auto-évolution a instantané et retour arrière
- **Ouvert et auditable** — Apache-2.0 ; inspecter, forker, redistribuer

<table>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/05-customize-en.jpg" alt="Personnaliser l’agent" />
      <p><strong>Personnaliser l’agent</strong><br />Compétences, outils et habillages. L’agent peut aussi modifier ce produit (instantané → vérifier → revenir).</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/03-assets-en.png" alt="Actifs numériques" />
      <p><strong>Actifs numériques</strong><br />Enregistrez images et vidéos en un geste. Réutilisez-les dans le chat.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/04-image-workbench-en.jpg" alt="Atelier image" />
      <p><strong>Atelier image</strong><br />Prêt pour les lots. Plusieurs modèles déjà branchés.</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/06-video-workbench-en.jpg" alt="Atelier vidéo" />
      <p><strong>Atelier vidéo</strong><br />Storyboards, image-vers-vidéo et files au même endroit.</p>
    </td>
  </tr>
</table>

## Télécharger

Build officiel : [v1.0.3](https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3) (macOS notarié). Site : [x.wodeapp.ai](https://x.wodeapp.ai/) · Chine : [x.wodeapp.cn](https://x.wodeapp.cn/)

| Plateforme | Installateur |
|---|---|
| macOS Apple Silicon | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-arm64-1.0.3.dmg) |
| macOS Intel | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-x64-1.0.3.dmg) |
| Windows x64 | [EXE](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-win-x64-1.0.3.exe) |
| Linux x64 | [AppImage](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-linux-x86_64-1.0.3.AppImage) |

Au premier lancement : clé locale, ou connexion cloud. Pas de compte pour commencer.

## Après l’ouverture

1. **Clé locale (défaut)**  
   Barre latérale **Local** ou **Configurer les clés locales**. DeepSeek, Volcano Ark, Kimi / Moonshot, DashScope, OpenRouter (une clé pour GPT / Claude / Grok) et une clé OpenAI connectée fonctionnent.  
   Vous pouvez ajouter un **fournisseur personnalisé** : nom + URL de base + clé ; nous interrogeons `/models` compatible OpenAI.  
   Les clés restent dans `~/.wodeapp/keys.json` sur la machine. Elles ne sont pas envoyées à WodeApp.

2. **Chrome (optionnel)**  
   Installez l’extension depuis Capacités pour que l’agent clique, lise et capture les pages. Vous pouvez passer et installer plus tard.

3. **Cloud (optionnel)**  
   Barre **Cloud**, puis un site : International [wodeapp.ai](https://wodeapp.ai/) (Stripe) ou Chine [wodeapp.cn](https://wodeapp.cn/) (Alipay / WeChat). La connexion ouvre le navigateur système. WodeApp est un fournisseur parmi d’autres. Se connecter ne remet pas le modèle par défaut sur le cloud.

4. **Parler**  
   Dites ce qu’il vous faut dans un chat vide, ou ouvrez Image / Vidéo / Actifs / Capacités. Le sélecteur n’affiche que les familles actuelles et les relie aux clés vraiment connectées.

Chat, image et vidéo partagent les mêmes clés et le même routage. S’il manque une clé, l’UI demande de la configurer — pas seulement de se connecter.

## Lancer depuis les sources

Node.js 22, pnpm 9.15, Bun 1.3.9+, Go 1.23. Pas Node 26. La commande est `pnpm run setup`, pas `pnpm setup`.

```bash
git clone https://github.com/diankourenxia/wodeappx.git
cd wodeappx
pnpm run setup
pnpm dev
```

`pnpm run setup` récupère le shell bureau, applique les correctifs et installe les dépendances. `vendor/` est généré — ce n’est pas la source. Puis créez un espace local et ajoutez des clés.

Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Pour les agents / contributeurs

Après le clone, lisez **[AGENTS.md](AGENTS.md)** (carte du dépôt, où éditer, règles produit), puis [docs/README.md](docs/README.md).

| Changement | Où |
|---|---|
| Fonctions propres, clés locales, extension navigateur | `integrations/`, `capture-engine/`, `scripts/` |
| Calques UI bureau | `integrations/openwork/fork/`, enregistrés dans le script apply |
| Pin du shell amont | `openwork.lock.json` (ne pas monter à la légère) |

L’auto-évolution in-app est sous garde (instantané → vérifier → revenir). Éditer ce clone dans votre éditeur est un changement source normal.

## FAQ

**Est-ce un remplaçant de Cursor / Codex ?**  
Oui — et plus. Utilisez WodeAppX pour le dépôt, les agents, l’image et la vidéo, et les sites. Construisez votre atelier : compétences, outils, habillages, modèles. Apportez votre clé.

**Faut-il se connecter au cloud ?**  
Non. L’OSS marche avec vos clés. Le cloud est optionnel.

**L’auto-évolution entraîne-t-elle un modèle ?**  
Non. Ce sont des éditions gardées du source de ce produit (sauvegarde → vérifier → revenir), pas un entraînement de poids.

**Mes données quittent-elles cet ordinateur ?**  
L’OSS est local d’abord. Sessions et fichiers peuvent rester sur la machine. Seules les API de modèles que vous configurez sortent. La connexion cloud n’est pas une barrière.

**L’édition visuelle des compétences est-elle finie ?**  
Skills / MCP / outils tournent aujourd’hui. L’édition de graphe de flux est sur la feuille de route.

**Windows dit que l’installateur n’est pas signé ?**  
Windows n’a pas encore Authenticode. macOS est notarié. Vous pouvez lancer depuis les sources ou lire les notes de Releases.

## Documentation

| Public | Docs |
|---|---|
| Premier fichier après clone | Cette page (langues dans l’en-tête) · [Site](https://x.wodeapp.ai/) |
| Agents / contributeurs | [AGENTS.md](AGENTS.md) · [CONTRIBUTING.md](CONTRIBUTING.md) |
| Capacités et clés locales | [docs/CAPABILITIES.md](docs/CAPABILITIES.md) · [docs/LOCAL_KEY_INVOKE.md](docs/LOCAL_KEY_INVOKE.md) |
| Index bureau | [docs/README.md](docs/README.md) |
| Plan open source | [docs/OPEN_SOURCE_PLAN.md](docs/OPEN_SOURCE_PLAN.md) |
| Sécurité / vie privée / marque | [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md) · [TRADEMARK.md](TRADEMARK.md) |

## License

Le code original est sous [Apache License 2.0](LICENSE). Mentions tierces : [NOTICE](NOTICE) et [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/).
