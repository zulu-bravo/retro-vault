#!/usr/bin/env python3
"""
Veeva Vault MCP Server
Lets Claude query Vault metadata, objects, picklists, and message catalog.
"""

import os
import json
import requests
from pathlib import Path
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

# Load .env from the same directory as this script
load_dotenv(Path(__file__).parent / ".env")

VAULT_DNS = os.getenv("VAULT_DNS")
VAULT_USERNAME = os.getenv("VAULT_USERNAME")
VAULT_PASSWORD = os.getenv("VAULT_PASSWORD")
VAULT_API_VERSION = os.getenv("VAULT_API_VERSION", "v24.1")

missing = [k for k in ("VAULT_DNS", "VAULT_USERNAME", "VAULT_PASSWORD") if not os.getenv(k)]
if missing:
    raise SystemExit(
        f"ERROR: Missing required environment variables: {', '.join(missing)}\n"
        "Copy .env.example to .env in the vaultMCP folder and fill in your credentials."
    )

mcp = FastMCP("Veeva Vault")

# ---------------------------------------------------------------------------
# Vault API client
# ---------------------------------------------------------------------------

_session_id: str | None = None


def _base_url() -> str:
    return f"https://{VAULT_DNS}/api/{VAULT_API_VERSION}"


def _authenticate() -> str:
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


def _session() -> str:
    if not _session_id:
        _authenticate()
    return _session_id


def _is_session_expired(data: dict) -> bool:
    """Vault returns HTTP 200 with FAILURE status when session expires."""
    if data.get("responseStatus") != "FAILURE":
        return False
    errors = data.get("errors") or []
    return any(e.get("type") == "INVALID_SESSION_ID" for e in errors)


def _get(path: str, params: dict | None = None) -> dict:
    global _session_id
    for attempt in range(2):
        resp = requests.get(
            f"{_base_url()}{path}",
            headers={"Authorization": _session(), "Accept": "application/json"},
            params=params,
            timeout=30,
        )
        if resp.status_code == 401 and attempt == 0:
            _session_id = None  # force re-auth
            continue
        resp.raise_for_status()
        data = resp.json()
        if _is_session_expired(data) and attempt == 0:
            _session_id = None  # force re-auth
            continue
        return data


def _post_form(path: str, data: dict) -> dict:
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


def _post_json(path: str, payload: dict) -> dict:
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


def _put_json(path: str, payload: dict) -> dict:
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


