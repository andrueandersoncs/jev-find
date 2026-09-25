import {
  Array,
  Equivalence,
  Function,
  Option,
  Schema,
  Tuple,
} from "effect";

import { SearchResult } from "./search.ts";

import {
  WikipediaExtractResponseSchema,
  WikipediaSearchResponseSchema,
} from "./wikipediaProtocol.ts";

type WikipediaSearchResponse = Schema.Schema.Type<
  typeof WikipediaSearchResponseSchema
>;

type WikipediaSearchQuery = NonNullable<WikipediaSearchResponse["query"]>;
type WikipediaSearchHit = NonNullable<WikipediaSearchQuery["search"]>[number];

type WikipediaExtractResponse = Schema.Schema.Type<
  typeof WikipediaExtractResponseSchema
>;

type WikipediaExtractQuery = NonNullable<WikipediaExtractResponse["query"]>;
type WikipediaPages = NonNullable<WikipediaExtractQuery["pages"]>;
type WikipediaPage = WikipediaPages[string];

const MIN_PASSAGE_LENGTH = 60;
const MAX_SOURCE_TEXT_LENGTH = 50_000;
const MAX_PASSAGE_LENGTH = 900;

const normalizeWikipediaText = (value: string) => {
  const collapsed = value.replace(/\s+/g, " ");

  return collapsed.trim();
};

const passageChunks = (text: string) => (start: number) => {
  if (start >= text.length) {
    return Option.none();
  }

  const nextStart = start + MAX_PASSAGE_LENGTH;
  const chunk = text.slice(start, nextStart).trim();
  const chunkAndNextStart = Tuple.make(chunk, nextStart);

  return Option.some(chunkAndNextStart);
};

const paragraphPassages = (paragraph: string) => {
  const text = normalizeWikipediaText(paragraph);

  return Array.unfold(0, passageChunks(text));
};

const hasPassageLength = (passage: string) =>
  passage.length >= MIN_PASSAGE_LENGTH;

const wikipediaPassages = (value: string) => {
  // Bound the plaintext extract before splitting because one oversized page could dominate CPU or allocation.
  const boundedValue = value.slice(0, MAX_SOURCE_TEXT_LENGTH);
  const paragraphs = boundedValue.split(/\n+/);
  const chunks = Array.flatMap(paragraphs, paragraphPassages);
  const readable = Array.filter(chunks, hasPassageLength);

  return Array.dedupe(readable);
};

const stripSnippetTags = (value: string) =>
  value.replace(/<[^>]*>/g, " ");

const cleanSnippet = Function.flow(
  stripSnippetTags,
  normalizeWikipediaText,
);

export const searchMatches = (response: WikipediaSearchResponse) =>
  response.query?.search ?? [];

export const suggestedQuery = (response: WikipediaSearchResponse) => {
  const searchInfo = response.query?.searchinfo;
  const candidate = searchInfo?.suggestion ?? searchInfo?.rewrittenquery ?? "";

  return cleanSnippet(candidate);
};

export const shouldSearchSuggestion = (
  query: string,
  suggestion: string,
) => {
  const normalizedSuggestion = suggestion.toLowerCase();
  const normalizedQuery = query.toLowerCase();

  const sameQuery = Equivalence.strictEqual<string>()(
    normalizedSuggestion,
    normalizedQuery,
  );

  const hasSuggestion = suggestion.length > 0;
  const changedQuery = !sameQuery;

  return hasSuggestion && changedQuery;
};

const findPage = (pages: WikipediaPages, pageId: string) =>
  Option.fromNullishOr(pages[pageId]);

const pageUrl = (page: Option.Option<WikipediaPage>, fallback: string) =>
  Option.match(page, {
    onNone: Function.constant(fallback),
    onSome: (value) => value.fullurl ?? fallback,
  });

const pageContent = (page: Option.Option<WikipediaPage>, fallback: string) =>
  Option.match(page, {
    onNone: Function.constant(fallback),
    onSome: (value) => value.extract ?? fallback,
  });

export const searchResult = (
  pages: WikipediaPages,
  match: WikipediaSearchHit,
) => {
  const pageId = String(match.pageid);
  const page = findPage(pages, pageId);
  const description = cleanSnippet(match.snippet ?? "");
  const fallbackUrl = `https://en.wikipedia.org/?curid=${pageId}`;
  const url = pageUrl(page, fallbackUrl);
  const content = pageContent(page, description);
  const passages = wikipediaPassages(content);
  const title = cleanSnippet(match.title);

  return SearchResult.make({ title, url, description, passages });
};
