import { Schema } from "effect";

const OptionalStringSchema = Schema.optionalKey(Schema.String);

class WikipediaPageSchema extends Schema.Class<WikipediaPageSchema>(
  "WikipediaPage",
)({
  extract: OptionalStringSchema,
  fullurl: OptionalStringSchema,
}) {}

class WikipediaSearchInfoSchema extends Schema.Class<WikipediaSearchInfoSchema>(
  "WikipediaSearchInfo",
)({
  suggestion: OptionalStringSchema,
  rewrittenquery: OptionalStringSchema,
}) {}

class WikipediaSearchHitSchema extends Schema.Class<WikipediaSearchHitSchema>(
  "WikipediaSearchHit",
)({
  title: Schema.String,
  pageid: Schema.Number,
  snippet: OptionalStringSchema,
}) {}

const OptionalWikipediaSearchInfoSchema = Schema.optionalKey(
  WikipediaSearchInfoSchema,
);

const WikipediaSearchHitsSchema = Schema.Array(WikipediaSearchHitSchema);

const OptionalWikipediaSearchHitsSchema = Schema.optionalKey(
  WikipediaSearchHitsSchema,
);

class WikipediaSearchQuerySchema extends Schema.Class<WikipediaSearchQuerySchema>(
  "WikipediaSearchQuery",
)({
  searchinfo: OptionalWikipediaSearchInfoSchema,
  search: OptionalWikipediaSearchHitsSchema,
}) {}

const OptionalWikipediaSearchQuerySchema = Schema.optionalKey(
  WikipediaSearchQuerySchema,
);

export class WikipediaSearchResponseSchema extends Schema.Class<WikipediaSearchResponseSchema>(
  "WikipediaSearchResponse",
)({
  query: OptionalWikipediaSearchQuerySchema,
}) {}

const WikipediaPageRecordSchema = Schema.Record(
  Schema.String,
  WikipediaPageSchema,
);

const OptionalWikipediaPagesSchema = Schema.optionalKey(
  WikipediaPageRecordSchema,
);

class WikipediaExtractQuerySchema extends Schema.Class<WikipediaExtractQuerySchema>(
  "WikipediaExtractQuery",
)({
  pages: OptionalWikipediaPagesSchema,
}) {}

const OptionalWikipediaExtractQuerySchema = Schema.optionalKey(
  WikipediaExtractQuerySchema,
);

export class WikipediaExtractResponseSchema extends Schema.Class<WikipediaExtractResponseSchema>(
  "WikipediaExtractResponse",
)({
  query: OptionalWikipediaExtractQuerySchema,
}) {}
