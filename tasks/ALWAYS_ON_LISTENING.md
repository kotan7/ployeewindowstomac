Title: Always-on Listening – Updated Implementation Plan

Objective
- Provide always-on mic listening that transcribes audio, detects/collects likely questions, batches refinements, and fetches answers on demand with optional RAG, while keeping costs controlled.

Scope & Current State (Audit)
- Renderer
  - Audio capture via Web Audio: `getUserMedia`, `AudioContext`, `AudioWorklet` with fallback to `ScriptProcessor`.
  - Smart chunking in `public/audio-worklet-processor.js` using amplitude-based silence detection (800ms) and a 10s hard cap.
  - Sends `Float32Array` chunks to main via `audio-stream-process-chunk` IPC.
  - UI: `QuestionSidePanel` to list detected/refined questions and trigger answering.
- Main
  - `AudioStreamProcessor`: accumulates samples, converts to PCM, writes temp WAV, transcribes with OpenAI Whisper (`whisper-1`, ja), pushes to `QuestionDetector`, buffers and batches, calls Gemini via `LLMHelper` for refinement, emits events to renderer.
  - `QuestionDetector`: simple JP/EN regex, validity filter, lightweight dedupe.
  - `LLMHelper`: Gemini-based chat/RAG and rephrase, plus image/audio helpers used elsewhere.
  - `QnAService`: Supabase + OpenAI embeddings for RAG.
  - `UsageTracker`: IPC guards for cost control.
- Events/IPC: `onAudioQuestionDetected`, `onAudioBatchProcessed`, `onAudioStreamStateChanged`, `onAudioStreamError`, plus start/stop/state/get/clear/answer methods.

Delta vs Original Draft
- VAD: Using amplitude threshold (renderer) instead of Silero/WebRTC VAD. Good enough for MVP, upgradeable later without API changes.
- ASR: Cloud Whisper instead of local whisper.cpp. Faster to ship; revisit later.
- Batching & Cost: Implemented interval-based batching and usage tracking at IPC level; aligns with plan.

Risks
- Dependence on network/Whisper latency and cost.
- Amplitude-only VAD may mis-split in noisy environments; acceptable for MVP.
- Temp file cleanup must remain reliable under errors.

Non-Goals (now)
- Local offline ASR.
- Full analytics/telemetry beyond minimal logs.

Milestones & Sessions (MVP-first)
1) Stream Lifecycle & State Stability
   - Verify start/stop propagation and renderer header status (listening/processing).
   - Ensure errors propagate to `onAudioStreamError` and stop loop cleanly.
   - Acceptance: Toggle on/off without stuck states; UI reflects status.

2) Question Buffer UX & Dedup
   - Ensure list shows newest first; dedupe near-duplicates across raw/refined entries.
   - Optional debounce to suppress identical detection bursts.
   - Acceptance: No spam from repeated phrasings; list remains compact.

3) Batch Refinement & Cost Caps
   - Keep batch interval at 30s and cap size via config; skip when empty.
   - Confirm usage checks where answers/refinements incur LLM calls.
   - Acceptance: At most one refinement per interval; graceful error handling.

4) Answer-on-Click + RAG Path
   - Wire `audio-stream-answer-question` with optional `collectionId` from UI mode.
   - Cache answers per question id within session to prevent duplicate spends.
   - Acceptance: Answer appears inline; repeated clicks don’t re-spend unless forced.

5) Optional VAD Upgrade (post-MVP)
   - Evaluate Silero (ONNX Runtime Web/Electron) or WebRTC VAD; measure CPU/accuracy.
   - Maintain renderer → main chunk API.
   - Acceptance: Comparable or better segmentation with low overhead.

6) Polish
   - Subtle UI improvements: highlight new/refined, compact counters, lightweight loading.
   - Minimal diagnostic logs behind a flag.

Task Breakdown (by component)
- Renderer
  - `Queue.tsx`: Confirm lifecycle for start/stop; ensure worklet fallback path is stable.
  - `QuestionSidePanel.tsx`: Dedup display, memoize per-question answers, optional RAG mode selector.
  - `preload.ts`: Keep API surface stable (already exposes needed methods/events).
- Main
  - `AudioStreamProcessor.ts`: Confirm cleanup on stop; robust temp-file cleanup; respect config caps.
  - `QuestionDetector.ts`: Keep simple heuristics; adjust thresholds only if needed.
  - `ipcHandlers.ts`: Ensure usage guard paths are consistent for answer/refine calls.
  - `LLMHelper.ts`/`QnAService.ts`: Leave as-is for MVP; only wire response consumption in UI.

Acceptance Criteria (MVP)
- User turns on listening; questions appear; batch-refined versions update; clicking returns answer inline; no duplicate spends; costs bounded by batching/usage checks.

Validation Plan
- Manual: Simulate varied speech (question vs statements), verify segmentation, detection, refinement cadence, UI updates, and answer flow with/without RAG.
- Synthetic: Feed short recorded clips via file-based path to confirm Whisper and detection logic.

Rollout & Flags
- Feature is self-contained behind UI listening toggle; can be disabled by hiding controls.

Change Log (to update during implementation)
- 2025-09-09: Initial updated plan written based on current code audit.
- 2025-09-09: Session 1 implemented (cleanup effect in QueueCommands). Lint passed.
- 2025-09-09: Session 2 implemented (dedup rendering in QuestionSidePanel via memoized normalized text). Added optional refinedText read on UI only; types updated.
 - 2025-09-09: Session 3 implemented (hybrid batching in AudioStreamProcessor: size/interval triggers, batch cap, single-flight).
