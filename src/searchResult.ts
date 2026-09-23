import { Schema } from "effect";

const PassageListSchema = Schema.Array(Schema.String);

export class SearchResult extends Schema.Class<SearchResult>("SearchResult")({
  title: Schema.String,
  url: Schema.String,
  description: Schema.String,
  passages: PassageListSchema,
}) {}
