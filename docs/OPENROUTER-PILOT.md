# OpenRouter JEV experimental provider

Live adapter smoke test (2026-09-28): correct answer, reported model
openai/gpt-6-luna, 24 input tokens, 5 output tokens, 2479 ms, reported cost
US$0.0000049. This confirms a charged routed response despite the listing's
zero headline price; it does not establish general task quality or savings.
This developer-run adapter test is not a dashboard receipt and was not added to
JEV decision-token totals. No real-data prompts or tools were sent.

Router Health contains an explicit-consent synthetic pilot for
`typesafe/jev-router`. It is NOT a replacement for the structured TypeSafe
classifier and does not change any harness model configuration.

The server accepts only a fixed synthetic arithmetic test. Browser authentication,
same-origin POST, explicit consent, one persisted attempt per UTC day, no retries,
a 20-second timeout, a 64-token output limit and a 64-KiB response cap apply.
No filenames, catalog rows or file contents are sent. Model output cannot execute
actions. Metadata receipts are stored in the app database under openrouter-pilot,
separate from decision-token analytics. Unknown usage/cost is displayed as unknown.

Configuration: supply OPENROUTER_API_KEY privately to the server environment before
starting it. The adapter never reads another harness's env file, copies a TypeSafe
key, or accepts a key through the browser. Existing credentials are not changed.
No model is automatically selected for production work by enabling the pilot.

Sources checked September 28, 2026:
- https://openrouter.ai/typesafe/jev-router
- https://openrouter.ai/docs/api_reference/overview

The listing shows zero pricing, but validate response billing before assuming
ongoing use is free. Output limits are not a dollar-denominated billing cap.
Future real-data storage explanations need separate payload preview, consent and
budget policy; the pilot intentionally does not expose a general prompt endpoint.
