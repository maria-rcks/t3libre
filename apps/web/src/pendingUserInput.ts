import type { UserInputQuestion } from "@t3tools/contracts";

export interface PendingUserInputDraftAnswer {
  selectedOptionValues?: string[];
  customAnswer?: string;
  attachmentCount?: number;
  attachmentsBlocked?: boolean;
}

export interface PendingUserInputProgress {
  questionIndex: number;
  activeQuestion: UserInputQuestion | null;
  activeDraft: PendingUserInputDraftAnswer | undefined;
  selectedOptionValues: string[];
  customAnswer: string;
  resolvedAnswer: string | string[] | null;
  usingCustomAnswer: boolean;
  answeredQuestionCount: number;
  isLastQuestion: boolean;
  isComplete: boolean;
  canAdvance: boolean;
}

function normalizeDraftAnswer(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSelectedOptionValues(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  // Provider option IDs must stay unchanged, including whitespace.
  return Array.from(new Set(value.filter((entry) => typeof entry === "string")));
}

export function resolvePendingUserInputAnswer(
  question: UserInputQuestion,
  draft: PendingUserInputDraftAnswer | undefined,
): string | string[] | null {
  if (draft?.attachmentsBlocked) return null;
  const customAnswer =
    question.allowCustomAnswer === false ? null : normalizeDraftAnswer(draft?.customAnswer);
  if (customAnswer) {
    return customAnswer;
  }

  const selectedOptionValues = normalizeSelectedOptionValues(draft?.selectedOptionValues).filter(
    (value) => question.options.some((option) => (option.value ?? option.label) === value),
  );
  if (question.multiSelect) {
    if (
      selectedOptionValues.length === 0 &&
      ((draft?.selectedOptionValues?.length ?? 0) > 0 ||
        normalizeDraftAnswer(draft?.customAnswer) !== null ||
        (question.allowCustomAnswer === false && (draft?.attachmentCount ?? 0) > 0))
    )
      return null;
    if (
      selectedOptionValues.length < (question.minSelections ?? 1) ||
      (question.maxSelections !== undefined && selectedOptionValues.length > question.maxSelections)
    ) {
      return selectedOptionValues.length === 0 &&
        question.minSelections === undefined &&
        question.maxSelections === undefined &&
        question.allowCustomAnswer !== false &&
        (draft?.attachmentCount ?? 0) > 0
        ? ""
        : null;
    }
    return selectedOptionValues;
  }

  return (
    selectedOptionValues[0] ??
    (question.allowCustomAnswer !== false && (draft?.attachmentCount ?? 0) > 0 ? "" : null)
  );
}

export function setPendingUserInputCustomAnswer(
  draft: PendingUserInputDraftAnswer | undefined,
  customAnswer: string,
): PendingUserInputDraftAnswer {
  const selectedOptionValues =
    customAnswer.trim().length > 0
      ? undefined
      : normalizeSelectedOptionValues(draft?.selectedOptionValues);

  return {
    customAnswer,
    ...(selectedOptionValues && selectedOptionValues.length > 0 ? { selectedOptionValues } : {}),
  };
}

const DISPLACED_ANSWER_SEPARATOR = "\n\n";

/**
 * Selecting an option replaces the custom answer, because a non-empty custom
 * answer outranks selected options in `resolvePendingUserInputAnswer`. Text the
 * user typed into the answer field must not vanish on that click: it moves back
 * into the thread draft, after whatever was already waiting there.
 */
export function carryDisplacedCustomAnswerIntoPrompt(
  prompt: string,
  customAnswer: string | undefined,
): string {
  const displaced = customAnswer?.trim() ?? "";
  if (displaced.length === 0) {
    return prompt;
  }
  if (prompt.trim().length === 0) {
    return displaced;
  }
  return `${prompt.trimEnd()}${DISPLACED_ANSWER_SEPARATOR}${displaced}`;
}

export function togglePendingUserInputOptionSelection(
  question: UserInputQuestion,
  draft: PendingUserInputDraftAnswer | undefined,
  optionValue: string,
): PendingUserInputDraftAnswer {
  if (question.multiSelect) {
    const selectedOptionValues = normalizeSelectedOptionValues(draft?.selectedOptionValues);
    const nextSelectedOptionValues = selectedOptionValues.includes(optionValue)
      ? selectedOptionValues.filter((value) => value !== optionValue)
      : [...selectedOptionValues, optionValue];

    return {
      customAnswer: "",
      ...(nextSelectedOptionValues.length > 0
        ? { selectedOptionValues: nextSelectedOptionValues }
        : {}),
    };
  }

  return {
    customAnswer: "",
    selectedOptionValues: [optionValue],
  };
}

export function buildPendingUserInputAnswers(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
): Record<string, string | string[]> | null {
  const answers: Record<string, string | string[]> = {};

  for (const question of questions) {
    const draft = draftAnswers[question.id];
    if (
      question.required === false &&
      !draft?.attachmentsBlocked &&
      normalizeDraftAnswer(draft?.customAnswer) === null &&
      (draft?.selectedOptionValues?.length ?? 0) === 0 &&
      (draft?.attachmentCount ?? 0) === 0
    )
      continue;
    const answer = resolvePendingUserInputAnswer(question, draft);
    if (answer === null) {
      return null;
    }
    answers[question.id] = answer;
  }

  return answers;
}

export function countAnsweredPendingUserInputQuestions(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
): number {
  return questions.reduce((count, question) => {
    return resolvePendingUserInputAnswer(question, draftAnswers[question.id]) !== null
      ? count + 1
      : count;
  }, 0);
}

export function findFirstUnansweredPendingUserInputQuestionIndex(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
): number {
  const unansweredIndex = questions.findIndex(
    (question) => buildPendingUserInputAnswers([question], draftAnswers) === null,
  );

  return unansweredIndex === -1 ? Math.max(questions.length - 1, 0) : unansweredIndex;
}

export function derivePendingUserInputProgress(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
  questionIndex: number,
): PendingUserInputProgress {
  const normalizedQuestionIndex =
    questions.length === 0 ? 0 : Math.max(0, Math.min(questionIndex, questions.length - 1));
  const activeQuestion = questions[normalizedQuestionIndex] ?? null;
  const activeDraft = activeQuestion ? draftAnswers[activeQuestion.id] : undefined;
  const resolvedAnswer = activeQuestion
    ? resolvePendingUserInputAnswer(activeQuestion, activeDraft)
    : null;
  const customAnswer =
    activeQuestion?.allowCustomAnswer === false ? "" : (activeDraft?.customAnswer ?? "");
  const answeredQuestionCount = countAnsweredPendingUserInputQuestions(questions, draftAnswers);
  const isLastQuestion =
    questions.length === 0 ? true : normalizedQuestionIndex >= questions.length - 1;

  return {
    questionIndex: normalizedQuestionIndex,
    activeQuestion,
    activeDraft,
    selectedOptionValues: normalizeSelectedOptionValues(activeDraft?.selectedOptionValues),
    customAnswer,
    resolvedAnswer,
    usingCustomAnswer: customAnswer.trim().length > 0,
    answeredQuestionCount,
    isLastQuestion,
    isComplete: buildPendingUserInputAnswers(questions, draftAnswers) !== null,
    canAdvance:
      activeQuestion !== null &&
      buildPendingUserInputAnswers([activeQuestion], draftAnswers) !== null,
  };
}
