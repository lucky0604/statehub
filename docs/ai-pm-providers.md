# AI PM Providers

The AI PM supports pluggable providers. The provider is selected at module
load time via `pickProvider(process.env)`.

Source: `agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md` §3.6

## Provider selection

```
OPENAI_API_KEY set?  →  OpenAICompatibleProvider
else                 →  DeterministicProvider
```

The selection happens once at module load (in
`packages/domain/src/services/ai-pm.ts`). Tests inject a provider
explicitly via `createAiPmService({ provider: ... })`.

## DeterministicProvider

**When:** local dev, CI, e2e tests — any environment without a real LLM
key.

**Behavior:** produces context-aware canned answers. The output varies by
mode + the current project/feature context, but is fully deterministic
(no network, no randomness). This makes e2e tests stable and lets the UI
be developed without an API key.

**Action cards it proposes:**
- `advisor` mode → `set_current_focus` + `record_decision`
- `plan` mode → `create_work_item`
- `review_triage` mode → `create_review_fix_items`
- `weekly_review` mode → `save_weekly_review`
- `prompt_builder` mode → `generate_agent_prompt`

The DeterministicProvider is the **default** and the safe fallback. It
never makes a network call.

## OpenAICompatibleProvider

**When:** production (or local dev with a real key).

**Config (env vars):**

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | yes | — | API key; presence triggers this provider |
| `OPENAI_BASE_URL` | no | `https://api.openai.com/v1` | Base URL (for Azure, Together, etc.) |
| `OPENAI_MODEL` | no | `gpt-4o-mini` | Model name |

**Behavior:** calls `POST {base_url}/chat/completions` with
`response_format: { type: "json_object" }`. The system prompt + mode
prompt + context packet are sent as the message array. The response is
parsed by `parseAIAnswer()` which validates the answer envelope + action
cards against the zod schema.

**Compatibility:** works with any OpenAI-compatible endpoint (OpenAI,
Azure OpenAI, Together, Groq, local LM Studio, etc.) by setting
`OPENAI_BASE_URL`.

## Switching providers in tests

Tests should never hit a real LLM. Use `createAiPmService` with an
explicit provider:

```typescript
import { createAiPmService } from "@statehub/domain";
import { DeterministicProvider } from "@statehub/ai";

const service = createAiPmService({ provider: new DeterministicProvider() });
const result = await service.query(db, actor, wsId, {
  mode: "advisor",
  projectId,
  featureId,
});
```

## Adding a new provider

1. Implement the `AIProvider` interface in `packages/ai/src/provider.ts`:
   ```typescript
   interface AIProvider {
     complete(req: AICompleteRequest): Promise<AICompleteResponse>;
   }
   ```
2. Add it to `pickProvider(env)` with the appropriate env trigger.
3. The provider's output MUST be a JSON object matching `AnswerEnvelope`
   (validated by `parseAIAnswer`). Invalid output throws
   `AIOutputParseError`.
4. Add tests using the new provider in
   `packages/ai/src/__tests__/context-builder.test.ts`.

## Security notes

- The API key is read from `process.env` at module load and never written
  to disk.
- The provider receives the context packet (workspace state) but never the
  API key of other providers.
- The AI PM's output is always validated — a malicious or buggy provider
  cannot inject invalid action cards. The zod schema rejects unknown
  fields, invalid action types, or malformed payloads.
