import { Context, Effect, Schema } from "effect";

import { type Passage } from "../research/research.ts";

export class RankedPassage extends Schema.Class<RankedPassage>(
  "RankedPassage",
)({
  id: Schema.String,
  title: Schema.String,
  url: Schema.String,
  description: Schema.String,
  text: Schema.String,
  relevance: Schema.Number,
}) {}

const RankedPassagesSchema = Schema.Array(RankedPassage);

export class RankedEvidence extends Schema.Class<RankedEvidence>(
  "RankedEvidence",
)({
  exists: Schema.Number,
  ranked: RankedPassagesSchema,
}) {}

export class NoReadablePassagesError extends Schema.TaggedError<NoReadablePassagesError>()(
  "NoReadablePassagesError",
  { detail: Schema.String },
) {}

export class EvidenceRequestError extends Schema.TaggedError<EvidenceRequestError>()(
  "EvidenceRequestError",
  { detail: Schema.String },
) {}

export class EvidenceResponseError extends Schema.TaggedError<EvidenceResponseError>()(
  "EvidenceResponseError",
  { detail: Schema.String },
) {}

export interface EvidenceRankerService {
  readonly rank: (
    query: string,
    passages: ReadonlyArray<Passage>,
  ) => Effect.Effect<
    RankedEvidence,
    NoReadablePassagesError | EvidenceRequestError | EvidenceResponseError
  >;
}

export class EvidenceRanker extends Context.Service<
  EvidenceRanker,
  EvidenceRankerService
>()("EvidenceRanker") {}
