/**
 * Metadata-only Jev adapter.
 *
 * API contract and design guidance (checked 2026-09-27):
 * https://docs.typesafe.ai/api.md
 * https://docs.typesafe.ai/concepts/state.md
 * https://docs.typesafe.ai/primitives/choice.md
 * https://docs.typesafe.ai/confidence.md
 *
 * This module never reads files or credentials. Callers must obtain explicit consent
 * before sending filenames, because filenames can themselves contain private data.
 */

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MAX_FILES = 20;
const MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const REVIEW_CONFIDENCE = 0.75;

export const CATEGORIES = [
  "document",
  "image",
  "video",
  "screenshot",
  "source-code",
  "archive",
  "backup",
  "generated",
  "other",
  "unknown",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type Metadata = {
  id: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: string;
};

type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<Category, string>;
};

export type JevPayload = {
  model: "jev-latest";
  state: { files: Metadata[] };
  questions: Record<string, ChoiceQuestion>;
};

export type ClassificationResult = {
  id: string;
  category: Category;
  confidence: number;
  needsReview: boolean;
  explanation: string;
};

export type Classification = {
  model: string;
  results: ClassificationResult[];
  usage: { input_tokens: number; output_tokens: number };
};

export type ClassifyOptions = {
  apiKey: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type JevErrorCode =
  | "invalid-input"
  | "missing-key"
  | "aborted"
  | "timeout"
  | "authentication"
  | "rate-limit"
  | "provider"
  | "invalid-response";

export class JevError extends Error {
  constructor(
    message: string,
    readonly code: JevErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JevError";
  }
}

const CRITERIA: Record<Category, string> = {
  document:
    "A document, note, spreadsheet, presentation, PDF, or other authored office material.",
  image:
    "A still image or graphic that is not specifically identifiable as a screenshot.",
  video: "A video, movie, animation, or screen recording.",
  screenshot:
    "A screenshot or screen capture, when the metadata supports that distinction.",
  "source-code":
    "Source code, configuration, script, markup, or a developer project file.",
  archive: "A compressed archive or packaged collection of files.",
  backup: "A backup, disk image, snapshot, exported copy, or backup manifest.",
  generated:
    "A build artifact, cache, generated output, temporary output, or derived asset.",
  other: "A known file kind that does not fit another option.",
  unknown: "The metadata is insufficient to identify the file kind reliably.",
};

function boundedString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new JevError(`${field} must be a non-empty string.`, "invalid-input");
  }
  return value.slice(0, maximum);
}

function normalizeMetadata(file: Metadata): Metadata {
  if (!file || typeof file !== "object") {
    throw new JevError("Each file must be a metadata object.", "invalid-input");
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new JevError(
      "File size must be a non-negative safe integer.",
      "invalid-input",
    );
  }
  const modifiedAt = boundedString(file.modifiedAt, "modifiedAt", 64);
  if (!Number.isFinite(Date.parse(modifiedAt))) {
    throw new JevError(
      "modifiedAt must be a valid date string.",
      "invalid-input",
    );
  }
  return {
    id: boundedString(file.id, "id", 128),
    name: boundedString(file.name, "name", 255),
    extension:
      typeof file.extension === "string" ? file.extension.slice(0, 32) : "",
    size: file.size,
    modifiedAt,
  };
}

