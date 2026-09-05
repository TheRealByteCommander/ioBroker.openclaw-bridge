# RELEASE READINESS

## Status

- Version: **0.12.4**
- Engineering: GREEN
- Test suite: GREEN (`npm test` — 55/55)
- P1 blockers: none
- Git-Tag: `v0.12.0`

## Checklist

- [x] Secure action whitelist + ACL prefix enforcement
- [x] Queue overload protection
- [x] Retry/backoff for transient adapter operations
- [x] Batched write flow (`batchSetStates`)
- [x] State sync snapshot flow (`syncSnapshot`)
- [x] Rich telemetry endpoint (`getTelemetry`)
- [x] Conversational intents, PV surplus, Alexa TTS / local STT
- [x] Habit learning phases (`observe` → `suggest` → `autonomous`)
- [x] Typical ioBroker admin settings page (`jsonConfig`)
- [x] Object rules (AND/OR/XOR, max-on, min-off)
- [x] Numeric thresholds and per-load PV surplus switching
- [x] Operating envelope (`getConstraints`, `planWithinBounds`, hints)
- [x] `package.json` / `io-package.json` version aligned (0.12.0)
- [x] `common.news` only 0.10.0–current (no 0.9.x keys; Admin string-compare)
- [x] CHANGELOG.md
- [x] LICENSE (MIT)
- [x] Negative path tests for oversized batches, guards, thresholds, envelope
- [x] Documentation matches 0.12.0 (README, actions, configuration, agent contract, operator guides)
- [x] Docs drift test (`test/docs.test.js`) covers actions, native keys and current version

## Known risks

- Queue/telemetry are in-memory (reset on adapter restart).
- For HA persistence, external metrics export should be added later.
- Time-window policies (e.g. no loud devices at night) are still on the roadmap.
