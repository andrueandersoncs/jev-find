import {
  Array,
  Effect,
  Function,
  Option,
  Order,
  Record,
  Schema,
  Struct,
  Tuple,
} from "effect";

import { noul, type NoulQuestion, type SystemOneRequest } from "@typesafe-ai/sdk";

import {
  EvidenceRequestError,
  EvidenceResponseError,
  NoReadablePassagesError,
  RankedEvidence,
  RankedPassage,
} from "./evidence.ts";

import { Passage } from "./research.ts";

const MAX_EVIDENCE_PASSAGES = 24;

const noReadablePassages = () =>
  NoReadablePassagesError.make({
    detail: "The search returned no readable passages.",
  });

const evidencePlanFailure = (cause: unknown) =>
  EvidenceRequestError.make({ detail: String(cause) });

const EvidenceSourceSchema = Schema.Struct({
  source_title: Schema.String,
  source_url: Schema.String,
  text: Schema.String,
});

interface EvidenceSource
  extends Schema.Schema.Type<typeof EvidenceSourceSchema> {}

const EvidenceRequestStateSchema = Schema.Struct({
  research_question: Schema.String,
  passages: Schema.Record(Schema.String, EvidenceSourceSchema),
});

interface EvidenceRequestState
  extends Schema.Schema.Type<typeof EvidenceRequestStateSchema> {}

const NoulAnswerSchema = Schema.Struct({
  type: Schema.Literal("noul"),
  noul: Schema.Number,
});

interface NoulAnswer extends Schema.Schema.Type<typeof NoulAnswerSchema> {}

export const EvidenceAnswersSchema = Schema.Record(
  Schema.String,
  NoulAnswerSchema,
);

interface EvidenceAnswers
  extends Schema.Schema.Type<typeof EvidenceAnswersSchema> {}

interface EvidenceQuestions {
  readonly [key: string]: NoulQuestion;
}

const relevanceQuestionEntry = ({ id }: Passage) => {
  const question = noul(
    {
      task: `Does \`passages.${id}.text\` directly answer \`research_question\`?`,
      requirement:
        "The passage must state or directly imply the specific fact requested, not merely discuss the same topic.",
    },
    {
      true: "The passage contains a specific answer to the research question.",
      false:
        "The passage is irrelevant, only topically related, or lacks the requested fact.",
    },
  );

  return Tuple.make(id, question);
};

const makeEvidenceSource = (passage: Passage): EvidenceSource =>
  EvidenceSourceSchema.make({
    source_title: passage.title,
    source_url: passage.url,
    text: passage.text,
  });

const sourceEntry = (passage: Passage) => {
  const source = makeEvidenceSource(passage);

  return Tuple.make(passage.id, source);
};

const selectEvidencePassages = (
  passages: ReadonlyArray<Passage>,
) => {
  const boundedPassages = Array.take(passages, MAX_EVIDENCE_PASSAGES);

  return boundedPassages.length <= 0
    ? Option.none()
    : Option.some(boundedPassages);
};

// This process value is opaque because only typed in-process construction can reach it.
const isSystemOneRequest = (_input: unknown): _input is SystemOneRequest => true;

const SystemOneRequestSchema = Schema.declare(isSystemOneRequest, {
  identifier: "SystemOneRequest",
});

const PassageListSchema = Schema.Array(Passage);

class EvidencePlan extends Schema.Class<EvidencePlan>("EvidencePlan")({
  request: SystemOneRequestSchema,
  passages: PassageListSchema,
}) {}

const planEvidence = Effect.fn("Evidence.plan")(function* (
  query: string,
  passages: ReadonlyArray<Passage>,
) {
  const selection = selectEvidencePassages(passages);

  const selectedPassages = yield* Effect.fromOption(
    selection,
    noReadablePassages,
  );

  return yield* Effect.try({
    try: () => {
      const questionEntries = Array.map(
        selectedPassages,
        relevanceQuestionEntry,
      );

      const relevanceQuestions = Record.fromEntries(questionEntries);

      const evidenceQuestion = noul(
        "Does at least one item in `passages` directly answer `research_question`?",
        {
          true:
            "At least one passage states or directly implies the specific requested fact.",
          false:
            "The passages are only topically related, or do not contain the requested fact.",
        },
      );

      const questions = Record.set(
        relevanceQuestions,
        "has_evidence",
        evidenceQuestion,
      ) satisfies EvidenceQuestions;

      const sourceEntries = Array.map(selectedPassages, sourceEntry);
      const sources = Record.fromEntries(sourceEntries);

      const state: EvidenceRequestState = EvidenceRequestStateSchema.make({
        research_question: query,
        passages: sources,
      });

      const request: SystemOneRequest = { state, questions };

      return EvidencePlan.make({ request, passages: selectedPassages });
    },
    catch: evidencePlanFailure,
  });
});

const answerNoul = Struct.get<NoulAnswer, "noul">("noul");

const evidenceVerdict = (answers: EvidenceAnswers) =>
  Option.fromNullishOr(answers.has_evidence);

const passageRelevance = (answers: EvidenceAnswers, passageId: string) => {
  const answer = Option.fromNullishOr(answers[passageId]);

  return Option.match(answer, {
    onNone: Function.constant(0),
    onSome: answerNoul,
  });
};

const rankPassage = (
  answers: EvidenceAnswers,
) => (passage: Passage): RankedPassage => {
  const relevance = passageRelevance(answers, passage.id);

  return RankedPassage.make({ ...passage, relevance });
};

const relevanceOrder = Order.make<RankedPassage>((left, right) =>
  Order.Number(right.relevance, left.relevance),
);

const rankedEvidence = (
  passages: ReadonlyArray<Passage>,
  answers: EvidenceAnswers,
  probability: number,
) => {
  const scores = Array.map(passages, rankPassage(answers));
  const ranked = Array.sort(scores, relevanceOrder);

  return RankedEvidence.make({
    exists: probability,
    ranked,
  });
};

const interpretEvidenceAnswers = (
  passages: ReadonlyArray<Passage>,
  answers: EvidenceAnswers,
) => {
  const evidenceAnswer = evidenceVerdict(answers);

  if (Option.isNone(evidenceAnswer)) {
    return Option.none();
  }

  const evidence = rankedEvidence(
    passages,
    answers,
    evidenceAnswer.value.noul,
  );

  return Option.some(evidence);
};

interface RequestEvidenceAnswers<E, R> {
  (request: SystemOneRequest): Effect.Effect<EvidenceAnswers, E, R>;
}

const missingEvidenceVerdict = () =>
  EvidenceResponseError.make({
    detail: "Jev did not return the evidence verdict.",
  });

export const evaluateEvidence = Effect.fn("Evidence.evaluate")(function* <E, R>(
  query: string,
  passages: ReadonlyArray<Passage>,
  requestEvidenceAnswers: RequestEvidenceAnswers<E, R>,
) {
  const plan = yield* planEvidence(query, passages);
  const answers = yield* requestEvidenceAnswers(plan.request);
  const interpretation = interpretEvidenceAnswers(plan.passages, answers);

  return yield* Effect.fromOption(interpretation, missingEvidenceVerdict);
});

