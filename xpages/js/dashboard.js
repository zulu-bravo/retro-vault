/**
 * RetroVault - Dashboard Page Logic
 *
 * Displays retro boards grouped by team.
 */
(function () {
    'use strict';

    var contentEl = document.getElementById('content');

    function init() {
        contentEl.innerHTML = Components.spinner();

        // Fetch teams, boards, and users in parallel
        Q.all([
            VaultDS.query('team__c', ['id', 'name__v']),
            VaultDS.query('retro_board__c', [
                'id', 'name__v', 'facilitator__c', 'team__c',
                'release_tag__c', 'board_date__c', 'status__c'
            ], { sort: ['board_date__c DESC'] }),
            App.loadUsers()
        ]).then(function (results) {
            var teams = results[0];
            var boards = results[1];

            Components.renderNavBar('dashboard', usersToArray(results[2]));
            setupNewBoardBtn();
            render(teams, boards);
        }, function (err) {
            contentEl.innerHTML = '<p style="color:red;">Error loading data. Check console.</p>';
            console.error('Dashboard load error:', err);
        });
    }

    function usersToArray(userMap) {
        var arr = [];
        for (var id in userMap) {
            if (userMap.hasOwnProperty(id)) {
                arr.push({ id: id, name__v: userMap[id] });
            }
        }
        return arr;
    }

    function setupNewBoardBtn() {
        var btn = document.getElementById('newBoardBtn');
        if (btn) btn.href = App.buildUrl('create-board.html');
    }

    function render(teams, boards) {
        if (!teams.length) {
            contentEl.innerHTML = Components.emptyState('No teams found. Run the seed data page first.');
            return;
        }

        // Group boards by team ID
        var boardsByTeam = {};
        boards.forEach(function (b) {
            var teamId = b.team__c || 'unassigned';
            if (!boardsByTeam[teamId]) boardsByTeam[teamId] = [];
            boardsByTeam[teamId].push(b);
        });

        // Build team name lookup
        var teamNames = {};
        teams.forEach(function (t) { teamNames[t.id] = t.name__v; });

        var html = '';
        teams.forEach(function (team) {
            var teamBoards = boardsByTeam[team.id] || [];
            html += renderTeamSection(team, teamBoards);
        });

        // Boards without a matching team
        if (boardsByTeam['unassigned']) {
            html += renderTeamSection({ id: 'unassigned', name__v: 'Unassigned' }, boardsByTeam['unassigned']);
        }

        contentEl.innerHTML = html;
    }

    function renderTeamSection(team, boards) {
        var html = '<div class="vault-section">';
        html += '<h2 class="vault-section__title">' + App.escapeHtml(team.name__v) +
                ' <span class="vault-text-muted vault-text-small">(' + boards.length + ' board' +
                (boards.length !== 1 ? 's' : '') + ')</span></h2>';

        if (!boards.length) {
            html += Components.emptyState('No boards for this team yet.');
        } else {
            html += '<div class="vault-grid vault-grid--3">';
            boards.forEach(function (board) {
                html += renderBoardCard(board);
            });
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderBoardCard(board) {
        var url = App.buildUrl('board.html', { boardId: board.id });
        var facilitatorName = App.getUserName(board.facilitator__c);

        return '<a href="' + url + '" class="vault-card vault-card--clickable" style="text-decoration:none;color:inherit;">' +
            '<div class="vault-board-card">' +
                '<div class="vault-flex-between">' +
                    '<span class="vault-board-card__name">' + App.escapeHtml(board.name__v) + '</span>' +
                    Components.statusBadge(board.status__c) +
                '</div>' +
                '<div class="vault-board-card__meta">' +
                    (board.release_tag__c ?
                        '<span class="vault-board-card__meta-item">' + App.escapeHtml(board.release_tag__c) + '</span>' : '') +
                    '<span class="vault-board-card__meta-item">' + App.formatDate(board.board_date__c) + '</span>' +
                '</div>' +
                '<div class="vault-board-card__meta">' +
                    '<span class="vault-board-card__meta-item">Facilitator: ' + App.escapeHtml(facilitatorName) + '</span>' +
                '</div>' +
            '</div>' +
        '</a>';
    }

    document.addEventListener('DOMContentLoaded', init);
})();
