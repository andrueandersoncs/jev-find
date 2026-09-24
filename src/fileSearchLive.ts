import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Effect, Layer } from "effect";

import { lexicalScore, queryTerms } from "./lexicalSearch.ts";
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
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

interface ScoredFile {
  readonly path: string;
  readonly score: number;
  readonly result: SearchResult;
}

const discoverFiles = async (roots: ReadonlyArray<string>) => {
  const files: Array<string> = [];
  const pending = roots.map((root) => resolve(root));
  let cursor = 0;

  while (cursor < pending.length && files.length < MAX_DISCOVERED_FILES) {
    const path = pending[cursor];
    cursor += 1;

    if (path === undefined) {
      continue;
    }

    const metadata = await stat(path);

    if (metadata.isFile()) {
      files.push(path);
      continue;
    }

    if (!metadata.isDirectory()) {
      continue;
    }

    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (files.length >= MAX_DISCOVERED_FILES) {
        break;
      }

      const entryPath = resolve(path, entry.name);

      if (entry.isFile()) {
        files.push(entryPath);
      } else if (
        entry.isDirectory() &&
        !SKIPPED_DIRECTORIES.has(entry.name)
      ) {
        pending.push(entryPath);
      }
    }
  }

  return files;
};

const isBinary = (content: Buffer) => content.includes(0);

const filePassages = (content: string) => {
  const normalized = content.replace(/\r\n?/g, "\n").trim();
  const passages: Array<string> = [];

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

const scoreFile = async (
  path: string,
  terms: ReadonlyArray<string>,
): Promise<ScoredFile | undefined> => {
  const metadata = await stat(path);

  if (metadata.size <= 0 || metadata.size > MAX_FILE_BYTES) {
    return undefined;
  }

  const bytes = await readFile(path);

  if (isBinary(bytes)) {
    return undefined;
  }

  const content = bytes.toString("utf8");
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

const compareScoredFiles = (left: ScoredFile, right: ScoredFile) =>
  right.score - left.score || left.path.localeCompare(right.path);

const searchFiles = async (
  roots: ReadonlyArray<string>,
  query: string,
) => {
  const terms = queryTerms(query);

  if (terms.length <= 0) {
    return [];
  }

  const paths = await discoverFiles(roots);
  const scored: Array<ScoredFile> = [];

  for (const path of paths) {
    const candidate = await scoreFile(path, terms);

    if (candidate !== undefined) {
      scored.push(candidate);
    }
  }

  scored.sort(compareScoredFiles);

  return scored.slice(0, MAX_RESULTS).map(({ result }) => result);
};

const searchFailure = (cause: unknown) =>
  SearchError.make({ detail: `files: ${String(cause)}` });

const makeFileSearch = (roots: ReadonlyArray<string>): SearchService => ({
  search: (query) =>
    Effect.tryPromise({
      try: () => searchFiles(roots, query),
      catch: searchFailure,
    }),
});

export const fileSearchLayer = (roots: ReadonlyArray<string>) =>
  Layer.succeed(Search, makeFileSearch(roots));
