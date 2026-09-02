# Troubleshooting (Operator-first)

## 1) Command rejected
### Symptom
`ok: false` + `EACTIONFORBIDDEN`

### Ursache
Action nicht in `allowedActions`.

### Fix
- Request korrigieren **oder** whitelist in Adapter-Config ergänzen.

---

## 2) State blocked
### Symptom
`ok: false` + `EIDFORBIDDEN`

### Ursache
State außerhalb `allowedPrefixes`.

### Fix
- State-ID auf erlaubten Prefix umstellen.

---

## 3) Critical action pending
### Symptom
`ECONFIRMREQUIRED` + Eintrag in `safety.pendingConfirmation`.

### Fix
- Kommando mit `confirmation: true` erneut senden.

---

## 4) Learning phase not complete
### Symptom
`ENOTREADY` bei `setHabitMode` / `autonomous`

### Ursache
Zu wenige Beobachtungen, zu wenig Tage oder zu geringe Konfidenz.

### Fix
- Weiter `recordObservation` / echte Nutzeraktionen sammeln
- `getLearningStatus` prüfen
- Schwellen nur bewusst senken (`habitMinObservations`, `habitMinDays`, `habitMinConfidence`)

---

## 5) Habit not found
### Symptom
`EHABITNOTFOUND`

### Fix
- Zuerst lernen oder Szenen-Template (`habitLightStateId` / `habitScenesJson`) setzen
- `getHabits` für vorhandene Namen nutzen

---

## 6) Timeout
### Symptom
`ETIMEOUT`

### Fix
- ioBroker Last / Fremdadapter-Verfügbarkeit prüfen
- `commandTimeoutMs` moderat erhöhen

