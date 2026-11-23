#!/usr/bin/env bash
set -euo pipefail
umask 077
[ "$(id -u)" = 0 ] || { echo "Esegui sul VPS come root."; exit 1; }
exec 9>/run/ultron-gateway-update.lock
flock -n 9 || { echo "Aggiornamento già in corso."; exit 1; }
proxy=ultron-https
config_path=/etc/caddy/Caddyfile
pilot=https://49.12.242.0/ratchet-pilot
next=unvor-gateway-allegati-50mb-v1
config=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$proxy")
if [ -z "$config" ]; then
  dir=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$proxy")
  config="${dir:?Mount Caddy non trovato}/Caddyfile"
fi
test -f "$config"
old=$(python3 - "$config" <<'PY_ROUTE'
from pathlib import Path
import re,sys
names=re.findall(r'(?m)^\s*reverse_proxy @pilot_api ([a-zA-Z0-9_.-]+):8002\s*$',Path(sys.argv[1]).read_text())
if len(names)!=1: raise SystemExit('Instradamento pilota non univoco. Nessuna modifica.')
print(names[0])
PY_ROUTE
)
if [ "$old" = "$next" ]; then
  curl -fsS --max-time 8 "$pilot/api/health" >/dev/null
  echo "Gateway allegati 50 MB già attivo; usa la nuova APK."
  exit 0
fi
if docker inspect "$next" >/dev/null 2>&1; then
  echo "Esiste già il candidato $next. Verificare il tentativo precedente prima di ripartire."
  exit 1
