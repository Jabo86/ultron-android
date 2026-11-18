"""Loopback fixture whose only credentials are generated for the test."""
import json
from hashlib import sha256
from threading import Thread

from cryptography.hazmat.primitives.asymmetric.mldsa import MLDSA65PrivateKey

from ultron_relay.__main__ import RelayServer
from ultron_relay.identity import ENROLLMENT_CONTEXT, enrollment_message
from ultron_relay.queue import Queue

credentials = json.loads(input())

with RelayServer(0, Queue(None, ttl=60, global_limit=64), require_proof=True) as server:
    identities = []
    for fixture in credentials:
        seed = bytes.fromhex(fixture["seed"])
        key = MLDSA65PrivateKey.from_seed_bytes(seed)
        public_key = key.public_key().public_bytes_raw()
        token = bytes.fromhex(fixture["token"])
        token_digest = sha256(token).digest()
        invite = bytes.fromhex(server.identity.invite(60))
        nonce, _ = server.identity.challenge(invite)
        signature = key.sign(enrollment_message(nonce, sha256(invite).digest(), public_key, token_digest),
                             context=ENROLLMENT_CONTEXT)
        mailbox = server.identity.enroll(invite, public_key, token_digest, signature)
        identities.append({"publicKey": public_key.hex(), "mailbox": mailbox})
    thread = Thread(target=server.serve_forever)
    thread.start()
    print(json.dumps({"origin": "http://127.0.0.1:" + str(server.server_port), "identities": identities}), flush=True)
    try:
        input()
    except EOFError:
        pass
    finally:
        server.shutdown()
        thread.join()
