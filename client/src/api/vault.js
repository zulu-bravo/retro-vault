/**
 * RetroVault - PageController Event API
 *
 * Thin wrapper around the `sendEvent` function provided by Vault
 * Custom Pages. All data access goes through our Java PageController
 * via four generic events: query, create, update, delete.
 */

let _sendEvent = null;
let _currentUserId = null;

export function initApi(sendEvent, userId) {
    _sendEvent = sendEvent;
    _currentUserId = userId;
}

export function getCurrentUserId() {
    return _currentUserId;
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
    return query("SELECT id, name__v FROM team__c ORDER BY name__v ASC");
}

export async function fetchBoards() {
    return query(
        "SELECT id, name__v, facilitator__c, team__c, release_tag__c, " +
        "board_date__c, status__c FROM retro_board__c ORDER BY board_date__c DESC"
    );
}

export async function fetchBoard(boardId) {
    const records = await query(
        "SELECT id, name__v, facilitator__c, team__c, release_tag__c, " +
        "board_date__c, status__c FROM retro_board__c " +
        `WHERE id = '${escapeVql(boardId)}'`
    );
    return records[0] || null;
}

export async function fetchFeedbackForBoard(boardId) {
    return query(
        "SELECT id, name__v, retro_board__c, author__c, category__c, content__c, " +
        "theme__c, vote_count__c FROM feedback_item__c " +
        `WHERE retro_board__c = '${escapeVql(boardId)}'`
    );
}

export async function fetchActionsForBoard(boardId) {
    return query(
        "SELECT id, name__v, retro_board__c, owner__c, status__c, " +
        "due_date__c, completed_at__c FROM action_item__c " +
        `WHERE retro_board__c = '${escapeVql(boardId)}'`
    );
}

export async function fetchVotesForUser(userId) {
    return query(
        "SELECT id, feedback_item__c, voter__c FROM vote__c " +
        `WHERE voter__c = '${escapeVql(userId)}'`
    );
}

export async function fetchUsers() {
    return query("SELECT id, name__v FROM user__sys WHERE status__v = 'active__v' LIMIT 50");
}

export async function fetchAllFeedback() {
    return query(
        "SELECT id, retro_board__c, category__c, theme__c, vote_count__c FROM feedback_item__c"
    );
}

export async function fetchAllActions() {
    return query(
        "SELECT id, retro_board__c, status__c FROM action_item__c"
    );
}
