"""Loopback test relay. Only the authority's public key is supplied."""
from threading import Thread
import json

from ultron_relay.__main__ import RelayServer
from ultron_relay.queue import Queue

authority_key = bytes.fromhex(input())
with RelayServer(0, Queue(None, ttl=60, global_limit=64), require_proof=True,
                 authority_key=authority_key) as server:
    thread = Thread(target=server.serve_forever)
    thread.start()
    print(json.dumps({"origin": "http://127.0.0.1:" + str(server.server_port)}), flush=True)
    try:
        input()
    except EOFError:
        pass
    finally:
        server.shutdown()
        thread.join()