- 2025-09-09: Session 4 implemented (answer memoization in Queue; panel updates inline answer on resolve). Lint passed.

Supabase Usage Note
- Current feature set uses Supabase for QnA collections retrieval and RAG (already integrated via `QnAService`).
- Always-on listening itself does not require additional tables. No schema changes planned for MVP.
- Future enhancement (optional): persist detected/refined questions with user/session linkage for history/analytics. If needed, propose `audio_questions` table (id, user_id, text, refined_text, timestamp, confidence, answered, collection_id?). Not required now.

Full-session plan details

Session 2 — Execution Plan (precise)
Scope
- Improve question panel UX: dedup across raw/refined; avoid flicker.

Files and exact edits
- `src/components/AudioListener/QuestionSidePanel.tsx`
  1) Display dedup: when mapping `questions`, filter by normalized text (prefer `refinedText || text`).
     - Insertion point: just before `.map((question) => ...)` in the render list.
     - Minimal helper inline in component scope to compute unique keys.
  2) Visual polish: keep as-is for MVP; no new components.

Acceptance
- Near-duplicate entries don’t appear twice (raw vs refined).

Session 3 — Execution Plan (precise)
Scope
- Hybrid batching in main: trigger refinement either when pending reaches `maxBatchSize` OR when `batchInterval` elapsed since last run. Reset timer on size-trigger. One batch at a time. Maintain cost guard.

Files and exact edits
- `electron/AudioStreamProcessor.ts`
  1) In `detectQuestions`, after pushing to `pendingQuestions`, if `pendingQuestions.length >= maxBatchSize` and not processing, call `processBatch()` immediately and set `lastBatchTime = now`.
  2) In `setupBatchProcessor`, keep interval check; if time since `lastBatchTime >= batchInterval` and there are pending questions and not processing, call `processBatch()`.
  3) In `processBatch`, slice only up to `maxBatchSize`, leave remainder pending, guard with `isProcessing` flag, and `try/finally` to reset.
  4) Cost guard is already enforced at answer time via `UsageTracker`; refinement uses Gemini via `LLMHelper` and is batched to control cost. No extra Supabase changes required.

Acceptance
- Rapid questions trigger immediate refinement on size threshold; slow pace triggers every 30s at most. Only one batch at a time. Refined questions appear promptly.

Session 4 — Execution Plan (precise)
Scope
- Prevent duplicate answer calls per question id within session; support optional RAG ID from panel.

Files and exact edits
- `src/_pages/Queue.tsx`
  1) Maintain Map<questionId, answer> and short-circuit if present.
  2) Thread `collectionId` from response mode when calling `audioStreamAnswerQuestion`.
- `src/components/AudioListener/QuestionSidePanel.tsx`
  3) Update `onAnswerQuestion` to return `{ response, timestamp }`, and set local `answers` map on resolve to render inline without re-click.

Acceptance
- Clicking same question twice doesn’t spend again; answer shows inline.

Session 5 — Execution Plan (precise)
Scope
- Evaluate VAD upgrade path; no default switch yet.

Files and exact edits
- New experimental module (future): guarded behind flag; not produced in MVP.

Acceptance
- Documented evaluation steps; no runtime change unless enabled.

Session 6 — Execution Plan (precise)
Scope
- Minor UI polish and minimal diagnostics toggle.

Files and exact edits
- `QuestionSidePanel.tsx`: highlight refined questions with existing Sparkles icon and subtle color; already present, keep minimal.
- Add optional debug toggle in renderer state to surface processing indicator (already present) — no code change if adequate.

Acceptance
- Panel remains informative without noise; no extra API calls added.

Session 1 — Execution Plan (precise)
Scope
- Stabilize stream lifecycle between renderer and main; no feature changes.
- Avoid refactors; add minimal, contained edits.

Files and exact edits
- `src/components/Queue/QueueCommands.tsx`
  1) Add unmount/dep-change cleanup to stop capture and backend stream if active.
     - Insertion point: after other useEffects, before the return JSX.
     - New block:
       ```tsx
       useEffect(() => {
         return () => {
           if (isListening) {
             try {
               // Stop backend first to cease processing
               window.electronAPI.audioStreamStop().catch(() => {});
             } finally {
               // Always stop local capture
               stopAudioCapture();
             }
           }
         };
       }, [isListening]);
       ```
     - Rationale: ensures no dangling processing or context leaks on unmount/navigation.

  2) Confirm start ordering (already correct): set `isListening` → `startAudioCapture()` → `audioStreamStart()`.
     - No code change; verify behavior.

  3) Confirm stop ordering: set `isListening=false` → `stopAudioCapture()` → `audioStreamStop()`.
     - Keep as-is to minimize risk; backend stop also called in cleanup.

- `electron/ipcHandlers.ts`, `electron/AudioStreamProcessor.ts`, `electron/preload.ts`
  - No changes for Session 1. Verify responses and error propagation only.

Acceptance checklist
- Toggling listen on/off repeatedly does not leak `AudioContext` or processors.
- On window close or component unmount, backend stops and no further chunks are sent.
- UI status in `QuestionSidePanel` reflects `isListening` and `isProcessing` correctly.

Rollback plan
- The edit is additive (one useEffect). Revert by removing that block if issues arise.

Next session readiness
- Once lifecycle is stable, proceed to Session 2 (UX dedup) with confidence that runtime states are clean.


