# Amsterdam Bot 🇳🇱

Bot WhatsApp (Baileys, un account, **un solo gruppo**) per il viaggio di gruppo a
Amsterdam (30/05 → 03/06 2026, ~15 persone). Manda **promemoria selettivi** solo
per le tappe che richiedono coordinamento di gruppo e risponde a comandi tipo
`/oggi` nel gruppo.

Adattamento multi-day del bot "Miglio d'Oro". Vedi **`CLAUDE.md`** per
l'architettura completa e lo schema di `schedule.json`.

## Quickstart

```bash
npm install

# 1. Pairing una tantum (scansiona il QR col telefono, poi Ctrl+C)
node index.js setup

# 2. Trova il JID del gruppo WhatsApp del viaggio
node index.js groups            # oppure: node index.js groups "Amsterdam 2026"
#  → copia l'ID 120363…@g.us nel campo group.whatsappId di schedule.json
#  → copia il tuo numero (…@s.whatsapp.net) in adminChatId

# 3. Edita schedule.json (orari, tappe, notify, testi)

# 4. Verifica
npm run validate                # conteggi + warning sui placeholder
node index.js schedule          # dry-run di TUTTO il viaggio
EVENT_DATE=2026-05-31 node index.js schedule   # dry-run di un singolo giorno

# 5. Prova dal vivo su un gruppo di test (1 giornata in ~1 minuto)
node index.js test-day 2026-05-31 <jid_gruppo_test>

# 6. Produzione (lasciare la finestra aperta dal 30/05)
node index.js run
```

> Su **PowerShell** usa `$env:EVENT_DATE="2026-05-31"; node index.js schedule`.
> Evita git-bash per i comandi con argomenti tipo `"/oggi"` (MSYS riscrive lo slash).

## Comandi

| Comando | Cosa fa |
|---|---|
| `setup` | Pairing QR (una volta) |
| `groups [nomi…]` | Lista gruppi WhatsApp + JID |
| `validate` | Valida `schedule.json` + conteggi eventi |
| `schedule` | Dry-run: stampa cosa verrebbe inviato (`EVENT_DATE` filtra il giorno) |
| `next` | Prossime 10 cose schedulate |
| `run` | Produzione: connette e schedula tutto il viaggio |
| `test-command "/oggi"` | Esegue un comando in locale, senza WhatsApp |
| `test-send <jid> <msg>` | Invia un messaggio arbitrario a un JID |
| `test-day <data> [jid]` | Manda ORA tutti i messaggi di quel giorno |
| `test-stop <stop_id> [jid]` | Manda ORA il reminder di una singola tappa |

ENV: `EVENT_DATE=YYYY-MM-DD` filtra al giorno · `TEST_JID=<jid>` punta il bot a un
gruppo di test senza toccare `schedule.json`.

## Comandi nel gruppo (inbound)

Rispondono solo nel gruppo configurato o in DM dall'admin:

| Comando | Cosa fa |
|---|---|
| `/oggi` `/domani` `/prossimo` | Programma del giorno / prossima tappa |
| `/dove <nome>` | Cerca un luogo nel piano |
| `/meteo` | Previsioni oggi + domani (open-meteo) |
| `/presente` | Appello: chi c'è? (reagite 👍) · `/presente stop` chiude |
| `/bici` `/valigia` `/casa` `/mezzi` `/sos` | Info utili (noleggio, checklist, ostello, trasporti, emergenze) |
| `/mvp @nome punti motivo` | Assegna punti MVP (budget giornaliero per votante) · senza argomenti mostra budget + classifica |
| `/classifica` | Classifica MVP corrente |
| `/help` | Elenco comandi |

Ogni mattina dei giorni ad Amsterdam il bot manda un **messaggio "Buongiorno"** che
fonde **programma del giorno + meteo** (dati [open-meteo.com](https://open-meteo.com),
nessuna API key). Si configura nelle sezioni `weather` e `info` di `schedule.json`.

## Deployment (NucBox G9 / Ubuntu)

Per farlo girare 24/7 come servizio systemd vedi **[`DEPLOY.md`](./DEPLOY.md)**.
In breve, sul device:

```bash
git clone https://github.com/federicodanesin99/miglio-bot.git && cd miglio-bot
git checkout ams-guide
./deploy/deploy.sh          # installa Node, deps e il servizio
node index.js setup         # pairing QR (una volta)
sudo systemctl start amsterdam-bot
```

## Roadmap

Feature future in [`ROADMAP.md`](./ROADMAP.md).
