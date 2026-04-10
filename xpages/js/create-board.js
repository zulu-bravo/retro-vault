/**
 * RetroVault - Create Board Page Logic
 */
(function () {
    'use strict';

    var formEl = document.getElementById('formContent');

    function init() {
        formEl.innerHTML = Components.spinner();

        Q.all([
            VaultDS.query('team__c', ['id', 'name__v']),
            App.loadUsers()
        ]).then(function (results) {
            var teams = results[0];
            var userMap = results[1];
            var users = [];
            for (var id in userMap) {
                if (userMap.hasOwnProperty(id)) users.push({ id: id, name__v: userMap[id] });
            }

            Components.renderNavBar('create-board', users);
            renderForm(teams, users);
        }, function (err) {
            formEl.innerHTML = '<p style="color:red;">Error loading data.</p>';
            console.error(err);
        });
    }

    function renderForm(teams, users) {
        var teamOptions = teams.map(function (t) {
            return '<option value="' + t.id + '">' + App.escapeHtml(t.name__v) + '</option>';
        }).join('');

        var userOptions = users.map(function (u) {
            return '<option value="' + u.id + '">' + App.escapeHtml(u.name__v) + '</option>';
        }).join('');

        var today = new Date().toISOString().split('T')[0];

        formEl.innerHTML =
            '<form class="vault-form" id="boardForm">' +
                '<div class="vault-form-group">' +
                    '<label class="vault-label" for="boardName">Board Name *</label>' +
                    '<input class="vault-input" type="text" id="boardName" placeholder="e.g., Sprint 12 Retro" required>' +
                '</div>' +
                '<div class="vault-form-group">' +
                    '<label class="vault-label" for="teamSelect">Team *</label>' +
                    '<select class="vault-select" id="teamSelect" required>' +
                        '<option value="">Select a team</option>' + teamOptions +
                    '</select>' +
                '</div>' +
                '<div class="vault-form-group">' +
                    '<label class="vault-label" for="facilitatorSelect">Facilitator *</label>' +
                    '<select class="vault-select" id="facilitatorSelect" required>' +
                        '<option value="">Select a facilitator</option>' + userOptions +
                    '</select>' +
                '</div>' +
                '<div class="vault-form-group">' +
                    '<label class="vault-label" for="releaseTag">Release Tag</label>' +
                    '<input class="vault-input" type="text" id="releaseTag" placeholder="e.g., v2.4.1">' +
                '</div>' +
                '<div class="vault-form-group">' +
                    '<label class="vault-label" for="boardDate">Board Date *</label>' +
                    '<input class="vault-input" type="date" id="boardDate" value="' + today + '" required>' +
                '</div>' +
                '<div class="vault-flex-between vault-mt-16">' +
                    '<a class="vault-btn vault-btn--secondary" href="' + App.buildUrl('index.html') + '">Cancel</a>' +
                    '<button type="submit" class="vault-btn vault-btn--primary">Create Board</button>' +
                '</div>' +
            '</form>';

        document.getElementById('boardForm').addEventListener('submit', handleSubmit);
    }

    function handleSubmit(e) {
        e.preventDefault();

        var name = document.getElementById('boardName').value.trim();
        var team = document.getElementById('teamSelect').value;
        var facilitator = document.getElementById('facilitatorSelect').value;
        var releaseTag = document.getElementById('releaseTag').value.trim();
        var boardDate = document.getElementById('boardDate').value;

        if (!name || !team || !facilitator || !boardDate) {
            App.showToast('Please fill in all required fields.', 'error');
            return;
        }

        var fields = {
            'name__v': name,
            'team__c': team,
            'facilitator__c': facilitator,
            'board_date__c': boardDate,
            'status__c': 'active__c'
        };
        if (releaseTag) fields['release_tag__c'] = releaseTag;

        var btn = e.target.querySelector('[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Creating...';

        VaultDS.create('retro_board__c', fields).then(function (resp) {
            App.showToast('Board created!', 'success');
            var newId = (typeof resp === 'object' && resp.id) ? resp.id : resp;
            App.navigate('board.html', { boardId: newId });
        }, function (err) {
            App.showToast('Failed to create board.', 'error');
            console.error(err);
            btn.disabled = false;
            btn.textContent = 'Create Board';
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
