# ROADMAP — Amsterdam Bot

Feature **fuori scope** per la Fase 1 (MVP). Idee per estensioni future. Nel codice
trovi breadcrumb `// future: <feature>` nei punti naturali di aggancio.

## Interazione di gruppo

- ~~**Conferme di presenza ai ritrovi**~~ ✅ **Fatto** (`/presente`). Appello via
  reazione 👍 al messaggio del bot, aggregazione silenziosa in `lib/rollcall.js`,
  conteggio con `/presente` e riepilogo con `/presente stop`. _Resta da provare
  live con persone vere nel gruppo (le reazioni non si testano in locale)._
- **`/qua` — position sharing aggregator** — raccoglie le posizioni condivise e
  risponde con una mini-mappa / lista "chi è dove".
- **Mini-galleria foto** — il bot raccoglie le foto postate nel gruppo per giorno e
  a fine viaggio genera un riassunto / album.
- **`/vota <domanda>` — votazioni democratiche** — sondaggi rapidi (es. "dove si
  cena?") con conteggio reazioni.

## Utility

- ~~**`/sos` — emergenze**~~ ✅ **Fatto.** Numeri utili (112, ambasciata, polizia),
  ostello, referente — testo in `info.sos`. Insieme al pacchetto comandi info
  `/bici` `/spese` `/valigia` `/casa` `/mezzi` (factory `lib/commands/_info.js`).
- ~~**Meteo automatico**~~ ✅ **Fatto.** Ora parte del messaggio mattutino unico
  "Buongiorno" (`lib/morning.js`, evento `morning`) che fonde programma + meteo;
  comando `/meteo` on-demand. Modulo `lib/weather.js`, open-meteo (no API key).
- **`/chiedi <domanda>` — LLM concierge** — risposte libere su Amsterdam / piano
  viaggio via API LLM. Richiede una dipendenza e una chiave.
- **Diario di bordo serale** — messaggio automatico a fine giornata che riepiloga le
  tappe fatte e chiede "com'è andata?".

## Robustezza

- **Replan periodico** in `cmdRun` per recuperare drift dopo lunghe disconnessioni
  (oggi i timer sono piazzati una volta sola all'avvio).
