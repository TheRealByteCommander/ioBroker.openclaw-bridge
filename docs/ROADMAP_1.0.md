# Roadmap zu 1.0.0

Stand: 0.13.0 (2026-11-23).

## Erledigt in 0.13.0

| Bereich | Punkt |
|---|---|
| Korrektheit | Serielle Queue; Timeout bricht restliche Writes ab; Idempotenz über `requestId` |
| Sicherheit | API-Token für alle Wege; REST-API öffentlich nur mit Token; menschliche Bestätigung; `sttAudioDir`; Aufräumen von `responses.*` |
| OpenClaw | REST-API, Tool-Katalog, SSE, Webhook-Push, `sendTo`, Skill und Plugin im Repo |
| Qualität | Modulstruktur, Payload-Validierung, ESLint, CI, Lockfile, 112 Tests |

## Offen bis 1.0.0

### Phase A – Praxistest

Durchgeführt am 2026-11-23 auf einer separaten Testinstanz (Docker `buanet/iobroker`, js-controller 7.2.5, Node 24) mit OpenClaw 2026.3.2. Adapter aus `npm pack` installiert.

| Prüfung | Ergebnis |
|---|---|
| Adapterstart auf echtem js-controller, `info.connection`, Token-Warnung | ok |
| Token per `iobroker object set` (verschlüsselt durch js-controller) wird korrekt gelesen | ok |
| REST-API: `health` ohne Token, `tools` ohne Token → 401, `command` mit Token | ok |
| `getConstraints` / `listStates search` / `planWithinBounds` mit Companion-Hinweis (Ventil) | ok |
| Direkter Pumpen-Write gesperrt, Plan Ventil + Pumpe schaltet in ioBroker | ok |
| `confirmationMode=human`: Agent-`confirmation:true` wirkungslos, Freigabe über `safety.confirm` | ok |
| Idempotenz (`requestId` doppelt) | ok |
| `control.command` mit Token: Antwort, Token danach als `***`, falsches Token → `EUNAUTHORIZED` | ok |
| Maximale Einschaltdauer 1 min: echtes Auto-Aus + Kontext-Event | ok |
| OpenClaw: Plugin-Installation, 13 Tools registriert | ok nach Fix (Pflichtfeld im Config-Schema entfernt, kein SDK-Import) |
| OpenClaw `/tools/invoke` → Plugin → Bridge → ioBroker (Sperre und Freigabe) | ok mit `tools.alsoAllow` |
| Bridge → Webhook `/hooks/agent` → Agent-Sitzung je Ereignis | ok (Annahme); Agent-Antwort nicht getestet, kein Sprachmodell eingerichtet |

Offen aus Phase A: Dialog mit Sprachmodell im Chat (Agent wählt Tools selbst).

### Phase B – ioBroker-Standard und Veröffentlichung

1. `@iobroker/testing` (Paket- und Integrationstests) ergänzen, Adapter-Checker grün.
2. README vollständig auf Englisch (Repo-Anforderung), Deutsch als zusätzliche Doku.
3. npm-Veröffentlichung, danach PR an `ioBroker.repositories` (latest).
4. Danach `lib/adminVersion.js` entfernen: Es greift in `system.repositories` ein und ist nur ein Workaround für die Installation per GitHub-URL.
5. GitHub-Releases für jedes Tag; veraltete Branches (`main`, gemergte `cursor/*`) löschen.

### Phase C – Funktionen nach 1.0

- Zeitfenster-Regeln (z. B. „nachts keine lauten Geräte“) als zusätzliche Bedingung in `guardRules`.
- Persistente Telemetrie und optionaler Export (Influx/Prometheus).
- Gewohnheitsdaten in Dateien statt großer JSON-States.
- Admin-Ansicht für offene Bestätigungen mit Knöpfen „Freigeben/Ablehnen“.

## Definition of Done 1.0.0

- Phase A und B abgeschlossen.
- CI und Adapter-Checker grün.
- Ende-zu-Ende-Test mit OpenClaw dokumentiert.
- Adapter auf npm und im ioBroker-`latest`-Repository.
