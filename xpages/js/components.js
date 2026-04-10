/**
 * RetroVault - Reusable UI Components
 *
 * Renders common elements: nav bar, status badges, modals, etc.
 */
var Components = (function () {
    'use strict';

    /**
     * Render the top navigation bar
     * @param {string} activePage - Current page identifier
     * @param {Array} users - Array of {id, name__v} user records
     */
    function renderNavBar(activePage, users) {
        var currentUserId = App.getCurrentUserId();
        var links = [
            { id: 'dashboard', label: 'Dashboard', href: 'index.html' },
            { id: 'insights', label: 'Insights', href: 'insights.html' }
        ];

        var linksHtml = links.map(function (l) {
            var cls = 'vault-nav__link' + (l.id === activePage ? ' vault-nav__link--active' : '');
            return '<a class="' + cls + '" href="' + App.buildUrl(l.href) + '">' + l.label + '</a>';
        }).join('');

        var userOptions = (users || []).map(function (u) {
            var name = u.name__v || u.Name || 'User';
            var sel = u.id === currentUserId ? ' selected' : '';
            return '<option value="' + u.id + '"' + sel + '>' + App.escapeHtml(name) + '</option>';
        }).join('');

        var html = '<nav class="vault-nav">' +
            '<a class="vault-nav__logo" href="' + App.buildUrl('index.html') + '">RetroVault</a>' +
            '<div class="vault-nav__links">' + linksHtml + '</div>' +
            '<div class="vault-nav__right">' +
                '<select class="vault-nav__user-select" id="userSwitcher">' +
                    '<option value="">Select User</option>' + userOptions +
                '</select>' +
                '<a class="vault-btn vault-btn--small vault-btn--primary" href="' +
                    App.buildUrl('create-board.html') + '">+ New Board</a>' +
            '</div>' +
        '</nav>';

        document.getElementById('navContainer').innerHTML = html;

        var switcher = document.getElementById('userSwitcher');
        if (switcher) {
            switcher.addEventListener('change', function () {
                var params = new URLSearchParams(window.location.search);
                params.set('userId', this.value);
                window.location.search = params.toString();
            });
        }
    }

    /**
     * Render a status badge
     */
    function statusBadge(status) {
        if (!status) return '';
        var label = status.replace(/__c$/, '').replace(/_/g, ' ');
        label = label.charAt(0).toUpperCase() + label.slice(1);
        var cls = status.replace(/__c$/, '');
        return '<span class="vault-badge vault-badge--' + cls + '">' + App.escapeHtml(label) + '</span>';
    }

    /**
     * Render a theme badge
     */
    function themeBadge(theme) {
        if (!theme) return '';
        var label = theme.replace(/__c$/, '').replace(/_/g, ' ');
        label = label.charAt(0).toUpperCase() + label.slice(1);
        return '<span class="vault-badge vault-badge--theme">' + App.escapeHtml(label) + '</span>';
    }

    /**
     * Render loading spinner
     */
    function spinner() {
        return '<div class="vault-spinner"><div class="vault-spinner__ring"></div></div>';
    }

    /**
     * Render empty state
     */
    function emptyState(message) {
        return '<div class="vault-empty">' +
            '<div class="vault-empty__icon">&#x1F4AD;</div>' +
            '<div class="vault-empty__text">' + App.escapeHtml(message) + '</div>' +
        '</div>';
    }

    /**
     * Show a modal dialog
     */
    function showModal(title, bodyHtml, onConfirm, confirmLabel) {
        confirmLabel = confirmLabel || 'Save';
        var overlay = document.createElement('div');
        overlay.className = 'vault-modal-overlay vault-modal-overlay--visible';
        overlay.innerHTML =
            '<div class="vault-modal">' +
                '<div class="vault-modal__header">' +
                    '<div class="vault-modal__title">' + App.escapeHtml(title) + '</div>' +
                    '<button class="vault-modal__close" data-action="close">&times;</button>' +
                '</div>' +
                '<div class="vault-modal__body">' + bodyHtml + '</div>' +
                '<div class="vault-modal__footer">' +
                    '<button class="vault-btn vault-btn--secondary" data-action="close">Cancel</button>' +
                    '<button class="vault-btn vault-btn--primary" data-action="confirm">' + App.escapeHtml(confirmLabel) + '</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        overlay.addEventListener('click', function (e) {
            var action = e.target.getAttribute('data-action');
            if (action === 'close') {
                overlay.remove();
            } else if (action === 'confirm') {
                if (typeof onConfirm === 'function') {
                    onConfirm(overlay);
                }
            }
        });

        overlay.querySelector('.vault-modal-overlay').addEventListener('click', function (e) {
            if (e.target === overlay) overlay.remove();
        });

        return overlay;
    }

    /**
     * Close all open modals
     */
    function closeModals() {
        document.querySelectorAll('.vault-modal-overlay').forEach(function (el) {
            el.remove();
        });
    }

    return {
        renderNavBar: renderNavBar,
        statusBadge: statusBadge,
        themeBadge: themeBadge,
        spinner: spinner,
        emptyState: emptyState,
        showModal: showModal,
        closeModals: closeModals
    };
})();
