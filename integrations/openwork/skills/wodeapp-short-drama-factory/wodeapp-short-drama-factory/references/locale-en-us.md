# English / North America Locale (`en-US`)

Use this appendix when `scriptLanguage` is `en-US`, `targetMarket` mentions North America / ReelShort / DramaBox US, or the user asks for an American script.

## Lock These Fields Early

In `creative-spec.json` / series bible:

```json
{
  "series": {
    "title": "The Heiress in Seat Twelve",
    "targetMarket": "North American female audience",
    "scriptLanguage": "en-US",
    "promptLanguage": "en-US",
    "format": {
      "episodeDurationSeconds": 90,
      "targetClipDurationSeconds": 15,
      "shotsPerEpisode": 6
    }
  }
}
```

Rules:

- `scene.script`, human分镜稿, and spoken dialogue are **English**.
- `scene.prompt` and video direction are **English** for US projects. Do not mix Chinese prop labels or character names inside English prompts unless the story explicitly requires bilingual on-screen text.
- Character display names may stay localized in `script` only if the user supplied them; prompts should use the same language as `promptLanguage`.

## Rhythm Preset

| Preset | When |
|--------|------|
| `na_micro_drama` | Default for US vertical romance / revenge / secret-heiress / werewolf |
| `suspense_ladder` | Legal thriller, mystery, conspiracy, evidence-chain stories |
| `emotional_wave` | Slow-burn intimacy with fewer hard hooks |
| `hongguo爽剧` | Do **not** use for US scripts |

`na_micro_drama` anchors:

- Cold open in 0-4s with a concrete question or insult, not lore.
- Blunt, mobile-readable lines; subtext is optional, clarity is mandatory.
- Prefer visual evidence before exposition in the first 3 episodes.
- Cliffhanger = named object, legal status, relationship flip, or door/light/prop state — not theme summary.

## Dialogue Budget (P0 at build time)

English is slower per semantic beat. Budget by `durationSec`, not by Chinese character count.

| `durationSec` | Max spoken words | Notes |
|---------------|------------------|-------|
| 4-8 | 12 | Hook line + one reaction fragment |
| 12-15 | 28 | Default workhorse clip |
| 16-24 | 50 | Use `long_clip` sparingly; split if dialogue + action both heavy |
| >24 | split shot | Do not rely on one spoken monologue |

Manifest field (optional override):

```json
{
  "shotId": "E01-S03",
  "durationSec": 15,
  "dialogueWordBudget": { "max": 28, "unit": "words" },
  "dialogue": [
    { "speaker": "OLIVIA", "line": "That tag is not mine." }
  ]
}
```

`build_wodeapp_drama_package.mjs` fails the build when spoken words exceed the budget.

## Prompt Budget

| `durationSec` | Compact prompt | Expanded prompt |
|---------------|----------------|-------------------|
| 4-8 | 50-90 words | 120-180 words |
| 12-15 | 80-140 words | 160-260 words |
| 16-24 | 100-180 words | 200-320 words |

Keep generation settings (`9:16`, `15s`, model id) in task fields, not inside prompt prose.

## Storyboard Header (English)

```text
EP01-03 INT. COURTROOM ANTEROOM - NIGHT (0:30 - 0:45)
CAMERA: slow push from badge tray to juror twelve
△ Olivia's name card sits under the wrong seat number.
△ Julian stops the bailiff with an open palm, not touching the file.
OLIVIA: That seat is not mine.
(EST. DURATION: 15s)
```

## Review Lane (do not use Chinese tone pass)

For `en-US` packages:

1. **Logic / continuity pass** — strong long-context reasoning model (e.g. DeepSeek V4 Pro class).
2. **Dialogue / speakability pass** — English-native or English-strong model for blunt micro-drama tone, not 豆包 Seed 2.1 Pro.

Do **not** run the default Chinese「爽感 / 情绪饱满」review lane on English scripts.

## Shot-Splitting Guidance

When an English beat overflows the word budget:

1. Split dialogue from reaction (two 12-15s clips).
2. Move exposition to a prop close-up or legal document insert.
3. Reserve `16-24s` for single-speaker emotional performance only.

## Reference

Market pattern cards: `generated/short-drama-north-america/research-2026-07-05/north-america-short-drama-kb.md` (structural research only; do not copy plots).
