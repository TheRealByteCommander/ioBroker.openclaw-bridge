# RELEASE READINESS

## Status

- Version: **0.13.0**
- Lint: GREEN (`npm run lint`)
- Test suite: GREEN (`npm test` — 112 Tests)
- CI: `.github/workflows/test.yml` (Node 20/22)

## Checklist 0.13.0

- [x] Serielle Command-Queue (keine parallelen Regel-Umgehungen)
- [x] Timeout bricht restliche Writes ab
- [x] Idempotenz über `requestId` / `Idempotency-Key`
- [x] `authToken` (encryptedNative/protectedNative) für alle Transportwege
- [x] REST-API mit Startup-Policy (öffentliche Adresse nur mit Token)
- [x] Ereignis-Push an OpenClaw (`/hooks/agent`, `/hooks/wake`), gedrosselt
- [x] SSE-Stream `/api/v1/events`
- [x] `sendTo` (`command`, `confirm`, `reject`, `tools`) und Admin-Testknöpfe
- [x] Menschliche Bestätigung (`confirmationMode = human`, `safety.confirm`)
- [x] `sttAudioDir` begrenzt Dateizugriff von `transcribe`
- [x] `responses.*` werden nach Aufbewahrungszeit gelöscht
- [x] `info.connection` (Agent aktiv)
- [x] Payload-Validierung aus dem Action-Katalog
- [x] OpenClaw-Skill und -Plugin im Repo, End-to-End-Test Plugin → HTTP → Bridge
- [x] ESLint, `package-lock.json`, `engines`, `files`
- [x] Doku: README, ACTIONS, CONFIGURATION, ANLEITUNG, HANDBOOK, openclaw/README

## Known risks

- OpenClaw-Plugin-SDK ist experimentell; Plugin gegen dokumentierte API und Test-Attrappe geprüft, nicht gegen ein laufendes Gateway. Skill als Fallback.
- Telemetrie und Idempotenz-Cache sind im Speicher (Neustart setzt zurück).
- `lib/adminVersion.js` greift in `system.repositories` ein; entfällt erst mit Veröffentlichung über npm/ioBroker-Repo (siehe [ROADMAP_1.0.md](ROADMAP_1.0.md)).
- Zeitfenster-Regeln (z. B. nachts keine lauten Geräte) fehlen noch.
