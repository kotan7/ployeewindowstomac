🎯 Goal
Enable always-on listening that:

- Continuously transcribes audio
- Detects potential questions in real time
- Displays them concisely in a side panel
- Only fetches full answers when the user clicks
- Keeps Gemini usage (and cost) under control

### Current Architecture & Tech Stack (as implemented)
- **Electron renderer (Web Audio)**: Real-time mic capture via `navigator.mediaDevices.getUserMedia` and `AudioContext` with `AudioWorklet` fallback to `ScriptProcessor`.
  - File: `src/_pages/Queue.tsx` (start/stop capture, sends chunks via IPC)
  - File: `public/audio-worklet-processor.js` (energy-based VAD-ish silence detection and smart chunking: silence >800ms OR max 10s)
- **IPC contract**: `preload.ts` exposes `audioStreamStart/Stop/ProcessChunk/GetState/GetQuestions/ClearQuestions/AnswerQuestion` and event bridges for
  - `audio-question-detected`, `audio-batch-processed`, `audio-stream-state-changed`, `audio-stream-error`.
- **Electron main processing**: `AudioStreamProcessor`
  - File: `electron/AudioStreamProcessor.ts`
  - Uses OpenAI Whisper API (`whisper-1`) for transcription (ja locale) by writing WAV temp files.
  - Chunking in main is time/words based; actual chunk boundaries come from renderer worklet.
  - Question detection: `electron/QuestionDetector.ts` (JP regex + simple EN helpers; dedupe via similarity; validity filter).
  - Batch refinement: every ~30s (configurable) using `LLMHelper.chatWithGemini` to rephrase questions (Japanese); emits refined batch.
- **Answering pipeline**: On click, `ipcHandlers.ts` routes to `LLMHelper.chatWithRAG` when `collectionId` provided, else `chatWithGemini`.
  - RAG uses `QnAService` (Supabase + OpenAI embeddings) to retrieve context; prompt assembly in `LLMHelper`.
- **Usage tracking**: `UsageTracker` guards per-question usage on IPC entrypoints (audio analyze, image analyze, chat, and answer generation).
- **UI**: `src/components/AudioListener/QuestionSidePanel.tsx` renders live questions, refined badges, status (listening/processing), click-to-answer.

### Key Design Choices vs Original Plan
- **VAD**: Using lightweight amplitude-based silence detection in `AudioWorklet` (800ms) instead of Silero/WebRTC VAD. Works well and keeps CPU low. Option to swap later.
- **ASR**: Using cloud Whisper (`whisper-1` via OpenAI SDK) for simplicity and quality. Local Whisper remains optional future work.
- **Batching**: Implemented 30s interval with pending buffer; emits refined questions to renderer.
- **Cost control**: Usage checks integrated at IPC boundaries; batching reduces Gemini calls; refinement only when pending buffer non-empty.

### Data Flow Overview
1) Renderer captures audio → chunks by silence/length → `audio-stream-process-chunk` IPC.
2) Main converts Float32 → PCM → temp WAV → Whisper transcription.
3) Transcripts → `QuestionDetector` → push to `questionBuffer` + `pendingQuestions`; emit `audio-question-detected`.
4) Batch timer → `LLMHelper.chatWithGemini` to refine → emit `audio-batch-processed`.
5) UI displays live + refined; on click → `audio-stream-answer-question` → Gemini with optional RAG → render inline answer.

### Config (current defaults)
- Sample rate: 16 kHz
- Silence threshold: 0.01 (renderer)
- Silence timeout: 800 ms (renderer)
- Max chunk: 10 s (renderer)
- Batch interval: 30 s (main)
- Language: ja (Whisper)

### Implementation Plan (multi-session)
Focus on MVP completion with minimal risk; refine later.

Session 1 — Stabilize Stream Lifecycle & State
- Ensure start/stop controls and state sync between renderer and main.
- Confirm `audioStreamStart/Stop/GetState` correctness and error propagation.
- Acceptance: Toggling listening updates header status and no stray processing occurs.

Session 2 — Question Buffer UX & De-duplication
- Ensure `QuestionSidePanel` shows latest first, dedup across raw/refined, avoid flicker.
- Add optional debounce for duplicate detected questions across batches.
- Acceptance: Repeated similar phrasings don’t spam the list.

Session 3 — Refinement & Cost Safeguards
- Keep batch interval (30s) and enforce: skip if empty; cap max batch size (config in main).
- Surface refinement status minimally (already emitting `batch-processed`).
- Acceptance: At most one refinement batch per interval; handles errors gracefully.

Session 4 — Answer Click + RAG Integration
- Wire `audio-stream-answer-question` from panel to display answers inline; support optional `collectionId`.
- Add lightweight memoization per question id to prevent duplicate requests.
- Acceptance: Click returns answer; subsequent clicks don’t re-spend unless forced.

Session 5 — Optional VAD Upgrade (later)
- Evaluate swapping amplitude-threshold VAD to Silero VAD (ONNX) or WebRTC VAD.
- Keep API identical; renderer continues sending Float32 chunks.
- Acceptance: Equivalent or better chunk boundaries with limited CPU overhead.

Session 6 — Polish & Telemetry
- Small UI polish (highlight new/refined, counts, subtle loading).
- Optional: emit minimal anonymized metrics (counts/timings) locally for diagnostics only.

### Done (current status)
- ✅ Renderer capture + chunking via `AudioWorklet` with silence detection
- ✅ Whisper transcription in main (`whisper-1`, ja)
- ✅ Regex-based question detection + validity + simple dedupe
- ✅ Batch refinement via Gemini; emits `audio-batch-processed`
- ✅ Side panel listing with click-to-answer; RAG-ready answer pipeline
- ✅ Usage tracking checks at IPC handlers

### Open Items / Risks
- Whisper API dependency (network latency, cost)
- Amplitude-based VAD may be less accurate in noisy environments (acceptable for MVP)
- Ensure temp WAV cleanup remains robust on errors

### Notes for Future Local ASR (optional)
- If moving to local Whisper: integrate whisper.cpp bridge; maintain WAV writer; keep `AudioStreamProcessor` interface unchanged.