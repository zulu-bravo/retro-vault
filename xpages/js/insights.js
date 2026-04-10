/**
 * RetroVault - Insights Page Logic
 *
 * Three analytics panels computed client-side:
 * 1. Recurring Blockers - themes from "Didn't Go Well" across 2+ boards
 * 2. Action Completion Rates - per-team breakdown
 * 3. Team Sentiment - positive-to-negative ratios by team
 */
(function () {
    'use strict';

    var contentEl = document.getElementById('content');

    function init() {
        contentEl.innerHTML = Components.spinner();

        Q.all([
            VaultDS.query('feedback_item__c', [
                'id', 'retro_board__c', 'category__c', 'ai_theme__c', 'vote_count__c'
            ]),
            VaultDS.query('action_item__c', [
                'id', 'retro_board__c', 'status__c'
            ]),
            VaultDS.query('retro_board__c', [
                'id', 'team__c'
            ]),
            VaultDS.query('team__c', [
                'id', 'name__v'
            ]),
            App.loadUsers()
        ]).then(function (results) {
            var feedback = results[0];
            var actions = results[1];
            var boards = results[2];
            var teams = results[3];
            var userMap = results[4];

            var users = [];
            for (var id in userMap) {
                if (userMap.hasOwnProperty(id)) users.push({ id: id, name__v: userMap[id] });
            }
            Components.renderNavBar('insights', users);

            // Build lookups
            var boardTeam = {};
            boards.forEach(function (b) { boardTeam[b.id] = b.team__c; });

            var teamNames = {};
            teams.forEach(function (t) { teamNames[t.id] = t.name__v; });

            var html = '';
            html += renderBlockers(feedback);
            html += renderCompletionRates(actions, boardTeam, teamNames);
            html += renderSentiment(feedback, boardTeam, teamNames);

            contentEl.innerHTML = html;
        }, function (err) {
            contentEl.innerHTML = '<p style="color:red;padding:24px;">Error loading insights data.</p>';
            console.error('Insights error:', err);
        });
    }

    /* ---------- 1. Recurring Blockers ---------- */

    function renderBlockers(feedback) {
        // Filter "didn't go well" items that have a theme
        var negatives = feedback.filter(function (fi) {
            return fi.category__c === 'didnt_go_well__c' && fi.ai_theme__c;
        });

        // Group by theme, tracking distinct boards and total votes
        var themeMap = {};
        negatives.forEach(function (fi) {
            var theme = fi.ai_theme__c;
            if (!themeMap[theme]) {
                themeMap[theme] = { theme: theme, boards: {}, votes: 0, count: 0 };
            }
            themeMap[theme].boards[fi.retro_board__c] = true;
            themeMap[theme].votes += (fi.vote_count__c || 0);
            themeMap[theme].count++;
        });

        // Filter themes appearing on 2+ boards, sort by board count then votes
        var blockers = [];
        for (var key in themeMap) {
            if (themeMap.hasOwnProperty(key)) {
                var entry = themeMap[key];
                entry.boardCount = Object.keys(entry.boards).length;
                if (entry.boardCount >= 2) blockers.push(entry);
            }
        }
        blockers.sort(function (a, b) {
            return b.boardCount - a.boardCount || b.votes - a.votes;
        });

        var rows = blockers.map(function (b) {
            var themeLabel = b.theme.replace(/__c$/, '').replace(/_/g, ' ');
            themeLabel = themeLabel.charAt(0).toUpperCase() + themeLabel.slice(1);
            return '<tr>' +
                '<td>' + Components.themeBadge(b.theme) + '</td>' +
                '<td>' + b.count + '</td>' +
                '<td>' + b.boardCount + '</td>' +
                '<td>' + b.votes + '</td>' +
            '</tr>';
        }).join('');

        return '<div class="vault-card vault-mb-24">' +
            '<div class="vault-card__header"><span class="vault-card__title">Recurring Blockers</span></div>' +
            (blockers.length
                ? '<table class="vault-table">' +
                    '<thead><tr><th>Theme</th><th>Mentions</th><th>Boards</th><th>Total Votes</th></tr></thead>' +
                    '<tbody>' + rows + '</tbody>' +
                  '</table>'
                : '<div class="vault-card__body">' + Components.emptyState('No recurring blockers found (themes must appear on 2+ boards).') + '</div>') +
        '</div>';
    }

    /* ---------- 2. Action Completion Rates ---------- */

    function renderCompletionRates(actions, boardTeam, teamNames) {
        // Group actions by team
        var teamStats = {};
        actions.forEach(function (ai) {
            var teamId = boardTeam[ai.retro_board__c] || 'unknown';
            if (!teamStats[teamId]) {
                teamStats[teamId] = { total: 0, done: 0, in_progress: 0, open: 0 };
            }
            teamStats[teamId].total++;
            if (ai.status__c === 'done__c') teamStats[teamId].done++;
            else if (ai.status__c === 'in_progress__c') teamStats[teamId].in_progress++;
            else teamStats[teamId].open++;
        });

        // Sort by completion rate desc
        var entries = [];
        for (var tid in teamStats) {
            if (teamStats.hasOwnProperty(tid)) {
                var s = teamStats[tid];
                s.teamName = teamNames[tid] || 'Unknown';
                s.rate = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
                entries.push(s);
            }
        }
        entries.sort(function (a, b) { return b.rate - a.rate; });

        var barsHtml = entries.map(function (e) {
            return '<div class="vault-bar-row">' +
                '<span class="vault-bar-label">' + App.escapeHtml(e.teamName) + '</span>' +
                '<div class="vault-bar-track">' +
                    '<div class="vault-bar-fill vault-bar-fill--green" style="width:' + e.rate + '%;">' +
                        (e.rate > 15 ? e.rate + '%' : '') +
                    '</div>' +
                '</div>' +
                '<span class="vault-bar-value">' + e.rate + '%</span>' +
            '</div>';
        }).join('');

        var rows = entries.map(function (e) {
            return '<tr>' +
                '<td class="vault-text-bold">' + App.escapeHtml(e.teamName) + '</td>' +
                '<td>' + e.total + '</td>' +
                '<td>' + e.done + '</td>' +
                '<td>' + e.in_progress + '</td>' +
                '<td>' + e.open + '</td>' +
                '<td class="vault-text-bold">' + e.rate + '%</td>' +
            '</tr>';
        }).join('');

        return '<div class="vault-card vault-mb-24">' +
            '<div class="vault-card__header"><span class="vault-card__title">Action Item Completion Rates</span></div>' +
            (entries.length
                ? '<div class="vault-card__body">' +
                    '<div class="vault-bar-chart vault-mb-24">' + barsHtml + '</div>' +
                    '<table class="vault-table">' +
                        '<thead><tr><th>Team</th><th>Total</th><th>Done</th><th>In Progress</th><th>Open</th><th>Rate</th></tr></thead>' +
                        '<tbody>' + rows + '</tbody>' +
                    '</table>' +
                  '</div>'
                : '<div class="vault-card__body">' + Components.emptyState('No action items found.') + '</div>') +
        '</div>';
    }

    /* ---------- 3. Team Sentiment ---------- */

    function renderSentiment(feedback, boardTeam, teamNames) {
        // Group feedback by team and category
        var teamData = {};
        feedback.forEach(function (fi) {
            var teamId = boardTeam[fi.retro_board__c] || 'unknown';
            if (!teamData[teamId]) {
                teamData[teamId] = { went_well: 0, didnt_go_well: 0, ideas: 0, boards: {} };
            }
            if (fi.category__c === 'went_well__c') teamData[teamId].went_well++;
            else if (fi.category__c === 'didnt_go_well__c') teamData[teamId].didnt_go_well++;
            else if (fi.category__c === 'ideas__c') teamData[teamId].ideas++;
            teamData[teamId].boards[fi.retro_board__c] = true;
        });

        var entries = [];
        for (var tid in teamData) {
            if (teamData.hasOwnProperty(tid)) {
                var d = teamData[tid];
                var total = d.went_well + d.didnt_go_well;
                d.teamName = teamNames[tid] || 'Unknown';
                d.ratio = total > 0 ? Math.round((d.went_well / total) * 100) : 0;
                d.boardCount = Object.keys(d.boards).length;
                entries.push(d);
            }
        }
        entries.sort(function (a, b) { return b.ratio - a.ratio; });

        var rows = entries.map(function (e) {
            var barW = e.went_well + e.didnt_go_well;
            var greenPct = barW > 0 ? Math.round((e.went_well / barW) * 100) : 0;
            var redPct = 100 - greenPct;

            return '<tr>' +
                '<td class="vault-text-bold">' + App.escapeHtml(e.teamName) + '</td>' +
                '<td>' + e.went_well + '</td>' +
                '<td>' + e.didnt_go_well + '</td>' +
                '<td>' + e.ideas + '</td>' +
                '<td>' +
                    '<div class="vault-bar-track" style="height:16px;width:120px;display:inline-flex;">' +
                        '<div class="vault-bar-fill vault-bar-fill--green" style="width:' + greenPct + '%;min-width:0;padding:0;"></div>' +
                        '<div class="vault-bar-fill vault-bar-fill--red" style="width:' + redPct + '%;min-width:0;padding:0;border-radius:0 12px 12px 0;"></div>' +
                    '</div>' +
                '</td>' +
                '<td class="vault-text-bold">' + e.ratio + '%</td>' +
                '<td>' + e.boardCount + '</td>' +
            '</tr>';
        }).join('');

        return '<div class="vault-card vault-mb-24">' +
            '<div class="vault-card__header"><span class="vault-card__title">Team Sentiment</span></div>' +
            (entries.length
                ? '<table class="vault-table">' +
                    '<thead><tr><th>Team</th><th>Went Well</th><th>Didn\'t Go Well</th><th>Ideas</th><th>Ratio</th><th>Positive %</th><th>Boards</th></tr></thead>' +
                    '<tbody>' + rows + '</tbody>' +
                  '</table>'
                : '<div class="vault-card__body">' + Components.emptyState('No feedback data found.') + '</div>') +
        '</div>';
    }

    document.addEventListener('DOMContentLoaded', init);
})();