fi
mount=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/usr/local/bin/ultron-gateway"}}{{.Source}}{{end}}{{end}}' "$old")
case "$mount" in /opt/ultron-network/test/*/target/debug/*) ;; *) echo "Sorgenti del gateway attivo non individuati. Nessuna modifica."; exit 1;; esac
source_dir=${mount%/target/debug/*}
test -d "$source_dir/src"
stage=/opt/ultron-network/test/unvor-allegati-50mb.8ObFhB
[ -d "$stage/src" ] || { echo "Compilazione precedente non trovata; nessuna modifica."; exit 1; }
started=0; changed=0; stopped=0; success=0
cleanup(){
  set +e
  rm -f "$stage/gateway.env"
  if (( success )); then return; fi
  if (( stopped )); then docker start "$old" >/dev/null; fi
  if (( changed )); then cat "$stage/Caddyfile.original" > "$config"; docker exec "$proxy" caddy reload --config "$config_path" --adapter caddyfile; fi
  if (( started )); then docker rm -f "$next" >/dev/null; fi
  echo "Aggiornamento non attivato. Sorgenti e backup: $stage" >&2
}
trap cleanup EXIT
cp "$config" "$stage/Caddyfile.original"
python3 - "$source_dir" "$stage" <<'PY_RESUME'
from pathlib import Path
import hashlib,sys
source,stage=map(Path,sys.argv[1:])
changed={'src/main.rs','src/mobile_chat/blobs.rs','src/mobile_chat/group_files.rs'}
for rel in ['Cargo.toml','Cargo.lock']+[str(p.relative_to(source)) for p in (source/'src').rglob('*') if p.is_file()]:
 if rel not in changed and (not (stage/rel).is_file() or (source/rel).read_bytes()!=(stage/rel).read_bytes()):
  raise SystemExit('Il gateway attivo è cambiato: ripresa interrotta senza modifiche.')
if hashlib.sha256((stage/'src/mobile_chat/group_files.rs').read_bytes()).hexdigest()!='afa4541cae73f5a425fdfe6a9eeba9c7410cac9f967909ec73983f004c3a7005':
 raise SystemExit('Sorgente allegati diverso da quello verificato.')
text=(stage/'src/mobile_chat/blobs.rs').read_text()
if 'const MAX_SIZE: i64 = 50 * 1024 * 1024;' not in text or 'const MAX_PARTS: i64 = 13;' not in text:
 raise SystemExit('Limiti allegati non riconosciuti.')
if 'post(mobile_chat::group_files::upload).layer(axum::extract::DefaultBodyLimit::max(mobile_chat::blobs::MAX_CHUNK))' not in (stage/'src/main.rs').read_text():
 raise SystemExit('Route allegati non riconosciuta.')
PY_RESUME
binary=$(awk -F'"' '/^name = "/ {print $2;exit}' "$stage/Cargo.toml")
case "$binary" in ultron-gateway|lattice-gateway) ;; *) exit 1;; esac
test -x "$stage/target/debug/$binary"
echo "Riutilizzo la compilazione completata; verifico il candidato prima di attivarlo."
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$old" > "$stage/gateway.env"
python3 - "$stage/gateway.env" <<'PY_ENV'
from pathlib import Path
import sys
lines=Path(sys.argv[1]).read_text().splitlines()
values=dict(line.split('=',1) for line in lines if '=' in line)
if values.get('DB_NAME')!='ultron_ratchet_pilot' or 'ultron-ratchet-pilot-db' not in values.get('MONGO_URL',''):
 raise SystemExit('Database pilota non identificato: aggiornamento interrotto.')
PY_ENV
mapfile -t nets < <(docker inspect -f '{{range $name, $net := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$old")
primary=ultron-ratchet-pilot-net
docker network inspect "$primary" >/dev/null
image=$(docker inspect -f '{{.Image}}' "$old")
docker run -d --name "$next" --restart unless-stopped --network "$primary" --ulimit core=0  --log-opt max-size=5m --log-opt max-file=2 --env-file "$stage/gateway.env"  --mount "type=bind,source=$stage/target/debug/$binary,target=/usr/local/bin/ultron-gateway,readonly"  "$image" /usr/local/bin/ultron-gateway >/dev/null
started=1
for net in "${nets[@]}"; do if [ -n "$net" ] && [ "$net" != "$primary" ]; then docker network connect "$net" "$next"; fi; done
for attempt in {1..60}; do
 if docker exec "$next" wget -q -T 2 -O /dev/null http://127.0.0.1:8002/api/health 2>/dev/null; then break; fi
 sleep 1
done
docker exec "$next" wget -q -T 2 -O /dev/null http://127.0.0.1:8002/api/health
ip=$(docker inspect -f '{{with index .NetworkSettings.Networks "ultron-test-net"}}{{.IPAddress}}{{end}}' "$next")
test -n "$ip"
echo "Provo 50 MB, ritentativi, isolamento, gruppi e quiz con account temporanei."
python3 - "http://$ip:8002" <<'PY_SMOKE'
import json
import secrets
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.request import Request, urlopen

origin = sys.argv[1]
prefix = bytes.fromhex("308207b2300b0609608648016503040312038207a100")
identities = []

def request(path, data=None, token=None, expected=200, method=None):
    payload = data if isinstance(data, bytes) else None if data is None else json.dumps(data).encode()
    headers = {"Content-Type": "application/octet-stream" if isinstance(data, bytes) else "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = Request(origin + "/api" + path, data=payload, headers=headers, method=method)
    try:
        with urlopen(req, timeout=12) as response:
            if response.status != expected:
                raise RuntimeError(f"{path}: HTTP {response.status}, atteso {expected}")
            return response.read() if response.headers.get_content_type() == "application/octet-stream" else json.load(response)
    except HTTPError as exc:
        with exc:
            if exc.code != expected:
                raise RuntimeError(f"{path}: HTTP {exc.code}, atteso {expected}") from exc
            return None


def openssl(*args):
    return subprocess.run(["openssl", *args], check=True, capture_output=True, timeout=15).stdout

def make_account(folder):
    username = "ultron-prova-" + secrets.token_hex(6)
    identity = username + "@ultron.uns"
    key = str(Path(folder) / (username + ".pem"))
    message = Path(folder) / (username + ".txt")
    openssl("genpkey", "-algorithm", "ML-DSA-65", "-out", key)
    public = openssl("pkey", "-in", key, "-pubout", "-outform", "DER")
    if not public.startswith(prefix) or len(public) != len(prefix) + 1952:
        raise RuntimeError("Chiave ML-DSA di prova non riconosciuta.")
    if request(f"/public/personal/check?username={username}").get("available") is not True:
        raise RuntimeError("Nome temporaneo già in uso.")
    identities.append(identity)
    message.write_bytes(f"ultron-personal-signup-v1:{identity}".encode())
    proof = openssl("pkeyutl", "-sign", "-inkey", key, "-in", str(message)).hex()
    created = request("/public/personal/signup", {
        "username": username, "public_key_hex": public[len(prefix):].hex(), "signature_hex": proof,
    })
    if created.get("lns_name") != identity:
        raise RuntimeError("Account temporaneo non confermato.")
    challenge = request("/public/sign-challenge", {"lns_name": identity})
    message.write_bytes(bytes.fromhex(challenge["nonce_hex"]))
    signature = openssl("pkeyutl", "-sign", "-inkey", key, "-in", str(message)).hex()
    session = request("/public/session/verify", {
        "lns_name": identity, "nonce_id": challenge["nonce_id"], "signature_hex": signature,
    })
    return username, identity, session["token"], key

def cleanup():
    if not identities:
        return
    names = json.dumps(identities)
    code = f"""
const ids = {names};
db.ultron_mobile_contact_requests.deleteMany({{members: {{$in: ids}}}});
db.ultron_mobile_contacts.deleteMany({{$or: [{{owner: {{$in: ids}}}}, {{peer: {{$in: ids}}}}]}});
db.ultron_wake_devices.deleteMany({{owner: {{$in: ids}}}});
db.auth_challenges.deleteMany({{lns_name: {{$in: ids}}}});
db.lns.deleteMany({{_id: {{$in: ids}}}});
"""
    subprocess.run(
        ["docker", "exec", "ultron-ratchet-pilot-db", "mongosh", "--quiet", "ultron_ratchet_pilot", "--eval", code],
        check=True, capture_output=True, timeout=25,
    )

import base64
from urllib.parse import quote

root = "/public/pulse/mls"
group_ids = []
def encoded():
    return base64.b64encode(secrets.token_bytes(54)).decode()

def event(op, cursor, epoch, kind, **fields):
    return {"op": op, "cursor": cursor, "epoch": epoch, "kind": kind, "wire": encoded(), **fields}

with TemporaryDirectory(prefix="ultron-mls-test-") as folder:
    try:
        _, alice, a, key = make_account(folder)
        _, bob, b, bob_key = make_account(folder)
        _, carol, c, carol_key = make_account(folder)
        request(root + "/groups", expected=401)
        direct_id = secrets.token_hex(12)
        document = json.dumps({"participants":[alice,bob],"from_lns":alice,"to_lns":bob,"conv_id":secrets.token_hex(32)})
        insert = f'const item={document}; item._id=ObjectId("{direct_id}"); db.ultron_mobile_messages.insertOne(item);'
        subprocess.run(["docker", "exec", "ultron-ratchet-pilot-db", "mongosh", "--quiet", "ultron_ratchet_pilot",
                        "--eval", insert], check=True, capture_output=True, timeout=25)
        direct_report = "/public/pulse/message/report"
        report = {"message_id": direct_id}
        request(direct_report, report, expected=401)
        request(direct_report, report, a, 404)
        request(direct_report, report, c, 404)
        assert request(direct_report, report, b)["ok"] is True
        assert request(direct_report, report, b)["ok"] is True
        direct_path = f"/public/pulse/messages/{direct_id}"
        request(direct_path + "?scope=all", token=b, expected=404, method="DELETE")
        assert request(direct_path + "?scope=me", token=b, method="DELETE")["ok"] is True
        assert request(direct_path + "?scope=all", token=a, method="DELETE")["ok"] is True
        for peer, token in ((bob, b), (carol, c)):
            request("/public/pulse/contacts/add", {"lns": peer}, a)
            request("/public/pulse/contacts/accept", {"lns": alice}, token)
        gid = secrets.token_hex(32)
        group_ids.append(gid)
        sign = Path(folder) / "group.txt"
        sign.write_text(json.dumps(["ultron-mls-group-v1", "https://49.12.242.0/ratchet-pilot", gid, alice], separators=(",", ":")))
        signature = openssl("pkeyutl", "-sign", "-inkey", key, "-in", str(sign)).hex()
        scope = "https://49.12.242.0/ratchet-pilot"
        def proof(key_file, payload):
            sign.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
            return openssl("pkeyutl", "-sign", "-inkey", key_file, "-in", str(sign)).hex()
        label = "Prova ULTRON " + secrets.token_hex(4)
        listing = {"name": label, "signature": proof(key, ["ultron-mls-listing-v1", scope, gid, alice, label])}
        group = {"id": gid, "signature": signature, "listing": listing}
        assert request(root + "/groups", group, a)["id"] == gid
        assert request(root + "/groups", group, a)["id"] == gid
        assert request(root + "/groups", token=b) == []
        assert request(root + "/groups", token=a)[0]["signature"] == signature
        assert any(row["id"] == gid and row["name"] == label for row in request(root + "/public-groups", token=b))
        invitation_path = root + f"/groups/{gid}/invitations"
        path = root + f"/groups/{gid}/events"
        request(path, token=b, expected=404)
        control = root + f"/groups/{gid}/control"
        reports = root + f"/groups/{gid}/reports"
        code = request(control, {"action": "link"}, a)["code"]
        assert request(root + "/redeem", {"code": code}, b)["status"] == "pending"
        request(control, {"action": "link"}, a)
        request(root + "/redeem", {"code": code}, b, 404)
        request(control, token=b, expected=404)
        old = event(secrets.token_hex(16), 0, 0, "message")
        assert request(path, old, a) == {"seq": 1, "epoch": 0}
        assert request(path, old, a) == {"seq": 1, "epoch": 0}
        request(path, event(secrets.token_hex(16), 0, 0, "message"), a, 409)

        def add(peer, token, signing_key, cursor, epoch):
            invite = secrets.token_hex(16)
            assert request(invitation_path, {"id": invite, "target": peer}, a)["status"] == "pending"
            assert any(row["id"] == invite for row in request(root + "/invitations", token=token))
            decision_path = root + "/invitations/" + invite
            decision = {"decision": "accepted", "signature": proof(signing_key, ["ultron-mls-consent-v1", scope, gid, invite, alice, peer, "accepted"])}
            request(decision_path, decision, a, 404)
            request(decision_path, {**decision, "signature": "b7"*3309}, token, 403)
            assert request(decision_path, decision, token)["status"] == "accepted"
            published = request(root + "/package", {"wire": encoded()}, token)["id"]
            claim_path = root + "/package/" + quote(peer, safe="")
            op = secrets.token_hex(16)
            assert request(claim_path, {"op": op}, a)["id"] == published
            assert request(claim_path, {"op": op}, a)["id"] == published
            request(claim_path, {"op": secrets.token_hex(16)}, a, 404)
            data = event(op, cursor, epoch, "add", target=peer, package=published, welcome=encoded(), welcome_signature="b7"*3309)
            request(path, data, a, 403)
            data["invitation"] = invite
            request(path, data, a, 403)
            assert any(row["status"] == "verification" and row["id"] == invite
                       for row in request(root + "/invitations", token=token))
            account_path = root + "/account"
            pub = openssl("pkey", "-in", signing_key, "-pubout", "-outform", "DER")[len(prefix):].hex()
            assert request(account_path, token=token) == {"verified": False}
            request(account_path, {"signature": proof(signing_key, ["ultron-mls-account-v1", scope, peer, pub])}, token)
            assert request(account_path, token=token) == {"verified": True}
            ack = request(path, data, a)
            assert ack == {"seq": cursor+1, "epoch": epoch+1}
            assert request(path, data, a) == ack
            rows = request(path + "?cursor=0", token=token)["events"]
            assert len(rows) == 1 and rows[0]["seq"] == cursor + 1
            assert rows[0]["wire"] is None and rows[0]["welcome"] == data["welcome"] and rows[0]["welcome_signature"] == data["welcome_signature"]
            assert rows[0]["invitation"] == invite and rows[0]["consent"] == decision["signature"]
            assert all(row["welcome"] is None for row in request(path + "?cursor=0", token=a)["events"])
            return data

        decline_id = secrets.token_hex(16)
        request(invitation_path, {"id": decline_id, "target": bob}, a)
        decline = {"decision": "declined", "signature": proof(bob_key, ["ultron-mls-consent-v1", scope, gid, decline_id, alice, bob, "declined"])}
        assert request(root + "/invitations/" + decline_id, decline, b)["status"] == "declined"
        request(path, token=b, expected=404)
        add(bob, b, bob_key, 1, 0)
        add(carol, c, carol_key, 2, 1)
        request(path, event(secrets.token_hex(16), 3, 2, "remove", target=carol), b, 403)
        request(control, {"action": "role", "target": bob, "role": "admin"}, a)
        request(control, {"action": "role", "target": carol, "role": "admin"}, b, 403)
        request(control, {"action": "role", "target": carol, "role": "moderator"}, b)
        request(control, {"action": "mute", "target": carol, "minutes": 15}, b)
        request(path, event(secrets.token_hex(16), 3, 2, "message"), c, 403)
        request(control, {"action": "mute", "target": carol, "minutes": 0}, b)
        request(reports, {"target": carol, "reason": "Verifica pilota temporanea"}, b)
        request(reports, token=c, expected=403)
        assert request(reports, token=a)[0]["target"] == carol
        remove = event(secrets.token_hex(16), 3, 2, "remove", target=bob)
        assert request(path, remove, a) == {"seq": 4, "epoch": 3}
        assert request(root + "/groups", token=b) == []
        request(path + "?cursor=0", token=b, expected=404)
        request(path, event(secrets.token_hex(16), 4, 2, "message"), a, 409)
        after = event(secrets.token_hex(16), 4, 3, "message")
        assert request(path, after, a) == {"seq": 5, "epoch": 3}
        assert [row["seq"] for row in request(path + "?cursor=0", token=c)["events"]] == [3, 4, 5]
        assert request(path, old, a) == {"seq": 1, "epoch": 0}
        assert request(path + "?cursor=0", token=a)["seq"] == 5
        request(path, event(secrets.token_hex(16), 5, 3, "message", managed_profile=True), c, 403)
        plain_size = 50 * 1024 * 1024
        chunk_size = 4 * 1024 * 1024
        parts = (plain_size + chunk_size - 1) // chunk_size
        blocks = [bytes([i+1]) * (min(chunk_size, plain_size - i*chunk_size) + 16) for i in range(parts)]
        body = b"".join(blocks)
        file = secrets.token_hex(16)
        file_url = root + f"/groups/{gid}/files/{file}"
        for index, block in enumerate(blocks):
            url = f"{file_url}?index={index}&parts={parts}&size={plain_size}"
            receipt = request(url, block, a)
            assert receipt["id"] == file and receipt["ready"] == (index == parts-1)
            assert request(url, block, a) == receipt
        request(f"{file_url}?index=0&parts={parts}&size={plain_size+1}", blocks[0], a, 413)
        changed = bytes([99]) + blocks[-1][1:]
        request(f"{file_url}?index={parts-1}&parts={parts}&size={plain_size}", changed, a, 409)
        request(file_url, token=c, expected=404)
        assert request(path, event(secrets.token_hex(16), 5, 3, "message", file=file), a)["seq"] == 6
        assert request(file_url, token=c) == body
        request(file_url, token=b, expected=404)
        assert request(path, event(secrets.token_hex(16), 6, 3, "message"), c)["seq"] == 7
        request(control, {"action": "role", "target": carol, "role": "member"}, a)
        request(control, {"action": "hide", "seq": 5}, c, 403)
        request(control, {"action": "hide", "seq": 7}, c)
        request(control, {"action": "hide", "seq": 7}, a)
        assert request(control, token=c)["hidden"] == [7]
        request(path, token=c, expected=426)
        assert request(path + "?protocol=1", token=c)["seq"] == 7
        quiz = root + f"/groups/{gid}/quiz"
        qid = secrets.token_hex(16)
        sealed = {"data": secrets.token_hex(28), "iv": secrets.token_hex(12)}
        prepared = {"action": "prepare", "id": qid, "options": 3, "correct": 1, "prompt": sealed, "solution": sealed}
        reading = {"action": "read", "id": qid}
        request(quiz, reading, expected=401)
        request(quiz, prepared, a, 403)
        owner_pk = openssl("pkey", "-in", key, "-pubout", "-outform", "DER")[len(prefix):].hex()
        request(root + "/account", {"signature": proof(key, ["ultron-mls-account-v1", scope, alice, owner_pk])}, a)
        request(quiz, {**prepared, "correct": 3}, a, 400)
        assert request(quiz, prepared, a)["ok"] is True
        assert request(quiz, prepared, a)["ok"] is True
        request(quiz, {**prepared, "correct": 0}, a, 404)
        request(quiz, reading, c, 404)
        current = request(path + "?protocol=1", token=a)
        packet = event(qid, current["seq"], current["epoch"], "message", quiz=True)
        assert request(path, packet, a)["seq"] == 8
        assert request(path, packet, a)["seq"] == 8
        request(quiz, reading, b, 404)
        assert request(quiz, reading, c) == {"prompt": sealed, "started": False}
        vote = {"action": "vote", "id": qid, "choice": 1}
        request(quiz, vote, c, 400)
        started = {"action": "start", "id": qid}
        assert request(quiz, started, c) == {"prompt": sealed, "started": True}
        assert request(quiz, started, c) == {"prompt": sealed, "started": True}
        result = request(quiz, vote, c)
        assert result["totals"] == [0, 1, 0] and result["choice"] == result["correct"] == 1
        assert result["solution"] == sealed
        duplicate = request(quiz, {**vote, "choice": 0}, c)
        assert duplicate["totals"] == result["totals"] and duplicate["choice"] == 1
        assert request(quiz, {"action": "board"}, a)["leaders"] == []
        assert request(quiz, {"action": "board"}, c)["points"] in (10, 15)
        assert request(quiz, {"action": "visibility", "visible": True}, c)["leaders"][0]["account"] == carol
        assert request(quiz, {"action": "board"}, a)["leaders"][0]["account"] == carol
        assert request(quiz, {"action": "visibility", "visible": False}, c)["leaders"] == []
        request(control, {"action": "hide", "seq": 8}, a)
        request(quiz, reading, c, 404)
        print("Verificati accesso al quiz pubblico, soluzione dopo il voto, voto definitivo, punteggio e classifica facoltativa.")
        request(control, {"action":"leave"}, c)
        request(path + "?protocol=1", token=c, expected=404)
        request(file_url, token=c, expected=404)
        request(path, event(secrets.token_hex(16), 8, 3, "message"), a, 403)
        assert request(path, event(secrets.token_hex(16), 8, 3, "remove", target=carol), a)["epoch"] == 4
        request(control, token=c, method="DELETE", expected=403)
        request(control, token=a, method="DELETE")
        request(control, token=a, method="DELETE")
        request(file_url, token=a, expected=404)
        assert request(root + "/groups", token=a) == []
        request(quiz, reading, a, 404)
        print("Verificati permessi di rimozione, segnalazione 1:1, gestione e allegati dei gruppi.")
    finally:
        if identities:
            code = (f"const names={json.dumps(identities)};const groups={json.dumps(group_ids)};"
                    "db.ultron_mobile_message_reports.deleteMany({reporter:{$in:names}});"
                    "db.ultron_mobile_messages.deleteMany({from_lns:{$in:names}});"
                    "db.ultron_mls_invites.deleteMany({group:{$in:groups}});"
                    "db.ultron_mls_events.deleteMany({group:{$in:groups}});"
                    "db.ultron_mls_groups.deleteMany({_id:{$in:groups}});"
                    "db.ultron_mls_packages.deleteMany({owner:{$in:names}});"
                    "db.ultron_mls_verified.deleteMany({_id:{$in:names}});"
                    "db.ultron_mls_reports.deleteMany({group:{$in:groups}});"
                    "db.ultron_mls_files.deleteMany({group:{$in:groups}});"
                    "db.ultron_mls_quizzes.deleteMany({group:{$in:groups}});"
                    "db.ultron_mls_quiz_ranking.deleteMany({group:{$in:groups}});")
            subprocess.run(["docker", "exec", "ultron-ratchet-pilot-db", "mongosh", "--quiet", "ultron_ratchet_pilot", "--eval", code],
                           check=True, capture_output=True, timeout=25)
            cleanup()
PY_SMOKE
python3 - "$stage/Caddyfile.original" "$stage/Caddyfile.updated" "$old" "$next" <<'PY_CADDY'
from pathlib import Path
import sys
source,out,old,new=sys.argv[1:]
text=Path(source).read_text();needle='reverse_proxy @pilot_api '+old+':8002'
if text.count(needle)!=1: raise SystemExit('Route pilota non univoca.')
Path(out).write_text(text.replace(needle,'reverse_proxy @pilot_api '+new+':8002',1))
PY_CADDY
docker cp "$stage/Caddyfile.updated" "$proxy:/tmp/unvor-allegati-candidate.Caddyfile"
docker exec "$proxy" caddy validate --config /tmp/unvor-allegati-candidate.Caddyfile --adapter caddyfile
cmp -s "$config" "$stage/Caddyfile.original" || { echo "Caddyfile modificato durante la compilazione.";exit 1; }
docker stop --time 20 "$old" >/dev/null
stopped=1
changed=1
cat "$stage/Caddyfile.updated" > "$config"
docker exec "$proxy" caddy reload --config "$config_path" --adapter caddyfile
curl -fsS --max-time 10 "$pilot/api/health" >/dev/null
success=1
echo "UNVOR: gateway allegati da 50 MB attivo. Prove completate."
echo "Gateway precedente conservato: $old"
echo "Backup Caddyfile: $stage/Caddyfile.original"
