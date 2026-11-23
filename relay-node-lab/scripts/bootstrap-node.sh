#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Uso: sudo bash bootstrap-node.sh /etc/unvor-relay IP_PUBBLICO" >&2
  exit 2
fi

DIR=$1
PUBLIC_IP=$2
if [[ ! "$PUBLIC_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "Per questa prova inserisci un IPv4 pubblico." >&2
  exit 2
fi
install -d -m 700 "$DIR"
umask 077
openssl genpkey -algorithm ED25519 -out "$DIR/identity-private.pem"
openssl pkey -in "$DIR/identity-private.pem" -pubout -out "$DIR/identity-public.pem"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$DIR/tls-key.pem" -out "$DIR/tls-cert.pem" \
  -subj "/CN=$PUBLIC_IP" \
  -addext "subjectAltName=IP:$PUBLIC_IP" -days 30
cp "$(dirname "$0")/../config/node.example.json" "$DIR/node.json"
chown -R root:1000 "$DIR"
chmod 750 "$DIR"
chmod 640 "$DIR/identity-private.pem" "$DIR/tls-key.pem" "$DIR/node.json"
chmod 644 "$DIR/identity-public.pem" "$DIR/tls-cert.pem"
NODE_ID=$(openssl pkey -in "$DIR/identity-private.pem" -pubout -outform DER | sha256sum | awk '{print $1}')
echo "Node ID: $NODE_ID"
echo "Public key: $DIR/identity-public.pem"
echo "TLS certificate (share only with the peer operator for this lab): $DIR/tls-cert.pem"
echo "Private identity/TLS keys remain on this server. No message data was created."
