import { Array, HashSet, Tuple } from "effect";

import { STOP_WORDS } from "./stopWords.ts";

const usefulQueryTerm = (term: string) => {
  const hasLength = term.length > 2;
  const isStopWord = HashSet.has(STOP_WORDS, term);

  return hasLength && !isStopWord;
};

export const queryTerms = (query: string) => {
  const normalized = query.toLowerCase();
  const terms = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const usefulTerms = Array.filter(terms, usefulQueryTerm);

  return Array.dedupe(usefulTerms);
};

const makeTermContext = (haystack: string) => (term: string) =>
  Tuple.make(haystack, term);

const countMatchingTerm = (
  score: number,
  [haystack, term]: readonly [string, string],
) => (haystack.includes(term) ? score + 1 : score);

export const lexicalScore = (
  text: string,
  terms: ReadonlyArray<string>,
) => {
  const haystack = text.toLowerCase();
  const contexts = Array.map(terms, makeTermContext(haystack));
  const matches = Array.reduce(contexts, 0, countMatchingTerm);
  const termCount = Math.max(terms.length, 1);

  return matches / termCount;
};