def _delete(path: str) -> dict:
    global _session_id
    for attempt in range(2):
        resp = requests.delete(
            f"{_base_url()}{path}",
            headers={"Authorization": _session(), "Accept": "application/json"},
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
# Tools
# ---------------------------------------------------------------------------

@mcp.tool()
def get_vault_info() -> str:
    """Get basic information about the connected Vault instance (name, API versions, etc.)."""
    return json.dumps(_get("/"), indent=2)


@mcp.tool()
def list_objects() -> str:
    """List all objects (vobjects) in the Vault — both standard and custom.
    Returns each object's API name, label, and prefix.
    """
    result = _get("/metadata/vobjects")
    summary = [
        {"name": o.get("name"), "label": o.get("label"), "prefix": o.get("prefix")}
        for o in result.get("objects", [])
    ]
    return json.dumps(summary, indent=2)


@mcp.tool()
def get_object_metadata(object_name: str) -> str:
    """Get full metadata for a Vault object: all fields, types, relationships, and record types.

    Args:
        object_name: API name of the object, e.g. 'account__v', 'call__v', 'product__v'
    """
    return json.dumps(_get(f"/metadata/vobjects/{object_name}"), indent=2)


@mcp.tool()
def get_object_fields(object_name: str) -> str:
    """Get a condensed field summary for a Vault object — name, label, type, required flag, and picklist.
    Easier to skim than full metadata when you just need to understand the schema.

    Args:
        object_name: API name of the object, e.g. 'account__v', 'call__v'
    """
    result = _get(f"/metadata/vobjects/{object_name}")
    fields = [
        {
            "name": f.get("name"),
            "label": f.get("label"),
            "type": f.get("type"),
            "required": f.get("required", False),
            "picklist": f.get("picklist"),
            "lookup_relationship_name": f.get("lookup_relationship_name"),
        }
        for f in result.get("object", {}).get("fields", [])
    ]
    return json.dumps(fields, indent=2)


@mcp.tool()
def get_object_record_types(object_name: str) -> str:
    """Get the record types defined for a Vault object.
    Record types control which fields and layouts are available for different use cases.

    Args:
        object_name: API name of the object, e.g. 'call__v'
    """
    return json.dumps(_get(f"/metadata/vobjects/{object_name}/types"), indent=2)


@mcp.tool()
def list_picklists() -> str:
    """List all picklists defined in the Vault."""
    return json.dumps(_get("/objects/picklists"), indent=2)


@mcp.tool()
def get_picklist_values(picklist_name: str) -> str:
    """Get all values for a specific picklist, including labels and active status.

    Args:
        picklist_name: API name of the picklist, e.g. 'call_status__v'
    """
    return json.dumps(_get(f"/objects/picklists/{picklist_name}"), indent=2)


@mcp.tool()
def list_message_groups() -> str:
    """List all message groups in the Vault message catalog.
    Use this to discover available groups before filtering search_message_catalog.
    """
    result = _post_form("/query", {"q": "SELECT id, name__v, label__v FROM message_group__v LIMIT 200"})
    return json.dumps(result, indent=2)


@mcp.tool()
def search_message_catalog(search_term: str = "", message_group: str = "", limit: int = 100) -> str:
    """Search the Vault message catalog for UI strings and labels.
    Useful when writing specs so you can reference exact existing label text.

    Args:
        search_term: Filter messages whose name contains this text (partial match, optional)
        message_group: Filter to a specific message group by name (optional)
        limit: Max results to return (default 100, max 500)
    """
    conditions = []
    if message_group:
        safe_group = message_group.replace("'", "''")
        conditions.append(f"message_group__vr.name__v = '{safe_group}'")
    if search_term:
        safe_term = search_term.replace("'", "''")
        conditions.append(f"name__v LIKE '%{safe_term}%'")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = (
        f"SELECT id, name__v, label__v, message_group__vr.name__v "
        f"FROM message__v {where} LIMIT {min(limit, 500)}"
    )
    return json.dumps(_post_form("/query", {"q": query}), indent=2)


@mcp.tool()
def run_vql_query(query: str) -> str:
    """Run an arbitrary VQL (Vault Query Language) query. VQL is SQL-like.

    Examples:
        SELECT id, name__v, status__v FROM account__v LIMIT 20
        SELECT id, name__v FROM call__v WHERE status__v = 'Submitted' LIMIT 10
        SELECT name__v, label__v FROM message__v LIMIT 50

    Args:
        query: Full VQL query string
    """
    return json.dumps(_post_form("/query", {"q": query}), indent=2)


# ---------------------------------------------------------------------------
# Write tools — objects
# ---------------------------------------------------------------------------

@mcp.tool()
def create_object(definition: str) -> str:
    """Create a new custom Vault object.

    Args:
        definition: JSON string with the object definition. Example:
            {"label": "My Object", "label_plural": "My Objects",
             "object_type": "base__v", "in_menu": true}
            Vault auto-generates the API name from the label (e.g. my_object__c).
    """
    payload = json.loads(definition)
    return json.dumps(_post_json("/metadata/vobjects", payload), indent=2)


@mcp.tool()
def update_object(object_name: str, definition: str) -> str:
    """Update properties of an existing Vault object (label, help text, etc.).

    Args:
        object_name: API name of the object, e.g. 'my_object__c'
        definition: JSON string with the fields to update. Example:
            {"label": "Updated Label", "label_plural": "Updated Labels"}
    """
    payload = json.loads(definition)
    return json.dumps(_put_json(f"/metadata/vobjects/{object_name}", payload), indent=2)


@mcp.tool()
def delete_object(object_name: str) -> str:
    """Delete a custom Vault object. Only custom objects (ending in __c) can be deleted.

    Args:
        object_name: API name of the object to delete, e.g. 'my_object__c'
    """
    return json.dumps(_delete(f"/metadata/vobjects/{object_name}"), indent=2)


# ---------------------------------------------------------------------------
# Write tools — fields
# ---------------------------------------------------------------------------

@mcp.tool()
def create_object_field(object_name: str, definition: str) -> str:
    """Create a new field on a Vault object.

    Args:
        object_name: API name of the object, e.g. 'my_object__c'
        definition: JSON string with field definition. Common examples:
            Text:     {"label": "My Field", "type": "String", "max_length": 100}
            Number:   {"label": "Score", "type": "Number", "max_length": 10, "decimal_places": 2}
            Picklist: {"label": "Status", "type": "Picklist", "picklist": "my_status__c"}
            Boolean:  {"label": "Active", "type": "YesNo"}
            Date:     {"label": "Start Date", "type": "Date"}
            Lookup:   {"label": "Account", "type": "Object", "relationship_type": "reference",
                       "object": {"name": "account__v"}}
    """
    payload = json.loads(definition)
    return json.dumps(_post_json(f"/metadata/vobjects/{object_name}/fields", payload), indent=2)


@mcp.tool()
def update_object_field(object_name: str, field_name: str, definition: str) -> str:
    """Update properties of an existing field on a Vault object.

    Args:
        object_name: API name of the object, e.g. 'my_object__c'
        field_name: API name of the field to update, e.g. 'my_field__c'
        definition: JSON string with fields to update. Example:
            {"label": "New Label", "required": true}
    """
    payload = json.loads(definition)
    return json.dumps(_put_json(f"/metadata/vobjects/{object_name}/fields/{field_name}", payload), indent=2)


@mcp.tool()
def delete_object_field(object_name: str, field_name: str) -> str:
    """Delete a custom field from a Vault object.

    Args:
        object_name: API name of the object, e.g. 'my_object__c'
        field_name: API name of the field to delete, e.g. 'my_field__c'
    """
    return json.dumps(_delete(f"/metadata/vobjects/{object_name}/fields/{field_name}"), indent=2)


# ---------------------------------------------------------------------------
# Write tools — picklists
# ---------------------------------------------------------------------------

@mcp.tool()
def create_picklist(definition: str) -> str:
    """Create a new picklist in the Vault.

    Args:
        definition: JSON string with picklist definition. Example:
            {"name": "my_status__c", "label": "My Status",
             "picklistValues": [
                 {"label": "Active", "value": "active__c"},
                 {"label": "Inactive", "value": "inactive__c"}
             ]}
    """
    payload = json.loads(definition)
    return json.dumps(_post_json("/objects/picklists", payload), indent=2)


@mcp.tool()
def add_picklist_value(picklist_name: str, definition: str) -> str:
    """Add one or more values to an existing picklist.

    Args:
        picklist_name: API name of the picklist, e.g. 'my_status__c'
        definition: JSON string with values to add. Example:
            {"picklistValues": [
                {"label": "Pending", "value": "pending__c"},
                {"label": "Closed", "value": "closed__c"}
            ]}
    """
    payload = json.loads(definition)
    return json.dumps(_put_json(f"/objects/picklists/{picklist_name}", payload), indent=2)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    mcp.run()
