# Troubleshooting (Operator-first)

Stand: **0.12.0**. Envelope-Hints: [OPENCLAW_AGENT.md](OPENCLAW_AGENT.md).

Strukturierte Fehler enthalten `code`, `message`, `details`, `nextAction` und oft `hint`.

## 1) Command rejected

**Symptom:** `ok: false` + `EACTIONFORBIDDEN`

**Ursache:** Action nicht in `allowedActions`.

**Fix:** Request korrigieren oder Whitelist im Tab **Sicherheit**.

---

## 2) State blocked (ACL)

**Symptom:** `EIDFORBIDDEN`

**Ursache:** State außerhalb `allowedPrefixes`.

**Fix:** ID auf erlaubten Prefix; Hint kann `use_allowed_prefix` sein.

---

## 3) Critical action pending

**Symptom:** `ECONFIRMREQUIRED` + `safety.pendingConfirmation`

**Fix:** Kommando mit `confirmation: true` erneut senden.

---

## 4) Learning phase not complete

**Symptom:** `ENOTREADY` bei `setHabitMode` → `autonomous`

**Ursache:** Zu wenige Beobachtungen, Tage oder Konfidenz.

**Fix:** Weiter `recordObservation` / echte Writes, `getLearningStatus` prüfen, Schwellen nur bewusst senken.

---

## 5) Habit not found

**Symptom:** `EHABITNOTFOUND`

**Fix:** Lernen oder Szenen-Template (`habitLightStateId` / `habitScenesJson`). Namen via `getHabits`.

---

## 6) Guard / Envelope blocked

**Symptom:** `EGUARDFAILED` / `ETHRESHOLD` / `EDURATIONLIMIT` / `ECOOLDOWN`, Eintrag in `safety.lastGuardBlock`, `error.hint`

**Ursache:** AND/OR/XOR nicht erfüllt, PV-Schwellwert zu niedrig, max. Ein erreicht, min. Aus läuft.

**Fix:**

- `hint.type` und `hint.companions` / `hint.deficit` lesen
- Ventile im selben Plan mitschalten
- Tab **Regeln** und `getConstraints` prüfen
- Dry-Run: `{ "action": "checkGuards", "id": "...", "value": true }`
- Plan splitten: `{ "action": "planWithinBounds", "operations": [ ... ] }`

---

## 7) Ack forbidden

**Symptom:** `EACKFORBIDDEN`

**Fix:** `ack` weglassen oder `setStateAckAllowed` aktivieren.

---

## 8) Queue / Batch / Timeout

| Code | Fix |
|---|---|
| `EQUEUEFULL` | Last senken, später retry (`queueHighWatermark`) |
| `EBATCHLIMIT` | Weniger Operationen (`maxBatchOperations`) |
| `ETIMEOUT` | Fremdadapter prüfen, `commandTimeoutMs` moderat erhöhen |
| `EBADJSON` / `EBADREQUEST` | Payload laut `help` / [ACTIONS.md](ACTIONS.md) korrigieren |
| `ESTTFAILED` / `ESTTEMPTY` | Audio-Pfad und `sttCommand` prüfen |

---

## 9) Mode forbidden

**Symptom:** `EMODEFORBIDDEN`

**Fix:** Nur `observe`, `suggest` oder `autonomous`.
