# Alexa TTS + Local STT Integration

Stand: **0.12.0**. Envelope und Guards gelten auch für Voice-Writes.

## Überblick

End-to-End-Sprachloop:

1. Lokales Speech-to-Text (`transcribe`)
2. Intent (`handleIntent`) — nur Operationen innerhalb der Rahmenbedingungen
3. ioBroker-Writes (ACL, Confirmation, Guards)
4. Alexa-Ausgabe (`speak`) über `alexa2`

## ioBroker-Setup

- `alexa2`-Adapter installieren.
- Schreibbaren Speak-State prüfen, z. B. `alexa2.0.<device>.Commands.speak`.
- Tab **Sprache**:
  - `alexaTtsStateId` — exakte Speak-State-ID
  - `sttCommand` — lokal, Default `faster-whisper`
  - `sttModel` — z. B. `small`
  - `sttLanguage` — z. B. `de`
- Speak-State-Prefix muss in `allowedPrefixes` liegen (Default enthält `alexa2.0`).

## Actions

### `speak`

```json
{ "action": "speak", "text": "Hallo Matthias" }
```

### `transcribe`

```json
{ "action": "transcribe", "audioPath": "/tmp/cmd.wav" }
```

Ohne `audioPath`: `ESTTEMPTY`. STT-Fehler: `ESTTFAILED`.

### `voiceCommand`

```json
{
  "action": "voiceCommand",
  "audioPath": "/tmp/cmd.wav",
  "execute": true,
  "confirmation": true,
  "speak": true,
  "speakText": "Okay, wird erledigt"
}
```

Ablauf: transcribe → `handleIntent` → Envelope-Filter → optional `speak`.

## Guardrails

- Kritische Prefixe brauchen `confirmation: true`.
- ACL (`allowedPrefixes`) und `allowedActions` gelten unverändert.
- Objekt-Regeln und Schwellwerte gelten auch für Voice: eine per Sprache angeforderte Poolheizung unter 4000 W wird blockiert (`ETHRESHOLD` / `wait_for_threshold`).

Operator-Quickstart im [../README.md](../README.md) und [OPERATOR_SETUP_FLOW.md](OPERATOR_SETUP_FLOW.md).
