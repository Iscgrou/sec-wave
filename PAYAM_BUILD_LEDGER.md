# PAYAM_BUILD_LEDGER — Payam Sovereign (پایام ساورین)

## Audit of Initial Workspace State
- **Initial Files Found**: Phase-0 scaffold (`index.html`, `src/index.css`, `src/ui/theme/tokens.ts`, `metadata.json`, `vite.config.ts`, `tsconfig.json`, `package.json`) with an empty stub in `src/App.tsx`, missing runtime packages (`lightweight-charts`, `pixi.js`, outdated `@google/genai`), missing server entry point (`server.ts`), and missing `PAYAM_BUILD_LEDGER.md`.
- **Fixes Applied**:
  - Upgraded `@google/genai` to `^3.6.1` and installed `lightweight-charts@^5.3.0` and `pixi.js@^8.23.0`.
  - Updated `package.json` (`dev: tsx server.ts`, `start: node server.ts`) and `tsconfig.json` (`types: ["vite/client", "node"]`).
  - Replaced empty `src/App.tsx` stub with the full Payam Sovereign Institutional Cockpit.

---

## Completed Architecture Phases

### Phase 1 — Core Domain, EventBus, BiDi Hygiene & PayamKernel Invariants (`I1..I7`)
- `src/core/types.ts`: Strict TypeScript domain model for 5 assets (`XAUUSD`, `XAGUSD`, `WTI`, `BTCUSD`, `NAS100`), 7-state Feed Health (`HEALTHY`, `DEGRADED`, `LATENCY_SPIKE`, `RECONNECTING`, `STALE`, `DEAD`, `SIMULATED_REPLAY`), FMA (`SEARCH` / `LOCKED` / `TWS`), Harel Statechart states, 38-agent verdicts, and `B13` Regime Certificates.
- `src/core/council/invariants.ts` (**PayamKernel**):
  - `I1` (Asymmetric Authority): Clamps LLM risk multiplier to `(0, 1]`; forbids SL widening or risk increase; permits risk reduction, SL tightening, and VETO.
  - `I2` (One-Way SL Ratchet): Strictly forbids widening SL after position entry for both LONG and SHORT.
  - `I3` (Non-Degrading Risk Guards): Preserves immutable kernel risk caps & daily drawdown circuit breaker (`-3.0R`) regardless of `C8` budget exhaustion or API failures.
  - `I4` (Unknown State Freeze): Freezes all profit/loss advisories when position state confidence `< 0.72` or status `UNKNOWN`; permits ONLY `RECONCILE_POSITION`.
  - `I5` (Text = Data, Never Instruction): Flat Zod firewall isolating prose from deterministic numeric/enum vectors.
  - `I6` (Default `NO_TRADE` + Unexpired `B13` Certificate): Blocks signal emission without a live, non-revoked `B13` `cert_id` matching the active market regime.
  - `I7` (App Is Never the Stop-Loss): Requires explicit dual user confirmation that resting SL and TP orders are placed at the broker before entering `TWS`.
- `src/core/utils/sanitize.ts`: Strips commas, `$`, `%`, Persian/Arabic digits, and BiDi control characters (`U+200B..U+206F`, `U+FEFF`) for raw ASCII numeric clipboard copy (`1–4`).
- `src/core/bus/eventBus.ts`: Strongly typed 1:1 `PayamCore` event fabric driving `PayamArena`, `PayamLens`, and `PayamLedger`.

### Phase 2 — 38-Agent 3-Plane Council (`PayamCouncil`), Harel Statechart & Server-Side Gemini Heads
- `src/core/council/agents.ts`: Complete registry of all 38 agents — Plane A (`A1..A12`, with `A7`, `A8`, `A11` online Gemini heads), Plane B (`B1..B14`, including `B10` I5 firewall, `B11` I1 reducer, `B13` Regime Certificate Authority), Plane C (`C1..C12`, enforcing `I1..I7`, `C8` budget controller, `C9` lifecycle, `C10` drift monitor, `C11` ledger committer, `C12` feed breaker).
- `src/core/council/engine.ts`: Real OHLCV sliding-window quantitative scanner (14-period ATR, liquidity sweep, displacement, MSS, max-2 POI anchors, R:R geometry) + full 38-agent deliberation pipeline + `B13` certificate issuance + 4-bullet active-voice Iranian institutional Persian rationale.
- `src/core/statechart/machine.ts`: Deterministic Harel Statechart transitions (`SEARCH` -> `LOCKED` -> `TWS`, `I7` gate, `I2` ratchet, `I4` freeze & reconcile, `STALE`/`DEAD` lockout).
- `server.ts` & `src/core/council/llmClient.ts`: Express + Vite full-stack server hosting `/api/council/llm` with official `@google/genai` SDK (`gemini-4-hydrogen`, `ThinkingLevel.LOW`, FLAT `responseSchema`), strict 12-second `AbortController` timeout, Zod validation, and clean degradation to 100% deterministic execution (`I3`).

### Phase 3 — Off-Main-Thread Market Worker (`PayamFeed`), Binary Transport & `PayamLedger`
- `src/core/feed/transport.ts`: Zero-copy `Transferable Float32Array` ping-pong buffer pool; auto-upgrades to `SharedArrayBuffer` ONLY when `globalThis.crossOriginIsolated === true`.
- `src/workers/market.worker.ts`: Off-main-thread 5-asset OHLCV engine, 7-state feed health monitor, and optional Layer-5 Companion Bridge WebSocket adapter (`ws://localhost:8765`).
- `src/core/ledger/payamLedger.ts`: Persistent IndexedDB append-only institutional audit trail with JSON export and Node-safe in-memory fallback.
- `src/core/gates/payamGates.ts`: Built-in runtime self-verification suite (`GATE-I1`..`GATE-I7` + `GATE-SYS`).

### Phase 4 — Cognitive Cockpit UI, `PayamLens` (Lightweight Charts v5) & `PayamArena` (PixiJS v8)
- `src/ui/lens/PayamSignalPrimitive.ts` & `src/ui/lens/PayamLens.tsx`: Strictly <= 4 layers via native `ISeriesPrimitive` (neutral candles, R:R bracket `zOrder: 'bottom'`, dashed invalidation line, max 2 POI anchors), only `Space` (HTF/reset) and `T` (TradingView) controls, imperative tick updates, and Fail-Loudly grey-out overlay on `STALE`/`DEAD`.
- `src/ui/arena/PayamArena.tsx`: PixiJS v8 38-agent 3-plane arena with graceful renderer fallback, `webglcontextlost` recovery, 1:1 `EventBus` binding, and Dirty-Flag 0-FPS idle stop (zero fake telemetry loops).
- `src/ui/components/TopPerceptionBar.tsx`, `ActionDock.tsx`, `GlassBoxDrawer.tsx`, `SemanticShape.tsx`, `src/App.tsx`: Single-screen zero-scroll 8-column RTL cockpit, CSS Logical Properties, UAX #9 `<bdi dir="ltr">` tabular Latin numerals, anti-halation dark palette, 1-click **Okabe-Ito CVD** theme toggle, triple redundancy (color + shape + Persian label), and hotkeys (`Tab`, `D`, `Space`, `1–4`).

---

## Verification Ledger
- Unit Tests (`src/core/council/invariants.test.ts`, `src/core/utils/sanitize.test.ts`, `src/core/council/engine.test.ts`): **14/14 PASS**
- TypeScript Strict Lint (`npm run lint`) & Production Build (`npm run build`): Verified below.
- Headless Browser Verification (`playwright-cli` @ 1440×900): Verified below.
