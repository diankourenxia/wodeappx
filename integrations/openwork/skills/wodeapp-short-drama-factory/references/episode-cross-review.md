# Episode Cross-Review

Use this gate after one episode body is complete and before generating its video script. It complements the deterministic chapter-content gate; it does not replace it.

## Pipeline

```text
episode outline + contentPlan
  -> episode body
  -> Gate 0 (free, deterministic)
  -> two independent model reviews in parallel
  -> deterministic local merge
  -> expand current episode / lower this episode's duration / accept a single-model risk
  -> beat budget and video script
```

Never review every intermediate step with two models. Review the completed episode body, cache the result, and reuse it before video-script generation while the body and target duration remain unchanged.

## Model Selection

1. Fetch the current platform text-model list through the documented WodeApp model interface.
2. Prefer user-selected model IDs, then fill from available platform models.
3. Select at least two **different IDs** when possible. Do not hardcode brands or model names in the skill, workbench, or review contract.
4. If only one distinct model is available, run one review and mark it `single_model_degraded`. Do not send the same prompt twice to the same ID and call it independent review.
5. Cache by `scriptHash + targetDurationSec + reviewPolicyVersion`. Editing the episode body, hook, beat, content plan, or episode duration invalidates the cache.

## Independent Roles

Send the same episode evidence to both reviewers, but use different role briefs:

| Reviewer | Checks | Must return |
|---|---|---|
| Capacity | effective events, target-duration fit, repeated/padded actions, missing outline events | verdict, estimate, evidence-based issues |
| Craft | first-3-second question, visible emotion, shootability, dialogue economy, visible ending hook | verdict, evidence-based fixes |

Each issue must contain:

```json
{
  "severity": "P0|P1|P2",
  "type": "stable_machine_key",
  "evidence": "quote or identify a concrete episode beat",
  "fix": "an executable change to the current episode"
}
```

Reject vague feedback such as “make it more exciting” when it gives no evidence or executable fix.

## Deterministic Merge

Do not ask a third model to decide the two reviews by default. Merge locally:

- Gate 0 content shortage: hard block.
- Programmatically verified missing outline hook: hard block.
- Two reviewers report the same P0 `type`: hard block.
- One reviewer reports a P0: require human accept-risk or revision; do not silently block or pass.
- P1/P2: advisory warning; do not block generation.
- Review request failure: show the failure as a warning and keep the successful reviewer result. It is not dual review.

The local merge must keep each reviewer's model ID, role, evidence, and fixes visible. Never synthesize fake agreement by collapsing unrelated P0 types.

## User Actions

- **Expand current episode**: feed merged fixes, the existing body, outline hook, content plan, and target duration back into one rewrite. Return the complete current episode, not the next episode.
- **Lower this episode's duration**: write `episode.targetDurationSec`; do not change the project-wide default or other episodes.
- **Accept risk**: available only for a single-reviewer P0 disagreement. Deterministic Gate 0 failures and consensus P0 failures remain blocked.

After expansion, regenerate the `contentPlan`, invalidate the old review, and rerun Gate 0 plus cross-review.

## Cost and Persistence

- Run Gate 0 first; do not spend review calls on an obvious hard failure unless the user explicitly requests diagnostic advice.
- Store the review beside the episode, including the script hash, target duration, selected model IDs, raw normalized reviews, merged result, accepted-risk flag, policy version, and timestamp.
- Reuse the cached review when generating the video script. Do not charge for the same unchanged episode twice.
