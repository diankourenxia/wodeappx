# WodeAppX Release Contract

> Last updated: 2026-08-17

## 1. Version Rule

The WodeAppX root package version and the Electron desktop package version must match. The desktop package version is what users see in the app and what Electron Builder writes into release artifacts.

Before publishing:

```bash
cd wodeappx
pnpm release:check
```

## 2. Release Matrix

Publish every supported build for the same app version on the same GitHub release:

| Platform | Architecture | Artifact | Built by |
|----------|--------------|----------|----------|
| macOS | arm64 | `wodeappx-mac-arm64-<version>.dmg` | Local Mac (`pnpm release:macos`) |
| macOS | x64 | `wodeappx-mac-x64-<version>.dmg` | Local Mac (`pnpm release:macos`) |
| Windows | x64 | `wodeappx-win-x64-<version>.exe` | GitHub Actions |
| Linux | x64 | `wodeappx-linux-x64-<version>.AppImage` (+ `.tar.gz`) | GitHub Actions |

Primary release targets are **macOS arm64** (local DMG; notarized when release credentials are available), **Windows x64** (CI), and **Linux x64** (CI AppImage). Windows remains unsigned until Authenticode secrets exist.

The app also publishes Electron updater manifests on the same release. The architecture mismatch gate reads those manifests to route users to the correct package.

## 3. Conversation Compatibility

Different architecture builds of the same version must read the same user data and workspace state. Do not change the production app identifier unless there is a deliberate migration plan.

Current compatibility anchors:

| Contract | Value |
|----------|-------|
| Production app identifier | `com.differentai.openwork` |
| Workspace state | `openwork-workspaces.json` |
| Legacy workspace keys | `selectedWorkspaceId`, `watchedWorkspaceId`, `activeId` |
| Conversation runtime | OpenWork native session path |

This means a user can replace the Intel build with the ARM build, or upgrade between same-version architecture packages, without losing workspaces, settings, or conversations.

## 4. Update Source

WodeAppX builds must use the public Gitea release feed (mirrored from monorepo CI):

```text
https://gitea.com/diankourenxia/wodeappx/releases/latest/download
```

Monorepo CI publishes installers to `diankourenxia/wodeapp` GitHub Releases under tag `wodeappx-v<version>`, then optionally mirrors the same assets to Gitea for public download and Electron updater.

### Public download page

| Entry | URL |
|-------|-----|
| Product landing | `https://wodeapp.ai/wodeappx/`（英文默认）· `https://wodeapp.cn/wodeappx/`（中文默认）；旧路径 `/xiaolingtong` 仍指向同一下载页 |
| Latest metadata API | `GET /mainserver/api/downloads/wodeappx-desktop` |
| Public mirror | `https://gitea.com/diankourenxia/wodeappx/releases` |
| CI / GitHub release | `https://github.com/diankourenxia/wodeapp/releases`（tag `wodeappx-v*`） |

The landing page reads the metadata API (Gitea first, then GitHub), then links users to installers. It does **not** host installer binaries. After each tagged release and successful Gitea mirror, the page updates automatically.

## 5. Automated Release Workflow

Standalone GitHub Actions workflow: `.github/workflows/release.yml`. The private
monorepo also keeps a subtree release workflow, but the public repository
workflow is the release source of truth.

The workflow has two entry points:

| Trigger | Result |
|---------|--------|
| Manual `workflow_dispatch` | Builds all configured platform installers, uploads them to prerelease `ci-packages-<version>`, and best-effort keeps 2-day workflow artifacts. This is for release-candidate checks, not a product release. |
| Git tag `v<version>` | Builds all configured platform installers, then publishes them to the GitHub release for that tag. |

After the GitHub release is created, the workflow can mirror the same installers to Gitea for users who download from mainland China. The Gitea mirror is optional: if the required secrets are missing, the workflow skips this step and the GitHub release still succeeds.

Current automated build targets:

| Runner | Output |
|--------|--------|
| Windows | Windows x64 `.exe` package |

macOS `.dmg` / `.zip` packages are **not** built on GitHub (runner queue is slow). Build and upload them from a local Mac instead.

Windows arm64 remains an optional target once native helper packaging is confirmed.

To publish a new version from the monorepo:

```bash
cd wodeappx
# update package.json (desktop version is synced by openwork:patch)
pnpm openwork:bootstrap
pnpm openwork:patch
pnpm release:check
cd ..
git tag wodeappx-v<version>
git push origin wodeappx-v<version>
```

