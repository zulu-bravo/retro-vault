/**
 * RetroVault - DataService Wrapper
 *
 * Wraps the Veeva X-Pages DataService (window.ds) with
 * convenience methods and standardized error handling.
 */
var VaultDS = (function () {
    'use strict';

    /**
     * Query records from an object
     * @param {string} object - API name of the object
     * @param {string[]} fields - Field API names to return
     * @param {object} [opts] - Optional: where, sort, limit
     * @returns {Promise<Array>} Array of record objects
     */
    function query(object, fields, opts) {
        opts = opts || {};
        var config = { object: object, fields: fields };
        if (opts.where) config.where = opts.where;
        if (opts.sort) config.sort = opts.sort;
        if (opts.limit) config.limit = opts.limit;

        return ds.queryRecord(config).then(function (resp) {
            if (resp && resp.success !== false) {
                return resp[object] || [];
            }
            throw new Error('Query failed for ' + object);
        });
    }

    /**
     * Create a record
     * @param {string} object - API name of the object
     * @param {object} fields - Key-value pairs of field values
     * @returns {Promise<string>} ID of created record
     */
    function create(object, fields) {
        return ds.createRecord({ object: object, fields: fields }).then(function (resp) {
            if (resp && resp.success !== false) {
                return resp.id || resp;
            }
            throw new Error('Create failed for ' + object);
        });
    }

    /**
     * Update a record
     * @param {string} object - API name of the object
     * @param {string} id - Record ID (Vault ID or Mobile ID)
     * @param {object} fields - Key-value pairs to update
     * @returns {Promise<string>} ID of updated record
     */
    function update(object, id, fields) {
        return ds.updateRecord({ object: object, id: id, fields: fields }).then(function (resp) {
            if (resp && resp.success !== false) {
                return resp.id || resp;
            }
            throw new Error('Update failed for ' + object);
        });
    }

    /**
     * Get picklist value labels for a field
     * @param {string} object - API name of the object
     * @param {string} field - API name of the picklist field
     * @returns {Promise<Array>} Array of {name, label, isActive}
     */
    function getPicklistValues(object, field) {
        return ds.getPicklistValueLabels(object, field, false).then(function (resp) {
            if (resp && resp[object] && resp[object][field]) {
                return resp[object][field];
            }
            return [];
        });
    }

    /**
     * Query all users from user__sys
     * @returns {Promise<Array>} Array of user records
     */
    function getUsers() {
        return query('user__sys', ['id', 'name__v']);
    }

    return {
        query: query,
        create: create,
        update: update,
        getPicklistValues: getPicklistValues,
        getUsers: getUsers
    };
})();
