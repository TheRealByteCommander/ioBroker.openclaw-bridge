# DEPLOYMENT PLAN

Stand: Adapter **0.12.0** (Tag `v0.12.0`).

## 1. Pre-deploy

- Code auf dem Host aktualisieren (git tag `v0.12.0` oder neuer).
- Instanz-Einstellungsseite prüfen:
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

1. `ping` — `version` = `0.12.0`
2. `help` — `envelope.actions` enthält `getConstraints`
3. `getConstraints`
4. `planWithinBounds` mit einer erlaubten und einer gesperrten Write
5. `syncSnapshot` / `getTelemetry`
6. Negativ: überlanges `batchSetStates` → `EBATCHLIMIT`
7. Optional: `handlePvSurplus` unter/über Last-Schwelle
8. Optional: `voiceCommand` nur wenn STT/Alexa konfiguriert

## 4. Rollback

- Vorheriges Git-Tag auschecken (vor diesem Stand: `v0.12.0` war der erste gebündelte Tag nach 0.8.0-Inhalten auf master).
- Adapterinstanz neu starten.
- Native-Felder `guardRules` / `surplusLoads` sind ab 0.10/0.11 relevant; ältere Versionen ignorieren sie.
