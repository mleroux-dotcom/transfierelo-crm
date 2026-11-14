#!/usr/bin/env bash
# Instalador de fuentes-mcp para macOS / Linux.
set -e
cd "$(dirname "$0")/mcp-server"
if ! command -v node >/dev/null 2>&1; then
  echo "No tienes Node.js. Instala la versión LTS (22+) desde https://nodejs.org y vuelve a ejecutar este script."
  exit 1
fi
node scripts/instalar.mjs "$@"
