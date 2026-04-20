/**
 * RetroVault - PageController Event API
 *
 * Thin wrapper around the `sendEvent` function provided by Vault
 * Custom Pages. All data access goes through our Java PageController
 * via four generic events: query, create, update, delete.
 */

import { vaultApiClient } from '@veeva/vault';

let _sendEvent = null;
let _currentUserId = null;
let _currentUserName = null;

export function initApi(sendEvent, userId) {
    _sendEvent = sendEvent;
    _currentUserId = userId;
    // Fetch the current user's name via REST (vaultApiClient bypasses the
    // SDK restriction on user__sys queries). Fire-and-forget.
    loadCurrentUserName();
}

export function getCurrentUserId() {
    return _currentUserId;
}

export function getCurrentUserName() {
    return _currentUserName;
}

async function loadCurrentUserName() {
    try {
        const resp = await vaultApiClient.fetch('/v25.1/objects/users/me', {
            headers: { Accept: 'application/json' }
        });
        const json = await resp.json();
        const user = json?.users?.[0]?.user;
        if (user) {
            const full = [user.user_first_name__v, user.user_last_name__v].filter(Boolean).join(' ').trim();
            _currentUserName = full || user.user_name__v || null;
        }
    } catch (err) {
        console.warn('[RetroVault] Could not load current user name:', err.message);
    }
}

function ensureInit() {
    if (!_sendEvent) {
        throw new Error('Vault API not initialized. Call initApi(sendEvent, userId) first.');
    }
}

// Vault Custom Pages wraps PageController responses as { data: <controller payload> }.
function unwrap(resp) {
    return (resp && resp.data) || {};
}

/**
 * Run a VQL query.
 * @param {string} vql - VQL statement (SELECT ... FROM object__c WHERE ...)
 * @returns {Promise<Array>} records
 */
export async function query(vql) {
    ensureInit();
    const payload = unwrap(await _sendEvent('query', { vql }));
    if (payload.success === false) {
        throw new Error(payload.error || 'Query failed');
    }
    return payload.records || [];
}

/**
 * Create a record.
 * @param {string} object - API name
 * @param {object} fields - Field values
 * @returns {Promise<string>} new record ID
 */
export async function create(object, fields) {
    ensureInit();
    const payload = unwrap(await _sendEvent('create', { object, fields }));
    if (payload.success === false) {
        throw new Error(payload.error || 'Create failed');
    }
    return payload.id;
}

/**
 * Update a record.
 * @param {string} object - API name
 * @param {string} id - Record ID
 * @param {object} fields - Fields to update
 * @returns {Promise<string>} updated record ID
 */
export async function update(object, id, fields) {
    ensureInit();
    const payload = unwrap(await _sendEvent('update', { object, id, fields }));
    if (payload.success === false) {
        throw new Error(payload.error || 'Update failed');
    }
    return payload.id;
}

/**
 * Delete a record.
 * @param {string} object - API name
 * @param {string} id - Record ID
 * @returns {Promise<void>}
 */
export async function deleteRecord(object, id) {
    ensureInit();
    const payload = unwrap(await _sendEvent('delete', { object, id }));
    if (payload.success === false) {
        throw new Error(payload.error || 'Delete failed');
    }
}

/* -----------------------------------------------------------
 * Domain-specific helpers
 * ----------------------------------------------------------- */

