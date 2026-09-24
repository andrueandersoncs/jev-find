import { Array, Config, Effect, Layer, pipe } from "effect";

import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import {
  searchMatches,
  searchResult,
  shouldSearchSuggestion,
  suggestedQuery,
} from "./wikipediaResponse.ts";

import {
  WikipediaExtractResponseSchema,
  WikipediaSearchResponseSchema,
} from "./wikipediaProtocol.ts";

import {
  Search,
  SearchError,
  type SearchService,
} from "./search.ts";

type WikipediaSearchHit = ReturnType<typeof searchMatches>[number];
type WikipediaPages = Parameters<typeof searchResult>[0];

const REQUEST_TIMEOUT = "10 seconds";
const DEFAULT_API_URL = new URL("https://en.wikipedia.org/w/api.php");
const MAX_SEARCH_RESULTS = 8;

const resultForPages =
  (pages: WikipediaPages) => (match: WikipediaSearchHit) =>
    searchResult(pages, match);

const searchUrl = (apiUrl: URL, query: string) => {
  const limit = String(MAX_SEARCH_RESULTS);

  const parameters = new URLSearchParams([
    ["action", "query"],
    ["list", "search"],
    ["srsearch", query],
    ["srlimit", limit],
    ["srinfo", "suggestion|rewrittenquery"],
    ["srprop", "snippet"],
    ["utf8", "1"],
    ["format", "json"],
  ]);

  const serialized = parameters.toString();

  return new URL(`?${serialized}`, apiUrl);
};

const searchMatchPageId = (match: WikipediaSearchHit) => String(match.pageid);

const extractUrl = (
  apiUrl: URL,
  matches: ReadonlyArray<WikipediaSearchHit>,
) => {
  const pageIds = Array.map(matches, searchMatchPageId);
  const joinedPageIds = Array.join(pageIds, "|");

  const parameters = new URLSearchParams([
    ["action", "query"],
    ["prop", "extracts|info"],
    ["pageids", joinedPageIds],
    ["explaintext", "1"],
    ["exintro", "1"],
    ["inprop", "url"],
    ["redirects", "1"],
    ["format", "json"],
  ]);

  const serialized = parameters.toString();

  return new URL(`?${serialized}`, apiUrl);
};

const makeRequest = (url: URL) =>
  pipe(
    HttpClientRequest.get(url),
    HttpClientRequest.setHeader("Accept", "application/json"),
    HttpClientRequest.setHeader("User-Agent", "jev-find/1.0 research CLI"),
  );

const wikipediaResponse = Effect.fn("Wikipedia.response")(function* <E>(
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
  onFailure: (cause: unknown) => E,
) {
  return yield* pipe(
    client.execute(request),
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.mapError(onFailure),
  );
});

const wikipediaFailure = (stage: string) => (cause: unknown) => {
  const causeText = String(cause);
  const detail = `${stage}: ${causeText}`;

  return SearchError.make({ detail });
};

const searchFailure = wikipediaFailure("search");
const extractFailure = wikipediaFailure("extract");

const requestSearch = Effect.fn("Wikipedia.requestSearch")(function* (
  client: HttpClient.HttpClient,
  apiUrl: URL,
  query: string,
) {
  const url = searchUrl(apiUrl, query);
  const request = makeRequest(url);

  const response = yield* wikipediaResponse(
    client,
    request,
    searchFailure,
  );

  const decode = HttpClientResponse.schemaBodyJson(
    WikipediaSearchResponseSchema,
  );

  return yield* pipe(decode(response), Effect.mapError(searchFailure));
});

const requestExtracts = Effect.fn("Wikipedia.requestExtracts")(function* (
  client: HttpClient.HttpClient,
  apiUrl: URL,
  matches: ReadonlyArray<WikipediaSearchHit>,
) {
  const url = extractUrl(apiUrl, matches);
  const request = makeRequest(url);

  const response = yield* wikipediaResponse(
    client,
    request,
    extractFailure,
  );

  const decode = HttpClientResponse.schemaBodyJson(
    WikipediaExtractResponseSchema,
  );

  return yield* pipe(decode(response), Effect.mapError(extractFailure));
});

const makeWikipedia = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;

  const apiUrl = yield* pipe(
    Config.URL("WIKIPEDIA_API_URL"),
    Config.withDefault(DEFAULT_API_URL),
  );

  const search = Effect.fn("Wikipedia.search")(function* (query: string) {
    const initialResponse = yield* requestSearch(client, apiUrl, query);
    const suggestion = suggestedQuery(initialResponse);

    const selectedResponse = yield* (shouldSearchSuggestion(query, suggestion)
      ? requestSearch(client, apiUrl, suggestion)
      : Effect.succeed(initialResponse));

    const matches = searchMatches(selectedResponse);
    const selectedMatches = Array.take(matches, MAX_SEARCH_RESULTS);

    if (selectedMatches.length <= 0) {
      return [];
    }

    const extractResponse = yield* requestExtracts(
      client,
      apiUrl,
      selectedMatches,
    );

    const pages = extractResponse.query?.pages ?? {};
    const results = Array.map(selectedMatches, resultForPages(pages));

    return yield* Effect.all(results);
  });

  return { search } satisfies SearchService;
});

export const WikipediaLive = Layer.effect(Search)(makeWikipedia);
