# Security exceptions

WodeAppX fails CI on every applicable moderate, high, or critical production dependency advisory.

## GHSA-qwww-vcr4-c8h2 — React Router RSC mode

- Status: narrowly excluded until 2026-12-31.
- Installed path: `apps/app > react-router-dom@7.18.2 > react-router@7.18.2`.
- Reason: WodeAppX renders a Vite SPA inside Electron. `apps/app/components.json` sets `rsc: false`; the app has no React Router framework/RSC server package and exposes no React Server Actions.
- Upstream constraint: the advisory reports a fix in `react-router@8.3.0`, while a matching `react-router-dom` release is not available. Forcing only the inner package across a major version creates an unsupported dependency pair.
- Enforcement: `scripts/check-security-audit.mjs` validates the exact advisory, package path/version, SPA configuration, dependency surface, and expiry date. Any other moderate/high/critical advisory fails the build.

Review this exception when a compatible `react-router-dom` release is available or before the expiry date, whichever comes first.
