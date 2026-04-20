#!/usr/bin/env python3
"""
One-time migration: release_tag__c + features__c (on retro_board__c)
    -> retro_release__c records referenced via retro_board__c.release__c

Prereqs:
  - retro_release__c object exists on Vault (deploy mdl/02_retro_release.mdl first)
  - retro_board__c.release__c field exists on Vault (deploy mdl/03_retro_board.mdl first)
  - HOST and SESSION_ID env vars set

Safe to re-run: skips boards that already have release__c set.

After running and verifying, drop the old fields:
  curl -X POST -H "Authorization: $SESSION_ID" -H "Content-Type: text/plain" \\
      --data-binary @scripts/migration/drop_old_board_fields.mdl \\
      "https://$HOST/api/mdl/execute"
"""
import os
import sys
import json
from collections import defaultdict
from urllib.parse import quote

import requests

HOST = os.environ.get("HOST")
SESSION_ID = os.environ.get("SESSION_ID")
API = "v25.1"

if not HOST or not SESSION_ID:
    print("ERROR: HOST and SESSION_ID env vars required", file=sys.stderr)
    sys.exit(1)

BASE = f"https://{HOST}/api/{API}"
HEADERS = {"Authorization": SESSION_ID, "Accept": "application/json"}


def vql(query: str):
    r = requests.post(
        f"{BASE}/query",
        headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
        data={"q": query},
    )
    r.raise_for_status()
    body = r.json()
    if body.get("responseStatus") != "SUCCESS":
        raise RuntimeError(f"VQL failed: {body}")
    return body.get("data", [])


def create_record(obj: str, fields: dict) -> str:
    r = requests.post(
        f"{BASE}/vobjects/{obj}",
        headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
        data=fields,
    )
    r.raise_for_status()
    body = r.json()
    data = body.get("data")
    if body.get("responseStatus") != "SUCCESS" or not data:
        raise RuntimeError(f"Create {obj} failed: {body}")
    entry = data[0] if isinstance(data, list) else data
    if entry.get("responseStatus") != "SUCCESS":
        raise RuntimeError(f"Create {obj} entry failed: {entry}")
    return entry["data"]["id"]


def update_record(obj: str, record_id: str, fields: dict):
    payload = {"id": record_id, **fields}
    r = requests.put(
        f"{BASE}/vobjects/{obj}",
        headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
        data=payload,
    )
    r.raise_for_status()
    body = r.json()
    if body.get("responseStatus") != "SUCCESS":
        raise RuntimeError(f"Update {obj} {record_id} failed: {body}")
    data = body.get("data")
    entry = data[0] if isinstance(data, list) else data
    if entry and entry.get("responseStatus") != "SUCCESS":
        raise RuntimeError(f"Update {obj} {record_id} entry failed: {entry}")


def union_features(features_list):
    """Union unique non-blank lines preserving first-seen order."""
    seen = set()
    out = []
    for features in features_list:
        if not features:
            continue
        for line in features.split("\n"):
            stripped = line.strip()
            if not stripped or stripped in seen:
                continue
            seen.add(stripped)
            out.append(stripped)
    return "\n".join(out)


def main():
    print(f"Migration: release_tag__c/features__c -> retro_release__c on {HOST}")

    print("\n[1/4] Fetching boards...")
    boards = vql(
        "SELECT id, name__v, release_tag__c, features__c, release__c "
        "FROM retro_board__c"
    )
    print(f"  Found {len(boards)} boards")

    already_linked = [b for b in boards if b.get("release__c")]
    if already_linked:
        print(f"  {len(already_linked)} already have release__c — skipping those")

    # Group boards without release__c by tag
    tag_to_features = defaultdict(list)
    tag_to_boards = defaultdict(list)
    untagged = []
    for b in boards:
        if b.get("release__c"):
            continue
        tag = (b.get("release_tag__c") or "").strip()
        if not tag:
            untagged.append(b)
            continue
        tag_to_features[tag].append(b.get("features__c") or "")
        tag_to_boards[tag].append(b)

    if untagged:
        print(f"  {len(untagged)} boards have no release_tag__c — leaving release__c null")

    print(f"  {len(tag_to_boards)} distinct release tags to migrate")

    print("\n[2/4] Checking existing releases...")
    existing = vql("SELECT id, name__v FROM retro_release__c")
    name_to_release_id = {r["name__v"]: r["id"] for r in existing}
    print(f"  {len(existing)} retro_release__c records already exist")

    print("\n[3/4] Creating missing releases...")
    created = 0
    for tag, features_list in sorted(tag_to_features.items()):
        if tag in name_to_release_id:
            print(f"  exists: {tag}")
            continue
        features = union_features(features_list)
        rid = create_record(
            "retro_release__c",
            {"name__v": tag, "features__c": features},
        )
        name_to_release_id[tag] = rid
        created += 1
        print(f"  created: {tag} ({rid}) with {len(features.splitlines())} feature line(s)")
    print(f"  {created} release records created")

    print("\n[4/4] Linking boards to releases...")
    linked = 0
    for tag, board_list in sorted(tag_to_boards.items()):
        rid = name_to_release_id[tag]
        for b in board_list:
            update_record("retro_board__c", b["id"], {"release__c": rid})
            linked += 1
            print(f"  linked: {b['name__v']} -> {tag}")
    print(f"  {linked} boards updated")

    print("\n=== MIGRATION COMPLETE ===")
    print("Next step: verify data, then drop old fields:")
    print('  curl -X POST -H "Authorization: $SESSION_ID" -H "Content-Type: text/plain" \\')
    print('      --data-binary @scripts/migration/drop_old_board_fields.mdl \\')
    print('      "https://$HOST/api/mdl/execute"')


if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as e:
        print(f"\nHTTP error: {e}\nResponse: {e.response.text if e.response else ''}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        sys.exit(1)
