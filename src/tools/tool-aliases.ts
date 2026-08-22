/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    dp[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

export function suggestSimilarKeys(
  input: string,
  candidates: readonly string[],
  limit = 3,
): string[] {
  const lowerInput = input.toLowerCase();
  const threshold = Math.max(3, Math.floor(input.length / 2));

  const scored: Array<{key: string; dist: number}> = [];
  for (const cand of candidates) {
    const dist = levenshtein(lowerInput, cand.toLowerCase());
    if (dist <= threshold) {
      scored.push({key: cand, dist});
    }
  }
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, limit).map(s => s.key);
}
