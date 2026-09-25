import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Effect, Layer } from "effect";

import { lexicalScore, queryTerms } from "../research/lexicalSearch.ts";
import {
  Search,
  SearchError,
  SearchResult,
  type SearchService,
} from "./search.ts";

const MAX_DISCOVERED_FILES = 500;
const MAX_FILE_BYTES = 1_000_000;
const MAX_RESULTS = 8;
const MAX_PASSAGE_LENGTH = 900;
const MIN_PASSAGE_LENGTH = 20;
const SKIPPED_DIRECTORIES: Readonly<Record<string, true>> = {
  ".git": true,
  node_modules: true,
};

interface ScoredFile {
  readonly path: string;
  readonly score: number;
  readonly result: SearchResult;
}

const searchFailure = (cause: unknown) =>
  SearchError.make({ detail: `files: ${String(cause)}` });

const fileMetadata = (path: string) =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: searchFailure,
  });

const directoryEntries = (path: string) =>
  Effect.tryPromise({
    try: () => readdir(path, { withFileTypes: true }),
    catch: searchFailure,
  });

const fileBytes = (path: string) =>
  Effect.tryPromise({
    try: () => readFile(path),
    catch: searchFailure,
  });

const orderedSearchableEntries = (entries: ReadonlyArray<Dirent>) =>
  entries
    .filter(
      (entry) =>
        entry.isFile() ||
        (entry.isDirectory() &&
          !Object.hasOwn(SKIPPED_DIRECTORIES, entry.name)),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

const discoverFiles = Effect.fn("FileSearch.discoverFiles")(function* (
  roots: ReadonlyArray<string>,
) {
  const files: string[] = [];
  const pending = roots.map((root) => resolve(root));
  let cursor = 0;

  while (cursor < pending.length && files.length < MAX_DISCOVERED_FILES) {
    const path = pending[cursor]!;
    cursor += 1;

    const metadata = yield* fileMetadata(path);

    if (metadata.isFile()) {
      files.push(path);
      continue;
    }

    if (!metadata.isDirectory()) {
      continue;
    }

    const entries = orderedSearchableEntries(yield* directoryEntries(path));

    for (const entry of entries) {
      if (files.length >= MAX_DISCOVERED_FILES) {
        break;
      }

      const entryPath = resolve(path, entry.name);

      if (entry.isFile()) {
        files.push(entryPath);
      } else {
        pending.push(entryPath);
      }
    }
  }

  return files;
});

const isBinary = (content: Buffer) => content.includes(0);

const filePassages = (content: string): string[] => {
  const normalized = content.replace(/\r\n?/g, "\n").trim();
  const passages: string[] = [];

  for (let start = 0; start < normalized.length; start += MAX_PASSAGE_LENGTH) {
    const passage = normalized.slice(start, start + MAX_PASSAGE_LENGTH).trim();

    if (passage.length >= MIN_PASSAGE_LENGTH) {
      passages.push(passage);
    }
  }

  return passages;
};

const displayPath = (path: string) => {
  const localPath = relative(process.cwd(), path);

  return localPath.startsWith("..") ? path : localPath;
};

const scoreContent = (
  path: string,
  content: string,
  terms: ReadonlyArray<string>,
): ScoredFile | undefined => {
  const score = lexicalScore(content, terms);

  if (score <= 0) {
    return undefined;
  }

  const passages = filePassages(content);

  if (passages.length <= 0) {
    return undefined;
  }

  return {
    path,
    score,
    result: SearchResult.make({
      title: displayPath(path),
      url: pathToFileURL(path).href,
      description: "",
      passages,
    }),
  };
};

const scoreFile = Effect.fn("FileSearch.scoreFile")(function* (
  path: string,
  terms: ReadonlyArray<string>,
) {
  const metadata = yield* fileMetadata(path);

  if (metadata.size <= 0 || metadata.size > MAX_FILE_BYTES) {
    return undefined;
  }

  const bytes = yield* fileBytes(path);

  return isBinary(bytes)
    ? undefined
    : scoreContent(path, bytes.toString("utf8"), terms);
});

const compareScoredFiles = (left: ScoredFile, right: ScoredFile) =>
  right.score - left.score || left.path.localeCompare(right.path);

const searchFiles = Effect.fn("FileSearch.searchFiles")(function* (
  roots: ReadonlyArray<string>,
  query: string,
) {
  const terms = queryTerms(query);

  if (terms.length <= 0) {
    return [];
  }

  const paths = yield* discoverFiles(roots);
  const scored: ScoredFile[] = [];

  for (const path of paths) {
    const candidate = yield* scoreFile(path, terms);

    if (candidate !== undefined) {
      scored.push(candidate);
    }
  }

  scored.sort(compareScoredFiles);
  const results: SearchResult[] = [];

  for (let index = 0; index < Math.min(scored.length, MAX_RESULTS); index++) {
    results.push(scored[index]!.result);
  }

  return results;
});

const makeFileSearch = (roots: ReadonlyArray<string>): SearchService => ({
  search: (query) => searchFiles(roots, query),
});

export const fileSearchLayer = (roots: ReadonlyArray<string>) =>
  Layer.succeed(Search, makeFileSearch(roots));
