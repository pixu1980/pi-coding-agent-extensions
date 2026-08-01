# Execution Plan — @pixu1980/pi-ask: domande interattive stile Claude Code

Obiettivo (richiesta utente): extension per pi-coding-agent che replichi il sistema di domande
a risposta multipla / risposta singola di Claude Code, con possibilità di **aggiungere note**
o **specificare una risposta custom**, per migliorare l'esperienza quando l'agente è in
**modalità intervista** (raccolta requisiti, preferenze, conferme).

## Ricerca preliminare (fatta)

pi fornisce già gli esempi `question.ts`, `questionnaire.ts` e `qna.ts` in
`examples/extensions/` del pacchetto pi-coding-agent:

- `question.ts` — singola domanda: lista opzioni (solo frecce ↑↓) + opzione "Type something."
  con editor inline. Niente note, niente numeri rapidi, niente multi-select.
- `questionnaire.ts` — multi-domanda con tab bar, tab "Submit" di riepilogo, "Type something"
  per domanda. Solo frecce, niente note, niente multi-select.
- `qna.ts` — estrae le domande dall'ultimo messaggio dell'assistente e le carica nell'editor
  (pattern "prompt generator").

Nessuno di questi è un package installabile e nessuno implementa: **selezione con tasti numerici
(1-9)**, **note allegate alla risposta**, **multi-select**, **riepilogo modificabile prima del submit**,
**skill/command per la modalità intervista**. La nostra extension colma questo gap come package
pubblicabile nel monorepo (convenzioni come pi-path-picker).

## Decisioni di design

| Scelta | Valore |
|---|---|
| Nome package | `@pixu1980/pi-ask` (tool: `ask`, `questionnaire`; command: `/interview`) |
| Tasti | 1-9 per selezione rapida + ↑↓ + Enter; `n` per nota; `Space` per multi-select; `Tab/←→` per navigazione domande; `Esc` annulla |
| Nota | Dopo aver scelto, tasto `n` apre editor inline → la nota viaggia con la risposta nei `details` |
| Risposta custom | Opzione "Type something." con editor inline (come negli esempi, ma riusabile) |
| Multi-select | Flag `multiSelect` per domanda: checkbox `[x]/[ ]`, riepilogo con conteggio |
| Review finale | Questionnaire: tab "Submit" con riepilogo di tutte le risposte, Enter conferma, Tab torna indietro a modificare |
| Fallback non-TUI | In modalità `print`/`rpc`/`json` il tool ritorna la domanda senza risposta (come negli esempi) |
| Skill | `skills/interview/SKILL.md`: istruisce il modello a usare `ask`/`questionnaire` quando fa domande, con linee guida (max opzioni, quando usare multiSelect, ecc.) |
| Command | `/interview <topic>`: avvia la modalità intervista mandando un messaggio al modello che lo istruisce a fare domande una alla volta con `ask` |

## Phase 1 — Scaffold + fondamenti (TDD)

- [ ] 1. Scaffold `packages/pi-ask/` (package.json con manifest `pi`, peer deps, keywords `pi-package`; index.ts barrel; lib/; __tests__/; README.md; skills/)
- [ ] 2. `lib/_types.ts`: schemi TypeBox (`Option`, `Question`, `AskParams`, `QuestionnaireParams`) + tipi TS + helper puri (`normalizeQuestions`, `buildAskOptions`, `formatAnswerSummary`)
- [ ] 3. Test `__tests__/_types.test.mjs`: validazione schemi + helper puri (prima falliscono, poi passano)

## Phase 2 — Tool `ask` (domanda singola)

- [ ] 4. `lib/_ask.ts`: componente `ctx.ui.custom` — opzioni numerate (1-9 + frecce), nota con `n`, "Type something", multi-select opzionale, fallback non-TUI
- [ ] 5. Registrazione tool in `index.ts` con `renderCall`/`renderResult` compatti
- [ ] 6. Test: logica selezione/nota/custom/multi (separata dalla UI in `_logic.ts` per testabilità)

## Phase 3 — Tool `questionnaire` (multi-domanda)

- [ ] 7. `lib/_questionnaire.ts`: tab bar (domande + Submit), nota per domanda, custom per domanda, multi-select per domanda, riepilogo modificabile
- [ ] 8. Registrazione tool + `renderCall`/`renderResult`
- [ ] 9. Test: navigazione, mappa risposte, submit/cancel

## Phase 4 — Modalità intervista

- [ ] 10. `skills/interview/SKILL.md` (guidelines per il modello: quando usare `ask` vs `questionnaire`, come formulare opzioni)
- [ ] 11. Command `/interview <topic>`: messaggio al modello che lo istruisce a porre domande una alla volta via `ask`
- [ ] 12. Test: skill esiste e command registrato (test harness del monorepo)

## Phase 5 — Polish + docs + release

- [ ] 13. README completo (install, usage, tasti, GIF/banner come gli altri package)
- [ ] 14. `test:all` del monorepo verde + verifica manuale con `pi -e .`
- [ ] 15. Bump versione 0.1.0 + CHANGELOG + tag + publish npm (`node scripts/release.mjs`)

## Fuori scope (candidati futuri)

- Overlay flottante (pattern `overlay-qa-tests.ts`) per rispondere senza perdere il contesto
- Estrazione automatica domande dall'ultimo messaggio (`qna.ts`) come command `/qna`
- Preferenze utente persistenti (risposta "always" / "remember")
