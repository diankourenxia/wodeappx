import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./build_wodeapp_drama_package.mjs', import.meta.url));

function runBuilder(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'drama-pkg-'));
  const inputPath = join(dir, 'spec.json');
  const outputPath = join(dir, 'out.json');
  writeFileSync(inputPath, JSON.stringify(spec, null, 2));
  const result = spawnSync(process.execPath, [scriptPath, '--input', inputPath, '--output', outputPath], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(readFileSync(outputPath, 'utf8'));
}

test('inline rhythm manifest maps shots to scenes with execution tiers', () => {
  const output = runBuilder({
    series: { title: 'Test Drama', format: { episodeCount: 1, episodeDurationSeconds: 60 } },
    episodes: [{
      no: 1,
      title: 'Pilot',
      rhythmManifest: {
        version: '1.1',
        episode: 1,
        title: 'Pilot',
        rhythmPreset: 'hook_dense',
        beats: [{ beatId: 'b1', type: 'cold_open', goal: 'Grab attention' }],
        shots: [
          {
            shotId: 'E01-S01',
            index: 1,
            beatId: 'b1',
            durationSec: 8,
            narrativeFunction: 'Hook',
            openingShot: 'Wide alley',
            endingShot: 'Close on eyes',
            videoMode: 'frames2video',
          },
          {
            shotId: 'E01-S02',
            index: 2,
            beatId: 'b1',
            durationSec: 18,
            narrativeFunction: 'Reveal',
            openingShot: 'Eyes widen',
            endingShot: 'Turn away',
            bridgeHint: 'match cut on gaze',
          },
        ],
      },
    }],
  });

  const scenes = output.productVideoRun.scenes;
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].id, 'E01-S01');
  assert.equal(scenes[0].durationSec, 8);
  assert.equal(scenes[0].executionTier, 'universal');
  assert.equal(scenes[0].taskType, 'firstlast');
  assert.equal(scenes[0].rhythmSource, 'rhythm_manifest');

  assert.equal(scenes[1].id, 'E01-S02');
  assert.equal(scenes[1].durationSec, 18);
  assert.equal(scenes[1].executionTier, 'long_clip');
  assert.equal(scenes[1].bridgeHint, 'match cut on gaze');

  const meta = JSON.parse(output.workflowRun.data.ctxSnapshot).importMeta;
  assert.equal(meta.rhythmManifestSources.length, 1);
  assert.equal(meta.rhythmManifestSources[0].shotCount, 2);
});

test('must_split duration fails build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drama-pkg-fail-'));
  const inputPath = join(dir, 'spec.json');
  const outputPath = join(dir, 'out.json');
  writeFileSync(inputPath, JSON.stringify({
    series: { title: 'X', format: { episodeCount: 1 } },
    episodes: [{
      no: 1,
      rhythmManifest: {
        version: '1.1',
        episode: 1,
        shots: [{ shotId: 'S1', index: 1, durationSec: 45, narrativeFunction: 'Too long' }],
      },
    }],
  }));
  const result = spawnSync(process.execPath, [scriptPath, '--input', inputPath, '--output', outputPath], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /exceeds 30s/i);
});

test('en-US dialogue overflow fails build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drama-pkg-dialogue-'));
  const inputPath = join(dir, 'spec.json');
  const outputPath = join(dir, 'out.json');
  writeFileSync(inputPath, JSON.stringify({
    series: {
      title: 'US Drama',
      targetMarket: 'North American female audience',
      scriptLanguage: 'en-US',
      format: { episodeCount: 1, episodeDurationSeconds: 60 },
    },
    episodes: [{
      no: 1,
      title: 'Pilot',
      rhythmManifest: {
        version: '1.1',
        episode: 1,
        durationSec: 60,
        scriptLanguage: 'en-US',
        rhythmPreset: 'na_micro_drama',
        beats: [{ beatId: 'E01-B01', atSec: 0, type: 'cold_open', goal: 'Hook' }],
        shots: [{
          shotId: 'E01-S01',
          beatId: 'E01-B01',
          index: 1,
          startSec: 0,
          endSec: 15,
          durationSec: 15,
          narrativeFunction: 'Hook',
          openingShot: 'Wide',
          endingShot: 'Close',
          dialogue: [{
            speaker: 'OLIVIA',
            line: 'That seat is not mine and I never signed any waiver and you cannot move me again without counsel present in this room because I was already discharged and your paperwork is forged and I want my attorney on speakerphone right now before anyone touches me again.',
          }],
        }],
      },
    }],
  }));
  const result = spawnSync(process.execPath, [scriptPath, '--input', inputPath, '--output', outputPath], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /exceeds budget/i);
});

test('en-US dialogue within budget builds and sets scriptLanguage', () => {
  const output = runBuilder({
    series: {
      title: 'US Drama',
      scriptLanguage: 'en-US',
      format: { episodeCount: 1, episodeDurationSeconds: 60 },
    },
    episodes: [{
      no: 1,
      title: 'Pilot',
      rhythmManifest: {
        version: '1.1',
        episode: 1,
        durationSec: 60,
        scriptLanguage: 'en-US',
        rhythmPreset: 'na_micro_drama',
        beats: [{ beatId: 'E01-B01', atSec: 0, type: 'cold_open', goal: 'Hook' }],
        shots: [{
          shotId: 'E01-S01',
          beatId: 'E01-B01',
          index: 1,
          startSec: 0,
          endSec: 15,
          durationSec: 15,
          narrativeFunction: 'Hook',
          openingShot: 'Wide',
          endingShot: 'Close',
          dialogue: [{ speaker: 'OLIVIA', line: 'That seat is not mine.' }],
        }],
      },
    }],
  });
  const ctx = JSON.parse(output.workflowRun.data.ctxSnapshot);
  assert.equal(ctx.storyboard.scriptLanguage, 'en-US');
  assert.match(ctx.storyboard.scenes[0].dialogue, /OLIVIA: That seat is not mine/);
});
