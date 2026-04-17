import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
    fetchBoard,
    fetchFeedbackForBoard,
    fetchActionsForBoard,
    fetchVotesForUser,
    userName,
    create,
    update,
    deleteRecord,
    getCurrentUserId
} from '../api/vault';
import Spinner, { EmptyState } from '../components/Spinner';
import { StatusBadge, ThemeBadge } from '../components/Badge';
import Modal from '../components/Modal';
import UserTypeAhead from '../components/UserTypeAhead';
import { formatDate, formatDateMonthDay, toISODate } from '../utils/format';

const CATEGORIES = [
    { key: 'kudos__c', label: 'Kudos', color: 'gold' },
    { key: 'went_well__c', label: 'Went Well', color: 'green' },
    { key: 'didnt_go_well__c', label: 'To Improve', color: 'red' }
];

const KUDOS_CATEGORY = 'kudos__c';

const THEMES = [
    { name: 'tooling__c', label: 'Tooling' },
    { name: 'process__c', label: 'Process' },
    { name: 'communication__c', label: 'Communication' },
    { name: 'scope__c', label: 'Scope' },
    { name: 'staffing__c', label: 'Staffing' },
    { name: 'quality__c', label: 'Quality' },
    { name: 'morale__c', label: 'Morale' },
    { name: 'other__c', label: 'Other' }
];

