import { Context, Effect, Schema } from "effect";

import { type SearchResult } from "./searchResult.ts";

export class WikipediaSearchError extends Schema.TaggedError<WikipediaSearchError>()(
  "WikipediaSearchError",
  { detail: Schema.String },
) {}

export interface WikipediaSearchService {
  readonly search: (
    query: string,
  ) => Effect.Effect<ReadonlyArray<SearchResult>, WikipediaSearchError>;
}

export class WikipediaSearch extends Context.Service<
  WikipediaSearch,
  WikipediaSearchService
>()("WikipediaSearch") {}
