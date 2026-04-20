#!/usr/bin/env python3
"""
Second migration: release.features__c text -> retro_feature__c records +
retro_board_feature__c junction assignments.

Strategy:
  - Parse each release's features__c text into unique non-blank lines.
  - Create one retro_feature__c per line (skipping duplicates that already exist).
  - Heuristic board-to-feature assignment by team name using a configurable map.
    Each team gets only the features that match its subset of the release list.
  - Prints the release.features__c drop command at the end (does NOT run it).

Prereqs:
  - retro_feature__c object deployed (mdl/03_retro_feature.mdl)
  - retro_board_feature__c junction deployed (mdl/05_retro_board_feature.mdl)
  - HOST + SESSION_ID env vars set

Safe to re-run: skips features that already exist per release and junction rows
that already link a given board to a given feature.
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

# Heuristic: team name -> set of feature names this team owned before the split.
# Derived from the original team-scoped features observed on live boards.
TEAM_FEATURE_SETS = {
    "Align": {
        "Territory Alignment", "Rep Activity", "Segmentation Engine",
        "Call Planning", "Approval Workflow",
    },
    "Campaign Manager": {
        "Campaign Builder", "Target Lists", "Email Delivery",
        "Response Tracking", "Attribution Reports",
    },
    "Network": {
        "HCP Master Data", "Affiliations", "DCR Workflow",
        "Data Stewardship", "Downstream Sync",
    },
}


def vql(q):
    r = requests.post(f"{BASE}/query",
        headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
        data={"q": q})
    r.raise_for_status()
    body = r.json()
    status = body.get("responseStatus")
    if status not in ("SUCCESS", "WARNING"):
        raise RuntimeError(f"VQL failed: {body}")
    return body.get("data", [])


def _extract_id(body, obj):
    if body.get("responseStatus") != "SUCCESS":
        raise RuntimeError(f"{obj} call failed: {body}")
    data = body.get("data")
    if not data:
        raise RuntimeError(f"{obj} response missing data: {body}")
    entry = data[0] if isinstance(data, list) else data
    if entry.get("responseStatus") and entry["responseStatus"] != "SUCCESS":
        raise RuntimeError(f"{obj} entry failed: {entry}")
    rid = entry.get("id") or (entry.get("data") or {}).get("id")
    if not rid:
        raise RuntimeError(f"{obj} response missing id: {entry}")
    return rid


def create_record(obj, fields):
    r = requests.post(f"{BASE}/vobjects/{obj}",
        headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
        data=fields)
    r.raise_for_status()
    return _extract_id(r.json(), f"Create {obj}")


def parse_lines(text):
    if not text:
        return []
    seen = set()
    out = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped or stripped in seen:
            continue
        seen.add(stripped)
        out.append(stripped)
    return out


def main():
    print(f"Feature migration on {HOST}\n")

    print("[1/5] Fetching releases with their features__c text...")
    releases = vql("SELECT id, name__v, features__c FROM retro_release__c")
    print(f"  {len(releases)} releases")

    print("\n[2/5] Fetching existing retro_feature__c records...")
    existing_features = vql("SELECT id, display_name__c, release__c FROM retro_feature__c")
    feature_by_rel_name = {}
    for f in existing_features:
        key = (f["release__c"], f["display_name__c"])
        feature_by_rel_name[key] = f["id"]
    print(f"  {len(existing_features)} features already exist")

    print("\n[3/5] Creating feature records from release.features__c...")
    # name__v must be unique tenant-wide, so we store a composite
    # "{release} . {feature}" in name__v and the bare feature name in
    # display_name__c (used by the UI).
    created_features = 0
    for rel in releases:
        lines = parse_lines(rel.get("features__c"))
        for name in lines:
            key = (rel["id"], name)
            if key in feature_by_rel_name:
                continue
            composite = f"{rel['name__v']} . {name}"[:200]
            fid = create_record("retro_feature__c", {
                "name__v": composite,
                "display_name__c": name,
                "release__c": rel["id"],
            })
            feature_by_rel_name[key] = fid
            created_features += 1
            print(f"  + {rel['name__v']}: {name}")
    print(f"  {created_features} feature records created")

    print("\n[4/5] Fetching boards + team names for heuristic assignment...")
    boards = vql(
        "SELECT id, name__v, release__c, team__c, team__cr.name__v "
        "FROM retro_board__c"
    )
    print(f"  {len(boards)} boards")

    print("\n[5/5] Building board-feature junction rows...")
    existing_junctions = vql(
        "SELECT id, retro_board__c, retro_feature__c FROM retro_board_feature__c"
    )
    have_junction = {(j["retro_board__c"], j["retro_feature__c"])
                     for j in existing_junctions}
    print(f"  {len(existing_junctions)} junction rows already exist")

    created_links = 0
    skipped_no_match = 0
    for b in boards:
        if not b.get("release__c"):
            continue
        team_name = b.get("team__cr.name__v") or ""
        subset = TEAM_FEATURE_SETS.get(team_name)
        if not subset:
            skipped_no_match += 1
            continue

        # Candidate features: release features whose name is in the team's subset.
        candidate_ids = [
            fid for (rid, fname), fid in feature_by_rel_name.items()
            if rid == b["release__c"] and fname in subset
        ]

        for fid in candidate_ids:
            if (b["id"], fid) in have_junction:
                continue
            composite = f"{b['id']}_{fid}"[:80]
            create_record("retro_board_feature__c", {
                "name__v": composite,
                "retro_board__c": b["id"],
                "retro_feature__c": fid,
            })
            have_junction.add((b["id"], fid))
            created_links += 1
        print(f"  {b['name__v']} ({team_name}): {len(candidate_ids)} feature(s) linked")

    print(f"\n  {created_links} new junction rows created")
    if skipped_no_match:
        print(f"  {skipped_no_match} boards had a team name not in TEAM_FEATURE_SETS — left without features")

    print("\n=== FEATURE MIGRATION COMPLETE ===")
    print("Drop release.features__c now that features are records:")
    print('  curl -X POST -H "Authorization: $SESSION_ID" -H "Content-Type: text/plain" \\')
    print('      -d "ALTER Object retro_release__c ( drop Field features__c );" \\')
    print('      "https://$HOST/api/mdl/execute"')


if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as e:
        print(f"HTTP error: {e}\n{e.response.text if e.response else ''}", file=sys.stderr)
        sys.exit(1)
