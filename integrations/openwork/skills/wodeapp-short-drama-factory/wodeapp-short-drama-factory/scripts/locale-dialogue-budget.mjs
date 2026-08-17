/**
 * Locale-aware dialogue and prompt budgets for short-drama manifests.
 */

export const LOCALE_ZH_CN = 'zh-CN';
export const LOCALE_EN_US = 'en-US';

export function normalizeLocale(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return LOCALE_ZH_CN;
  if (raw.startsWith('en') || raw === 'us' || raw === 'na') return LOCALE_EN_US;
  if (raw.startsWith('zh') || raw === 'cn') return LOCALE_ZH_CN;
  return value;
}

export function resolveScriptLanguage(spec = {}) {
  const series = spec.series || {};
  const project = spec.project || {};
  const explicit = series.scriptLanguage
    || series.promptLanguage
    || series.locale
    || project.scriptLanguage
    || project.locale;
  if (explicit) return normalizeLocale(explicit);

  const market = String(series.targetMarket || '').toLowerCase();
  if (
    market.includes('north america')
    || market.includes('united states')
    || market.includes('u.s.')
    || market.includes('english')
    || market.includes('reelshort')
    || market.includes('dramabox')
  ) {
    return LOCALE_EN_US;
  }
  return LOCALE_ZH_CN;
}

export function deriveDialogueBudget(durationSec, locale = LOCALE_ZH_CN) {
  const duration = Number(durationSec) || 15;
  if (locale === LOCALE_EN_US) {
    if (duration <= 8) return { max: 12, unit: 'words' };
    if (duration <= 15) return { max: 28, unit: 'words' };
    if (duration <= 24) return { max: 50, unit: 'words' };
    return { max: 60, unit: 'words' };
  }
  if (duration <= 8) return { max: 25, unit: 'chars' };
  if (duration <= 15) return { max: 45, unit: 'chars' };
  if (duration <= 24) return { max: 80, unit: 'chars' };
  return { max: 100, unit: 'chars' };
}

export function derivePromptBudget(durationSec, locale = LOCALE_ZH_CN) {
  const duration = Number(durationSec) || 15;
  if (locale === LOCALE_EN_US) {
    if (duration <= 8) return { compactMin: 50, compactMax: 90, expandedMin: 120, expandedMax: 180, unit: 'words' };
    if (duration <= 15) return { compactMin: 80, compactMax: 140, expandedMin: 160, expandedMax: 260, unit: 'words' };
    return { compactMin: 100, compactMax: 180, expandedMin: 200, expandedMax: 320, unit: 'words' };
  }
  if (duration <= 8) return { compactMin: 80, compactMax: 140, expandedMin: 180, expandedMax: 260, unit: 'chars' };
  if (duration <= 15) return { compactMin: 120, compactMax: 220, expandedMin: 260, expandedMax: 420, unit: 'chars' };
  return { compactMin: 160, compactMax: 280, expandedMin: 300, expandedMax: 480, unit: 'chars' };
}

export function countSpokenUnits(text, locale = LOCALE_ZH_CN) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 0;
  if (locale === LOCALE_EN_US) {
    return trimmed.split(/\s+/).filter(Boolean).length;
  }
  const cjk = trimmed.match(/[\u4e00-\u9fff]/g);
  const latinWords = trimmed.match(/[A-Za-z']+/g);
  return (cjk?.length || 0) + (latinWords?.length || 0);
}

export function extractShotDialogueText(shot = {}) {
  if (Array.isArray(shot.dialogue)) {
    return shot.dialogue
      .map((line) => {
        if (!line || typeof line !== 'object') return String(line || '');
        return String(line.line || '');
      })
      .filter(Boolean)
      .join(' ');
  }
  return String(shot.dialogue || shot.spokenLine || '');
}

export function formatDialogueLine(speaker, line, locale = LOCALE_ZH_CN) {
  const text = String(line || '').trim();
  if (!text) return '';
  const name = String(speaker || '').trim();
  if (!name) return text;
  const sep = locale === LOCALE_EN_US ? ': ' : '：';
  return `${name}${sep}${text}`;
}

export function validateShotDialogueBudget(shot, locale = LOCALE_ZH_CN) {
  const durationSec = Number(shot.durationSec) || 15;
  const budget = shot.dialogueWordBudget && typeof shot.dialogueWordBudget === 'object'
    ? shot.dialogueWordBudget
    : deriveDialogueBudget(durationSec, locale);
  const max = Number(budget.max);
  const spoken = countSpokenUnits(extractShotDialogueText(shot), locale);
  if (spoken > max) {
    const label = shot.shotId || `shot index ${shot.index || '?'}`;
    return {
      ok: false,
      shotId: shot.shotId,
      spoken,
      max,
      unit: budget.unit || (locale === LOCALE_EN_US ? 'words' : 'chars'),
      message: `${label}: spoken dialogue ${spoken} ${budget.unit || 'units'} exceeds budget ${max} for ${durationSec}s (${locale})`,
    };
  }
  return { ok: true, spoken, max, unit: budget.unit };
}

export function validateManifestDialogue(manifest, locale = LOCALE_ZH_CN) {
  const shots = Array.isArray(manifest?.shots) ? manifest.shots : [];
  const failures = [];
  for (const shot of shots) {
    const result = validateShotDialogueBudget(shot, locale);
    if (!result.ok) failures.push(result);
  }
  return failures;
}

export function recommendedRhythmPreset(locale = LOCALE_ZH_CN, genre = []) {
  const tags = Array.isArray(genre) ? genre.map((g) => String(g).toLowerCase()) : [];
  if (locale === LOCALE_EN_US) {
    if (tags.some((g) => g.includes('thriller') || g.includes('mystery') || g.includes('legal'))) {
      return 'suspense_ladder';
    }
    if (tags.some((g) => g.includes('romance') || g.includes('werewolf') || g.includes('billionaire'))) {
      return 'na_micro_drama';
    }
    return 'na_micro_drama';
  }
  return 'hongguo爽剧';
}
