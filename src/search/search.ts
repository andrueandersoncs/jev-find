import { Context, Effect, Schema } from "effect";

const PassageListSchema = Schema.Array(Schema.String);

export class SearchResult extends Schema.Class<SearchResult>("SearchResult")({
  title: Schema.String,
  url: Schema.String,
  description: Schema.String,
  passages: PassageListSchema,
}) {}

export class SearchError extends Schema.TaggedError<SearchError>()(
  "SearchError",
  { detail: Schema.String },
) {}

export interface SearchService {
  readonly search: (
    query: string,
  ) => Effect.Effect<ReadonlyArray<SearchResult>, SearchError>;
}

export class Search extends Context.Service<Search, SearchService>()("Search") {}
