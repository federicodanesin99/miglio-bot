#!/usr/bin/env bash
# deploy/deploy.sh — installa l'Amsterdam Bot come servizio systemd su Ubuntu.
#
# Eseguire DALLA cartella del progetto, come utente NORMALE (NON con sudo: lo
# script chiama sudo solo dove serve, così node_modules/ e auth/ restano del tuo
# utente). Idempotente: rilanciabile per aggiornare deps e unit.
#
#   ./deploy/deploy.sh
set -euo pipefail

SERVICE_NAME="amsterdam-bot"
MIN_NODE_MAJOR=18
NODE_INSTALL_MAJOR=20   # versione installata se Node manca o è troppo vecchio

# --- 0. posizione & utente -------------------------------------------------
APPDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # root progetto (parent di deploy/)
cd "$APPDIR"
if [[ ! -f index.js ]]; then
  echo "❌ index.js non trovato in $APPDIR" >&2; exit 1
fi
if [[ "${EUID}" -eq 0 ]]; then
  echo "❌ Non lanciare con sudo/root. Esegui da utente normale: ./deploy/deploy.sh" >&2; exit 1
fi
RUN_USER="$USER"
echo "📂 App dir:        $APPDIR"
echo "👤 Utente servizio: $RUN_USER"

# --- 1. Node.js ------------------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  cur="$(node -p 'process.versions.node.split(".")[0]')"
  if (( cur >= MIN_NODE_MAJOR )); then need_node=0; echo "✅ Node $(node -v) già presente"; fi
fi
if (( need_node )); then
  echo "⬇️  Installo Node.js ${NODE_INSTALL_MAJOR} LTS (NodeSource)…"
  sudo apt-get update -y
  sudo apt-get install -y curl ca-certificates
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_INSTALL_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi
NODE_BIN="$(command -v node)"
echo "🟢 Node: $NODE_BIN ($(node -v))"

# --- 2. dipendenze ---------------------------------------------------------
echo "📦 Installo dipendenze (solo produzione)…"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi

# --- 3. unit systemd -------------------------------------------------------
echo "🛠️  Genero /etc/systemd/system/${SERVICE_NAME}.service…"
sed -e "s#__USER__#${RUN_USER}#g" \
    -e "s#__APPDIR__#${APPDIR}#g" \
    -e "s#__NODE__#${NODE_BIN}#g" \
    "$APPDIR/deploy/${SERVICE_NAME}.service" \
  | sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}" >/dev/null
echo "✅ Servizio installato e abilitato all'avvio."

# --- 4. sessione WhatsApp / avvio -----------------------------------------
if [[ -d "$APPDIR/auth" && -n "$(ls -A "$APPDIR/auth" 2>/dev/null)" ]]; then
  echo "🔐 Sessione WhatsApp presente. (Ri)avvio il servizio…"
  sudo systemctl restart "${SERVICE_NAME}"
  sleep 2
  sudo systemctl --no-pager --lines=0 status "${SERVICE_NAME}" || true
  echo "📜 Log live:  journalctl -u ${SERVICE_NAME} -f"
else
  cat <<EOF

⚠️  Manca la sessione WhatsApp (cartella auth/ assente o vuota).
   Fai il pairing UNA volta, poi avvia il servizio:

     cd "$APPDIR"
     node index.js setup       # scansiona il QR col telefono, attendi il sync, Ctrl+C
     node index.js validate    # sanity check della config
     sudo systemctl start ${SERVICE_NAME}
     journalctl -u ${SERVICE_NAME} -f
EOF
fi
