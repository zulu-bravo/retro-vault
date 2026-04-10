/**
 * RetroVault - Shared Application State & Utilities
 *
 * Manages current user via URL parameters (X-Pages does not
 * support localStorage/IndexedDB).
 */
var App = (function () {
    'use strict';

    /* ---------- URL Parameter Helpers ---------- */

    function getParam(name) {
        var params = new URLSearchParams(window.location.search);
        return params.get(name) || '';
    }

    function setParams(baseUrl, params) {
        var url = baseUrl.split('?')[0];
        var qs = new URLSearchParams();
        for (var key in params) {
            if (params.hasOwnProperty(key) && params[key]) {
                qs.set(key, params[key]);
            }
        }
        var str = qs.toString();
        return str ? url + '?' + str : url;
    }

    /**
     * Build a navigation URL that preserves the current userId
     */
    function buildUrl(page, extraParams) {
        var params = { userId: getCurrentUserId() };
        if (extraParams) {
            for (var k in extraParams) {
                if (extraParams.hasOwnProperty(k)) params[k] = extraParams[k];
            }
        }
        return setParams(page, params);
    }

    function navigate(page, extraParams) {
        window.location.href = buildUrl(page, extraParams);
    }

    /* ---------- Current User ---------- */

    function getCurrentUserId() {
        return getParam('userId');
    }

    /* ---------- Date Formatting ---------- */

    function formatDate(dateStr) {
        if (!dateStr) return '';
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }

    function formatDateTime(dateStr) {
        if (!dateStr) return '';
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return formatDate(dateStr) + ' ' +
            String(d.getHours()).padStart(2, '0') + ':' +
            String(d.getMinutes()).padStart(2, '0');
    }

    function toISODate(dateStr) {
        if (!dateStr) return '';
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    /* ---------- Toast Notifications ---------- */

    function showToast(message, type) {
        type = type || 'info';
        var el = document.createElement('div');
        el.className = 'vault-toast vault-toast--' + type;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(function () {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s';
            setTimeout(function () { el.remove(); }, 300);
        }, 3000);
    }

    /* ---------- User Name Resolver ---------- */

    var _userCache = null;

    function loadUsers() {
        if (_userCache) return Q.resolve(_userCache);
        return VaultDS.getUsers().then(function (users) {
            _userCache = {};
            users.forEach(function (u) {
                _userCache[u.id] = u.name__v || u.Name || 'Unknown';
            });
            return _userCache;
        });
    }

    function getUserName(userId) {
        if (!userId) return 'Unassigned';
        if (_userCache && _userCache[userId]) return _userCache[userId];
        return 'User';
    }

    /* ---------- Escaping ---------- */

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return {
        getParam: getParam,
        buildUrl: buildUrl,
        navigate: navigate,
        getCurrentUserId: getCurrentUserId,
        formatDate: formatDate,
        formatDateTime: formatDateTime,
        toISODate: toISODate,
        showToast: showToast,
        loadUsers: loadUsers,
        getUserName: getUserName,
        escapeHtml: escapeHtml
    };
})();
