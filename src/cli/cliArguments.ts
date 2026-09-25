import { Array, Effect, Schema } from "effect";

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

class InvalidCliArgumentsError extends Schema.TaggedError<InvalidCliArgumentsError>()(
  "InvalidCliArgumentsError",
  { detail: Schema.String },
) {}

const isFileFlag = (argument: string) =>
  Array.contains(FILE_FLAGS, argument);

const isHelpFlag = (argument: string) =>
  Array.contains(HELP_FLAGS, argument);

export const cliInputFromArgv = Effect.fn("CliArguments.fromArgv")(function* (
  argv: ReadonlyArray<string>,
) {
  const cliArguments = yield* decodeCliArguments(argv);
  const endOptionsIndex = cliArguments.indexOf(END_OPTIONS, 2);
  const filePaths: Array<string> = [];
  const queryParts: Array<string> = [];

  for (let index = 2; index < cliArguments.length; index += 1) {
    const argument = cliArguments[index];

    if (argument === undefined) {
      continue;
    }

    if (index === endOptionsIndex) {
      continue;
    }

    const parseOptions = endOptionsIndex < 0 || index < endOptionsIndex;

    if (parseOptions && isHelpFlag(argument)) {
      return CliInput.make({ query: "", filePaths, help: true });
    }

    if (parseOptions && isFileFlag(argument)) {
      const filePath = cliArguments[index + 1];

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
