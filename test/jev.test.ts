import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPayload,
  classify,
  CATEGORIES,
  JevError,
  type Metadata,
} from "../src/jev.ts";

const file: Metadata = {
  id: "file-1",
  name: "Report.pdf",
  extension: ".pdf",
  size: 1234,
  modifiedAt: "2026-09-26T12:00:00.000Z",
};

function responseBody(overrides: Record<string, unknown> = {}) {
  const probabilities = Object.fromEntries(
    CATEGORIES.map((category) => [category, category === "document" ? 1 : 0]),
  );
  return {
    model: "jev-1.13.0",
    answers: {
      f0: { type: "choice", choice: "document", probabilities, confidence: 1 },
    },
    usage: { input_tokens: 50, output_tokens: 12 },
    ...overrides,
  };
}

function mockFetch(body: unknown, status = 200): typeof fetch {
  return async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
    }) as never;
}

async function rejectsCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(
    action,
    (error: unknown) => error instanceof JevError && error.code === code,
  );
}

test("buildPayload emits bounded metadata-only state and one closed question per file", () => {
  const payload = buildPayload([
    file,
    { ...file, id: "file-2", name: "x".repeat(300) },
  ]);
  assert.deepEqual(Object.keys(payload), ["model", "state", "questions"]);
  assert.equal(payload.model, "jev-latest");
  assert.equal(payload.state.files[1].name.length, 255);
  assert.deepEqual(Object.keys(payload.questions), ["f0", "f1"]);
  assert.deepEqual(Object.keys(payload.questions.f0.criteria), [...CATEGORIES]);
  assert.equal(JSON.stringify(payload).includes("path"), false);
  assert.equal(JSON.stringify(payload).includes("content"), false);
});

test("buildPayload rejects empty and oversized batches", () => {
  assert.throws(() => buildPayload([]), JevError);
  assert.throws(
    () =>
      buildPayload(
        Array.from({ length: 21 }, (_, index) => ({
          ...file,
          id: String(index),
        })),
      ),
    JevError,
  );
});

test("classify sends the expected request and returns deterministic policy output", async () => {
  const payload = buildPayload([file]);
  let captured: { url?: string; init?: RequestInit } = {};
  const fetchImpl: typeof fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify(responseBody()), { status: 200 });
  };
  const result = await classify(payload, { apiKey: "secret", fetchImpl });
  assert.equal(captured.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(captured.init?.method, "POST");
  assert.equal(
    (captured.init?.headers as Record<string, string>).authorization,
    "Bearer secret",
  );
  assert.deepEqual(JSON.parse(String(captured.init?.body)), payload);
  assert.deepEqual(result, {
    model: "jev-1.13.0",
    results: [
      {
        id: "file-1",
        category: "document",
        confidence: 1,
        needsReview: false,
        explanation:
          "Metadata-only classification was document (confidence 1.00); no automatic file action is authorized.",
      },
    ],
    usage: { input_tokens: 50, output_tokens: 12 },
  });
});

test("classify rejects missing keys without making a request", async () => {
  let called = false;
  await rejectsCode(
    () =>
      classify(buildPayload([file]), {
        apiKey: "",
        fetchImpl: async () => {
          called = true;
          return new Response();
        },
      }),
    "missing-key",
  );
  assert.equal(called, false);
});

test("classify rejects non-canonical payloads and already-aborted requests", async () => {
  const payload = buildPayload([file]);
  payload.questions.f0.instructions = "unbounded caller override";
  await rejectsCode(
    () =>
      classify(payload, {
        apiKey: "secret",
        fetchImpl: mockFetch(responseBody()),
      }),
    "invalid-input",
  );

  const controller = new AbortController();
  controller.abort();
  await rejectsCode(
    () =>
      classify(buildPayload([file]), {
        apiKey: "secret",
        signal: controller.signal,
        fetchImpl: mockFetch(responseBody()),
      }),
    "aborted",
  );
});

for (const [status, code] of [
  [401, "authentication"],
  [429, "rate-limit"],
  [529, "provider"],
] as const) {
  test(`classify sanitizes HTTP ${status}`, async () => {
    await rejectsCode(
      () =>
        classify(buildPayload([file]), {
          apiKey: "secret",
          fetchImpl: mockFetch("private provider detail", status),
        }),
      code,
    );
  });
}

test("classify rejects malformed JSON", async () => {
  await rejectsCode(
    () =>
      classify(buildPayload([file]), {
        apiKey: "secret",
        fetchImpl: mockFetch("not-json"),
      }),
    "invalid-response",
  );
});

test("classify rejects bad probability values and distributions", async () => {
  const badRange = responseBody();
  (
    badRange.answers as Record<
      string,
      { probabilities: Record<string, number> }
    >
  ).f0.probabilities.document = 1.1;
  await rejectsCode(
    () =>
      classify(buildPayload([file]), {
        apiKey: "secret",
        fetchImpl: mockFetch(badRange),
      }),
    "invalid-response",
  );

  const badSum = responseBody();
  (
    badSum.answers as Record<string, { probabilities: Record<string, number> }>
  ).f0.probabilities.image = 0.5;
  await rejectsCode(
    () =>
      classify(buildPayload([file]), {
        apiKey: "secret",
        fetchImpl: mockFetch(badSum),
      }),
    "invalid-response",
  );
});

test("classify rejects incomplete answers, confidence, and usage", async () => {
  await rejectsCode(
    () =>
      classify(buildPayload([file]), {
        apiKey: "secret",
        fetchImpl: mockFetch(responseBody({ answers: {} })),
      }),
    "invalid-response",
  );
  const badConfidence = responseBody();
  (
    badConfidence.answers as Record<string, { confidence: number }>
  ).f0.confidence = Number.NaN;
  await rejectsCode(
    () =>
      classify(buildPayload([file]), {
        apiKey: "secret",
        fetchImpl: mockFetch(badConfidence),
      }),
    "invalid-response",
  );
  await rejectsCode(
    () =>
      classify(buildPayload([file]), {
        apiKey: "secret",
        fetchImpl: mockFetch(
          responseBody({ usage: { input_tokens: -1, output_tokens: 2 } }),
        ),
      }),
    "invalid-response",
  );
});

test("classify supports caller cancellation", async () => {
  const controller = new AbortController();
  const fetchImpl: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  const pending = classify(buildPayload([file]), {
    apiKey: "secret",
    fetchImpl,
    signal: controller.signal,
  });
  controller.abort();
  await rejectsCode(() => pending, "aborted");
});

test("classify enforces its timeout", async () => {
  const fetchImpl: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  await rejectsCode(
    () =>
      classify(buildPayload([file]), {
        apiKey: "secret",
        fetchImpl,
        timeoutMs: 5,
      }),
    "timeout",
  );
});

test("low-confidence and unknown choices always require review", async () => {
  const body = responseBody();
  const answer = (
    body.answers as Record<
      string,
      {
        choice: string;
        confidence: number;
        probabilities: Record<string, number>;
      }
    >
  ).f0;
  answer.choice = "unknown";
  answer.confidence = 0.2;
  answer.probabilities = Object.fromEntries(
    CATEGORIES.map((category) => [category, category === "unknown" ? 1 : 0]),
  );
  const result = await classify(buildPayload([file]), {
    apiKey: "secret",
    fetchImpl: mockFetch(body),
  });
  assert.equal(result.results[0].needsReview, true);
  assert.match(result.results[0].explanation, /manual review is required/);
});
