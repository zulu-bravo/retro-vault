#!/usr/bin/env python3
"""
Reseed retro_feature__c + retro_board_feature__c with a realistic per-release,
per-team distribution (replaces the migration-era cross-join where every
release had the same 15 features).

Destructive: deletes every retro_board_feature__c and retro_feature__c row
before recreating. Feedback (retro_feedback__c) is NOT deleted, but the
free-text feature__c string on each feedback item is rewritten when it
doesn't match the board's new feature set.

Prereqs: HOST + SESSION_ID env vars.
"""
import os
import sys
import random
import requests

HOST = os.environ.get("HOST")
SESSION_ID = os.environ.get("SESSION_ID")
if not HOST or not SESSION_ID:
    print("ERROR: HOST and SESSION_ID env vars required", file=sys.stderr)
    sys.exit(1)

BASE = f"https://{HOST}/api/v25.1"
HEADERS = {"Authorization": SESSION_ID, "Accept": "application/json"}

# Team × release -> list of features this team is working on for that release.
# Each feature appears in 1-3 releases so the chart has trend continuity
# without every release carrying every feature.
TEAM_RELEASE_FEATURES = {
    ("Align", "25R3.0"): ["Territory Alignment", "Call Planning"],
    ("Align", "25R3.2"): ["Territory Alignment", "HCP Master Data", "Affiliations"],
    ("Align", "25R3.4"): ["HCP Master Data", "Rep Activity", "Call Planning"],
    ("Align", "25R3.5"): ["Rep Activity", "Territory Alignment"],
    ("Align", "26R1.0"): ["Territory Alignment", "Call Planning", "Affiliations"],

    ("Campaign Manager", "25R3.0"): ["Campaign Builder", "Email Delivery"],
    ("Campaign Manager", "25R3.2"): ["Campaign Builder", "Segmentation Engine", "Target Lists"],
    ("Campaign Manager", "25R3.4"): ["Segmentation Engine", "Response Tracking", "Email Delivery", "Campaign Builder"],
    ("Campaign Manager", "25R3.5"): ["Attribution Reports", "Campaign Builder", "Approval Workflow"],
    ("Campaign Manager", "26R1.0"): ["Attribution Reports", "Segmentation Engine", "Response Tracking"],

    ("Network", "25R3.0"): ["DCR Workflow", "HCP Master Data"],
    ("Network", "25R3.2"): ["DCR Workflow", "Affiliations", "Data Stewardship"],
    ("Network", "25R3.4"): ["HCP Master Data", "Downstream Sync", "DCR Workflow"],
    ("Network", "25R3.5"): ["Data Stewardship", "DCR Workflow", "Downstream Sync"],
    ("Network", "26R1.0"): ["Downstream Sync", "HCP Master Data", "Affiliations"],
}

random.seed(42)


def vql(q):
    r = requests.post(
        f"{BASE}/query",
        headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
        data={"q": q},
    )
    r.raise_for_status()
    body = r.json()
    if body.get("responseStatus") not in ("SUCCESS", "WARNING"):
        raise RuntimeError(f"VQL failed: {body}")
    return body.get("data", [])


def _extract_id(body, obj):
    if body.get("responseStatus") != "SUCCESS":
        raise RuntimeError(f"{obj} failed: {body}")
    data = body.get("data")
    if not data:
        raise RuntimeError(f"{obj} missing data: {body}")
    entry = data[0] if isinstance(data, list) else data
    if entry.get("responseStatus") and entry["responseStatus"] != "SUCCESS":
        raise RuntimeError(f"{obj} entry failed: {entry}")
    rid = entry.get("id") or (entry.get("data") or {}).get("id")
    if not rid:
        raise RuntimeError(f"{obj} missing id: {entry}")
    return rid


def create_record(obj, fields):
    r = requests.post(
        f"{BASE}/vobjects/{obj}",
        headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
        data=fields,
    )
    r.raise_for_status()
    return _extract_id(r.json(), f"Create {obj}")


def _csv_escape(v):
    s = "" if v is None else str(v)
    if any(c in s for c in ',"\n\r'):
        return '"' + s.replace('"', '""') + '"'
    return s


def update_record(obj, record_id, fields):
    cols = ["id"] + list(fields.keys())
    values = [record_id] + [fields[c] for c in fields]
    csv = ",".join(cols) + "\n" + ",".join(_csv_escape(v) for v in values)
    r = requests.put(
        f"{BASE}/vobjects/{obj}",
        headers={**HEADERS, "Content-Type": "text/csv"},
        data=csv,
    )
    r.raise_for_status()
    body = r.json()
    if body.get("responseStatus") != "SUCCESS":
        raise RuntimeError(f"Update {obj} failed: {body}")
    entry = body.get("data", [{}])[0] if isinstance(body.get("data"), list) else {}
    if entry.get("responseStatus") and entry["responseStatus"] != "SUCCESS":
        raise RuntimeError(f"Update {obj} entry failed: {entry}")


def delete_records(obj, ids):
    if not ids:
        return
    # Vault REST accepts bulk delete via CSV id list.
    for i in range(0, len(ids), 200):
        chunk = ids[i : i + 200]
        csv = "id\n" + "\n".join(chunk)
        r = requests.delete(
            f"{BASE}/vobjects/{obj}",
            headers={**HEADERS, "Content-Type": "text/csv"},
            data=csv,
        )
        r.raise_for_status()
        body = r.json()
        if body.get("responseStatus") not in ("SUCCESS", "WARNING"):
            raise RuntimeError(f"Delete {obj} failed: {body}")


