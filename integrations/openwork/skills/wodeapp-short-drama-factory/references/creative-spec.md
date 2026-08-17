# Creative Spec Contract

Use one JSON file as the source of truth for a short-drama package.

Shared prompt wording and duration-routing rules are generated in `references/shared-prompt-contract.md` from `server/src/config/dramaPrompts/shortDramaContracts.ts`.

## Required Top-Level Shape

```json
{
  "project": {
    "name": "Project title",
    "id": "optional WodeApp project id",
    "url": "https://example.wodeapp.cn/"
  },
  "series": {
    "title": "English title",
    "cnTitle": "Chinese title",
    "targetMarket": "North American female audience",
    "scriptLanguage": "en-US",
    "promptLanguage": "en-US",
    "format": {
      "episodeCount": 30,
      "episodeDurationSeconds": 90,
      "targetClipDurationSeconds": 15,
      "maxClipDurationSeconds": 30,
      "shotsPerEpisode": 6,
      "aspectRatio": "9:16"
    },
    "genre": ["supernatural romance", "urban fantasy"],
    "logline": "One-sentence promise.",
    "styleBible": {
      "globalLook": ["live-action vertical short drama"],
      "hardStyleLock": "Live-action photorealistic...",
      "negativeStyle": "not anime, not manga..."
    }
  },
  "characters": [],
  "scenes": [],
  "episodes": []
}
```

## Character Fields

Every recurring character should include:

```json
{
  "id": "char_kane",
  "name": "Kane",
  "type": "character",
  "role": "White wolf king, protector",
  "revealEpisode": 1,
  "age": 32,
  "ethnicity": "Northern / Eastern European-coded",
  "skinTone": "cool pale",
  "bodyType": "tall lean wolf-muscle",
  "hairEyes": "silver-white hair, ice-gray eyes",
  "faceBody": "sharp cheekbones, hard jaw",
  "wardrobeSilhouette": "open pale gray coat, wet white shirt",
  "animalMarker": "crescent chest brand, broken collar cord",
  "animalForm": "white wolf",
  "transformationBrief": "realistic large white wolf...",
  "relationshipTension": "wants to protect heroine but fears hurting her",
  "emotionalCore": "needs to be seen without having to beg",
  "defaultMode": "fixes things off-screen, avoids eye contact when thanked",
  "visibleTell": "fixes things off-screen, avoids eye contact when thanked",
  "releaseStyle": "places one object on the table and finally says one short line",
  "description": "Long production description."
}
```

For female-audience ensemble romance, make male leads distinct by ethnicity anchor, age impression, face structure, body type, wardrobe silhouette, animal identity, and emotional function. Do not reuse the same handsome face with different hair.

## Scene Asset Fields

Scene assets are reusable locations, not episode shots.

```json
{
  "id": "scene_clinic",
  "name": "Hart Veterinary Clinic",
  "type": "scene",
  "description": "Main late-night clinic location.",
  "imagePrompt": "Photorealistic location reference, no people..."
}
```

## Episode Fields

Each episode should be split into shot beats when video generation max duration is shorter than the episode.

For structured timing, attach or reference an `EpisodeRhythmManifest` (`references/episode-rhythm-manifest.schema.json`) as `rhythmManifest` or `rhythmManifestPath` before final scene JSON. The manifest owns dramatic beats, shot durations, bridges, and `modelRequirements`; it does not store `providerModel`.

```json
{
  "no": 1,
  "title": "Blood and Collar",
  "logline": "The hook and episode turn.",
  "rhythmPreset": "suspense_ladder",
  "rhythmManifestPath": "E01_rhythm_manifest.json",
  "panels": [
    {
      "beat": "Opening image",
      "description": "0-10s shot description.",
      "characters": ["char_ella", "char_kane"],
      "location": "scene_clinic"
    }
  ]
}
```

If `panels` are arrays like `["Opening", "Description"]`, the build script will normalize them.

## Quality Rules

- First 3 seconds: create a question. This can be an impossible image, a dangerous line, a quiet contradiction, forbidden evidence, intimate tension, or a small uncanny detail that escalates.
- Middle: information gap plus action, not exposition.
- Ending: answer one question and open two larger questions.
- Every generated clip should cover one story beat only. Opening hooks can be impact hooks or progressive hooks; normal clips should use 2-3 clear actions or inserts.
- Ban empty slow pans, long empty atmosphere, pure eye contact, and reaction shots that do not add a new clue in early-episode openers.
- Do not force every clip to change every 2 seconds. Reserve denser pacing for the first few episodes' opening clips and selected early shock beats; progressive hooks may build through 2-4 layered clues.
- Prefer executable scenes near **15s** when the beat can naturally carry action, reaction, and a clean handoff. Use short 4-8s clips only for hard hooks, inserts, reactions, or bridges; use 16-30s only when splitting would hurt continuity.
- Keep each executable scene duration within the **selected provider/model** limit at build or submit time. Authoring may plan longer dramatic shots, but `durationSec > 30` must be split (or use extend) before scene JSON is emitted.
- Set `scriptLanguage` / `promptLanguage` on the series (and optionally on each `EpisodeRhythmManifest`). For North American projects use `en-US` and read `references/locale-en-us.md` for dialogue word budgets, prompt word budgets, and review-lane overrides.
