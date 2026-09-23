import {
  Array,
  HashSet,
  Order,
  pipe,
  Schema,
  Tuple,
} from "effect";

import { type SearchResult } from "./searchResult.ts";

import { STOP_WORDS } from "./stopWords.ts";

const PASSAGES_PER_SOURCE = 3;
const MAX_RESEARCH_SOURCES = 8;

export class Passage extends Schema.Class<Passage>("Passage")({
  id: Schema.String,
  title: Schema.String,
  url: Schema.String,
  description: Schema.String,
  text: Schema.String,
}) {}

class Candidate extends Schema.Class<Candidate>("Candidate")({
  title: Schema.String,
  url: Schema.String,
  description: Schema.String,
  text: Schema.String,
}) {}

class ScoredText extends Schema.Class<ScoredText>("ScoredText")({
  text: Schema.String,
  order: Schema.Number,
  score: Schema.Number,
}) {}

const usefulQueryTerm = (term: string) => {
  const hasLength = term.length > 2;
  const isStopWord = HashSet.has(STOP_WORDS, term);
  const usefulTerm = !isStopWord;

  return hasLength && usefulTerm;
};

const queryTerms = (query: string) => {
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

const lexicalScore = (text: string, terms: ReadonlyArray<string>) => {
  const haystack = text.toLowerCase();
  const contexts = Array.map(terms, makeTermContext(haystack));
  const matches = Array.reduce(contexts, 0, countMatchingTerm);
  const termCount = Math.max(terms.length, 1);

  return matches / termCount;
};

const scoreText = (
  terms: ReadonlyArray<string>,
) => (text: string, order: number) => {
  const score = lexicalScore(text, terms);

  return ScoredText.make({ text, order, score });
};

const scoredTextOrder = Order.make<ScoredText>((left, right) => {
  const scoreOrder = Order.Number(right.score, left.score);
  const originalOrder = Order.Number(left.order, right.order);

  return scoreOrder || originalOrder;
});

const makeCandidate = (result: SearchResult) => (scored: ScoredText) =>
  Candidate.make({
    ...result,
    text: scored.text,
  });

const rankSourcePassages = (
  result: SearchResult,
  terms: ReadonlyArray<string>,
) => (pagePassages: ReadonlyArray<string>) => {
  const pool = result.description
    ? Array.prepend(pagePassages, result.description)
    : pagePassages;

  const scored = Array.map(pool, scoreText(terms));
  const sorted = Array.sort(scored, scoredTextOrder);
  const best = Array.take(sorted, PASSAGES_PER_SOURCE);

  return Array.map(best, makeCandidate(result));
};

const sourceCandidates =
  (terms: ReadonlyArray<string>) => (result: SearchResult) =>
    pipe(
      result.passages,
      rankSourcePassages(result, terms),
    );

const makePassage = (candidate: Candidate, index: number) => {
  const indexText = String(index);
  const paddedIndex = indexText.padStart(2, "0");

  return Passage.make({
    ...candidate,
    id: `P${paddedIndex}`,
  });
};

const buildPassages = (
  candidatePools: ReadonlyArray<ReadonlyArray<Candidate>>,
) => {
  const candidates = Array.flatten(candidatePools);

  return Array.map(candidates, makePassage);
};

export const collectCandidates = (
  query: string,
  results: ReadonlyArray<SearchResult>,
) => {
  const selectedResults = Array.take(results, MAX_RESEARCH_SOURCES);
  const terms = queryTerms(query);

  const candidatePools = Array.map(
    selectedResults,
    sourceCandidates(terms),
  );

  return buildPassages(candidatePools);
};
