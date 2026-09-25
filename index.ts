import { Console, Effect, pipe, Schema } from "effect";

import { FetchHttpClient } from "effect/unstable/http";

import { cliInputFromArgv } from "./src/cli/cliArguments.ts";
import { EvidenceRanker } from "./src/evidence/evidence.ts";
import { fileSearchLayer } from "./src/search/fileSearchLive.ts";
import { EvidenceRankerLive } from "./src/evidence/evidenceLive.ts";
import { printEvidence } from "./src/cli/output.ts";
import { collectCandidates } from "./src/research/research.ts";
import { Search } from "./src/search/search.ts";
import { WikipediaLive } from "./src/search/wikipediaLive.ts";

const USAGE = `Usage:
  bun run index.ts "research question"
  bun run index.ts --file <path> [--file <path> ...] "research question"`;

class MissingResearchQuestionError extends Schema.TaggedError<MissingResearchQuestionError>()(
  "MissingResearchQuestionError",
  { detail: Schema.String },
) {}

class NoSearchResultsError extends Schema.TaggedError<NoSearchResultsError>()(
  "NoSearchResultsError",
  { detail: Schema.String },
) {}

const runResearch = Effect.fn("Cli.runResearch")(function* (query: string) {
  const search = yield* Search;
  const evidenceRanker = yield* EvidenceRanker;
  const results = yield* search.search(query);

  if (results.length <= 0) {
    return yield* NoSearchResultsError.make({
      detail: "The search returned no results.",
    });
  }

  const passages = collectCandidates(query, results);
  const evidence = yield* evidenceRanker.rank(query, passages);

  return yield* printEvidence(query, evidence);
});

const runCli = Effect.fn("Cli.run")(function* () {
  const input = yield* cliInputFromArgv(Bun.argv);

  if (input.help) {
    return yield* Console.log(USAGE);
  }

  if (input.query.length <= 0) {
    yield* Console.log(USAGE);

    return yield* MissingResearchQuestionError.make({
      detail: "A research question is required.",
    });
  }

  const searchLayer =
    input.filePaths.length > 0
      ? fileSearchLayer(input.filePaths)
      : WikipediaLive;

  return yield* pipe(
    runResearch(input.query),
    Effect.provide(searchLayer),
  );
});

const markExecuteFailure = Effect.sync(() => (process.exitCode = 1));

const failureMessage = (error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "detail" in error &&
    typeof error.detail === "string"
  ) {
    return error.detail;
  }

  return String(error);
};

const reportFailure = Effect.fn("Cli.reportFailure")(function* (
  error: unknown,
) {
  const message = failureMessage(error);

  yield* Console.error(`jev-find: ${message}`);
  yield* markExecuteFailure;
});

const program = pipe(
  runCli(),
  Effect.provide(EvidenceRankerLive),
  Effect.provide(FetchHttpClient.layer),
  Effect.catch(reportFailure),
);

Effect.runFork(program);