function generateGroupId() {
    return 'g_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// `group__c` doubles as the group ID and the display name. Newly created
// groups get a generated `g_…` token so they don't collide; once the user
// renames a group, that human-readable name becomes the ID.
function isGeneratedGroupId(s) {
    return typeof s === 'string' && /^g_[a-z0-9]+$/.test(s);
}

function groupDisplayName(groupId) {
    return isGeneratedGroupId(groupId) ? 'Group' : groupId;
}

// Build the display order for a category: array of { type: 'card', item } | { type: 'group', groupId, items }.
// Preserves the order of `items`; a group appears at the position of its first member.
function buildColumnDisplay(items) {
    const result = [];
    const seen = new Set();
    for (const item of items) {
        const gid = item.group__c;
        if (gid) {
            if (seen.has(gid)) continue;
            seen.add(gid);
            const groupItems = items.filter(x => x.group__c === gid);
            result.push({ type: 'group', groupId: gid, items: groupItems });
        } else {
            result.push({ type: 'card', item });
        }
    }
    return result;
}

export default function BoardView({ boardId, highlightActionId, navigate, showToast }) {
    const currentUserId = getCurrentUserId();

    const [loading, setLoading] = useState(true);
    const [board, setBoard] = useState(null);
    const [feedback, setFeedback] = useState([]);
    const [actions, setActions] = useState([]);
    const [userVotes, setUserVotes] = useState({}); // feedbackItemId -> voteRecordId

    const [fbModal, setFbModal] = useState(null); // { category } or { id, category }
    const [fbContent, setFbContent] = useState('');
    const [fbTheme, setFbTheme] = useState('');
    const [fbFeature, setFbFeature] = useState('');
    const [fbRecipientId, setFbRecipientId] = useState('');
    const [fbRecipientName, setFbRecipientName] = useState('');

    // aiModal: null = closed, { id: null } = add, { id: <actionId> } = edit
    const [aiModal, setAiModal] = useState(null);
    const [aiTitle, setAiTitle] = useState('');
    const [aiDue, setAiDue] = useState('');
    const [aiAssigneeId, setAiAssigneeId] = useState('');
    const [aiAssigneeName, setAiAssigneeName] = useState('');
    const [aiStatus, setAiStatus] = useState('open__c');
    const [aiOwnerName, setAiOwnerName] = useState('');

    // Multi-select for grouping (Cmd/Ctrl+click)
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    // Context menu: { x, y, kind: 'cards'|'group', ids?, groupId? }
    const [contextMenu, setContextMenu] = useState(null);

    // Drag state
    // dragRef shape:
    //   { type: 'feedback', id, category, fromGroupId }
    //   { type: 'action',   id }
    //   { type: 'group',    groupId, category }
    const dragRef = useRef(null);
    const [dragging, setDragging] = useState(null);
    // dropTarget shape:
    //   { column, overId, before, isGroup: false }           (card target — before/after)
    //   { column, overId, before, isGroup: true,  intoGroup: false } (group target — position)
    //   { column, overId,          isGroup: true,  intoGroup: true }  (group target — join)
    const [dropTarget, setDropTarget] = useState(null);
    const [justDroppedId, setJustDroppedId] = useState(null);

    const loadData = useCallback(async () => {
        try {
            const [b, f, a, v] = await Promise.all([
                fetchBoard(boardId),
                fetchFeedbackForBoard(boardId),
                fetchActionsForBoard(boardId),
                currentUserId ? fetchVotesForUser(currentUserId) : Promise.resolve([])
            ]);
            setBoard(b);
            setFeedback(f.sort((x, y) => {
                const xO = x.order__c != null ? Number(x.order__c) : Infinity;
                const yO = y.order__c != null ? Number(y.order__c) : Infinity;
                if (xO !== yO) return xO - yO;
                return parseInt(y.vote_count__c || 0, 10) - parseInt(x.vote_count__c || 0, 10);
            }));
            setActions(a.sort((x, y) => {
                const xO = x.order__c != null ? Number(x.order__c) : Infinity;
                const yO = y.order__c != null ? Number(y.order__c) : Infinity;
                return xO - yO;
            }));

            const boardFeedbackIds = new Set(f.map(fi => fi.id));
            const votes = {};
            v.forEach(vote => {
                if (boardFeedbackIds.has(vote.feedback_item__c)) {
                    votes[vote.feedback_item__c] = vote.id;
                }
            });
            setUserVotes(votes);
        } catch (err) {
            showToast('Failed to load board: ' + err.message, 'error');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [boardId, currentUserId]);

    useEffect(() => {
        if (!boardId) return;
        setLoading(true);
        loadData();
    }, [loadData]);

    /* ---------- Voting ---------- */

    async function toggleVote(feedbackItemId) {
        if (!currentUserId) {
            showToast('No current user.', 'error');
            return;
        }
        const existingVoteId = userVotes[feedbackItemId];
        const item = feedback.find(fi => fi.id === feedbackItemId);
        if (!item) return;

        const currentCount = parseInt(item.vote_count__c || 0, 10);

        try {
            if (existingVoteId) {
                await deleteRecord('retro_vote__c', existingVoteId);
                await update('retro_feedback__c', feedbackItemId, {
                    vote_count__c: Math.max(0, currentCount - 1)
                });
                setUserVotes(prev => {
                    const next = { ...prev };
                    delete next[feedbackItemId];
                    return next;
                });
                setFeedback(prev => prev.map(fi =>
                    fi.id === feedbackItemId ? { ...fi, vote_count__c: Math.max(0, currentCount - 1) } : fi
                ));
            } else {
                const voteId = await create('retro_vote__c', {
                    name__v: `${feedbackItemId}_${currentUserId}`.slice(0, 80),
                    feedback_item__c: feedbackItemId,
                    voter__c: currentUserId
                });
                await update('retro_feedback__c', feedbackItemId, {
                    vote_count__c: currentCount + 1
                });
                setUserVotes(prev => ({ ...prev, [feedbackItemId]: voteId }));
                setFeedback(prev => prev.map(fi =>
                    fi.id === feedbackItemId ? { ...fi, vote_count__c: currentCount + 1 } : fi
                ));
            }
        } catch (err) {
            showToast('Vote failed: ' + err.message, 'error');
        }
    }

    /* ---------- Add / Edit Feedback ---------- */

    function openEditFeedback(item) {
        setFbModal({ id: item.id, category: item.category__c });
        setFbContent(item.content__c || '');
        setFbTheme(item.theme__c || '');
        setFbFeature(item.feature__c || '');
        setFbRecipientId(item.kudos_recipient__c || '');
        setFbRecipientName(userName(item, 'kudos_recipient') === 'Unknown' ? '' : userName(item, 'kudos_recipient'));
    }

    function resetFbModal() {
        setFbModal(null);
        setFbContent('');
        setFbTheme('');
        setFbFeature('');
        setFbRecipientId('');
        setFbRecipientName('');
    }

    async function submitFeedback() {
        const isKudos = fbModal.category === KUDOS_CATEGORY;
        if (!fbContent.trim()) {
            showToast(isKudos ? 'Please describe what they did.' : 'Please enter feedback content.', 'error');
            return;
        }
        if (isKudos && !fbRecipientId) {
            showToast('Please pick a recipient for the kudos.', 'error');
            return;
        }
        const isEdit = !!fbModal.id;
        try {
            if (isEdit) {
                const updates = {
                    name__v: fbContent.substring(0, 80),
                    content__c: fbContent,
                    theme__c: fbTheme || null,
                    feature__c: fbFeature || null
                };
                if (isKudos) {
                    updates.kudos_recipient__c = fbRecipientId || null;
                }
                await update('retro_feedback__c', fbModal.id, updates);
                setFeedback(prev => prev.map(fi =>
                    fi.id === fbModal.id
                        ? {
                            ...fi,
                            ...updates,
                            ...(isKudos ? { 'kudos_recipient__cr.name__v': fbRecipientName || null } : {})
                        }
                        : fi
                ));
                showToast(isKudos ? 'Kudos updated!' : 'Feedback updated!', 'success');
            } else {
                const fields = {
                    name__v: fbContent.substring(0, 80),
                    retro_board__c: boardId,
                    author__c: currentUserId,
                    category__c: fbModal.category,
                    content__c: fbContent,
                    vote_count__c: 0
                };
                if (fbTheme) fields.theme__c = fbTheme;
                if (fbFeature) fields.feature__c = fbFeature;
                if (isKudos && fbRecipientId) fields.kudos_recipient__c = fbRecipientId;
                const maxOrder = feedback.filter(f => f.category__c === fbModal.category)
                    .reduce((max, f) => Math.max(max, Number(f.order__c) || 0), 0);
                fields.order__c = String(maxOrder + 1);

                const newId = await create('retro_feedback__c', fields);
                const newRow = { id: newId, ...fields };
                if (isKudos) newRow['kudos_recipient__cr.name__v'] = fbRecipientName || null;
                setFeedback(prev => [...prev, newRow]);
                showToast(isKudos ? 'Kudos added! 🎉' : 'Feedback added!', 'success');
            }
            resetFbModal();
        } catch (err) {
            showToast(`Failed to ${isEdit ? 'update' : 'add'} ${isKudos ? 'kudos' : 'feedback'}: ${err.message}`, 'error');
        }
    }

    /* ---------- Add / Edit Action Item ---------- */

    function openAddAction() {
        setAiModal({ id: null });
        setAiTitle('');
        setAiDue('');
        setAiAssigneeId('');
        setAiAssigneeName('');
        setAiStatus('open__c');
        setAiOwnerName('');
    }

    function openEditAction(item) {
        setAiModal({ id: item.id });
        setAiTitle(item.name__v || '');
        setAiDue(item.due_date__c ? String(item.due_date__c).slice(0, 10) : '');
        setAiAssigneeId(item.assignee__c || '');
        setAiAssigneeName(item['assignee__cr.name__v'] || '');
        setAiStatus(item.status__c || 'open__c');
        setAiOwnerName(userName(item, 'owner'));
    }

    function resetAiModal() {
        setAiModal(null);
        setAiTitle('');
        setAiDue('');
        setAiAssigneeId('');
        setAiAssigneeName('');
        setAiStatus('open__c');
        setAiOwnerName('');
    }

    async function submitAction() {
        const trimmedTitle = aiTitle.trim();
        if (!trimmedTitle) {
            showToast('Please enter a title.', 'error');
            return;
        }
        const isEdit = !!(aiModal && aiModal.id);
        try {
            if (isEdit) {
                const existing = actions.find(a => a.id === aiModal.id);
                const updates = {
                    name__v: trimmedTitle,
                    due_date__c: aiDue || null,
                    assignee__c: aiAssigneeId || null,
                    status__c: aiStatus
                };
                // Stamp completion time when first moving to Done; leave it
                // alone if already Done (don't overwrite the original timestamp).
                if (aiStatus === 'done__c' && existing?.status__c !== 'done__c') {
                    updates.completed_at__c = new Date().toISOString();
                }
                await update('retro_action__c', aiModal.id, updates);
                setActions(prev => prev.map(a =>
                    a.id === aiModal.id
                        ? { ...a, ...updates, 'assignee__cr.name__v': aiAssigneeName || null }
                        : a
                ));
                showToast('Action item updated!', 'success');
            } else {
                const fields = {
                    name__v: trimmedTitle,
                    retro_board__c: boardId,
                    owner__c: currentUserId,
                    status__c: 'open__c'
                };
                if (aiDue) fields.due_date__c = aiDue;
                if (aiAssigneeId) fields.assignee__c = aiAssigneeId;
                const maxOrder = actions.reduce((max, a) => Math.max(max, Number(a.order__c) || 0), 0);
                fields.order__c = String(maxOrder + 1);

                const newId = await create('retro_action__c', fields);
                setActions(prev => [...prev, {
                    id: newId,
                    ...fields,
                    'assignee__cr.name__v': aiAssigneeName || null
                }]);
                showToast('Action item added!', 'success');
            }
            resetAiModal();
        } catch (err) {
            showToast(`Failed to ${isEdit ? 'update' : 'add'} action item: ${err.message}`, 'error');
        }
    }

    function actionStatusLabel(status) {
        if (status === 'done__c') return 'Done';
        if (status === 'in_progress__c') return 'In Progress';
        return 'Not Started';
    }

    /* ---------- Multi-select + Context Menu ---------- */

    function handleCardClick(e, item) {
        if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            setSelectedIds(prev => {
                const next = new Set(prev);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
            });
            return;
        }
        openEditFeedback(item);
    }

    function handleCardContextMenu(e, item) {
        e.preventDefault();
        e.stopPropagation();
        // Grouping only makes sense for 2+ items in the same category
        if (!selectedIds.has(item.id) || selectedIds.size < 2) {
            return;
        }
        const ids = Array.from(selectedIds);
        // Guard: all selected must be in the same category
        const cats = new Set(ids.map(id => {
            const it = feedback.find(f => f.id === id);
            return it ? it.category__c : null;
        }));
        if (cats.size !== 1) {
            showToast('Group members must be in the same column.', 'error');
            return;
        }
        setContextMenu({ x: e.clientX, y: e.clientY, kind: 'cards', ids });
    }

    function handleGroupContextMenu(e, groupId) {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, kind: 'group', groupId });
    }

    function closeContextMenu() {
        setContextMenu(null);
    }

    async function groupSelectedItems() {
        const ids = contextMenu?.ids || [];
        if (ids.length < 2) { closeContextMenu(); return; }
        const groupId = generateGroupId();
        try {
            await Promise.all(ids.map(id =>
                update('retro_feedback__c', id, { group__c: groupId })
            ));
            setFeedback(prev => prev.map(f =>
                ids.includes(f.id) ? { ...f, group__c: groupId } : f
            ));
            setSelectedIds(new Set());
            showToast(`Grouped ${ids.length} items`, 'success');
        } catch (err) {
            showToast('Grouping failed: ' + err.message, 'error');
        }
        closeContextMenu();
    }

    async function renameGroup(oldGroupId, newName) {
        const trimmed = (newName || '').trim();
        if (!trimmed || trimmed === oldGroupId) return;
        const ids = feedback.filter(f => f.group__c === oldGroupId).map(f => f.id);
        if (ids.length === 0) return;
        try {
            await Promise.all(ids.map(id =>
                update('retro_feedback__c', id, { group__c: trimmed })
            ));
            setFeedback(prev => prev.map(f =>
                ids.includes(f.id) ? { ...f, group__c: trimmed } : f
            ));
            showToast('Group renamed', 'success');
        } catch (err) {
            showToast('Rename failed: ' + err.message, 'error');
        }
    }

    async function ungroupItems(groupId) {
        const ids = feedback.filter(f => f.group__c === groupId).map(f => f.id);
        if (ids.length === 0) { closeContextMenu(); return; }
        try {
            await Promise.all(ids.map(id =>
                update('retro_feedback__c', id, { group__c: '' })
            ));
            setFeedback(prev => prev.map(f =>
                ids.includes(f.id) ? { ...f, group__c: '' } : f
            ));
            showToast('Ungrouped', 'success');
        } catch (err) {
            showToast('Ungrouping failed: ' + err.message, 'error');
        }
        closeContextMenu();
    }

    /* ---------- Drag and Drop ---------- */

    function onDragStart(payload) {
        dragRef.current = payload;
        setDragging(payload);
        // Clear any open context menu / selection highlight while dragging
        setContextMenu(null);
    }

    function onDragEnd() {
        dragRef.current = null;
        setDragging(null);
        setDropTarget(null);
    }

    function isValidDrop(columnKey) {
        const drag = dragRef.current;
        if (!drag) return false;
        if (columnKey === 'action' && (drag.type === 'feedback' || drag.type === 'group')) return false;
        if (columnKey !== 'action' && drag.type === 'action') return false;
        // Kudos column accepts only kudos cards (and groups of kudos);
        // kudos cards/groups can't drop into Went Well / To Improve.
        if (drag.type === 'feedback') {
            const draggedIsKudos = drag.category === KUDOS_CATEGORY;
            const targetIsKudos = columnKey === KUDOS_CATEGORY;
            if (draggedIsKudos !== targetIsKudos) return false;
        }
        if (drag.type === 'group') {
            const draggedIsKudos = drag.category === KUDOS_CATEGORY;
            const targetIsKudos = columnKey === KUDOS_CATEGORY;
            if (draggedIsKudos !== targetIsKudos) return false;
        }
        return true;
    }

    function onCardDragOver(e, columnKey, overId) {
        e.preventDefault();
        if (!isValidDrop(columnKey)) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }
        e.dataTransfer.dropEffect = 'move';
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        setDropTarget(prev => {
            if (prev && prev.column === columnKey && prev.overId === overId && prev.before === before && !prev.isGroup) return prev;
            return { column: columnKey, overId, before, isGroup: false };
        });
    }

    function onGroupDragOver(e, columnKey, groupId) {
        e.preventDefault();
        if (!isValidDrop(columnKey)) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }
        e.dataTransfer.dropEffect = 'move';
        e.stopPropagation();

        const drag = dragRef.current;
        if (!drag) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const h = rect.height;

        const canJoin =
            drag.type === 'feedback' && drag.fromGroupId !== groupId;

        let next;
        if (!canJoin) {
            next = { column: columnKey, overId: groupId, before: y < h / 2, isGroup: true, intoGroup: false };
        } else if (y < h * 0.25) {
            next = { column: columnKey, overId: groupId, before: true, isGroup: true, intoGroup: false };
        } else if (y > h * 0.75) {
            next = { column: columnKey, overId: groupId, before: false, isGroup: true, intoGroup: false };
        } else {
            next = { column: columnKey, overId: groupId, isGroup: true, intoGroup: true };
        }
        setDropTarget(prev => {
            if (prev && prev.column === next.column && prev.overId === next.overId && prev.before === next.before && prev.isGroup === next.isGroup && prev.intoGroup === next.intoGroup) return prev;
            return next;
        });
    }

    function onColumnDragOver(e, columnKey) {
        e.preventDefault();
        if (!isValidDrop(columnKey)) {
            e.dataTransfer.dropEffect = 'none';
            return;
        }
        e.dataTransfer.dropEffect = 'move';
        if (e.target === e.currentTarget) {
            setDropTarget(prev => {
                // Don't clear a card-level target — the indicator's
                // pointer-events:none can pass events to the column body.
                if (prev && prev.column === columnKey && prev.overId) return prev;
                if (prev && prev.column === columnKey && prev.overId === null && !prev.isGroup) return prev;
                return { column: columnKey, overId: null, before: false, isGroup: false };
            });
        }
    }

    function onColumnDragLeave(e) {
        if (!e.currentTarget.contains(e.relatedTarget)) {
            setDropTarget(null);
        }
    }

    function onColumnDrop(e, columnKey) {
        e.preventDefault();
        const drag = dragRef.current;
        if (!drag || !isValidDrop(columnKey)) {
            onDragEnd();
            return;
        }
        const dt = dropTarget;
        const droppedId = drag.type === 'group' ? drag.groupId : drag.id;

        if (drag.type === 'action') {
            handleActionDrop(drag, dt);
        } else if (drag.type === 'group') {
            handleGroupDrop(drag, columnKey, dt);
        } else {
            handleFeedbackDrop(drag, columnKey, dt);
        }

        onDragEnd();
        setJustDroppedId(droppedId);
        setTimeout(() => setJustDroppedId(null), 400);
    }

    function assignOrder(items) {
        return items.map((item, i) => ({ ...item, order__c: String(i + 1) }));
    }

    function assignFeedbackOrder(items) {
        const counters = {};
        return items.map(f => {
            const cat = f.category__c;
            counters[cat] = (counters[cat] || 0) + 1;
            return { ...f, order__c: String(counters[cat]) };
        });
    }

    function persistOrder(items, objectName) {
        const updates = items
            .map((item, idx) => ({ item, newOrder: String(idx + 1) }))
            .filter(({ item, newOrder }) => String(item.order__c) !== newOrder);
        if (updates.length === 0) return;
        Promise.all(
            updates.map(({ item, newOrder }) =>
                update(objectName, item.id, { order__c: newOrder })
            )
        ).catch(err => {
            showToast('Failed to save order: ' + err.message, 'error');
        });
    }

    function handleActionDrop(drag, dt) {
        const item = actions.find(a => a.id === drag.id);
        if (!item) return;
        const rest = actions.filter(a => a.id !== drag.id);
        let insertIdx;
        if (dt && dt.overId) {
            const overIdx = rest.findIndex(a => a.id === dt.overId);
            insertIdx = overIdx >= 0 ? (dt.before ? overIdx : overIdx + 1) : rest.length;
        } else {
            insertIdx = rest.length;
        }
        const newList = [...rest];
        newList.splice(insertIdx, 0, item);
        persistOrder(newList, 'retro_action__c');
        setActions(assignOrder(newList));
    }

    function handleGroupDrop(drag, columnKey, dt) {
        const groupItems = feedback.filter(f => f.group__c === drag.groupId);
        if (groupItems.length === 0) return;

        const rest = feedback.filter(f => f.group__c !== drag.groupId);
        let insertIdx = rest.length;

        if (dt && dt.overId && dt.isGroup && dt.overId !== drag.groupId) {
            // Position relative to another group (no nesting — always before/after)
            if (dt.before) {
                const idx = rest.findIndex(f => f.group__c === dt.overId);
                insertIdx = idx >= 0 ? idx : rest.length;
            } else {
                let lastIdx = -1;
                rest.forEach((f, i) => { if (f.group__c === dt.overId) lastIdx = i; });
                insertIdx = lastIdx >= 0 ? lastIdx + 1 : rest.length;
            }
        } else if (dt && dt.overId && !dt.isGroup) {
            // Position relative to a card
            const overIdx = rest.findIndex(f => f.id === dt.overId);
            if (overIdx >= 0) insertIdx = dt.before ? overIdx : overIdx + 1;
        } else {
            // End of target category
            const catEntries = rest.map((f, i) => ({ f, i })).filter(({ f }) => f.category__c === columnKey);
            insertIdx = catEntries.length > 0 ? catEntries[catEntries.length - 1].i + 1 : rest.length;
        }

        const categoryChanged = drag.category !== columnKey;
        const moved = categoryChanged
            ? groupItems.map(f => ({ ...f, category__c: columnKey }))
            : groupItems;

        const newList = [...rest];
        newList.splice(insertIdx, 0, ...moved);

        const destItems = newList.filter(f => f.category__c === columnKey);
        persistOrder(destItems, 'retro_feedback__c');
        if (categoryChanged) {
            const srcItems = newList.filter(f => f.category__c === drag.category);
            persistOrder(srcItems, 'retro_feedback__c');
            Promise.all(groupItems.map(f =>
                update('retro_feedback__c', f.id, { category__c: columnKey })
            )).catch(err => {
                showToast('Failed to move group: ' + err.message, 'error');
                loadData();
            });
        }

        setFeedback(assignFeedbackOrder(newList));
    }

    function handleFeedbackDrop(drag, columnKey, dt) {
        const item = feedback.find(f => f.id === drag.id);
        if (!item) return;
        const currentGroupId = item.group__c || '';

        let newGroupId = '';
        let newCategory = columnKey;
        let insertIdx;

        const rest = feedback.filter(f => f.id !== drag.id);

        if (dt && dt.isGroup && dt.intoGroup) {
            // Join the target group; inherit its category
            newGroupId = dt.overId;
            const groupItem = rest.find(f => f.group__c === dt.overId);
            if (groupItem) newCategory = groupItem.category__c;
            let lastIdx = -1;
            rest.forEach((f, i) => { if (f.group__c === dt.overId) lastIdx = i; });
            insertIdx = lastIdx >= 0 ? lastIdx + 1 : rest.length;
        } else if (dt && dt.isGroup && !dt.intoGroup) {
            // Position relative to a group as standalone (leave any previous group)
            if (dt.before) {
                const idx = rest.findIndex(f => f.group__c === dt.overId);
                insertIdx = idx >= 0 ? idx : rest.length;
            } else {
                let lastIdx = -1;
                rest.forEach((f, i) => { if (f.group__c === dt.overId) lastIdx = i; });
                insertIdx = lastIdx >= 0 ? lastIdx + 1 : rest.length;
            }
        } else if (dt && dt.overId) {
            // Over a card — inherit that card's group membership & category
            const overIdx = rest.findIndex(f => f.id === dt.overId);
            if (overIdx >= 0) {
                const target = rest[overIdx];
                newGroupId = target.group__c || '';
                newCategory = target.category__c;
                insertIdx = dt.before ? overIdx : overIdx + 1;
            } else {
                insertIdx = rest.length;
            }
        } else {
            // End of the target column, standalone
            const catEntries = rest.map((f, i) => ({ f, i })).filter(({ f }) => f.category__c === newCategory);
            insertIdx = catEntries.length > 0 ? catEntries[catEntries.length - 1].i + 1 : rest.length;
        }

        const updatedItem = { ...item, category__c: newCategory, group__c: newGroupId };
        const newList = [...rest];
        newList.splice(insertIdx, 0, updatedItem);

        const destItems = newList.filter(f => f.category__c === newCategory);
        persistOrder(destItems, 'retro_feedback__c');
        if (drag.category !== newCategory) {
            const srcItems = newList.filter(f => f.category__c === drag.category);
            persistOrder(srcItems, 'retro_feedback__c');
        }

        setFeedback(assignFeedbackOrder(newList));

        const updates = {};
        if (drag.category !== newCategory) updates.category__c = newCategory;
        if (currentGroupId !== newGroupId) updates.group__c = newGroupId;
        if (Object.keys(updates).length > 0) {
            update('retro_feedback__c', drag.id, updates).catch(err => {
                showToast('Failed to move: ' + err.message, 'error');
                loadData();
            });
        }
    }

    if (loading) return <Spinner />;
    if (!board) return <EmptyState message="Board not found." />;

    return (
        <>
            <div className="vault-page-header">
                <div>
                    <div className="vault-flex-center vault-gap-8">
                        <h1 className="vault-page-header__title">{board.name__v}</h1>
                        <StatusBadge status={board.status__c} />
                    </div>
                </div>
                <div className="vault-flex vault-gap-8">
                    <button className="vault-btn vault-btn--secondary" onClick={() => navigate('create-board', { boardId })}>
                        Board Settings
                    </button>
                    <button
                        className="vault-btn vault-btn--secondary"
                        onClick={loadData}
                        title="Refresh"
                        aria-label="Refresh"
                    >
                        ↻ Refresh
                    </button>
                </div>
            </div>

            <div className="vault-columns">
                {CATEGORIES.map(cat => {
                    const items = feedback.filter(fi => fi.category__c === cat.key);
                    const entries = buildColumnDisplay(items);
                    const isDragOver = dragging && dropTarget?.column === cat.key;
                    const isValidTarget = dragging && isValidDrop(cat.key);

                    return (
                        <div key={cat.key} className="vault-column">
                            <div className={'vault-column__header vault-column__header--' + cat.color}>
                                <span>{cat.label}</span>
                                <span className="vault-column__count">{items.length}</span>
                            </div>
                            <div
                                className={
                                    'vault-column__body' +
                                    (isDragOver && isValidTarget ? ' vault-column__body--drag-over' : '') +
                                    (dragging && !isValidTarget ? ' vault-column__body--drag-reject' : '')
                                }
                                onDragOver={(e) => onColumnDragOver(e, cat.key)}
                                onDragLeave={onColumnDragLeave}
                                onDrop={(e) => onColumnDrop(e, cat.key)}
                            >
                                {currentUserId && (
                                    <button
                                        className="vault-btn vault-btn--small vault-btn--secondary"
                                        style={{ width: '100%', marginBottom: 4 }}
                                        onClick={() => {
                                            setFbModal({ category: cat.key });
                                            setFbContent('');
                                            setFbTheme('');
                                            setFbFeature('');
                                            setFbRecipientId('');
                                            setFbRecipientName('');
                                        }}
                                    >
                                        {cat.key === KUDOS_CATEGORY ? '+ Kudos' : '+ Add'}
                                    </button>
                                )}
                                {entries.length === 0 && !isDragOver ? (
                                    <div className="vault-empty vault-text-small" style={{ padding: 16 }}>No items yet</div>
                                ) : (
                                    entries.map(entry => {
                                        if (entry.type === 'group') {
                                            const g = entry;
                                            return (
                                                <React.Fragment key={'g:' + g.groupId}>
                                                    {dropTarget?.column === cat.key && dropTarget?.overId === g.groupId && dropTarget?.isGroup && dropTarget?.before === true && (
                                                        <div className="vault-drop-indicator" />
                                                    )}
                                                    <GroupCard
                                                        groupId={g.groupId}
                                                        items={g.items}
                                                        columnKey={cat.key}
                                                        dragging={dragging}
                                                        dropTarget={dropTarget}
                                                        justDroppedId={justDroppedId}
                                                        userVotes={userVotes}
                                                        currentUserId={currentUserId}
                                                        selectedIds={selectedIds}
                                                        onToggleVote={toggleVote}
                                                        onCardClick={handleCardClick}
                                                        onCardContextMenu={handleCardContextMenu}
                                                        onGroupContextMenu={handleGroupContextMenu}
                                                        onCardDragStart={(item) =>
                                                            onDragStart({ type: 'feedback', id: item.id, category: item.category__c, fromGroupId: g.groupId })
                                                        }
                                                        onGroupDragStart={() =>
                                                            onDragStart({ type: 'group', groupId: g.groupId, category: cat.key })
                                                        }
                                                        onCardDragOver={onCardDragOver}
                                                        onGroupDragOver={onGroupDragOver}
                                                        onDragEnd={onDragEnd}
                                                        onRenameGroup={renameGroup}
                                                    />
                                                    {dropTarget?.column === cat.key && dropTarget?.overId === g.groupId && dropTarget?.isGroup && dropTarget?.before === false && (
                                                        <div className="vault-drop-indicator" />
                                                    )}
                                                </React.Fragment>
                                            );
                                        }
                                        const item = entry.item;
                                        const isDropTarget = dropTarget?.column === cat.key && dropTarget?.overId === item.id && !dropTarget?.isGroup;
                                        return (
                                            <FeedbackCard
                                                key={item.id}
                                                item={item}
                                                authorName={userName(item, 'author')}
                                                isVoted={!!userVotes[item.id]}
                                                onVote={() => toggleVote(item.id)}
                                                canVote={!!currentUserId}
                                                selected={selectedIds.has(item.id)}
                                                dropPosition={isDropTarget ? (dropTarget.before ? 'before' : 'after') : null}
                                                justDropped={item.id === justDroppedId}
                                                onClick={(e) => handleCardClick(e, item)}
                                                onContextMenu={(e) => handleCardContextMenu(e, item)}
                                                isDragging={dragging?.id === item.id}
                                                onDragStart={() => onDragStart({ type: 'feedback', id: item.id, category: item.category__c, fromGroupId: null })}
                                                onDragOver={(e) => onCardDragOver(e, cat.key, item.id)}
                                                onDragEnd={onDragEnd}
                                            />
                                        );
                                    })
                                )}
                                {dropTarget?.column === cat.key && !dropTarget?.overId && (
                                    <div className="vault-drop-indicator" />
                                )}
                            </div>
                        </div>
                    );
                })}

                {/* Action Items column */}
                {(() => {
                    const isDragOver = dragging && dropTarget?.column === 'action';
                    const isValidTarget = dragging && isValidDrop('action');
                    return (
                        <div className="vault-column">
                            <div className="vault-column__header vault-column__header--blue">
                                <span>Action Items</span>
                                <span className="vault-column__count">{actions.length}</span>
                            </div>
                            <div
                                className={
                                    'vault-column__body' +
                                    (isDragOver && isValidTarget ? ' vault-column__body--drag-over' : '') +
                                    (dragging && !isValidTarget ? ' vault-column__body--drag-reject' : '')
                                }
                                onDragOver={(e) => onColumnDragOver(e, 'action')}
                                onDragLeave={onColumnDragLeave}
                                onDrop={(e) => onColumnDrop(e, 'action')}
                            >
                                {currentUserId && (
                                    <button
                                        className="vault-btn vault-btn--small vault-btn--secondary"
                                        style={{ width: '100%', marginBottom: 4 }}
                                        onClick={openAddAction}
                                    >
                                        + Add
                                    </button>
                                )}
                                {actions.length === 0 && !isDragOver ? (
                                    <div className="vault-empty vault-text-small" style={{ padding: 16 }}>No action items yet</div>
                                ) : (
                                    actions.map(a => {
                                        const isDropTarget = dropTarget?.column === 'action' && dropTarget?.overId === a.id;
                                        return (
                                            <ActionCard
                                                key={a.id}
                                                item={a}
                                                assigneeName={a['assignee__cr.name__v'] || null}
                                                statusLabel={actionStatusLabel(a.status__c)}
                                                highlighted={a.id === highlightActionId}
                                                dropPosition={isDropTarget ? (dropTarget.before ? 'before' : 'after') : null}
                                                justDropped={a.id === justDroppedId}
                                                onClick={() => openEditAction(a)}
                                                isDragging={dragging?.id === a.id}
                                                onDragStart={() => onDragStart({ type: 'action', id: a.id })}
                                                onDragOver={(e) => onCardDragOver(e, 'action', a.id)}
                                                onDragEnd={onDragEnd}
                                            />
                                        );
                                    })
                                )}
                                {dropTarget?.column === 'action' && !dropTarget?.overId && (
                                    <div className="vault-drop-indicator" />
                                )}
                            </div>
                        </div>
                    );
                })()}
            </div>

            {contextMenu && (
                <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={closeContextMenu}>
                    {contextMenu.kind === 'cards' && (
                        <button className="vault-context-menu__item" onClick={groupSelectedItems}>
                            Group ({contextMenu.ids.length})
                        </button>
                    )}
                    {contextMenu.kind === 'group' && (
                        <button className="vault-context-menu__item" onClick={() => ungroupItems(contextMenu.groupId)}>
                            Ungroup
                        </button>
                    )}
                </ContextMenu>
            )}

            {/* Feedback Modal */}
            {fbModal && (() => {
                const boardFeatures = (board?.features__c || '')
                    .split('\n')
                    .map(s => s.trim())
                    .filter(Boolean);
                const isKudos = fbModal.category === KUDOS_CATEGORY;
                const titleLabel = isKudos
                    ? (fbModal.id ? 'Edit Kudos' : 'Give Kudos 🎉')
                    : (fbModal.id ? 'Edit Feedback' : 'Add Feedback');
                const confirmLabel = isKudos
                    ? (fbModal.id ? 'Save Changes' : 'Send Kudos')
                    : (fbModal.id ? 'Save Changes' : 'Add Feedback');
                const editingItem = fbModal.id ? feedback.find(f => f.id === fbModal.id) : null;
                const canDelete = editingItem && (
                    currentUserId === board?.facilitator__c || currentUserId === editingItem.author__c
                );
                return (
                    <Modal
                        title={titleLabel}
                        confirmLabel={confirmLabel}
                        onClose={resetFbModal}
                        onConfirm={submitFeedback}
                        onDelete={fbModal.id ? async () => {
                            try {
                                await deleteRecord('retro_feedback__c', fbModal.id);
                                setFeedback(prev => prev.filter(f => f.id !== fbModal.id));
                                resetFbModal();
                                showToast('Deleted.', 'success');
                            } catch (err) {
                                showToast('Delete failed: ' + err.message, 'error');
                            }
                        } : undefined}
                        deleteDisabled={!canDelete}
                    >
                        <div className="vault-form">
                            {isKudos && (
                                <div className="vault-form-group">
                                    <label className="vault-label">To *</label>
                                    <UserTypeAhead
                                        value={fbRecipientId}
                                        displayName={fbRecipientName}
                                        onChange={(id, name) => {
                                            setFbRecipientId(id || '');
                                            setFbRecipientName(name || '');
                                        }}
                                        placeholder="Search teammates..."
                                        autoFocus
                                    />
                                </div>
                            )}
                            <div className="vault-form-group">
                                <label className="vault-label">{isKudos ? 'Why *' : 'Feedback *'}</label>
                                <textarea
                                    className="vault-textarea"
                                    placeholder={isKudos ? 'What did they do that made the difference?' : 'Share your feedback...'}
                                    value={fbContent}
                                    onChange={(e) => setFbContent(e.target.value)}
                                    rows={3}
                                />
                            </div>
                            <div className="vault-form-group">
                                <label className="vault-label">Feature</label>
                                {boardFeatures.length > 0 ? (
                                    <select className="vault-select" value={fbFeature} onChange={(e) => setFbFeature(e.target.value)}>
                                        <option value="">None</option>
                                        {boardFeatures.map(f => (
                                            <option key={f} value={f}>{f}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <div className="vault-text-small vault-text-muted">
                                        No features defined for this board. Edit the board to add some.
                                    </div>
                                )}
                            </div>
                            {!isKudos && (
                                <div className="vault-form-group">
                                    <label className="vault-label">Theme</label>
                                    <select className="vault-select" value={fbTheme} onChange={(e) => setFbTheme(e.target.value)}>
                                        <option value="">None</option>
                                        {THEMES.map(t => (
                                            <option key={t.name} value={t.name}>{t.label}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    </Modal>
                );
            })()}

            {/* Action Item Modal */}
            {aiModal && (() => {
                const editingAction = aiModal.id ? actions.find(a => a.id === aiModal.id) : null;
                const canDeleteAction = editingAction && (
                    currentUserId === board?.facilitator__c || currentUserId === editingAction.owner__c
                );
                return (
                <Modal
                    title={aiModal.id ? 'Edit Action Item' : 'Add Action Item'}
                    confirmLabel={aiModal.id ? 'Save Changes' : 'Add Item'}
                    onClose={resetAiModal}
                    onConfirm={submitAction}
                    onDelete={aiModal.id ? async () => {
                        try {
                            await deleteRecord('retro_action__c', aiModal.id);
                            setActions(prev => prev.filter(a => a.id !== aiModal.id));
                            resetAiModal();
                            showToast('Deleted.', 'success');
                        } catch (err) {
                            showToast('Delete failed: ' + err.message, 'error');
                        }
                    } : undefined}
                    deleteDisabled={!canDeleteAction}
                >
                    <div className="vault-form">
                        {aiModal.id && (
                            <div className="vault-form-group">
                                <label className="vault-label">Created by</label>
                                <div>{aiOwnerName || 'Unknown'}</div>
                            </div>
                        )}
                        <div className="vault-form-group">
                            <label className="vault-label">Title *</label>
                            <input
                                className="vault-input"
                                type="text"
                                placeholder="Action item title..."
                                value={aiTitle}
                                onChange={(e) => setAiTitle(e.target.value)}
                            />
                        </div>
                        <div className="vault-form-group">
                            <label className="vault-label">Assignee</label>
                            <UserTypeAhead
                                value={aiAssigneeId}
                                displayName={aiAssigneeName}
                                onChange={(id, name) => {
                                    setAiAssigneeId(id || '');
                                    setAiAssigneeName(name || '');
                                }}
                                placeholder="Search users..."
                            />
                        </div>
                        <div className="vault-form-group">
                            <label className="vault-label">Due Date</label>
                            <input
                                className="vault-input"
                                type="date"
                                value={aiDue}
                                onChange={(e) => setAiDue(e.target.value)}
                            />
                        </div>
                        {aiModal.id && (
                            <div className="vault-form-group">
                                <label className="vault-label">Status</label>
                                <select
                                    className="vault-select"
                                    value={aiStatus}
                                    onChange={(e) => setAiStatus(e.target.value)}
                                >
                                    <option value="open__c">Not Started</option>
                                    <option value="in_progress__c">In Progress</option>
                                    <option value="done__c">Done</option>
                                </select>
                            </div>
                        )}
                    </div>
                </Modal>
                );
            })()}
        </>
    );
}

function GroupCard({
    groupId, items, columnKey,
    dragging, dropTarget, justDroppedId,
    userVotes, currentUserId, selectedIds,
    onToggleVote, onCardClick, onCardContextMenu, onGroupContextMenu,
    onCardDragStart, onGroupDragStart,
    onCardDragOver, onGroupDragOver, onDragEnd,
    onRenameGroup
}) {
    const isDropHere = dropTarget?.overId === groupId && dropTarget?.isGroup;
    const isJoinTarget = isDropHere && dropTarget?.intoGroup;
    const isDraggingThis = dragging?.type === 'group' && dragging?.groupId === groupId;

    const [editing, setEditing] = useState(false);
    const [draftName, setDraftName] = useState('');

    function startRename(e) {
        e.preventDefault();
        e.stopPropagation();
        setDraftName(isGeneratedGroupId(groupId) ? '' : groupId);
        setEditing(true);
    }

    function commitRename() {
        const trimmed = draftName.trim();
        setEditing(false);
        if (trimmed && trimmed !== groupId) {
            onRenameGroup(groupId, trimmed);
        }
    }

    return (
        <div
            className={
                'vault-group-card' +
                (isDraggingThis ? ' vault-group-card--dragging' : '') +
                (isJoinTarget ? ' vault-group-card--join-target' : '') +
                (groupId === justDroppedId ? ' vault-card--just-dropped' : '')
            }
            onDragOver={(e) => onGroupDragOver(e, columnKey, groupId)}
            onContextMenu={(e) => onGroupContextMenu(e, groupId)}
        >
            <div
                className="vault-group-card__header"
                draggable={!editing}
                onDragStart={editing ? undefined : onGroupDragStart}
                onDragEnd={onDragEnd}
                title="Drag to move group · Right-click to ungroup · Double-click name to rename"
            >
                <span className="vault-group-card__handle">⠿</span>
                {editing ? (
                    <input
                        className="vault-group-card__name-input"
                        autoFocus
                        value={draftName}
                        maxLength={50}
                        placeholder="Group name"
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                commitRename();
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditing(false);
                            }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <span
                        className="vault-group-card__label"
                        onDoubleClick={startRename}
                        title="Double-click to rename"
                    >
                        {groupDisplayName(groupId)} · {items.length}
                    </span>
                )}
            </div>
            <div className="vault-group-card__items">
                {items.map(item => {
                    const isDropTarget = dropTarget?.overId === item.id && !dropTarget?.isGroup;
                    return (
                        <FeedbackCard
                            key={item.id}
                            item={item}
                            authorName={item['author__cr.name__v'] || 'Unknown'}
                            isVoted={!!userVotes[item.id]}
                            onVote={() => onToggleVote(item.id)}
                            canVote={!!currentUserId}
                            selected={selectedIds.has(item.id)}
                            dropPosition={isDropTarget ? (dropTarget.before ? 'before' : 'after') : null}
                            justDropped={item.id === justDroppedId}
                            onClick={(e) => onCardClick(e, item)}
                            onContextMenu={(e) => onCardContextMenu(e, item)}
                            isDragging={dragging?.id === item.id}
                            onDragStart={() => onCardDragStart(item)}
                            onDragOver={(e) => onCardDragOver(e, columnKey, item.id)}
                            onDragEnd={onDragEnd}
                        />
                    );
                })}
            </div>
        </div>
    );
}

function ContextMenu({ x, y, children, onClose }) {
    const ref = useRef(null);

    useEffect(() => {
        function onDocEvent(e) {
            const path = e.composedPath ? e.composedPath() : [];
            if (ref.current && !path.includes(ref.current)) {
                onClose();
            }
        }
        // Defer attaching listeners to avoid catching the triggering event
        const t = setTimeout(() => {
            document.addEventListener('mousedown', onDocEvent, true);
            document.addEventListener('contextmenu', onDocEvent, true);
        }, 0);
        return () => {
            clearTimeout(t);
            document.removeEventListener('mousedown', onDocEvent, true);
            document.removeEventListener('contextmenu', onDocEvent, true);
        };
    }, [onClose]);

    return (
        <div
            ref={ref}
            className="vault-context-menu"
            style={{ top: y, left: x }}
        >
            {children}
        </div>
    );
}

function ActionCard({ item, assigneeName, statusLabel, highlighted, dropPosition, justDropped, onClick, isDragging, onDragStart, onDragOver, onDragEnd }) {
    const cardRef = useRef(null);

    useEffect(() => {
        if (highlighted && cardRef.current) {
            cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [highlighted]);

    return (
        <div
            ref={cardRef}
            className={
                'vault-action-card vault-action-card--clickable' +
                (isDragging ? ' vault-action-card--dragging' : '') +
                (highlighted ? ' vault-action-card--highlighted' : '') +
                (justDropped ? ' vault-card--just-dropped' : '') +
                (dropPosition === 'before' ? ' vault-card--drop-before' : '') +
                (dropPosition === 'after' ? ' vault-card--drop-after' : '')
            }
            draggable
            onClick={onClick}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            title="Click to edit"
        >
            {(() => {
                if (item.status__c === 'done__c') {
                    return <span className="vault-action-card__status-dot vault-action-card__status-dot--done" title="Done">✓</span>;
                }
                // YYYY-MM-DD strings compare lexicographically as dates — avoids timezone drift
                // from parsing the Vault-returned date as UTC midnight.
                const dueYmd = item.due_date__c ? String(item.due_date__c).slice(0, 10) : '';
                const todayYmd = toISODate(new Date());
                if (dueYmd && dueYmd < todayYmd) {
                    return (
                        <span className="vault-action-card__status-dot vault-action-card__status-dot--overdue" title={`Overdue — due ${formatDate(item.due_date__c)}`}>
                            <span className="vault-action-card__overdue-label">overdue</span>
                            <span className="vault-action-card__status-dot--open" />
                        </span>
                    );
                }
                return <span className="vault-action-card__status-dot vault-action-card__status-dot--open" title="Not done" />;
            })()}
            <div className="vault-action-card__drag-handle">⠿</div>
            <div className="vault-action-card__title">{item.name__v}</div>
            <div className="vault-action-card__field-row">
                <span className="vault-action-card__field-label">Assigned to:</span>
                <span>{assigneeName || 'Unassigned'}</span>
            </div>
            <div className="vault-action-card__field-row">
                <span className="vault-action-card__field-label">Status:</span>
                <span>{statusLabel}</span>
            </div>
            <div className="vault-action-card__field-row">
                <span className="vault-action-card__field-label">Due Date:</span>
                <span>{item.due_date__c ? formatDateMonthDay(item.due_date__c) : '—'}</span>
            </div>
            <div className="vault-action-card__field-row">
                <span className="vault-action-card__field-label">Completed:</span>
                <span>{item.completed_at__c ? formatDateMonthDay(item.completed_at__c) : '—'}</span>
            </div>
        </div>
    );
}

function FeedbackCard({ item, authorName, isVoted, onVote, canVote, selected, dropPosition, justDropped, onClick, onContextMenu, isDragging, onDragStart, onDragOver, onDragEnd }) {
    const voteCount = parseInt(item.vote_count__c || 0, 10);
    const isKudos = item.category__c === 'kudos__c';
    const recipientName = isKudos
        ? (item['kudos_recipient__cr.name__v'] || 'Someone')
        : null;
    return (
        <div
            className={
                'vault-feedback-card vault-feedback-card--clickable' +
                (isKudos ? ' vault-feedback-card--kudos' : '') +
                (isDragging ? ' vault-feedback-card--dragging' : '') +
                (selected ? ' vault-feedback-card--selected' : '') +
                (justDropped ? ' vault-card--just-dropped' : '') +
                (dropPosition === 'before' ? ' vault-card--drop-before' : '') +
                (dropPosition === 'after' ? ' vault-card--drop-after' : '')
            }
            draggable
            onClick={onClick}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            title="Drag to reorder or move · Click to edit · Cmd/Ctrl+click to select · Right-click to group"
        >
            <div className="vault-feedback-card__drag-handle">⠿</div>
            {isKudos && (
                <div className="vault-feedback-card__recipient">
                    🎉 Kudos to <strong>{recipientName}</strong>
                </div>
            )}
            <div className="vault-feedback-card__content">{item.content__c}</div>
            {item.feature__c && (
                <div className="vault-feedback-card__feature">{item.feature__c}</div>
            )}
            <div className="vault-feedback-card__footer">
                <span className="vault-feedback-card__author">
                    {isKudos ? `from ${authorName}` : authorName}
                </span>
                <div className="vault-feedback-card__actions">
                    {item.theme__c && <ThemeBadge theme={item.theme__c} />}
                    {canVote ? (
                        <button
                            className={'vault-vote-btn' + (isVoted ? ' vault-vote-btn--voted' : '')}
                            onClick={(e) => { e.stopPropagation(); onVote(); }}
                        >
                            ▲ {voteCount}
                        </button>
                    ) : (
                        <span className="vault-text-small vault-text-muted">▲ {voteCount}</span>
                    )}
                </div>
            </div>
        </div>
    );
}
