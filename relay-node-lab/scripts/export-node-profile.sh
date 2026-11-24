#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Uso: $0 CONFIG_DIR https://HOST:PORT [NOME]" >&2
  exit 2
fi

CONFIG_DIR=$1
PUBLIC_URL=$2
NODE_NAME=${3:-UNVOR relay}

for file in "$CONFIG_DIR/identity-private.pem" "$CONFIG_DIR/tls-cert.pem"; do
  if [[ ! -r "$file" ]]; then
    echo "File richiesto non leggibile: $file" >&2
    exit 1
  fi
done

if [[ ! "$PUBLIC_URL" =~ ^https://[^/[:space:]]+(:[0-9]{1,5})?$ ]]; then
  echo "L'URL deve essere HTTPS, senza percorso, ad esempio https://95.217.178.73:8443" >&2
  exit 2
fi

NODE_ID=$(openssl pkey -in "$CONFIG_DIR/identity-private.pem" -pubout -outform DER | sha256sum | awk '{print $1}')
TLS_SHA256=$(openssl x509 -in "$CONFIG_DIR/tls-cert.pem" -outform DER | sha256sum | awk '{print $1}')

python3 - "$NODE_NAME" "$PUBLIC_URL" "$NODE_ID" "$TLS_SHA256" <<'PY'
import json, sys
name, url, node_id, tls_sha256 = sys.argv[1:]
print(json.dumps({
    "version": 1,
    "name": name[:48],
    "url": url.rstrip("/"),
    "nodeId": node_id,
    "tlsSha256": tls_sha256,
}, indent=2))
PY
