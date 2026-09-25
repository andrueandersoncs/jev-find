import { Array, HashSet } from "effect";

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

export const lexicalScore = (
  text: string,
  terms: ReadonlyArray<string>,
) => {
  const haystack = text.toLowerCase();
  const matches = Array.reduce(
    terms,
    0,
    (count, term) => count + Number(haystack.includes(term)),
  );

  return matches / Math.max(terms.length, 1);
};