export function escapeVql(str) {
    if (str == null) return '';
    return String(str).replace(/'/g, "\\'");
}

export async function fetchTeams() {
    return query("SELECT id, name__v FROM retro_team__c ORDER BY name__v ASC");
}

export async function fetchReleases() {
    return query(
        "SELECT id, name__v FROM retro_release__c ORDER BY name__v ASC"
    );
}

export async function createRelease(name) {
    return create('retro_release__c', { name__v: name });
}

export async function updateRelease(id, fields) {
    return update('retro_release__c', id, fields);
}

/* ---------- Features ---------- */

export async function fetchFeatures() {
    return query(
        "SELECT id, name__v, display_name__c, release__c, release__cr.name__v " +
        "FROM retro_feature__c ORDER BY release__cr.name__v ASC, display_name__c ASC"
    );
}

export async function fetchFeaturesForRelease(releaseId) {
    return query(
        "SELECT id, name__v, display_name__c, release__c " +
        "FROM retro_feature__c " +
        `WHERE release__c = '${escapeVql(releaseId)}' ` +
        "ORDER BY display_name__c ASC"
    );
}

export async function createFeature(displayName, releaseId, releaseName) {
    // name__v must be unique tenant-wide — store a composite that includes
    // the release name so the same feature name can exist under different releases.
    // The UI displays display_name__c.
    const composite = `${releaseName || releaseId} . ${displayName}`.slice(0, 200);
    return create('retro_feature__c', {
        name__v: composite,
        display_name__c: displayName,
        release__c: releaseId,
    });
}

export async function deleteFeature(featureId) {
    return deleteRecord('retro_feature__c', featureId);
}

/* ---------- Board <-> Feature junction ---------- */

export async function fetchBoardFeatures(boardId) {
    return query(
        "SELECT id, retro_feature__c, retro_feature__cr.name__v, retro_feature__cr.display_name__c " +
        "FROM retro_board_feature__c " +
        `WHERE retro_board__c = '${escapeVql(boardId)}' ` +
        "ORDER BY retro_feature__cr.display_name__c ASC"
    );
}

export async function assignFeatureToBoard(boardId, featureId) {
    // Composite name for uniqueness — matches the pattern used on retro_vote__c.
    const composite = `${boardId}_${featureId}`.slice(0, 80);
    return create('retro_board_feature__c', {
        name__v: composite,
        retro_board__c: boardId,
        retro_feature__c: featureId,
    });
}

export async function unassignFeatureFromBoard(junctionId) {
    return deleteRecord('retro_board_feature__c', junctionId);
}

// Note: this Vault's SDK blocks direct queries on `user__sys`, so we pull
// user names via dotted relationship syntax (facilitator__cr.name__v etc).
// The client reads the joined value from the row via userName(row, prefix).

export async function fetchBoards() {
    return query(
        "SELECT id, name__v, facilitator__c, facilitator__cr.name__v, " +
        "team__c, release__c, release__cr.name__v, " +
        "board_date__c, status__c " +
        "FROM retro_board__c ORDER BY board_date__c DESC"
    );
}

export async function fetchBoard(boardId) {
    const records = await query(
        "SELECT id, name__v, facilitator__c, facilitator__cr.name__v, " +
        "team__c, release__c, release__cr.name__v, " +
        "board_date__c, status__c " +
        "FROM retro_board__c " +
        `WHERE id = '${escapeVql(boardId)}'`
    );
    return records[0] || null;
}

export async function fetchFeedbackForBoard(boardId) {
    return query(
        "SELECT id, name__v, retro_board__c, author__c, author__cr.name__v, " +
        "category__c, content__c, theme__c, feature__c, vote_count__c, group__c, " +
        "kudos_recipient__c, kudos_recipient__cr.name__v, order__c " +
        "FROM retro_feedback__c " +
        `WHERE retro_board__c = '${escapeVql(boardId)}' ` +
        "ORDER BY order__c ASC"
    );
}

export async function fetchActionsForBoard(boardId) {
    return query(
        "SELECT id, name__v, retro_board__c, owner__c, owner__cr.name__v, " +
        "assignee__c, assignee__cr.name__v, " +
        "status__c, due_date__c, completed_at__c, order__c FROM retro_action__c " +
        `WHERE retro_board__c = '${escapeVql(boardId)}' ` +
        "ORDER BY order__c ASC"
    );
}

/**
 * Search users by name (type-ahead). Uses the Vault REST Query API directly
 * via vaultApiClient to avoid the SDK restriction on user__sys VQL queries.
 * @param {string} term - search string (min 2 chars)
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
// Cached user list — loaded once on first search, reused for subsequent keystrokes
let _usersCache = null;

async function loadAllUsers() {
    if (_usersCache) return _usersCache;
    const resp = await vaultApiClient.fetch('/v25.1/objects/users', {
        headers: { Accept: 'application/json' }
    });
    const json = await resp.json();
    _usersCache = (json.users || []).map(entry => {
        const u = entry.user;
        const name = [u.user_first_name__v, u.user_last_name__v].filter(Boolean).join(' ').trim()
            || u.user_name__v
            || '';
        return { id: String(u.id), name };
    });
    return _usersCache;
}

/**
 * Search users by name (type-ahead). Loads all users once and filters
 * client-side using the same REST endpoint that loadCurrentUserName uses.
 * @param {string} term - search string (min 2 chars)
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function searchUsers(term) {
    if (!term || term.trim().length < 2) return [];
    const lower = term.trim().toLowerCase();
    try {
        const users = await loadAllUsers();
        return users.filter(u => u.name.toLowerCase().includes(lower)).slice(0, 10);
    } catch (err) {
        console.warn('[RetroVault] User search failed:', err.message);
        return [];
    }
}

export async function fetchVotesForUser(userId) {
    return query(
        "SELECT id, feedback_item__c, voter__c FROM retro_vote__c " +
        `WHERE voter__c = '${escapeVql(userId)}'`
    );
}

// Helper — read a joined user name off a row (returns 'Unknown' if absent).
export function userName(row, prefix) {
    return (row && row[prefix + '__cr.name__v']) || 'Unknown';
}

export async function fetchAllFeedback() {
    return query(
        "SELECT id, retro_board__c, category__c, theme__c, content__c, vote_count__c, " +
        "kudos_recipient__c, kudos_recipient__cr.name__v " +
        "FROM retro_feedback__c"
    );
}

export async function fetchAllActions() {
    return query(
        "SELECT id, name__v, retro_board__c, status__c, due_date__c, completed_at__c, " +
        "assignee__c, assignee__cr.name__v FROM retro_action__c"
    );
}
