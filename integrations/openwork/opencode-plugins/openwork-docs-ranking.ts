export type OpenWorkDocsSearchEntry = {
  path: string;
  title: string | null;
  description: string | null;
  content: string;
};

export type RankedOpenWorkDoc<T extends OpenWorkDocsSearchEntry = OpenWorkDocsSearchEntry> = {
  entry: T;
  score: number;
  coverage: number;
  matchedTerms: string[];
};

const QUERY_NOISE_TERMS = new Set([
  "a",
  "an",
  "and",
  "doc",
  "docs",
  "documentation",
  "for",
  "how",
  "in",
  "of",
  "openwork",
  "please",
  "the",
  "to",
  "wodeapp",
  "wodeappx",
  "文档",
  "接口",
  "请",
  "怎么",
  "如何",
]);

function normalizedText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export function openWorkDocsQueryTerms(query: string): string[] {
  const matches = normalizedText(query).match(/[\p{Script=Han}]+|[\p{L}\p{N}][\p{L}\p{N}._/-]*/gu) ?? [];
  return matches
    .map((term) => term.replace(/^[._/-]+|[._/-]+$/g, ""))
    .filter((term) => term.length >= 2 && !QUERY_NOISE_TERMS.has(term))
    .filter((term, index, terms) => terms.indexOf(term) === index);
}

function includesTerm(value: string, term: string): boolean {
  return value.includes(term);
}

export function rankOpenWorkDocs<T extends OpenWorkDocsSearchEntry>(
  entries: T[],
  query: string,
  limit = 5,
): Array<RankedOpenWorkDoc<T>> {
  const terms = openWorkDocsQueryTerms(query);
  if (!terms.length) return [];

  return entries
    .map((entry): RankedOpenWorkDoc<T> | null => {
      const path = normalizedText(entry.path);
      const title = normalizedText(entry.title ?? "");
      const description = normalizedText(entry.description ?? "");
      const content = normalizedText(entry.content);
      const matchedTerms: string[] = [];
      let score = 0;
      let strongMatches = 0;

      for (const term of terms) {
        let matched = false;
        if (includesTerm(path, term)) {
          score += 8;
          strongMatches += 1;
          matched = true;
        }
        if (includesTerm(title, term)) {
          score += 6;
          strongMatches += 1;
          matched = true;
        }
        if (includesTerm(description, term)) {
          score += 4;
          strongMatches += 1;
          matched = true;
        }
        if (includesTerm(content, term)) {
          score += 1;
          matched = true;
        }
        if (matched) matchedTerms.push(term);
      }

      const coverage = matchedTerms.length / terms.length;
      const relevant = terms.length === 1
        ? strongMatches > 0
        : matchedTerms.length >= 2 && coverage >= 0.5;
      if (!relevant) return null;

      return {
        entry,
        score,
        coverage,
        matchedTerms,
      };
    })
    .filter((match): match is RankedOpenWorkDoc<T> => match !== null)
    .sort((a, b) =>
      b.coverage - a.coverage
      || b.score - a.score
      || a.entry.path.localeCompare(b.entry.path),
    )
    .slice(0, Math.max(1, limit));
}
