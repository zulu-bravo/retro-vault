#!/usr/bin/env python3
"""
RetroVault Schema Deployer
Creates all picklists, objects, and fields in a Veeva Vault instance.
Reads credentials from vaultMCP/.env
"""

import json
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv
import os

# Load .env from vaultMCP directory
load_dotenv(Path(__file__).parent / "vaultMCP" / ".env")

VAULT_DNS = os.getenv("VAULT_DNS")
VAULT_USERNAME = os.getenv("VAULT_USERNAME")
VAULT_PASSWORD = os.getenv("VAULT_PASSWORD")
VAULT_API_VERSION = os.getenv("VAULT_API_VERSION", "v24.1")

missing = [k for k in ("VAULT_DNS", "VAULT_USERNAME", "VAULT_PASSWORD") if not os.getenv(k)]
if missing:
    sys.exit(f"ERROR: Missing env vars: {', '.join(missing)}\nFill in vaultMCP/.env")


# ---------------------------------------------------------------------------
# Vault API client (mirrors server.py)
# ---------------------------------------------------------------------------

_session_id = None


def _base_url():
    return f"https://{VAULT_DNS}/api/{VAULT_API_VERSION}"


def _authenticate():
    global _session_id
    resp = requests.post(
        f"https://{VAULT_DNS}/api/{VAULT_API_VERSION}/auth",
        data={"username": VAULT_USERNAME, "password": VAULT_PASSWORD},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("responseStatus") != "SUCCESS":
        msg = (data.get("errors") or [{"message": "Unknown error"}])[0]["message"]
        raise RuntimeError(f"Vault auth failed: {msg}")
    _session_id = data["sessionId"]
    return _session_id


def _session():
    if not _session_id:
        _authenticate()
    return _session_id


def _is_session_expired(data):
    if data.get("responseStatus") != "FAILURE":
        return False
    errors = data.get("errors") or []
    return any(e.get("type") == "INVALID_SESSION_ID" for e in errors)


def _get(path, params=None):
    global _session_id
    for attempt in range(2):
        resp = requests.get(
            f"{_base_url()}{path}",
            headers={"Authorization": _session(), "Accept": "application/json"},
            params=params,
            timeout=30,
        )
        if resp.status_code == 401 and attempt == 0:
            _session_id = None
            continue
        resp.raise_for_status()
        data = resp.json()
        if _is_session_expired(data) and attempt == 0:
            _session_id = None
            continue
        return data


def _post_form(path, data):
    global _session_id
    for attempt in range(2):
        resp = requests.post(
            f"{_base_url()}{path}",
            headers={"Authorization": _session(), "Accept": "application/json"},
            data=data,
            timeout=30,
        )
        if resp.status_code == 401 and attempt == 0:
            _session_id = None
            continue
        resp.raise_for_status()
        result = resp.json()
        if _is_session_expired(result) and attempt == 0:
            _session_id = None
            continue
        return result


def _post_json(path, payload):
    global _session_id
    for attempt in range(2):
        resp = requests.post(
            f"{_base_url()}{path}",
            headers={
                "Authorization": _session(),
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=30,
        )
        if resp.status_code == 401 and attempt == 0:
            _session_id = None
            continue
        resp.raise_for_status()
        result = resp.json()
        if _is_session_expired(result) and attempt == 0:
            _session_id = None
            continue
        return result


def _put_json(path, payload):
    global _session_id
    for attempt in range(2):
        resp = requests.put(
            f"{_base_url()}{path}",
            headers={
                "Authorization": _session(),
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=30,
        )
        if resp.status_code == 401 and attempt == 0:
            _session_id = None
            continue
        resp.raise_for_status()
        result = resp.json()
        if _is_session_expired(result) and attempt == 0:
            _session_id = None
            continue
        return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

results = {"created": [], "already_exists": [], "errors": []}


def log_ok(category, name):
    print(f"  [OK] {category}: {name}")
    results["created"].append(f"{category}: {name}")


def log_exists(category, name):
    print(f"  [EXISTS] {category}: {name}")
    results["already_exists"].append(f"{category}: {name}")


def log_error(category, name, err):
    print(f"  [ERROR] {category}: {name} -> {err}")
    results["errors"].append(f"{category}: {name} -> {err}")


def _extract_error(data):
    errors = data.get("errors") or []
    if errors:
        return "; ".join(e.get("message", str(e)) for e in errors)
    return str(data)


# ---------------------------------------------------------------------------
# Step 1: Picklists
# ---------------------------------------------------------------------------

PICKLIST_MDL = [
    {
        "name": "feedback_category__c",
        "mdl": """RECREATE Picklist feedback_category__c (
    label('Feedback Category'),
    active(true),
    Picklistentry went_well__c(value('Went Well'), order(0), active(true)),
    Picklistentry didnt_go_well__c(value('Didn\\'t Go Well'), order(1), active(true)),
    Picklistentry ideas__c(value('Ideas'), order(2), active(true))
);""",
    },
    {
        "name": "board_status__c",
        "mdl": """RECREATE Picklist board_status__c (
    label('Board Status'),
    active(true),
    Picklistentry active__c(value('Active'), order(0), active(true)),
    Picklistentry closed__c(value('Closed'), order(1), active(true))
);""",
    },
    {
        "name": "action_status__c",
        "mdl": """RECREATE Picklist action_status__c (
    label('Action Status'),
    active(true),
    Picklistentry open__c(value('Open'), order(0), active(true)),
    Picklistentry in_progress__c(value('In Progress'), order(1), active(true)),
    Picklistentry done__c(value('Done'), order(2), active(true))
);""",
    },
    {
        "name": "ai_theme__c",
        "mdl": """RECREATE Picklist ai_theme__c (
    label('AI Theme'),
    active(true),
    Picklistentry tooling__c(value('Tooling'), order(0), active(true)),
    Picklistentry process__c(value('Process'), order(1), active(true)),
    Picklistentry communication__c(value('Communication'), order(2), active(true)),
    Picklistentry scope__c(value('Scope'), order(3), active(true)),
    Picklistentry staffing__c(value('Staffing'), order(4), active(true)),
    Picklistentry quality__c(value('Quality'), order(5), active(true)),
    Picklistentry morale__c(value('Morale'), order(6), active(true)),
    Picklistentry other__c(value('Other'), order(7), active(true))
);""",
    },
]


def _execute_mdl(mdl_script):
    """Execute an MDL script via the Vault configuration API."""
    return _post_form("/mdl/execute", {"script": mdl_script})


def create_picklists():
    print("\n=== Creating Picklists (via MDL) ===")
    for pl in PICKLIST_MDL:
        try:
            result = _execute_mdl(pl["mdl"])
            if result.get("responseStatus") == "SUCCESS":
                log_ok("Picklist", pl["name"])
            else:
                err = _extract_error(result)
                if "already exists" in err.lower():
                    log_exists("Picklist", pl["name"])
                else:
                    log_error("Picklist", pl["name"], err)
        except requests.exceptions.HTTPError as e:
            try:
                body = e.response.json()
                err_msg = _extract_error(body)
            except Exception:
                err_msg = str(e)
            if "already exists" in err_msg.lower():
                log_exists("Picklist", pl["name"])
            else:
                log_error("Picklist", pl["name"], err_msg)
        except Exception as e:
            log_error("Picklist", pl["name"], str(e))


def verify_picklists():
    print("\n=== Verifying Picklists ===")
    try:
        result = _get("/objects/picklists")
        picklist_names = [p.get("name") for p in result.get("picklists", [])]
        for pl in PICKLIST_MDL:
            if pl["name"] in picklist_names:
                print(f"  [VERIFIED] Picklist {pl['name']} exists")
                # Also verify values
                try:
                    vals = _get(f"/objects/picklists/{pl['name']}")
                    value_names = [v.get("name") for v in vals.get("picklistValues", [])]
                    print(f"    Values: {value_names}")
                except Exception as e:
                    print(f"    Could not read values: {e}")
            else:
                print(f"  [MISSING] Picklist {pl['name']} NOT found")
    except Exception as e:
        print(f"  Error listing picklists: {e}")


# ---------------------------------------------------------------------------
# Step 2: Objects and Fields
# ---------------------------------------------------------------------------

OBJECTS = [
    {
        "name": "team__c",
        "definition": {
            "label": "Team",
            "label_plural": "Teams",
            "object_type": "base__v",
            "in_menu": True,
            "description": "Represents a team participating in retrospectives",
        },
        "fields": [],  # name__v is auto-created
    },
    {
        "name": "retro_board__c",
        "definition": {
            "label": "Retro Board",
            "label_plural": "Retro Boards",
            "object_type": "base__v",
            "in_menu": True,
            "description": "A retrospective session board",
        },
        "fields": [
            {
                "label": "Facilitator",
                "name": "facilitator__c",
                "type": "Object",
                "relationship_type": "reference",
                "object": {"name": "user__sys"},
            },
            {
                "label": "Team",
                "name": "team__c",
                "type": "Object",
                "relationship_type": "reference",
                "object": {"name": "team__c"},
            },
            {
                "label": "Release Tag",
                "name": "release_tag__c",
                "type": "String",
            },
            {
                "label": "Board Date",
                "name": "board_date__c",
                "type": "Date",
                "required": True,
            },
            {
                "label": "Status",
                "name": "status__c",
                "type": "Picklist",
                "picklist": "board_status__c",
                "required": True,
            },
        ],
    },
    {
        "name": "feedback_item__c",
        "definition": {
            "label": "Feedback Item",
            "label_plural": "Feedback Items",
            "object_type": "base__v",
            "in_menu": True,
            "description": "Individual feedback entry on a retro board",
        },
        "fields": [
            {
                "label": "Retro Board",
                "name": "retro_board__c",
                "type": "Object",
                "relationship_type": "reference",
                "object": {"name": "retro_board__c"},
                "required": True,
            },
            {
                "label": "Author",
                "name": "author__c",
                "type": "Object",
                "relationship_type": "reference",
                "object": {"name": "user__sys"},
                "required": True,
            },
            {
                "label": "Category",
                "name": "category__c",
                "type": "Picklist",
                "picklist": "feedback_category__c",
                "required": True,
            },
            {
                "label": "Content",
                "name": "content__c",
                "type": "String",
                "required": True,
            },
            {
                "label": "Theme",
                "name": "ai_theme__c",
                "type": "Picklist",
                "picklist": "ai_theme__c",
            },
            {
                "label": "Vote Count",
                "name": "vote_count__c",
                "type": "Number",
            },
        ],
    },
    {
        "name": "action_item__c",
        "definition": {
            "label": "Action Item",
            "label_plural": "Action Items",
            "object_type": "base__v",
            "in_menu": True,
            "description": "Action item created from a retrospective",
        },
        "fields": [
            {
                "label": "Retro Board",
                "name": "retro_board__c",
                "type": "Object",
                "relationship_type": "reference",
                "object": {"name": "retro_board__c"},
                "required": True,
            },
            {
                "label": "Owner",
                "name": "owner__c",
                "type": "Object",
                "relationship_type": "reference",
                "object": {"name": "user__sys"},
            },
            {
                "label": "Status",
                "name": "status__c",
                "type": "Picklist",
                "picklist": "action_status__c",
                "required": True,
            },
            {
                "label": "Due Date",
                "name": "due_date__c",
                "type": "Date",
            },
            {
                "label": "Completed At",
                "name": "completed_at__c",
                "type": "DateTime",
            },
        ],
    },
    {
        "name": "vote__c",
        "definition": {
            "label": "Vote",
            "label_plural": "Votes",
            "object_type": "base__v",
            "in_menu": True,
            "description": "Upvote on a feedback item, one per user per item",
        },
        "fields": [
            {
                "label": "Feedback Item",
                "name": "feedback_item__c",
                "type": "Object",
                "relationship_type": "reference",
                "object": {"name": "feedback_item__c"},
                "required": True,
            },
            {
                "label": "Voter",
                "name": "voter__c",
                "type": "Object",
                "relationship_type": "reference",
                "object": {"name": "user__sys"},
                "required": True,
            },
            {
                "label": "Active",
                "name": "active__c",
                "type": "YesNo",
            },
        ],
    },
]


def create_objects_and_fields():
    for obj in OBJECTS:
        obj_name = obj["name"]
        print(f"\n=== Creating Object: {obj_name} ===")

        # Create the object
        try:
            result = _post_json("/metadata/vobjects", obj["definition"])
            if result.get("responseStatus") == "SUCCESS":
                log_ok("Object", obj_name)
            else:
                err = _extract_error(result)
                if "DUPLICATE" in err.upper() or "already exists" in err.lower():
                    log_exists("Object", obj_name)
                else:
                    log_error("Object", obj_name, err)
        except requests.exceptions.HTTPError as e:
            status = e.response.status_code if e.response is not None else "?"
            try:
                body = e.response.json()
                err_msg = _extract_error(body)
            except Exception:
                err_msg = str(e)
            if "DUPLICATE" in err_msg.upper() or "already exists" in err_msg.lower():
                log_exists("Object", obj_name)
            else:
                log_error("Object", obj_name, err_msg)
                continue  # skip fields if object creation failed
        except Exception as e:
            log_error("Object", obj_name, str(e))
            continue

        # Create fields one at a time
        for field_def in obj["fields"]:
            field = {k: v for k, v in field_def.items() if k != "name"}
            field_name = field_def.get("name")
            display_name = f"{obj_name}.{field_name}"
            try:
                result = _post_json(f"/metadata/vobjects/{obj_name}/fields", field)
                if result.get("responseStatus") == "SUCCESS":
                    log_ok("Field", display_name)
                else:
                    err = _extract_error(result)
                    if "DUPLICATE" in err.upper() or "already exists" in err.lower():
                        log_exists("Field", display_name)
                    else:
                        log_error("Field", display_name, err)
            except requests.exceptions.HTTPError as e:
                try:
                    body = e.response.json()
                    err_msg = _extract_error(body)
                except Exception:
                    err_msg = str(e)
                if "DUPLICATE" in err_msg.upper() or "already exists" in err_msg.lower():
                    log_exists("Field", display_name)
                else:
                    log_error("Field", display_name, err_msg)
            except Exception as e:
                log_error("Field", display_name, str(e))


def verify_objects():
    print("\n=== Verifying Objects ===")
    try:
        result = _get("/metadata/vobjects")
        obj_names = [o.get("name") for o in result.get("objects", [])]
        for obj in OBJECTS:
            if obj["name"] in obj_names:
                print(f"  [VERIFIED] Object {obj['name']} exists")
                # Verify fields
                try:
                    meta = _get(f"/metadata/vobjects/{obj['name']}")
                    field_names = [
                        f.get("name") for f in meta.get("object", {}).get("fields", [])
                    ]
                    custom_fields = [f for f in field_names if f and f.endswith("__c")]
                    print(f"    Custom fields: {custom_fields}")
                except Exception as e:
                    print(f"    Could not read fields: {e}")
            else:
                print(f"  [MISSING] Object {obj['name']} NOT found")
    except Exception as e:
        print(f"  Error listing objects: {e}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"RetroVault Schema Deployer")
    print(f"Target: {VAULT_DNS}")
    print(f"API Version: {VAULT_API_VERSION}")
    print(f"User: {VAULT_USERNAME}")

    # Authenticate
    print("\n=== Authenticating ===")
    try:
        _authenticate()
        print(f"  [OK] Authenticated successfully")
    except Exception as e:
        sys.exit(f"  [FATAL] Authentication failed: {e}")

    # Deploy
    create_picklists()
    verify_picklists()
    create_objects_and_fields()
    verify_objects()

    # Summary
    print("\n" + "=" * 60)
    print("DEPLOYMENT SUMMARY")
    print("=" * 60)
    print(f"Created:        {len(results['created'])}")
    print(f"Already existed: {len(results['already_exists'])}")
    print(f"Errors:          {len(results['errors'])}")

    if results["created"]:
        print("\nCreated:")
        for item in results["created"]:
            print(f"  + {item}")

    if results["already_exists"]:
        print("\nAlready existed:")
        for item in results["already_exists"]:
            print(f"  ~ {item}")

    if results["errors"]:
        print("\nErrors:")
        for item in results["errors"]:
            print(f"  ! {item}")
        sys.exit(1)

    print("\nDone.")


if __name__ == "__main__":
    main()
