# OpenClaw-Agent: Rahmenbedingungen

Die konfigurierten Regeln sind der **Spielraum**. Der Agent plant und steuert nur darin. Die Bridge führt keine Writes außerhalb der Envelope aus.

## Vertrag

Der Operator setzt in der Instanz:

- Prefix-ACL und Action-Whitelist
- AND / OR / XOR-Bedingungen (z. B. Pumpe nur bei offenem Ventil)
- Zahlen-Schwellwerte (z. B. Poolheizung ≥ 4000 W)
- Maximale Einschaltdauer und Mindest-Auszeit
- Kritische Prefixe (brauchen `confirmation: true`)

Der Agent darf:

- States in `allowedPrefixes` lesen und (wenn die Regel es zulässt) schreiben
- Gewohnheiten lernen und nach der Lernphase optimieren
- PV-Lasten zuschalten, sobald deren Schwellwert erreicht ist
- Mehrere erlaubte Schritte in einem Plan kombinieren (Ventil, dann Pumpe)

Der Agent darf nicht:

- Regeln umgehen
- Lasten unter ihrer Watt-Schwelle einschalten
- Kritische Prefixe ohne Confirmation schreiben

## Empfohlener Loop

```text
getConstraints
    → verstehen, was jetzt erlaubt ist
planWithinBounds / handleIntent (execute=false)
    → Wunsch in allowed / blocked teilen
nur allowed ausführen (optimizeHome, applyHabit, executePlan)
    → blocked[] enthält Hints, kein Retry derselben illegalen Write
recordObservation
    → Lernen für später
```

### 1) Grenzen lesen

```json
{ "action": "getConstraints", "watts": 1200 }
```

Antwort (`data`):

- `role`: `operating_envelope`
- `rules[].currentlyAllowsTurnOn` und `rules[].hint`
- `agent.may` / `agent.mustNot`
- `surplusLoads`, `energy.watts`

### 2) Plan prüfen

```json
{
  "action": "planWithinBounds",
  "watts": 1200,
  "operations": [
    { "type": "setState", "id": "0_userdata.0.light.livingroom", "value": true },
    { "type": "setState", "id": "0_userdata.0.pool.heater", "value": true }
  ]
}
```

Licht kann `allowed` sein, Poolheizung `blocked` mit `hint.type = wait_for_threshold` und `deficit` in Watt.

### 3) Innerhalb der Grenzen handeln

`optimizeHome`, `applyHabit` und `handleIntent` (mit `execute: true`) schreiben nur `allowed`. Gesperrtes steht in `blocked[]` inklusive Hint.

Direktes `setState` auf ein gesperrtes Objekt bleibt `ok: false` und liefert denselben `error.hint`.

## Hint-Typen

| `hint.type` | Bedeutung | Nächster Schritt |
|---|---|---|
| `ok` | Innerhalb der Grenzen | Ausführen |
| `wait_for_threshold` | Schwellwert nicht erreicht | Warten oder andere Last wählen (`deficit` beachten) |
| `satisfy_any` | OR nicht erfüllt | Eine Companion-Operation (z. B. Ventil) in denselben Plan |
| `satisfy_all` | AND nicht erfüllt | Alle Companion-IDs wahr setzen |
| `satisfy_exactly_one` | XOR nicht erfüllt | Genau eine Bedingung wahr |
| `turn_off_or_wait` | Max. Einschaltdauer erreicht | Ausschalten oder Limit erhöhen |
| `wait_for_min_off` | Mindest-Auszeit läuft | Warten |
| `use_allowed_prefix` | ID außerhalb der ACL | Anderen State wählen |
| `blocked` | Sonstige Sperre | `error.nextAction` folgen |

`hint.companions` sind fertige `setState`-Operationen, die der Agent in denselben Plan legen kann (Ventil auf, dann Pumpe).

## Lernen und Autonomie

1. In `observe` nur beobachten (`recordObservation` / normale Writes).
2. `getLearningStatus` bis `readyForSuggest` / `readyForAutonomy`.
3. `setHabitMode` → `suggest` oder mit `confirmation: true` nach `autonomous`.
4. `optimizeHome` bleibt an die Envelope gebunden: PV-Lasten unter Schwelle landen in `blocked[]`.
