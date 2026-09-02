# Architecture & Gap Audit (Engineering-first)

> Historischer Snapshot (2026-03-02, später um Habit 0.9.0 ergänzt). Aktueller Soll-Stand: [README.md](README.md), Architektur und Envelope in 0.12.0.

## Security

## Security
- ACL prefix enforcement: present.
- Action whitelist: present.
- Gap closed: bounded batch writes now protected (`maxBatchOperations`, `EBATCHLIMIT`).

## Reliability
- Gap closed: retry/backoff wrapper for adapter read/write operations.
- Gap closed: queue overload guard (`queueHighWatermark`, `EQUEUEFULL`).
- Gap closed: richer telemetry to observe failures and latency trends.

## Adapter capabilities
- Gap closed: lacked bulk state write action -> `batchSetStates`.
- Gap closed: lacked source-of-truth snapshot -> `syncSnapshot`.
- Gap closed: lacked telemetry read action -> `getTelemetry`.
- Gap closed: limited intent routing -> hot/cold comfort mapping.

## Remaining non-blocking items
- Persist telemetry window across adapter restart (currently in-memory only).
- Optional external metrics exporter (Prometheus/Influx) for long-term observability.

## Habit / autonomy (0.9.0)
- Gap closed: context events were signals only; the adapter now mines habit profiles and can optimize home automation after the learning phase.
- Safety retained: `observe` cannot auto-write, `autonomous` needs confirmation plus readiness gates, ACL/critical prefixes still apply.

## Envelope / rules (0.10.0–0.12.0, siehe aktuelle Doku)
- Gap closed: per-object AND/OR/XOR, numeric thresholds, max-on, `getConstraints` / `planWithinBounds`.
- Agent executes only inside the operator envelope; blocked writes return actionable hints.
