import {
  Array,
  Console,
  Effect,
  Function,
  Match,
  pipe,
} from "effect";

import {
  type RankedEvidence,
  type RankedPassage,
} from "../evidence/evidence.ts";

const DISPLAYED_PASSAGES = 5;
const DISCARD_RESULTS = { discard: true } as const;

const hasDirectEvidence = (probability: number) => probability >= 0.7;
const hasPartialEvidence = (probability: number) => probability >= 0.35;
const directEvidenceVerdict = Function.constant("direct evidence found");
const partialEvidenceVerdict = Function.constant("partial evidence found");
const missingEvidenceVerdict = Function.constant("no direct evidence found");

const formatNumberAsEvidenceVerdict = (probability: number) =>
  pipe(
    Match.value(probability),
    Match.when(hasDirectEvidence, directEvidenceVerdict),
    Match.when(hasPartialEvidence, partialEvidenceVerdict),
    Match.orElse(missingEvidenceVerdict),
  );

const renderRankedPassage = (passage: RankedPassage, index: number) => {
  const relevance = passage.relevance.toFixed(2);
  const heading = `${index + 1}. ${passage.title} · relevance ${relevance}`;

  return `${heading}\n   ${passage.url}\n   ${passage.text}\n`;
};

export const printEvidence = Effect.fn("Output.printEvidence")(function* (
  query: string,
  evidence: RankedEvidence,
) {
  const probability = evidence.exists.toFixed(2);
  const verdict = formatNumberAsEvidenceVerdict(evidence.exists);
  const heading = `\n${query}\n${verdict} (${probability})\n`;
  const selected = Array.take(evidence.ranked, DISPLAYED_PASSAGES);
  const formattedPassages = Array.map(selected, renderRankedPassage);

  yield* Console.log(heading);
  yield* Effect.forEach(formattedPassages, Console.log, DISCARD_RESULTS);
});
