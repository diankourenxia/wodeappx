<p align="center">
  <img src="branding/wodeappx-logo-180.png" alt="WodeAppX" width="128" />
</p>

<h1 align="center">WodeAppX</h1>

<p align="center">
  <strong>エージェントは自分で組む。モデルは自由に組み合わせる。</strong><br />
  オープンソースの AI デスクトップ。スキル・ツール・スキンは自分で決める。文章・画像・動画で別々のモデルを使える。<br />
  画像・動画ワークベンチは最初から使える。ローカル優先。自分の Key。ログイン壁なし。
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
  <a href="https://x.wodeapp.ai/">サイト</a>
  ·
  <a href="https://wodeapp.ai/chat">ブラウザで試す</a>
  ·
  <a href="https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3">v1.0.3 をダウンロード</a>
  ·
  <a href="https://youtu.be/gULs1_u1JYE">トレーラー</a>
  ·
  <a href="AGENTS.md">Agent 向け</a>
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

## 目次

- [まずここから](#まずここから)
- [できること](#できること)
- [なぜ WodeAppX か](#なぜ-wodeappx-か)
- [ダウンロード](#ダウンロード)
- [開いたあと](#開いたあと)
- [ソースから動かす](#ソースから動かす)
- [Agent / 貢献者向け](#agent--貢献者向け)
- [よくある質問](#よくある質問)
- [ドキュメント](#ドキュメント)
- [License](#license)

## まずここから

| 経路 | 向き | 内容 |
|---|---|---|
| [デスクトップを入れる](#ダウンロード) | 日常利用 | インストール → ローカル Key（またはクラウドログイン）→ 話す |
| [ブラウザで試す](https://wodeapp.ai/chat) | 先に見る | 公式サイトのサイドバー会話。中国: [wodeapp.cn/chat](https://wodeapp.cn/chat) |
| [ソースから動かす](#ソースから動かす) | 改変 / 貢献 | `pnpm run setup && pnpm dev` |

サイト: [x.wodeapp.ai](https://x.wodeapp.ai/) · 中国 [x.wodeapp.cn](https://x.wodeapp.cn/)。比較: [vs Cursor](https://x.wodeapp.ai/vs-cursor/) · [vs Claude Code](https://x.wodeapp.ai/vs-claude-code/) · [vs Codex](https://x.wodeapp.ai/vs-codex/)。

## できること

- **エージェントをカスタム** — スキル、ツール、MCP、コネクタ、スキンを自分で組む
- **モデルを自由に組み合わせ** — 文章・画像・動画で別モデル。囲い込みなし
- **画像・動画はそのまま使える** — 一括生成、絵コンテ、画像から動画まで接続済み。サイドバーに画像 / 動画 / 短編 / キャンバス / マルチモデル
- **デジタル資産** — できた画像・動画をすぐ保存し、会話で再利用
- **ブラウザ自動化** — Chrome 拡張が実ページをクリック、読み取り、スクリーンショット
- **スキルを一括実行** — 同じ流れをまとめて回す。権限・コスト・再試行が見える
- **自己進化** — ワークスペースをこの製品のソースに向けると、エージェントがアプリ自体を変えられる（スナップショット → 検証 → ロールバック）
- **パソコンで実際に働く** — ローカルフォルダ、ファイル、ターミナル、ブラウザ。チャットだけではない
- **サイトとメディアはローカルで完結できる** — 公開も制作も自機または自前ホスト。クラウドは任意

スキルは「何ができるか」、エージェントは「どう回すか」。やりたいことをそのまま言えばよい。

## なぜ WodeAppX か

Cursor / Claude Code / Codex はリポジトリを直す。WodeAppX はデスクトップ Agent ワークベンチ：エージェントをカスタムし、モデルを組み合わせ、画像・動画を最初から使え、製品自体も変えられる。ソフトは無料（Apache-2.0）。払うのは自分で持ってきたモデルだけ。サブスクの壁はない。

- **助手を自分で形作る** — スキル、ツール、スキンは一等
- **仕事ごとに合うモデル** — 文章・画像・動画が同じベンダーを共有しなくてよい
- **空の箱ではない** — 画像・動画ワークベンチは最初から入っている
- **データは外に出さなくてよい** — セッション、ファイル、ターミナル、ブラウザは自分のマシン。OSS はログインなしで始められる
- **Key は自分のもの** — ローカル Key / 自前ホストが先。公式クラウドは追加であり門ではない
- **このアプリ自体を変えられる** — 自己進化にはスナップショットとロールバックがある
- **開いて検証できる** — Apache-2.0。見て、フォークして、再配布できる

<table>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/05-customize-en.jpg" alt="エージェントをカスタム" />
      <p><strong>エージェントをカスタム</strong><br />スキル、ツール、スキンを自分で組む。エージェントはこの製品自体も変えられる（スナップショット → 検証 → ロールバック）。</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/03-assets-en.png" alt="デジタル資産" />
      <p><strong>デジタル資産</strong><br />できた画像・動画をすぐ保存し、会話で再利用。</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/04-image-workbench-en.jpg" alt="画像ワークベンチ" />
      <p><strong>画像ワークベンチ</strong><br />一括生成に対応。複数モデルは接続済み。</p>
    </td>
    <td width="50%">
      <img src="https://x.wodeapp.ai/product-hunt/en/06-video-workbench-en.jpg" alt="動画ワークベンチ" />
      <p><strong>動画ワークベンチ</strong><br />絵コンテ、画像から動画、キューがひとつに。</p>
    </td>
  </tr>
</table>

## ダウンロード

正式ビルド: [v1.0.3](https://github.com/diankourenxia/wodeappx/releases/tag/v1.0.3)（macOS 公証済み）。サイト: [x.wodeapp.ai](https://x.wodeapp.ai/) · 中国: [x.wodeapp.cn](https://x.wodeapp.cn/)

| プラットフォーム | インストーラ |
|---|---|
| macOS Apple Silicon | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-arm64-1.0.3.dmg) |
| macOS Intel | [DMG](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-mac-x64-1.0.3.dmg) |
| Windows x64 | [EXE](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-win-x64-1.0.3.exe) |
| Linux x64 | [AppImage](https://github.com/diankourenxia/wodeappx/releases/download/v1.0.3/wodeappx-linux-x86_64-1.0.3.AppImage) |

初回起動: ローカル Key、またはクラウドログイン。始めるのにアカウントは不要。

## 開いたあと

1. **ローカル Key（既定）**  
   サイドバーの **ローカル** または **ローカル Key を設定**。DeepSeek、Volcano Ark、Kimi / Moonshot、DashScope、OpenRouter（1 本の Key で GPT / Claude / Grok）、接続済みの OpenAI が使える。  
   **カスタムベンダー**も追加できる: 名前 + Base URL + Key。OpenAI 互換の `/models` を探る。  
   Key は本機の `~/.wodeapp/keys.json` に残る。WodeApp には上がらない。

2. **Chrome（任意）**  
   能力センターからブラウザ拡張を入れると、エージェントが実ページをクリック、読み取り、スクリーンショットできる。後からでもよい。

3. **クラウド（任意）**  
   サイドバー **クラウド** でサイトを選ぶ: International [wodeapp.ai](https://wodeapp.ai/)（Stripe）または中国 [wodeapp.cn](https://wodeapp.cn/)（Alipay / WeChat）。ログインはシステムブラウザ。WodeApp は他社と同じ一ベンダー。ログインで既定モデルがクラウドに奪われない。

4. **話す**  
   空の会話で要件を言うか、画像 / 動画 / デジタル資産 / 能力センターを開く。モデル選択は今のファミリーだけを出し、つながっている Key に合わせる。

会話・画像・動画は同じ Key と経路。Key がなければ「設定して」と出す。ログインだけを要求しない。

## ソースから動かす

Node.js 22、pnpm 9.15、Bun 1.3.9+、Go 1.23。Node 26 は使わない。コマンドは `pnpm run setup` であり `pnpm setup` ではない。

```bash
git clone https://github.com/diankourenxia/wodeappx.git
cd wodeappx
pnpm run setup
pnpm dev
```

`pnpm run setup` はデスクトップシェルを取り、パッチを当て、依存を入れる。`vendor/` は生成物なのでソース扱いしない。その後ローカルワークスペースを作り、Key を入れる。

門禁は [CONTRIBUTING.md](CONTRIBUTING.md)。

## Agent / 貢献者向け

クローン後は **[AGENTS.md](AGENTS.md)**（リポジトリ地図、どこを直すか、製品の赤線）を先に読み、次に [docs/README.md](docs/README.md)。

| 直すもの | 場所 |
|---|---|
| 自前機能、ローカル Key、ブラウザ拡張 | `integrations/`、`capture-engine/`、`scripts/` |
| デスクトップ UI の上書き | `integrations/openwork/fork/`（apply スクリプトに登録） |
| 上流シェルの固定 | `openwork.lock.json`（安易に上げない） |

アプリ内の自己進化は門禁付き（スナップショット → 検証 → ロールバック）。この git クローンをエディタで直すのは普通のソース変更。

## よくある質問

**Cursor / Codex の代替か？**  
はい。それ以上でもある。リポジトリ、カスタムエージェント、画像と動画、サイトまで WodeAppX でやる。スキル、ツール、スキン、モデルは自分で決める。自分の Key を持ってくる。

**クラウドログインは必須か？**  
不要。OSS は持ってきた Key で動く。クラウドは任意。

**自己進化はモデルの学習か？**  
違う。この製品ソースへの門禁付き編集（バックアップ → 検証 → ロールバック）であり、重みの学習ではない。

**データはこのパソコンから出るか？**  
OSS はローカル優先。セッションとファイルは本機に残せる。ネットに出るのは自分で設定したモデル API だけ。クラウドログインは門ではない。

**スキルの視覚編集は完成しているか？**  
Skill / MCP / ツールは今日動く。フローグラフ編集はロードマップ。

**Windows が未署名と言う？**  
Windows はまだ Authenticode 署名していない。macOS は公証済み。ソースから動かすか Releases を見る。

## ドキュメント

| 対象 | ドキュメント |
|---|---|
| クローン後の最初 | このページ（ヘッダーで言語切替） · [サイト](https://x.wodeapp.ai/) |
| Agent / 貢献者 | [AGENTS.md](AGENTS.md) · [CONTRIBUTING.md](CONTRIBUTING.md) |
| 能力とローカル Key | [docs/CAPABILITIES.md](docs/CAPABILITIES.md) · [docs/LOCAL_KEY_INVOKE.md](docs/LOCAL_KEY_INVOKE.md) |
| デスクトップ文書一覧 | [docs/README.md](docs/README.md) |
| オープンソース計画 | [docs/OPEN_SOURCE_PLAN.md](docs/OPEN_SOURCE_PLAN.md) |
| セキュリティ / プライバシー / 商標 | [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md) · [TRADEMARK.md](TRADEMARK.md) |

## License

オリジナルコードは [Apache License 2.0](LICENSE)。第三者表示は [NOTICE](NOTICE) と [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/)。
