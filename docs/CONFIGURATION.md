# Konfiguration — Native-Felder (0.13.0)

Quelle zur Laufzeit: Instanz-Native. UI: `admin/jsonConfig.json`. Jedes Feld hier muss in der Einstellungsseite vorkommen.

## OpenClaw (`tabOpenclaw`)

| Feld | Default | Bedeutung |
|---|---|---|
| `authToken` | leer | API-Token (verschlüsselt gespeichert). HTTP: `Authorization: Bearer <token>`. `control.command`/`sendTo`: Feld `"token"` im JSON. Leer = keine Authentifizierung (Warnung im Log) |
| `httpEnabled` | `false` | REST-API `/api/v1` einschalten |
| `httpBind` | `127.0.0.1` | Bind-Adresse. Andere als Loopback nur mit `authToken` |
| `httpPort` | `8097` | Port der REST-API |
| `openclawWebhookUrl` | leer | Gateway-Hook, z. B. `http://<openclaw-host>:18789/hooks/agent` |
| `openclawWebhookToken` | leer | `hooks.token` aus `openclaw.json` (verschlüsselt) |
| `openclawWebhookMode` | `agent` | `agent` → `/hooks/agent` (Agent-Lauf), `wake` → `/hooks/wake` (Systemereignis) |
| `openclawAgentId` | leer | Optionale Agent-ID (`agentId`) |
| `openclawDeliver` | `true` | `deliver` bei `/hooks/agent`: Reaktion im Chat melden |
| `openclawNotifyEvents` | `guard_block,max_on_elapsed,confirmation_pending,confirmation_resolved` | Zu pushende Ereignisse; zusätzlich `habit_mode_changed`, `state_changed` |
| `openclawWatchStates` | leer | IDs/Prefixe, deren Änderung als `state_changed` gepusht wird |
| `notifyMinIntervalSec` | `60` | Mindestabstand je Ereignistyp + ID |
| `confirmationMode` | `agent` | `agent`: `confirmation:true` im Request genügt. `human`: Operator bestätigt über `safety.confirm` |
| `confirmationTtlMinutes` | `10` | Offene Bestätigungen verfallen danach |
| `confirmationDenySources` | `system.adapter.simple-api,system.adapter.rest-api,system.adapter.openclaw-bridge` | Writes dieser Quellen auf `safety.confirm` werden ignoriert |
| `responseRetentionMinutes` | `60` | `responses.<requestId>` älter als das werden gelöscht |
| `idempotencyTtlMinutes` | `10` | Gleiche `requestId` in diesem Fenster → gespeicherte Antwort, keine zweite Ausführung |
| `agentHeartbeatMinutes` | `15` | `info.connection` = Kommando in diesem Fenster |

## Sicherheit (`tabSecurity`)

| Feld | Default | Bedeutung |
|---|---|---|
| `allowedPrefixes` | `javascript.0,0_userdata.0,alexa2.0` | CSV/Chips: erlaubte State-Prefixe |
| `allowedActions` | alle dokumentierten Actions | CSV-Whitelist. `ping`, `help`, `describeTools`, `getPendingConfirmations` sind immer erlaubt |
| `commandTimeoutMs` | `5000` | Timeout pro Command |
| `setStateAckAllowed` | `true` | `ack: true` in `setState` erlaubt |
| `requireExistingStates` | `true` | Schreiben nur auf existierende, schreibbare State-Objekte (`EIDUNKNOWN`, `EREADONLY`); verhindert Phantom-States durch geratene IDs |
| `criticalStatePrefixes` | `system.,admin.0` | Writes brauchen Confirmation |
| `requireConfirmationActions` | `executePlan` | Actions, die Confirmation erzwingen können |

## Regeln (`tabRules`)

| Feld | Default | Bedeutung |
|---|---|---|
| `guardRules` | `[]` | Tabelle: Zielobjekt, Wann, AND/OR/XOR, Bedingungs-IDs, Prefix, JSON-Vergleiche, Schwellwert-State/Op/Wert, max. Ein, min. Aus |

Schwellwerte werden **zusätzlich per AND** zur Kombinator-Logik geprüft.

## Geräte (`tabDevices`)

| Feld | Default | Bedeutung |
|---|---|---|
| `comfortTemperatureStateId` | `0_userdata.0.hvac.livingRoom.targetTemperature` | Ziel für „mir ist kalt/heiß“ |
| `comfortTempStep` | `1` | Kelvin-Schritt |
| `contextEventHistoryLimit` | `50` | Ringpuffer Kontext-Events |
| `pvSurplusMinWatts` | `1500` | Fallback-Schwelle, wenn `surplusLoads` leer |
| `pvSurplusLoadStateId` | `0_userdata.0.energy.pvSurplusMode` | Fallback-Last |
| `pvPowerStateId` | `0_userdata.0.energy.pvSurplusWatts` | Ist-PV für Envelope/`watts`-Overlay |
| `surplusLoads` | `[]` | Tabelle: Last, Ein ab (W), Aus unter (W) |

## Gewohnheiten (`tabHabits`)

| Feld | Default | Bedeutung |
|---|---|---|
| `habitMode` | `observe` | `observe` / `suggest` / `autonomous` |
| `habitMinObservations` | `7` | Minimum Beobachtungen für Reife |
| `habitMinDays` | `3` | Minimum Lerntage |
| `habitMinConfidence` | `0.65` | Minimum Konfidenz |
| `habitSlotMinutes` | `30` | Zeitslot-Raster |
| `habitMatchSlackMinutes` | `30` | Toleranz beim Zeitfenster |
| `habitObservationLimit` | `500` | Ringpuffer Beobachtungen |
| `habitOverrideCooldownMs` | `7200000` | Pause nach manuellem Override (2 h) |
| `habitMinApplyIntervalMs` | `1800000` | Mindestabstand zwischen Applies (30 min) |
| `habitAutoPromote` | `true` | Auto nur bis `suggest` |
| `habitLearnFromCommands` | `true` | Writes als Beobachtung speichern |
| `habitWatchPrefixes` | leer | Passive Beobachtung fremder Writes |
| `habitLightStateId` | `0_userdata.0.light.livingroom` | Default-Szene Licht |
| `habitBedtimeTemperature` | `18` | Default Gute-Nacht-Temperatur |
| `habitMorningTemperature` | `21` | Default Morgen-Temperatur |
| `habitScenesJson` | leer | Optionale Szenen-Map als JSON |

## Sprache (`tabVoice`)

| Feld | Default | Bedeutung |
|---|---|---|
| `alexaTtsStateId` | `alexa2.0.Echo-Devices.Speak` | Alexa Speak-State |
| `sttCommand` | `faster-whisper` | Lokales STT-Binary |
| `sttModel` | `small` | Whisper-Modell |
| `sttLanguage` | `de` | STT-Sprache |
| `sttAudioDir` | leer | Nur Dateien in diesem Verzeichnis werden transkribiert. Leer = `transcribe`/`voiceCommand` aus (`EAUDIOPATH`) |

## Erweitert (`tabAdvanced`)

| Feld | Default | Bedeutung |
|---|---|---|
| `retryAttempts` | `3` | Retries bei transienten Adapter-Fehlern |
| `retryBackoffMs` | `100` | Backoff-Basis |
| `maxBatchOperations` | `25` | Limit `batchSetStates` |
| `queueHighWatermark` | `100` | Max. wartende Commands, danach `EQUEUEFULL`. Commands laufen strikt nacheinander |
| `commandTimeoutMs` | `5000` | Nach Ablauf `ETIMEOUT`; noch ausstehende Writes des Plans werden nicht mehr ausgeführt |
