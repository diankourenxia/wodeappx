# WodeAppX branding assets

Canonical **open-source** mark: the WodeAppX lockup (black field, white “WodeApp”, lime “X”). Policy: [`../TRADEMARK.md`](../TRADEMARK.md).

Source files consumed by `pnpm openwork:patch` (`scripts/sync-wodeapp-branding-assets.mjs`):

| File | Use |
|------|-----|
| `wodeapp-icon-source.png` | 1024×1024 master lockup (app icon / apple-touch) |
| `wodeapp-icon-32.png` | favicon 32 |
| `wodeapp-icon-16.png` | favicon 16 |
| `wodeappx-logo-180.png` | README |
| `wodeappx-logo-512.png` | og:image / social |

The patch script copies/resizes these into `vendor/openwork` (web favicons + Electron `.icns` on macOS).

To refresh after replacing art: `pnpm openwork:patch`

Note: `appId` stays `com.differentai.openwork` intentionally (OpenWork upstream keychain / migration compatibility). That is not a trademark license.