def main():
    feedback_only = "--feedback-only" in sys.argv
    print(f"Reseed features on {HOST} (feedback_only={feedback_only})\n")

    if not feedback_only:
        print("[1/7] Deleting existing retro_board_feature__c records...")
        junctions = vql("SELECT id FROM retro_board_feature__c")
        delete_records("retro_board_feature__c", [r["id"] for r in junctions])
        print(f"  deleted {len(junctions)} junction rows")

        print("\n[2/7] Deleting existing retro_feature__c records...")
        features = vql("SELECT id FROM retro_feature__c")
        delete_records("retro_feature__c", [r["id"] for r in features])
        print(f"  deleted {len(features)} feature rows")

    print("\n[3/7] Fetching releases...")
    releases = vql("SELECT id, name__v FROM retro_release__c")
    release_id_by_name = {r["name__v"]: r["id"] for r in releases}
    print(f"  {len(releases)} releases: {sorted(release_id_by_name)}")

    print("\n[4/7] Fetching boards...")
    boards = vql(
        "SELECT id, name__v, release__c, release__cr.name__v, team__cr.name__v "
        "FROM retro_board__c"
    )
    print(f"  {len(boards)} boards")

    print("\n[5/7] Feature records...")
    # Build release -> set of feature names (union of all teams working that release).
    features_by_release = {}
    for (team, rel_name), feats in TEAM_RELEASE_FEATURES.items():
        features_by_release.setdefault(rel_name, set()).update(feats)

    # (release_id, feature_name) -> feature_id
    feature_id_by_rel_name = {}
    if feedback_only:
        existing = vql("SELECT id, display_name__c, release__c FROM retro_feature__c")
        for f in existing:
            feature_id_by_rel_name[(f["release__c"], f["display_name__c"])] = f["id"]
        print(f"  reusing {len(existing)} existing features")
    else:
        created_features = 0
        for rel_name in sorted(features_by_release):
            rel_id = release_id_by_name.get(rel_name)
            if not rel_id:
                print(f"  WARN: release {rel_name} not found, skipping")
                continue
            for fname in sorted(features_by_release[rel_name]):
                composite = f"{rel_name} . {fname}"[:200]
                fid = create_record(
                    "retro_feature__c",
                    {
                        "name__v": composite,
                        "display_name__c": fname,
                        "release__c": rel_id,
                    },
                )
                feature_id_by_rel_name[(rel_id, fname)] = fid
                created_features += 1
            print(f"  {rel_name}: {len(features_by_release[rel_name])} features")
        print(f"  {created_features} feature records created")

    print("\n[6/7] Board-feature junctions...")
    created_links = 0
    # board_id -> list of (feature_id, feature_name) for that board's team+release
    board_feature_names = {}
    for b in boards:
        team_name = b.get("team__cr.name__v") or ""
        rel_name = b.get("release__cr.name__v") or ""
        rel_id = b.get("release__c")
        feats = TEAM_RELEASE_FEATURES.get((team_name, rel_name))
        if not feats or not rel_id:
            print(f"  WARN: {b['name__v']} ({team_name} / {rel_name}) has no mapping")
            board_feature_names[b["id"]] = []
            continue
        board_feats = []
        for fname in feats:
            fid = feature_id_by_rel_name.get((rel_id, fname))
            if not fid:
                continue
            if not feedback_only:
                composite = f"{b['id']}_{fid}"[:80]
                create_record(
                    "retro_board_feature__c",
                    {
                        "name__v": composite,
                        "retro_board__c": b["id"],
                        "retro_feature__c": fid,
                    },
                )
                created_links += 1
            board_feats.append(fname)
        board_feature_names[b["id"]] = board_feats
        if not feedback_only:
            print(f"  {b['name__v']}: {len(board_feats)} feature(s) linked")
    if not feedback_only:
        print(f"  {created_links} junction rows created")

    print("\n[7/7] Re-tagging feedback feature__c strings...")
    feedback = vql(
        "SELECT id, retro_board__c, feature__c, category__c FROM retro_feedback__c"
    )
    updated = kept = cleared = 0
    for fb in feedback:
        current = fb.get("feature__c")
        if not current:
            continue
        board_feats = board_feature_names.get(fb["retro_board__c"], [])
        if not board_feats:
            # board has no features; clear the stale tag
            update_record("retro_feedback__c", fb["id"], {"feature__c": ""})
            cleared += 1
            continue
        if current in board_feats:
            kept += 1
            continue
        # Pick a deterministic-ish replacement from the board's set.
        replacement = random.choice(board_feats)
        update_record("retro_feedback__c", fb["id"], {"feature__c": replacement})
        updated += 1
    print(f"  kept {kept}, retagged {updated}, cleared {cleared}")

    print("\n=== RESEED COMPLETE ===")
    print(f"feedback items reviewed: {kept + updated + cleared}")


if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as e:
        print(f"HTTP error: {e}\n{e.response.text if e.response else ''}", file=sys.stderr)
        sys.exit(1)
