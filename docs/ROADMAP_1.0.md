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

### Phase A – Praxistest (Pflicht)

1. Test auf einer **separaten** ioBroker-Testinstanz (z. B. `dev-server` oder Docker), nicht auf dem Produktivsystem.
2. Ende-zu-Ende mit echtem OpenClaw-Gateway: Skill **und** Plugin laden, `ping`, `getConstraints`, gesperrter `planWithinBounds` auf eine Interlock-Regel, Freigabe einer kritischen Aktion über `safety.confirm`, Webhook-Ereignis im Chat.
3. Ergebnis als Abschnitt in dieser Datei dokumentieren; Plugin-Hinweis in `openclaw/README.md` entsprechend anpassen.

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
