# ROADMAP — Amsterdam Bot

Feature **fuori scope** per la Fase 1 (MVP). Idee per estensioni future. Nel codice
trovi breadcrumb `// future: <feature>` nei punti naturali di aggancio.

## Interazione di gruppo

- **Conferme di presenza ai ritrovi** — reazione emoji (👍) al messaggio di
  reminder, il bot aggrega chi c'è / chi manca. Aggancio: `messages.reaction` in
  `lib/whatsapp.js`.
- **`/qua` — position sharing aggregator** — raccoglie le posizioni condivise e
  risponde con una mini-mappa / lista "chi è dove".
- **Mini-galleria foto** — il bot raccoglie le foto postate nel gruppo per giorno e
  a fine viaggio genera un riassunto / album.
- **`/vota <domanda>` — votazioni democratiche** — sondaggi rapidi (es. "dove si
  cena?") con conteggio reazioni.

## Utility

- **`/sos` — emergenze** — numeri utili (112, ambasciata), indirizzo ostello,
  posizione, contatto referente. Risposta immediata, niente schedulazione.
- ~~**Meteo automatico**~~ ✅ **Fatto.** Brief meteo mattutino + comando `/meteo` via
  [open-meteo.com](https://open-meteo.com) (no API key). Modulo `lib/weather.js`,
  evento dinamico `weather` (testo calcolato al fire-time via `ev.build`), sezione
  `weather` in `schedule.json`.
- **`/chiedi <domanda>` — LLM concierge** — risposte libere su Amsterdam / piano
  viaggio via API LLM. Richiede una dipendenza e una chiave.
- **Diario di bordo serale** — messaggio automatico a fine giornata che riepiloga le
  tappe fatte e chiede "com'è andata?".

## Robustezza

- **Replan periodico** in `cmdRun` per recuperare drift dopo lunghe disconnessioni
  (oggi i timer sono piazzati una volta sola all'avvio).
