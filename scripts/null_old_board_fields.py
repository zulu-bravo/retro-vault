#!/usr/bin/env python3
"""
Null out legacy release_tag__c + features__c on retro_board__c so the fields
can be dropped via MDL. Run AFTER migrate_releases.py has backfilled release__c
on every board.

Safety: requires 100% of boards to have release__c set before clearing.
"""
import os
import sys
import requests

HOST = os.environ.get("HOST")
SESSION_ID = os.environ.get("SESSION_ID")
if not HOST or not SESSION_ID:
    print("ERROR: HOST and SESSION_ID env vars required", file=sys.stderr)
    sys.exit(1)

BASE = f"https://{HOST}/api/v25.1"
HEADERS = {"Authorization": SESSION_ID, "Accept": "application/json"}


def vql(q):
    r = requests.post(f"{BASE}/query",
        headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
        data={"q": q})
    r.raise_for_status()
    body = r.json()
    if body.get("responseStatus") not in ("SUCCESS", "WARNING"):
        raise RuntimeError(f"VQL failed: {body}")
    return body.get("data", [])


def put_records(obj, records):
    r = requests.put(f"{BASE}/vobjects/{obj}",
        headers={**HEADERS, "Content-Type": "application/json"},
        json=records)
    r.raise_for_status()
    body = r.json()
    if body.get("responseStatus") != "SUCCESS":
        raise RuntimeError(f"PUT {obj} failed: {body}")
    return body


def main():
    boards = vql("SELECT id, release__c, release_tag__c, features__c FROM retro_board__c")
    print(f"Found {len(boards)} boards")

    unlinked = [b for b in boards if not b.get("release__c")]
    if unlinked:
        print(f"ABORT: {len(unlinked)} boards have no release__c set:")
        for b in unlinked:
            print(f"  {b['id']}")
        sys.exit(1)

    with_legacy = [b for b in boards
                   if b.get("release_tag__c") or b.get("features__c")]
    print(f"{len(with_legacy)} boards still carry legacy field values")

    if not with_legacy:
        print("Nothing to clear. Safe to drop fields.")
        return

    records = [{"id": b["id"], "release_tag__c": "", "features__c": ""}
               for b in with_legacy]

    BATCH = 100
    for i in range(0, len(records), BATCH):
        chunk = records[i:i + BATCH]
        put_records("retro_board__c", chunk)
        print(f"  nulled {i + len(chunk)}/{len(records)}")

    print("\nLegacy values cleared. Now run:")
    print('  curl -X POST -H "Authorization: $SESSION_ID" -H "Content-Type: text/plain" \\')
    print('      --data-binary @scripts/migration/drop_old_board_fields.mdl \\')
    print('      "https://$HOST/api/mdl/execute"')


if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as e:
        print(f"HTTP error: {e}\n{e.response.text if e.response else ''}", file=sys.stderr)
        sys.exit(1)
