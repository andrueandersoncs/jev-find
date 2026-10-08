# jev-find

A research CLI that searches Wikipedia or local files, then uses [TypeSafe's Jev](https://docs.typesafe.ai/introduction) to judge whether the retrieved passages answer your question.

Built with TypeScript, [Bun](https://bun.sh), [Effect](https://effect.website), and the TypeSafe JavaScript SDK. It prints ranked source passages and an evidence verdict—not a generated prose answer.

## Setup

Requirements:

- Bun; the commands below were verified with Bun 1.4.2.
- A [TypeSafe API key](https://console.typesafe.ai/keys).
- Internet access for evidence ranking, including when searching local files.

```sh
git clone https://github.com/andrueandersoncs/jev-find.git
cd jev-find
bun install --frozen-lockfile
```

Create a `.env` file in the project root and replace the placeholder with your API key:

```dotenv
TYPESAFE_API_KEY=your-api-key
```

Bun loads `.env` automatically. You can also set `TYPESAFE_API_KEY` in your shell environment. `.env` is ignored by Git; do not commit credentials.

## Usage

Run commands from the project root.

### Search Wikipedia

Without `--file`, the CLI searches English Wikipedia and retrieves introductory text from matching articles:

```sh
bun run index.ts "What causes ocean tides?"
```

### Search a local file

```sh
bun run index.ts --file src/search/fileSearchLive.ts "Which directories does local file search skip?"
```

### Search directories or multiple paths

Repeat `--file` to include multiple files or directories. Directories are searched recursively. Providing any `--file` paths replaces Wikipedia search; the two modes are not combined.

```sh
bun run index.ts --file src/search --file src/research "How are candidate passages selected?"
```

### Options

| Option | Behavior |
| --- | --- |
| `--file <path>`, `-f <path>` | Search a local file or directory. Repeat to include additional paths. |
| `--help`, `-h` | Print usage. |
| `--` | Stop parsing options; treat subsequent arguments as question text. |

```sh
bun run index.ts --help
```

The question is required. Quote it to keep the command easy to read; separate positional arguments are joined with spaces.

## Results

The CLI prints:

- The research question.
- An evidence verdict and the model's estimated probability that at least one selected passage directly answers the question.
- Up to five passages, ordered by relevance, with a source title or file path, a URL, and the original text.

Wikipedia citations use article URLs; local citations use `file://` URLs. Each passage's relevance is the model's estimated probability that it contains a specific answer, not just a discussion of the same topic.

The verdict labels use these thresholds:

| Evidence probability | Verdict |
| --- | --- |
| At least `0.70` | `direct evidence found` |
| At least `0.35`, below `0.70` | `partial evidence found` |
| Below `0.35` | `no direct evidence found` |

These are model judgments about the retrieved passages, not guarantees of factual correctness or exhaustive coverage. Inspect the cited sources.

## How it works

1. Retrieve up to eight sources from Wikipedia or lexical matches in the supplied local paths.
2. Select up to three passages per source using query-term overlap, for at most 24 candidate passages.
3. Send the question and candidate passages to TypeSafe in one request. Jev evaluates a yes/no probability for each passage and for whether any passage answers the question.
4. Sort passages by their returned probabilities and print the evidence verdict and highest-ranked passages.

Lexical retrieval happens before semantic ranking: relevant text that never reaches the candidate set cannot be recovered by Jev.

### Local search limits and privacy

- Discovery stops after 500 files across the supplied paths.
- Empty files, files larger than 1,000,000 bytes, and files containing NUL bytes are skipped. Remaining files are decoded as UTF-8 text; there is no PDF or other document-format extraction.
- Text is split into chunks of at most 900 characters; chunks shorter than 20 characters are discarded.
- Directory traversal skips `.git` and `node_modules`. It does **not** honor `.gitignore` or exclude other hidden files, including `.env`.

**Local search is not offline or private-only:** selected passages, source titles, source URLs, and your question are sent to the TypeSafe API. Choose explicit, non-sensitive files or directories rather than pointing the CLI at a tree containing credentials or confidential data.

## Configuration and errors

| Environment variable | Purpose |
| --- | --- |
| `TYPESAFE_API_KEY` | Required TypeSafe API credential. |
| `WIKIPEDIA_API_URL` | Optional MediaWiki API endpoint override. Defaults to `https://en.wikipedia.org/w/api.php`. |

Failures are written to stderr with a `jev-find:` prefix and a nonzero exit code. Check the API key and network access for ranking failures, supplied paths for file errors, and query terms if no results or readable passages are found. A low evidence probability is a result, not an execution error.

## Project layout

- [`index.ts`](index.ts): CLI entrypoint and search-mode selection.
- [`src/cli/`](src/cli/): argument parsing and terminal output.
- [`src/search/`](src/search/): shared search contract, Wikipedia retrieval, and local file search.
- [`src/research/`](src/research/): lexical scoring and candidate passage selection.
- [`src/evidence/`](src/evidence/): TypeSafe requests, response decoding, and evidence ranking.
