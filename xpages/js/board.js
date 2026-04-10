/**
 * RetroVault - Board View Page Logic
 *
 * Displays a single retro board with 3 feedback columns,
 * voting, and action items.
 */
(function () {
    'use strict';

    var boardId = App.getParam('boardId');
    var currentUserId = App.getCurrentUserId();

    // State
    var board = null;
    var feedbackItems = [];
    var actionItems = [];
    var userVotes = {}; // feedbackItemId -> voteRecordId
    var themeLabels = {};

    function init() {
        if (!boardId) {
            document.getElementById('feedbackColumns').innerHTML =
                '<p style="color:red;padding:24px;">No boardId in URL. Go back to the dashboard.</p>';
            return;
        }

        document.getElementById('feedbackColumns').innerHTML = Components.spinner();

        Q.all([
            VaultDS.query('retro_board__c', [
                'id', 'name__v', 'facilitator__c', 'team__c',
                'release_tag__c', 'board_date__c', 'status__c'
            ], { where: "id = '" + boardId + "'", limit: 1 }),
            VaultDS.query('feedback_item__c', [
                'id', 'name__v', 'retro_board__c', 'author__c',
                'category__c', 'content__c', 'ai_theme__c', 'vote_count__c'
            ], { where: "retro_board__c = '" + boardId + "'" }),
            VaultDS.query('action_item__c', [
                'id', 'name__v', 'retro_board__c', 'owner__c',
                'status__c', 'due_date__c', 'completed_at__c'
            ], { where: "retro_board__c = '" + boardId + "'" }),
            currentUserId
                ? VaultDS.query('vote__c', ['id', 'feedback_item__c', 'voter__c', 'active__c'],
                    { where: "voter__c = '" + currentUserId + "'" })
                : Q.resolve([]),
            App.loadUsers(),
            VaultDS.getPicklistValues('feedback_item__c', 'ai_theme__c')
        ]).then(function (results) {
            var boards = results[0];
            board = boards[0];
            feedbackItems = results[1];
            actionItems = results[2];
            var votes = results[3];
            var userMap = results[4];
            var themes = results[5];

            // Build theme label map
            themes.forEach(function (t) { themeLabels[t.name] = t.label; });

            // Build user vote map: only active votes for THIS board's feedback items
            var boardFeedbackIds = {};
            feedbackItems.forEach(function (fi) { boardFeedbackIds[fi.id] = true; });
            votes.forEach(function (v) {
                if (v.active__c !== false && v.active__c !== 'false' && boardFeedbackIds[v.feedback_item__c]) {
                    userVotes[v.feedback_item__c] = v.id;
                }
            });

            var users = [];
            for (var id in userMap) {
                if (userMap.hasOwnProperty(id)) users.push({ id: id, name__v: userMap[id] });
            }
            Components.renderNavBar('board', users);

            if (!board) {
                document.getElementById('feedbackColumns').innerHTML =
                    Components.emptyState('Board not found.');
                return;
            }

            renderHeader();
            renderColumns();
            renderActionItems();
        }, function (err) {
            document.getElementById('feedbackColumns').innerHTML =
                '<p style="color:red;padding:24px;">Error loading board. Check console.</p>';
            console.error('Board load error:', err);
        });
    }

    /* ---------- Header ---------- */

    function renderHeader() {
        var el = document.getElementById('boardHeader');
        el.innerHTML =
            '<div class="vault-page-header">' +
                '<div>' +
                    '<div class="vault-flex-center vault-gap-8">' +
                        '<h1 class="vault-page-header__title">' + App.escapeHtml(board.name__v) + '</h1>' +
                        Components.statusBadge(board.status__c) +
                    '</div>' +
                    '<p class="vault-page-header__subtitle">' +
                        App.formatDate(board.board_date__c) +
                        (board.release_tag__c ? ' &middot; ' + App.escapeHtml(board.release_tag__c) : '') +
                        ' &middot; Facilitator: ' + App.escapeHtml(App.getUserName(board.facilitator__c)) +
                    '</p>' +
                '</div>' +
                '<a class="vault-btn vault-btn--secondary" href="' + App.buildUrl('index.html') + '">&larr; Back</a>' +
            '</div>';
    }

    /* ---------- Feedback Columns ---------- */

    function renderColumns() {
        var categories = [
            { key: 'went_well__c', label: 'Went Well', color: 'green' },
            { key: 'didnt_go_well__c', label: "Didn't Go Well", color: 'red' },
            { key: 'ideas__c', label: 'Ideas', color: 'blue' }
        ];

        var html = '<div class="vault-columns">';
        categories.forEach(function (cat) {
            var items = feedbackItems.filter(function (fi) { return fi.category__c === cat.key; });
            // Sort by vote count desc
            items.sort(function (a, b) { return (b.vote_count__c || 0) - (a.vote_count__c || 0); });

            html += '<div class="vault-column">' +
                '<div class="vault-column__header vault-column__header--' + cat.color + '">' +
                    '<span>' + cat.label + '</span>' +
                    '<span class="vault-column__count">' + items.length + '</span>' +
                '</div>' +
                '<div class="vault-column__body">';

            if (currentUserId) {
                html += '<button class="vault-btn vault-btn--small vault-btn--secondary" style="width:100%;margin-bottom:4px;" ' +
                    'onclick="BoardPage.addFeedback(\'' + cat.key + '\')">+ Add</button>';
            }

            items.forEach(function (item) {
                html += renderFeedbackCard(item);
            });

            if (!items.length) {
                html += '<div class="vault-empty vault-text-small" style="padding:16px;">No items yet</div>';
            }

            html += '</div></div>';
        });
        html += '</div>';

        document.getElementById('feedbackColumns').innerHTML = html;
    }

    function renderFeedbackCard(item) {
        var isVoted = !!userVotes[item.id];
        var voteCount = item.vote_count__c || 0;
        var voteBtnClass = 'vault-vote-btn' + (isVoted ? ' vault-vote-btn--voted' : '');

        return '<div class="vault-feedback-card">' +
            '<div class="vault-feedback-card__content">' + App.escapeHtml(item.content__c) + '</div>' +
            '<div class="vault-feedback-card__footer">' +
                '<span class="vault-feedback-card__author">' + App.escapeHtml(App.getUserName(item.author__c)) + '</span>' +
                '<div class="vault-feedback-card__actions">' +
                    (item.ai_theme__c ? Components.themeBadge(item.ai_theme__c) : '') +
                    (currentUserId
                        ? '<button class="' + voteBtnClass + '" onclick="BoardPage.toggleVote(\'' + item.id + '\')">' +
                            '&#x25B2; ' + voteCount + '</button>'
                        : '<span class="vault-text-small vault-text-muted">&#x25B2; ' + voteCount + '</span>') +
                '</div>' +
            '</div>' +
        '</div>';
    }

    /* ---------- Voting ---------- */

    function toggleVote(feedbackItemId) {
        if (!currentUserId) return;

        var existingVoteId = userVotes[feedbackItemId];
        var item = feedbackItems.find(function (fi) { return fi.id === feedbackItemId; });
        if (!item) return;

        var currentCount = item.vote_count__c || 0;

        if (existingVoteId) {
            // Unvote: soft-delete and decrement
            Q.all([
                VaultDS.update('vote__c', existingVoteId, { 'active__c': false }),
                VaultDS.update('feedback_item__c', feedbackItemId, { 'vote_count__c': Math.max(0, currentCount - 1) })
            ]).then(function () {
                delete userVotes[feedbackItemId];
                item.vote_count__c = Math.max(0, currentCount - 1);
                renderColumns();
            }, function (err) {
                App.showToast('Failed to remove vote.', 'error');
                console.error(err);
            });
        } else {
            // Vote: create and increment
            var voteName = feedbackItemId + '_' + currentUserId;
            Q.all([
                VaultDS.create('vote__c', {
                    'name__v': voteName,
                    'feedback_item__c': feedbackItemId,
                    'voter__c': currentUserId,
                    'active__c': true
                }),
                VaultDS.update('feedback_item__c', feedbackItemId, { 'vote_count__c': currentCount + 1 })
            ]).then(function (results) {
                var voteResp = results[0];
                var voteId = (typeof voteResp === 'object' && voteResp.id) ? voteResp.id : voteResp;
                userVotes[feedbackItemId] = voteId;
                item.vote_count__c = currentCount + 1;
                renderColumns();
            }, function (err) {
                App.showToast('Failed to vote.', 'error');
                console.error(err);
            });
        }
    }

    /* ---------- Add Feedback ---------- */

    function addFeedback(category) {
        if (!currentUserId) {
            App.showToast('Select a user first.', 'error');
            return;
        }

        // Build theme options
        var themeOptionsHtml = '<option value="">None</option>';
        for (var k in themeLabels) {
            if (themeLabels.hasOwnProperty(k)) {
                themeOptionsHtml += '<option value="' + k + '">' + App.escapeHtml(themeLabels[k]) + '</option>';
            }
        }

        var bodyHtml =
            '<div class="vault-form">' +
                '<div class="vault-form-group">' +
                    '<label class="vault-label" for="fbContent">Feedback *</label>' +
                    '<textarea class="vault-textarea" id="fbContent" placeholder="Share your feedback..." rows="3"></textarea>' +
                '</div>' +
                '<div class="vault-form-group">' +
                    '<label class="vault-label" for="fbTheme">Theme</label>' +
                    '<select class="vault-select" id="fbTheme">' + themeOptionsHtml + '</select>' +
                '</div>' +
            '</div>';

        Components.showModal('Add Feedback', bodyHtml, function (overlay) {
            var content = overlay.querySelector('#fbContent').value.trim();
            var theme = overlay.querySelector('#fbTheme').value;

            if (!content) {
                App.showToast('Please enter feedback content.', 'error');
                return;
            }

            var fields = {
                'name__v': content.substring(0, 80),
                'retro_board__c': boardId,
                'author__c': currentUserId,
                'category__c': category,
                'content__c': content,
                'vote_count__c': 0
            };
            if (theme) fields['ai_theme__c'] = theme;

            VaultDS.create('feedback_item__c', fields).then(function (resp) {
                var newId = (typeof resp === 'object' && resp.id) ? resp.id : resp;
                fields.id = newId;
                feedbackItems.push(fields);
                Components.closeModals();
                renderColumns();
                App.showToast('Feedback added!', 'success');
            }, function (err) {
                App.showToast('Failed to add feedback.', 'error');
                console.error(err);
            });
        }, 'Add Feedback');
    }

    /* ---------- Action Items ---------- */

    function renderActionItems() {
        var el = document.getElementById('actionItems');

        var rows = actionItems.map(function (ai) {
            return '<tr>' +
                '<td>' + App.escapeHtml(ai.name__v) + '</td>' +
                '<td>' + App.escapeHtml(App.getUserName(ai.owner__c)) + '</td>' +
                '<td>' +
                    '<select class="vault-status-select" data-id="' + ai.id + '" onchange="BoardPage.updateActionStatus(this)">' +
                        '<option value="open__c"' + (ai.status__c === 'open__c' ? ' selected' : '') + '>Open</option>' +
                        '<option value="in_progress__c"' + (ai.status__c === 'in_progress__c' ? ' selected' : '') + '>In Progress</option>' +
                        '<option value="done__c"' + (ai.status__c === 'done__c' ? ' selected' : '') + '>Done</option>' +
                    '</select>' +
                '</td>' +
                '<td>' + App.formatDate(ai.due_date__c) + '</td>' +
                '<td>' + (ai.completed_at__c ? App.formatDateTime(ai.completed_at__c) : '') + '</td>' +
            '</tr>';
        }).join('');

        el.innerHTML =
            '<div class="vault-card vault-mt-24">' +
                '<div class="vault-card__header">' +
                    '<span class="vault-card__title">Action Items (' + actionItems.length + ')</span>' +
                    (currentUserId
                        ? '<button class="vault-btn vault-btn--small vault-btn--primary" onclick="BoardPage.addActionItem()">+ Add</button>'
                        : '') +
                '</div>' +
                (actionItems.length
                    ? '<table class="vault-table">' +
                        '<thead><tr><th>Title</th><th>Owner</th><th>Status</th><th>Due Date</th><th>Completed</th></tr></thead>' +
                        '<tbody>' + rows + '</tbody>' +
                      '</table>'
                    : '<div class="vault-card__body">' + Components.emptyState('No action items yet.') + '</div>') +
            '</div>';
    }

    function updateActionStatus(selectEl) {
        var id = selectEl.getAttribute('data-id');
        var newStatus = selectEl.value;
        var fields = { 'status__c': newStatus };

        if (newStatus === 'done__c') {
            fields['completed_at__c'] = new Date().toISOString();
        }

        VaultDS.update('action_item__c', id, fields).then(function () {
            var ai = actionItems.find(function (a) { return a.id === id; });
            if (ai) {
                ai.status__c = newStatus;
                if (newStatus === 'done__c') ai.completed_at__c = new Date().toISOString();
            }
            renderActionItems();
        }, function (err) {
            App.showToast('Failed to update status.', 'error');
            console.error(err);
        });
    }

    function addActionItem() {
        if (!currentUserId) {
            App.showToast('Select a user first.', 'error');
            return;
        }

        var bodyHtml =
            '<div class="vault-form">' +
                '<div class="vault-form-group">' +
                    '<label class="vault-label" for="aiTitle">Title *</label>' +
                    '<input class="vault-input" type="text" id="aiTitle" placeholder="Action item title...">' +
                '</div>' +
                '<div class="vault-form-group">' +
                    '<label class="vault-label" for="aiDueDate">Due Date</label>' +
                    '<input class="vault-input" type="date" id="aiDueDate">' +
                '</div>' +
            '</div>';

        Components.showModal('Add Action Item', bodyHtml, function (overlay) {
            var title = overlay.querySelector('#aiTitle').value.trim();
            var dueDate = overlay.querySelector('#aiDueDate').value;

            if (!title) {
                App.showToast('Please enter a title.', 'error');
                return;
            }

            var fields = {
                'name__v': title,
                'retro_board__c': boardId,
                'owner__c': currentUserId,
                'status__c': 'open__c'
            };
            if (dueDate) fields['due_date__c'] = dueDate;

            VaultDS.create('action_item__c', fields).then(function (resp) {
                var newId = (typeof resp === 'object' && resp.id) ? resp.id : resp;
                fields.id = newId;
                actionItems.push(fields);
                Components.closeModals();
                renderActionItems();
                App.showToast('Action item added!', 'success');
            }, function (err) {
                App.showToast('Failed to add action item.', 'error');
                console.error(err);
            });
        }, 'Add Item');
    }

    /* ---------- Public API (for onclick handlers) ---------- */
    window.BoardPage = {
        toggleVote: toggleVote,
        addFeedback: addFeedback,
        addActionItem: addActionItem,
        updateActionStatus: updateActionStatus
    };

    document.addEventListener('DOMContentLoaded', init);
})();