The tag must match `wodeappx/package.json` with the `wodeappx-v` prefix. For example, package version `0.17.4` must be released with tag `wodeappx-v0.17.4`. This triggers `.github/workflows/wodeappx-release.yml` for **Windows only**.

Then on a Mac, build and attach DMGs to the same release:

```bash
cd wodeappx
pnpm release:macos -- --upload
```

If the Windows release is not ready yet, build first and upload later:

```bash
pnpm release:macos
pnpm release:macos -- --skip-bootstrap --upload
```

The manual workflow has a `flavor` input:

| Flavor | Meaning |
|--------|---------|
| `oss` | Applies the default WodeAppX/OpenWork integration patches. |
| `cloud` | Applies default patches plus the WodeApp cloud integration patch. |

### Computer Use helpers

| Platform | Helper | How it is staged |
|----------|--------|------------------|
| macOS | `OpenWork Computer Use.app` (HandsFree) | `prepare-computer-use-helper.mjs` during `electron-build` |
| Windows | `resources/helpers/open-computer-use.exe` | `prepare-open-computer-use-helper.mjs` downloads pinned `open-computer-use` npm binary |
| Linux | `resources/helpers/open-computer-use` | Same prepare script (when Linux packaging is enabled) |

Windows CI packaging already runs `electron-build`, which stages the OCU binary before `electron-builder`. Override with `WODEAPPX_OPEN_COMPUTER_USE_VERSION` (default `0.2.1`) or `WODEAPPX_OPEN_COMPUTER_USE_BINARY` if needed.

Local dry-run:

```bash
cd wodeappx
pnpm helper:open-computer-use:test
pnpm helper:open-computer-use -- --platform win32 --arch x64
```

## 6. Gitea Mirror

Use Gitea as a regional download mirror, not as the canonical update source. GitHub remains the source of truth for tags, release notes, and Electron updater feeds. Gitea carries the same installer files to improve download speed for domestic users.

Architecture:

1. CI / local packaging publishes to GitHub Release `wodeappx-v*`.
2. Prefer a **public download surface** for the large installers:
   - **Mainland (current)**: static files on the CN nginx box at `/var/www/wodeappx-releases/`, public URL `https://wodeapp.cn/downloads/wodeappx/<file>`. Set `WODEAPPX_PUBLIC_DOWNLOAD_BASE` + `WODEAPPX_PUBLIC_DOWNLOAD_DIR` on CN only; the API advertises a file only if it exists on disk. Keep this directory out of `client-react/dist` (`rsync --delete`).
   - **Later / high traffic**: object storage / CDN (COS/OSS), or a self-hosted Gitea with a high attachment limit.
   - **gitea.com cloud**: suitable for release metadata / tiny `latest*.yml` only. Measured limit is roughly **≤50MB** (80MB uploads return HTTP 502), so 250–300MB `.dmg` / `.exe` cannot be hosted there.
3. `/xiaolingtong` reads `GET /mainserver/api/downloads/wodeappx-desktop`: prefer public mirror URLs when available; otherwise GitHub with `WODEAPPX_GITHUB_TOKEN` + `/wodeappx-file` proxy.

Configure these GitHub Actions secrets to enable mirroring:

| Secret | Example | Meaning |
|--------|---------|---------|
| `GITEA_BASE_URL` | `https://gitea.example.com` | Gitea instance origin, without `/api/v1`. |
| `GITEA_OWNER` | `wodeapp` | Gitea owner or organization. |
| `GITEA_REPO` | `wodeappx` | Gitea repository name. |
| `GITEA_TOKEN` | `...` | Gitea access token that can **push commits/tags** and manage release assets. Release-only tokens fail on an empty mirror repo. |

Current mirror configuration:

| Field | Value |
|-------|-------|
| Gitea repository | `https://gitea.com/diankourenxia/wodeappx` |
| `GITEA_BASE_URL` | `https://gitea.com` |
| `GITEA_OWNER` | `diankourenxia` |
| `GITEA_REPO` | `wodeappx` |

Recommended setup:

1. Create the Gitea repository once (it may start empty). The release workflow seeds `main` + the `wodeappx-v*` tag when `empty=true`, then creates/updates the release assets.
2. Prefer giving the token repository write + release permissions so CI can push the tag. A release-only token cannot un-empty the repo and will fail with HTTP 422 `repo is empty`.
3. After a local macOS build (or any time GitHub already has assets), backfill Gitea with:

```bash
cd wodeappx
# from local wodeappx/release/*
pnpm release:mirror-gitea
# or pull from private GitHub release
pnpm release:mirror-gitea -- --from-github --tag wodeappx-v0.17.4
```

4. Put the Gitea release link on the public download page (`/xiaolingtong`) as "国内镜像".

The mirror step replaces existing assets with the same filename, so rerunning a failed release job keeps the Gitea release tidy. GitHub Actions marks the Gitea step `continue-on-error: true` so a mirror failure never blocks the GitHub release.

## 7. Local macOS Packaging

macOS installers are built on a local Mac and uploaded to the same GitHub release tag that CI uses for Windows:

```bash
cd wodeappx
pnpm release:macos -- --upload
```

What the script does:

1. `openwork:bootstrap` / `openwork:patch` / `openwork:install` (skip with `--skip-bootstrap`)
2. `release:check`
3. Electron build + capture sidecars for Intel and Apple Silicon
4. `electron-builder --mac --x64 --arm64`
5. Copies artifacts into `wodeappx/release/`
6. With `--upload`, creates or updates GitHub release `wodeappx-v<version>`

## 8. Packaging smoke (avoid reinstall loops)

Before uploading installers, validate the Electron tree and (when packaged) `app.asar`:

```bash
cd wodeappx
pnpm openwork:patch
pnpm release:check                 # includes import-graph + preload auth bridge checks
pnpm release:smoke-electron:asar   # after electron-builder produced win-unpacked/mac*
```

GitHub Windows release CI runs the asar smoke after packaging. That catches missing modules and `asarUnpack` workers without downloading/installing the `.exe`.

## 9. Signing and notarization (current policy)

This is the policy in force, not a future wish list.

| Platform | What happens today | Secrets |
|---|---|---|
| macOS | `electron-builder.yml` sets `mac.notarize: false`. `afterSign` (`electron-after-sign.cjs`) notarizes when `MACOS_NOTARIZE=true`, via `notarytool --key/--key-id/--issuer` then `stapler staple` the `.app`. Local 2026-08-14 pack used **Developer ID Application: yao hui (88B8TA3MKP)** (`CSC_NAME="yao hui (88B8TA3MKP)"`, do not prefix `Developer ID Application:`). `.app` Gatekeeper: `accepted / Notarized Developer ID`. The DMG needs a **second** `notarytool submit` + `stapler staple` (afterSign only covers the `.app`). The DMG file itself is unsigned, so `spctl --type install` may still reject; the app inside is what strangers run. | Do not commit `.p12` / `.p8`. Local run: `WODEAPPX_OSS_MAC_TARGETS=aarch64-apple-darwin MACOS_NOTARIZE=true APPLE_API_KEY_PATH=... APPLE_API_KEY=<KeyID> APPLE_API_ISSUER=<IssuerID> pnpm release:macos:oss -- --skip-bootstrap`. Rotate by replacing the secret, do not log values. |
| Windows | `workflow_dispatch` packs with `--publish never`. electron-builder signs when GitHub secrets `WIN_CSC_LINK` (base64 `.p12`) and `WIN_CSC_KEY_PASSWORD` are set; otherwise the `.exe` stays unsigned. No Authenticode cert exists yet (2026-08-17). | Never commit `.p12`. After buying an OV/EV code-signing cert: `base64 -i cert.p12 \| pbcopy`, then `gh secret set WIN_CSC_LINK -R diankourenxia/wodeappx` and `gh secret set WIN_CSC_KEY_PASSWORD -R diankourenxia/wodeappx`. Re-run Release. Verify on Windows: `Get-AuthenticodeSignature wodeappx-win-x64-*.exe`. |
| Linux | `wodeappx/.github/workflows/release.yml` packs AppImage + tar.gz. First-release surface includes Linux x64. | n/a |

`appId` stays `com.differentai.openwork` so existing installs keep keychain/TCC. Changing it is a migration, not a branding tweak.

OSS test packages (`*-oss.dmg`) follow the same signing flags as commercial macOS builds. Notarization is **off** unless that run sets `MACOS_NOTARIZE=true`. The current local `release-oss/wodeappx-mac-arm64-1.0.0-oss.dmg` is notarized; the CI mac DMG on `ci-packages-1.0.0` is not.

To verify a local DMG without installing: mount read-only and read `WodeAppX.app/Contents/Info.plist` (`CFBundleName`), plus `pnpm release:smoke-electron:asar -- --asar <path-to-app.asar>`.
