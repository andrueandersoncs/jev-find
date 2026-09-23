import {
  Array,
  Console,
  Effect,
  pipe,
  Schema,
} from "effect";

import { FetchHttpClient } from "effect/unstable/http";

import { EvidenceRanker } from "./src/evidence.ts";
import { EvidenceRankerLive } from "./src/evidenceLive.ts";
import { printEvidence } from "./src/output.ts";
import { collectCandidates } from "./src/research.ts";
import { WikipediaSearch } from "./src/wikipedia.ts";
import { WikipediaLive } from "./src/wikipediaLive.ts";

const USAGE = 'Usage: bun run index.ts "research question"';
const CliArgumentsSchema = Schema.Array(Schema.String);
const decodeCliArguments = Schema.decodeUnknownEffect(CliArgumentsSchema);

class MissingResearchQuestionError extends Schema.TaggedError<MissingResearchQuestionError>()(
  "MissingResearchQuestionError",
  { detail: Schema.String },
) {}

class NoSearchResultsError extends Schema.TaggedError<NoSearchResultsError>()(
  "NoSearchResultsError",
  { detail: Schema.String },
) {}

const isHelpQuery = (query: string) =>
  Array.contains(["--help", "-h"], query);

const runResearch = Effect.fn("Cli.runResearch")(function* () {
  const wikipedia = yield* WikipediaSearch;
  const evidenceRanker = yield* EvidenceRanker;
  const cliArguments = yield* decodeCliArguments(Bun.argv);
  const argumentsAfterScript = Array.drop(cliArguments, 2);
  const query = Array.join(argumentsAfterScript, " ").trim();

  if (query.length <= 0) {
    yield* Console.log(USAGE);

    return yield* MissingResearchQuestionError.make({
      detail: "A research question is required.",
    });
  }

  if (isHelpQuery(query)) {
    return yield* Console.log(USAGE);
  }

  const results = yield* wikipedia.search(query);

  if (results.length <= 0) {
    return yield* NoSearchResultsError.make({
      detail: "The search returned no results.",
    });
  }

  const passages = collectCandidates(query, results);
  const evidence = yield* evidenceRanker.rank(query, passages);

  return yield* printEvidence(query, evidence);
});

const markExecuteFailure = Effect.sync(() => (process.exitCode = 1));

const reportFailure = Effect.fn("Cli.reportFailure")(function* (
  error: unknown,
) {
  const message = String(error);

  yield* Console.error(`jev-find: ${message}`);
  yield* markExecuteFailure;
});

const program = pipe(
  runResearch(),
  Effect.provide(WikipediaLive),
  Effect.provide(EvidenceRankerLive),
  Effect.provide(FetchHttpClient.layer),
  Effect.catch(reportFailure),
);

Effect.runFork(program);
