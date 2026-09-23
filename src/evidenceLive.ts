import {
  Config,
  Effect,
  Layer,
  pipe,
  Redacted,
  Schema,
} from "effect";

import { TypeSafeClient, type SystemOneRequest } from "@typesafe-ai/sdk";

import {
  EvidenceRanker,
  EvidenceRequestError,
  EvidenceResponseError,
  type EvidenceRankerService,
} from "./evidence.ts";

import {
  EvidenceAnswersSchema,
  evaluateEvidence,
} from "./evidenceModel.ts";

import { type Passage } from "./research.ts";

const TYPESAFE_TIMEOUT = "30 seconds";

const TypeSafeClientConfigSchema = Schema.Struct({
  apiKey: Schema.String,
  timeout: Schema.Number,
});

interface TypeSafeClientConfig
  extends Schema.Schema.Type<typeof TypeSafeClientConfigSchema> {}

const EvidenceResponseSchema = Schema.Struct({
  answers: EvidenceAnswersSchema,
});

interface EvidenceResponse
  extends Schema.Schema.Type<typeof EvidenceResponseSchema> {}

const requestFailure = (cause: unknown) =>
  EvidenceRequestError.make({ detail: String(cause) });

const responseFailure = (cause: unknown) =>
  EvidenceResponseError.make({ detail: String(cause) });

const decodeEvidenceResponse = Schema.decodeUnknownEffect(
  EvidenceResponseSchema,
);

const requestEvidenceAnswers = Effect.fn("TypeSafe.requestEvidenceAnswers")(
  function* (
    client: TypeSafeClient,
    request: SystemOneRequest,
  ) {
    const responseRequest = Effect.tryPromise({
      try: (signal) => {
        const options = { signal };

        return client.systemOne(request, options);
      },
      catch: requestFailure,
    });

    const rawResponse = yield* pipe(
      responseRequest,
      Effect.timeout(TYPESAFE_TIMEOUT),
      Effect.mapError(requestFailure),
    );

    const decodedResponse = yield* pipe(
      decodeEvidenceResponse(rawResponse),
      Effect.mapError(responseFailure),
    );

    return decodedResponse.answers;
  },
);

const makeEvidenceRanker = Effect.gen(function* () {
  const redactedApiKey = yield* Config.Redacted("TYPESAFE_API_KEY");
  const apiKey = Redacted.value(redactedApiKey);

  const clientConfig: TypeSafeClientConfig = TypeSafeClientConfigSchema.make({
    apiKey,
    timeout: 10_000,
  });

  const client = new TypeSafeClient(clientConfig);

  const requestAnswers = (request: SystemOneRequest) =>
    requestEvidenceAnswers(client, request);

  const rank = Effect.fn("EvidenceRanker.rank")(function* (
    query: string,
    passages: ReadonlyArray<Passage>,
  ) {
    return yield* evaluateEvidence(query, passages, requestAnswers);
  });

  return { rank } satisfies EvidenceRankerService;
});

export const EvidenceRankerLive = Layer.effect(EvidenceRanker)(
  makeEvidenceRanker,
);
