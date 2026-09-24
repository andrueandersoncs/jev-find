import {
  Array,
  Console,
  Effect,
  pipe,
  Schema,
} from "effect";

import { FetchHttpClient } from "effect/unstable/http";

import { EvidenceRanker } from "./src/evidence.ts";
import { fileSearchLayer } from "./src/fileSearchLive.ts";
import { EvidenceRankerLive } from "./src/evidenceLive.ts";
import { printEvidence } from "./src/output.ts";
import { collectCandidates } from "./src/research.ts";
import { Search } from "./src/search.ts";
import { WikipediaLive } from "./src/wikipediaLive.ts";

const USAGE = `Usage:
  bun run index.ts "research question"
  bun run index.ts --file <path> [--file <path> ...] "research question"`;
const FILE_FLAGS = ["--file", "-f"] as const;
const HELP_FLAGS = ["--help", "-h"] as const;
const END_OPTIONS = "--";
const CliArgumentsSchema = Schema.Array(Schema.String);
const decodeCliArguments = Schema.decodeUnknownEffect(CliArgumentsSchema);

class CliInput extends Schema.Class<CliInput>("CliInput")({
  query: Schema.String,
  filePaths: Schema.Array(Schema.String),
  help: Schema.Boolean,
}) {}

class MissingResearchQuestionError extends Schema.TaggedError<MissingResearchQuestionError>()(
  "MissingResearchQuestionError",
  { detail: Schema.String },
) {}

class InvalidCliArgumentsError extends Schema.TaggedError<InvalidCliArgumentsError>()(
  "InvalidCliArgumentsError",
  { detail: Schema.String },
) {}

class NoSearchResultsError extends Schema.TaggedError<NoSearchResultsError>()(
  "NoSearchResultsError",
  { detail: Schema.String },
) {}


const isFileFlag = (argument: string) =>
  Array.contains(FILE_FLAGS, argument);

const isHelpFlag = (argument: string) =>
  Array.contains(HELP_FLAGS, argument);

const parseArguments = Effect.fn("Cli.parseArguments")(function* (
  argumentsAfterScript: ReadonlyArray<string>,
) {
  const filePaths: Array<string> = [];
  const queryParts: Array<string> = [];
  let parseOptions = true;

  for (let index = 0; index < argumentsAfterScript.length; index += 1) {
    const argument = argumentsAfterScript[index];

    if (argument === undefined) {
      continue;
    }

    if (parseOptions && argument === END_OPTIONS) {
      parseOptions = false;
      continue;
    }

    if (parseOptions && isHelpFlag(argument)) {
      return CliInput.make({ query: "", filePaths, help: true });
    }

    if (parseOptions && isFileFlag(argument)) {
      const filePath = argumentsAfterScript[index + 1];

      if (
        filePath === undefined ||
        filePath === END_OPTIONS ||
        isFileFlag(filePath) ||
        isHelpFlag(filePath)
      ) {
        return yield* InvalidCliArgumentsError.make({
          detail: `${argument} requires a file or directory path.`,
        });
      }

      filePaths.push(filePath);
      index += 1;
      continue;
    }

    queryParts.push(argument);
  }

  const query = queryParts.join(" ").trim();

  return CliInput.make({ query, filePaths, help: false });
});

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
  const cliArguments = yield* decodeCliArguments(Bun.argv);
  const argumentsAfterScript = Array.drop(cliArguments, 2);
  const input = yield* parseArguments(argumentsAfterScript);

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
