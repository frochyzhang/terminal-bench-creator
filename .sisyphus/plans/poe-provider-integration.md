# Plan: Poe Provider Integration (Replace Legacy Providers)

## Goal
Replace all existing AI providers with Poe as the sole provider across server, DB settings, and client settings UI while preserving current generation behavior (streaming, prompts, error handling).

## Scope
- Server: remove legacy provider usage; add Poe provider.
- DB: default settings updated to Poe; add Poe settings keys; migrate existing installs to Poe default.
- Client: settings UI shows only Poe; remove old fields.
- Logs/telemetry: keep existing logging format.

## Non-Goals
- No new model discovery UI or multi-provider fallback.
- No historical data migration beyond default provider setting.
- No new billing/usage features.

## Assumptions
- Poe OpenAI-compatible API at `https://api.poe.com/v1` is sufficient for current usage.
- Streaming behavior can be handled with the existing OpenAI-style SSE parser.
- Default model can be set to `Claude-Sonnet-4.5` and adjusted by users in settings.

## Work Plan
1. **Server provider implementation**
   - Add `server/src/services/aiService/poeProvider.js` using OpenAI-compatible `chat/completions`.
   - Implement API key + model lookup from settings (`poe_api_key`, `poe_model`, optional `poe_api_base`).
   - Reuse existing SSE parsing logic to preserve streaming behavior.
   - Preserve `logCurlRequest`, `logCurlResponse`, `logRawSseSample` integration for parity.

2. **Swap provider selection logic**
   - Update `server/src/services/aiService/index.js` to always use Poe provider (remove legacy provider branching).
   - Remove unused imports and model override behavior if no longer needed.
   - Keep prompt selection and generation order unchanged.

3. **Database settings updates**
   - Update seed defaults in `server/src/db/migrations/001_init.sql`:
     - `ai_provider` default to `poe`.
     - Add `poe_api_key`, `poe_model`, `poe_api_base` (if needed).
     - Remove legacy provider defaults from seed list.
   - Add new migration `003_poe_provider.sql` to:
     - Insert Poe settings keys if missing.
     - Set `ai_provider` to `poe` for existing installs.
     - Leave existing legacy keys untouched (data retention only).

4. **Client settings UI changes**
   - Update `client/src/pages/Settings/index.jsx`:
     - Replace provider dropdown with a fixed Poe entry (or remove dropdown if not needed).
     - Add Poe API key, model, optional API base fields.
     - Remove legacy provider sections.
   - Ensure sensitive handling still masks key fields.

5. **Dependency and cleanup**
   - Remove the previous provider SDK from `server/package.json` if no longer used.
   - Delete legacy provider modules if fully replaced.
   - Remove any remaining references to legacy providers in code and UI.

6. **Validation**
   - Confirm settings API saves and returns Poe fields correctly.
   - Confirm AI generation path works for each prompt type.
   - Verify streaming works (if currently used) with Poe responses.
   - Check error propagation for missing/invalid Poe API key.

## Acceptance Criteria
- Poe is the only provider option in UI and server logic.
- `ai_provider` defaults to `poe` for new and existing installs.
- Poe API key/model are stored in settings and used for generation.
- No legacy provider references remain in code, UI, or docs.
- Generation works end-to-end with unchanged prompt behavior.

## Risks & Mitigations
- **Model name mismatch**: document default model in UI; allow user to override.
- **Streaming differences**: reuse existing SSE parser and add guards for JSON responses.
- **Missing key**: clear error message “Poe API key not configured”.

## Open Decisions (if you want to override defaults)
- Default Poe model name (currently set to `Claude-Sonnet-4.5`).
- Whether to expose `poe_api_base` in UI (default `https://api.poe.com/v1`).
