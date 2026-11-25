#!/usr/bin/env python3
"""One narrowly scoped gateway patch: a valid bearer invite link needs no moderator review.

The incoming user still must sign MLS consent.  The owner must create an MLS
Welcome to deliver group keys.  All existing group limits and revocation remain.
"""
from pathlib import Path
from io import BytesIO
import tarfile
import tempfile
import sys

ARCHIVE = Path("tools/gateway-attachments/source.tar.gz")
OLD = '"status": if group.contains_key("listing") {"pending"} else {"review"}'
NEW = '"status": "pending"'
TARGET = "src/mobile_chat/group_control.rs"

def main():
    with tarfile.open(ARCHIVE, "r:gz") as source:
        members = source.getmembers()
        updated = []
        match = 0
        for entry in members:
            file = source.extractfile(entry) if entry.isfile() else None
            data = file.read() if file else None
            if entry.name.lstrip("./") == TARGET:
                if data is None:
                    raise SystemExit("MLS handler was not a file.")
                before = data.decode("utf-8")
                if OLD in before:
                    if before.count(OLD) != 1:
                        raise SystemExit("Ambiguous MLS link handler.")
                    after = before.replace(OLD, NEW)
                    data = after.encode("utf-8")
                    match += 1
                elif NEW in before:
                    print("Gateway already accepts direct-link invitations.")
                    return
                else:
                    raise SystemExit("Unexpected gateway version; refusing to patch.")
            updated.append((entry, data))
    if match != 1:
        raise SystemExit("Cannot locate the expected gateway handler.")
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as temp:
        output = Path(temp.name)
    try:
        with tarfile.open(output, "w:gz") as result:
            for entry, data in updated:
                if data is not None:
                    entry.size = len(data)
                    result.addfile(entry, BytesIO(data))
                else:
                    result.addfile(entry)
        output.replace(ARCHIVE)
    finally:
        output.unlink(missing_ok=True)
    print("Patched gateway: valid private and public invite links now enter PENDING,")
    print("without manual review; recipient signature and MLS Welcome still required.")

if __name__ == "__main__":
    main()