export function buildPayload(files: Metadata[]): JevPayload {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) {
    throw new JevError(
      `Expected between 1 and ${MAX_FILES} metadata records.`,
      "invalid-input",
    );
  }
  const normalized = files.map(normalizeMetadata);
  const questions: Record<string, ChoiceQuestion> = {};
  normalized.forEach((_file, index) => {
    questions[`f${index}`] = {
      type: "choice",
      instructions: `Classify the file described by \`files[${index}]\` using metadata only. Do not infer that it is safe to delete. Choose unknown when the metadata is insufficient.`,
      criteria: { ...CRITERIA },
    };
  });
  return { model: "jev-latest", state: { files: normalized }, questions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberInUnitInterval(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function validateAnswer(value: unknown): {
  choice: Category;
  confidence: number;
} {
  if (
    !isRecord(value) ||
    value.type !== "choice" ||
    !CATEGORIES.includes(value.choice as Category)
  ) {
    throw new JevError(
      "Jev returned an invalid choice answer.",
      "invalid-response",
    );
  }
  if (
    !numberInUnitInterval(value.confidence) ||
    !isRecord(value.probabilities)
  ) {
    throw new JevError(
      "Jev returned invalid confidence or probabilities.",
      "invalid-response",
    );
  }
  const probabilitiesRecord = value.probabilities;
  const keys = Object.keys(probabilitiesRecord);
  if (
    keys.length !== CATEGORIES.length ||
    CATEGORIES.some((category) => !keys.includes(category))
  ) {
    throw new JevError(
      "Jev returned an incomplete probability distribution.",
      "invalid-response",
    );
  }
  const probabilities = CATEGORIES.map(
    (category) => probabilitiesRecord[category],
  );
  if (!probabilities.every(numberInUnitInterval)) {
    throw new JevError(
      "Jev returned an invalid probability.",
      "invalid-response",
    );
  }
  const total = probabilities.reduce(
    (sum, probability) => sum + probability,
    0,
  );
  if (Math.abs(total - 1) > 0.001) {
    throw new JevError(
      "Jev returned probabilities that do not sum to one.",
      "invalid-response",
    );
  }
  return { choice: value.choice as Category, confidence: value.confidence };
}

function explanation(
  category: Category,
  confidence: number,
  needsReview: boolean,
): string {
  const confidenceText = confidence.toFixed(2);
  if (category === "unknown") {
    return `Metadata-only classification was unknown (confidence ${confidenceText}); manual review is required.`;
  }
  if (needsReview) {
    return `Metadata-only classification was ${category} (confidence ${confidenceText}); policy requires manual review.`;
  }
  return `Metadata-only classification was ${category} (confidence ${confidenceText}); no automatic file action is authorized.`;
}

function validateResponse(value: unknown, payload: JevPayload): Classification {
  if (
    !isRecord(value) ||
    typeof value.model !== "string" ||
    value.model.length === 0 ||
    value.model.length > 128
  ) {
    throw new JevError("Jev returned an invalid response.", "invalid-response");
  }
  if (!isRecord(value.answers) || !isRecord(value.usage)) {
    throw new JevError("Jev returned an invalid response.", "invalid-response");
  }
  const answers = value.answers;
  const expectedKeys = Object.keys(payload.questions);
  const answerKeys = Object.keys(value.answers);
  if (
    answerKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !answerKeys.includes(key))
  ) {
    throw new JevError(
      "Jev returned an unexpected answer set.",
      "invalid-response",
    );
  }
  const inputTokens = value.usage.input_tokens;
  const outputTokens = value.usage.output_tokens;
  if (
    !Number.isSafeInteger(inputTokens) ||
    (inputTokens as number) < 0 ||
    !Number.isSafeInteger(outputTokens) ||
    (outputTokens as number) < 0
  ) {
    throw new JevError("Jev returned invalid usage data.", "invalid-response");
  }
  const results = expectedKeys.map((key, index) => {
    const answer = validateAnswer(answers[key]);
    const needsReview =
      answer.choice === "unknown" ||
      answer.choice === "other" ||
      answer.confidence < REVIEW_CONFIDENCE;
    return {
      id: payload.state.files[index].id,
      category: answer.choice,
      confidence: answer.confidence,
      needsReview,
      explanation: explanation(answer.choice, answer.confidence, needsReview),
    };
  });
  return {
    model: value.model,
    results,
    usage: {
      input_tokens: inputTokens as number,
      output_tokens: outputTokens as number,
    },
  };
}

function httpError(status: number): JevError {
  if (status === 401 || status === 403)
    return new JevError("Jev authentication failed.", "authentication", status);
  if (status === 429)
    return new JevError(
      "Jev rate limit or quota was exceeded.",
      "rate-limit",
      status,
    );
  return new JevError("Jev service request failed.", "provider", status);
}

export async function classify(
  payload: JevPayload,
  options: ClassifyOptions,
): Promise<Classification> {
  const apiKey = options?.apiKey?.trim();
  if (!apiKey) throw new JevError("A Jev API key is required.", "missing-key");
  if (
    !payload ||
    payload.model !== "jev-latest" ||
    !isRecord(payload.state) ||
    !Array.isArray(payload.state.files) ||
    !isRecord(payload.questions)
  ) {
    throw new JevError("A valid Jev payload is required.", "invalid-input");
  }
  const canonicalPayload = buildPayload(payload.state.files);
  if (JSON.stringify(payload) !== JSON.stringify(canonicalPayload)) {
    throw new JevError(
      "The Jev payload is not canonical or exceeds its bounds.",
      "invalid-input",
    );
  }
  if (options.signal?.aborted)
    throw new JevError("Jev request was cancelled.", "aborted");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new JevError(
      "timeoutMs must be between 1 and 120000.",
      "invalid-input",
    );
  }

  const timeoutController = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok) throw httpError(response.status);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new JevError("Jev response was too large.", "invalid-response");
    }
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES)
      throw new JevError("Jev response was too large.", "invalid-response");
    let decoded: unknown;
    try {
      decoded = JSON.parse(body);
    } catch {
      throw new JevError("Jev returned malformed JSON.", "invalid-response");
    }
    return validateResponse(decoded, payload);
  } catch (error) {
    if (error instanceof JevError) throw error;
    if (options.signal?.aborted)
      throw new JevError("Jev request was cancelled.", "aborted");
    if (timeoutController.signal.aborted)
      throw new JevError("Jev request timed out.", "timeout");
    throw new JevError("Jev service request failed.", "provider");
  } finally {
    clearTimeout(timer);
  }
}
