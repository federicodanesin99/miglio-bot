# Deployment — NucBox G9 (Ubuntu) come servizio

Guida per far girare l'Amsterdam Bot 24/7 sul **NucBox G9** (Ubuntu, x86_64) come
servizio **systemd**, con riavvio automatico e avvio al boot. Da fare **prima del
30/05** (giorno in cui il bot deve partire e restare acceso per tutto il viaggio).

> Il bot è un singolo processo Node (`node index.js run`) che, una volta avviato,
> schedula da solo tutti gli eventi dei 5 giorni e risponde ai comandi nel gruppo.
> Vedi `CLAUDE.md` per l'architettura.

---

## 0. Prerequisiti

- NucBox G9 con **Ubuntu** (Server o Desktop) e accesso **SSH** (o tastiera+monitor).
- Il **telefono** con l'account WhatsApp del bot (per scansionare il QR una volta).
- Connessione internet sul NucBox.

---

## 1. Prendere il codice sul NucBox

```bash
# via SSH sul NucBox, come utente normale (es. "nuc")
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/federicodanesin99/miglio-bot.git
cd miglio-bot
git checkout ams-guide        # il branch con tutte le feature (meteo, /presente, info…)
```

> In alternativa al clone, puoi copiare la cartella col `rsync` dal tuo PC:
> `rsync -av --exclude node_modules --exclude auth ./miglio-bot/ nuc@IP:~/miglio-bot/`

---

## 2. Verificare la configurazione

`schedule.json` è già popolato (JID del gruppo, piano dei 5 giorni, meteo, info).
Controlla solo che siano corretti:

```bash
grep -E '"whatsappId"|"adminChatId"' schedule.json
```

- `group.whatsappId` → il gruppo reale (`120363…@g.us`).
- `adminChatId` → il tuo numero (`39…@s.whatsapp.net`), riceve ping di avvio ed errori.

> ⚠️ **Privacy**: `schedule.json` contiene numero admin, JID gruppo e link Splitwise
> ed è versionato su GitHub. Se il repo è pubblico, valuta di renderlo privato.

---

## 3. Eseguire lo script di deploy

```bash
./deploy/deploy.sh
```

Lo script (utente normale, **non** sudo — lo chiama lui dove serve):

1. installa **Node 20 LTS** se manca (o se < 18) via NodeSource;
2. installa le dipendenze di produzione (`npm ci/install --omit=dev`);
3. genera e installa `/etc/systemd/system/amsterdam-bot.service` (con utente, path e
   binario `node` giusti) e lo **abilita all'avvio**;
4. se manca la sessione WhatsApp, ti dice come fare il pairing.

---

## 4. Pairing WhatsApp (una volta sola)

La cartella `auth/` **non** è nel repo: va creata sul NucBox scansionando il QR.

```bash
node index.js setup        # appare un QR ASCII nel terminale
```

Sul telefono: **WhatsApp → Impostazioni → Dispositivi collegati → Collega un
dispositivo** e inquadra il QR. Attendi il messaggio di sync, poi **Ctrl+C**.

Sanity check facoltativo:

```bash
node index.js validate     # conteggi eventi, deve dire "Config valida"
node index.js groups "Amsterdam 2026"   # conferma il JID del gruppo
```

---

## 5. Avviare il servizio

```bash
sudo systemctl start amsterdam-bot
journalctl -u amsterdam-bot -f     # log in tempo reale (Ctrl+C per uscire)
```

All'avvio l'admin riceve un messaggio WhatsApp "🤖 Amsterdam Bot attivo".
Il servizio riparte da solo al reboot e in caso di crash (`Restart=on-failure`).

---

## 6. Tenere sveglio il NucBox

Su Ubuntu **Desktop** la macchina può sospendersi. Per un servizio always-on,
disabilita la sospensione:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

E in Impostazioni → Energia metti "Sospensione automatica: Mai" / schermo pure.
(Ubuntu **Server** di norma non sospende: questo passo non serve.)

---

## 7. Operatività

```bash
sudo systemctl status amsterdam-bot      # stato
journalctl -u amsterdam-bot -f           # log live
journalctl -u amsterdam-bot --since today
sudo systemctl restart amsterdam-bot     # riavvia
sudo systemctl stop amsterdam-bot        # ferma
```

I log applicativi giornalieri stanno anche in `logs/bot-YYYY-MM-DD.log`.

### Aggiornare dopo una modifica al codice/piano

```bash
cd ~/miglio-bot
git pull
./deploy/deploy.sh                       # reinstalla deps + unit, poi riavvia
# (oppure solo: sudo systemctl restart amsterdam-bot, se hai cambiato solo schedule.json)
```

> `state.json` (eventi già inviati) **non** viene toccato: un riavvio non rimanda i
> messaggi già partiti. Cancellalo solo se vuoi davvero ri-inviare tutto.

---

## 8. Troubleshooting

| Sintomo | Causa / Rimedio |
|---|---|
| Servizio in `failed`, log "Logged out" | WhatsApp ha scollegato il dispositivo. Ferma il servizio, `rm -rf auth/`, rifai `node index.js setup`, riavvia. |
| Crash-loop e poi `failed` | Superato `StartLimitBurst` (5 in 5 min). Risolvi la causa nei log, poi `sudo systemctl reset-failed amsterdam-bot && sudo systemctl start amsterdam-bot`. |
| Riconnessioni continue nei log | Normale dopo brevi cali di rete: l'app si riconnette da sola (backoff). Se persiste, controlla la connessione del NucBox. |
| Nessun messaggio all'orario atteso | Verifica `node index.js next` e che l'ora/timezone del bot sia giusta (`Europe/Amsterdam`, già forzata dal codice). |
| `node: command not found` nel servizio | Rilancia `./deploy/deploy.sh`: rigenera la unit col path assoluto di `node`. |

---

## Riferimento rapido

| Cosa | Comando |
|---|---|
| Deploy / update | `./deploy/deploy.sh` |
| Pairing | `node index.js setup` |
| Avvia / ferma / riavvia | `sudo systemctl start\|stop\|restart amsterdam-bot` |
| Stato / log | `systemctl status amsterdam-bot` · `journalctl -u amsterdam-bot -f` |
| Anteprima eventi | `node index.js next` · `node index.js schedule` |
