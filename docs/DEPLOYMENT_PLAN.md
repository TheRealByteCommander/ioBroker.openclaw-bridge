# DEPLOYMENT PLAN

Stand: Adapter **0.13.2** (Tag `v0.13.2`).

## 1. Pre-deploy

- Code auf dem Host aktualisieren: `iobroker url https://github.com/TheRealByteCommander/ioBroker.openclaw-bridge#v0.13.2`.
- Vorher Backup der Instanz-Einstellungen (Admin → Instanz → Export) und `iobroker backup`.
- Instanz-Einstellungsseite prüfen:
  - **OpenClaw:** API-Token setzen, REST-API und Bind-Adresse, optional Webhook und Bestätigungsmodus
  - **Sicherheit:** `allowedPrefixes`, `allowedActions`, Timeouts
  - **Regeln:** `guardRules` (Interlocks, Schwellwerte, max. Ein)
  - **Geräte:** `pvPowerStateId`, `surplusLoads`
  - **Gewohnheiten:** Mode und Schwellen
  - **Erweitert:** `retryAttempts`, `maxBatchOperations`, `queueHighWatermark`

## 2. Deploy

```bash
npm ci
npm test
```

ioBroker-Adapterinstanz neu starten.

## 3. Post-deploy validation

Über `control.command`:

1. `ping` — `version` = `0.13.0` (Admin-Knopf **Bridge testen**)
2. `help` — `envelope.actions` enthält `getConstraints`
3. `getConstraints`
4. `planWithinBounds` mit einer erlaubten und einer gesperrten Write
5. `syncSnapshot` / `getTelemetry`
6. Negativ: überlanges `batchSetStates` → `EBATCHLIMIT`
7. Optional: `handlePvSurplus` unter/über Last-Schwelle
8. Optional: `voiceCommand` nur wenn STT/Alexa und `sttAudioDir` konfiguriert
9. REST-API: `curl http://<host>:8097/api/v1/health`, ohne Token → 401 bei `/api/v1/tools`
10. Webhook: Admin-Knopf **Testereignis senden**
11. `info.connection` wird nach dem ersten Agent-Kommando `true`

## 4. Rollback

- Vorheriges Tag installieren: `iobroker url https://github.com/TheRealByteCommander/ioBroker.openclaw-bridge#v0.12.5`.
- Adapterinstanz neu starten.
- Native-Felder `guardRules` / `surplusLoads` sind ab 0.10/0.11 relevant; ältere Versionen ignorieren sie.
- Die neuen 0.13.0-Felder (Token, REST-API, Webhook) werden von 0.12.x ignoriert. Mit gesetztem Token muss die Skill nach einem Rollback ohne Token arbeiten.
