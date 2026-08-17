# Security Policy

Maintainer: the GitHub repository owner of [diankourenxia/wodeappx](https://github.com/diankourenxia/wodeappx).

## Support

Security fixes go to the latest release and `main`. Older builds may need an upgrade first.

## How to report

**Do not** open a public Issue, Discussion, or PR with exploit details, API keys, tokens, workspace contents, or personal data.

1. Prefer GitHub **Security → Report a vulnerability** (private advisory):
   <https://github.com/diankourenxia/wodeappx/security/advisories/new>
   This form is available on a public repository, and on a private repository if GitHub Advanced Security is enabled.
2. If that form is unavailable (private repo on a free plan), contact the repository owner through GitHub **without** attaching secrets or a working exploit in the first message. Wait for a private channel, then share the report.

Include: affected version, platform (macOS / Windows / Linux / source), reproduction steps, impact, and any mitigation you already use.

## Response targets

These are targets, not a paid SLA.

| Step | Target |
|---|---|
| Acknowledge receipt | 2 calendar days |
| Severity triage | 7 calendar days |
| Critical / high fix on `main` | 14 calendar days after confirmed triage, or a public mitigation note if a patch needs more time |
| Coordinated disclosure | After a fix is on `main` (or a mitigation is published). Do not spread working exploit details before that. |

If a report is out of scope (for example a third-party Provider outage), we will say so in the acknowledgement.

## Security boundary

- Provider keys, MCP, browser control, terminal, filesystem, and Computer Use are high-privilege. They need explicit config or approval.
- OSS default run does not require a WodeApp login. Cloud is an explicit opt-in.
- Credentials must not land in git, Skills, workflow manifests, test evidence, or installer logs.
- Connectors keep credentials at the host boundary. Models see trimmed schemas and results, not raw secrets.
- Before a source export or release: `pnpm open-source:check`, plus dependency, license, and artifact review.

If a secret is already in git history: revoke and rotate first, then clean history. Deleting the current file is not enough.
