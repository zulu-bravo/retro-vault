import React, { useEffect, useState, useCallback } from 'react';
import {
    fetchBoard,
    fetchFeedbackForBoard,
    fetchActionsForBoard,
    fetchVotesForUser,
    fetchUsers,
    create,
    update,
    deleteRecord,
    getCurrentUserId
} from '../api/vault';
import Spinner, { EmptyState } from '../components/Spinner';
import { StatusBadge, ThemeBadge } from '../components/Badge';
import Modal from '../components/Modal';
import { formatDate, formatDateTime } from '../utils/format';

const CATEGORIES = [
    { key: 'went_well__c', label: 'Went Well', color: 'green' },
    { key: 'didnt_go_well__c', label: "Didn't Go Well", color: 'red' },
    { key: 'ideas__c', label: 'Ideas', color: 'blue' }
];

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

export default function BoardView({ boardId, navigate, showToast }) {
    const currentUserId = getCurrentUserId();

    const [loading, setLoading] = useState(true);
    const [board, setBoard] = useState(null);
    const [feedback, setFeedback] = useState([]);
    const [actions, setActions] = useState([]);
    const [userMap, setUserMap] = useState({});
    const [userVotes, setUserVotes] = useState({}); // feedbackItemId -> voteRecordId

    const [fbModal, setFbModal] = useState(null); // { category }
    const [fbContent, setFbContent] = useState('');
    const [fbTheme, setFbTheme] = useState('');

    const [aiModal, setAiModal] = useState(false);
    const [aiTitle, setAiTitle] = useState('');
    const [aiDue, setAiDue] = useState('');

    const loadData = useCallback(async () => {
        try {
            const [b, f, a, v, users] = await Promise.all([
                fetchBoard(boardId),
                fetchFeedbackForBoard(boardId),
                fetchActionsForBoard(boardId),
                currentUserId ? fetchVotesForUser(currentUserId) : Promise.resolve([]),
                fetchUsers()
            ]);
            setBoard(b);
            setFeedback(f);
            setActions(a);

            const map = {};
            users.forEach(u => { map[u.id] = u.name__v; });
            setUserMap(map);

            // Filter votes to only those for this board's feedback items
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
                // Real delete (supported in Custom Pages)
                await deleteRecord('vote__c', existingVoteId);
                await update('feedback_item__c', feedbackItemId, {
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
                const voteId = await create('vote__c', {
                    name__v: `${feedbackItemId}_${currentUserId}`.slice(0, 80),
                    feedback_item__c: feedbackItemId,
                    voter__c: currentUserId
                });
                await update('feedback_item__c', feedbackItemId, {
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

    /* ---------- Add Feedback ---------- */

    async function submitFeedback() {
        if (!fbContent.trim()) {
            showToast('Please enter feedback content.', 'error');
            return;
        }
        try {
            const fields = {
                name__v: fbContent.substring(0, 80),
                retro_board__c: boardId,
                author__c: currentUserId,
                category__c: fbModal.category,
                content__c: fbContent,
                vote_count__c: 0
            };
            if (fbTheme) fields.theme__c = fbTheme;

            const newId = await create('feedback_item__c', fields);
            setFeedback(prev => [...prev, { id: newId, ...fields }]);
            setFbModal(null);
            setFbContent('');
            setFbTheme('');
            showToast('Feedback added!', 'success');
        } catch (err) {
            showToast('Failed to add feedback: ' + err.message, 'error');
        }
    }

    /* ---------- Add Action Item ---------- */

    async function submitAction() {
        if (!aiTitle.trim()) {
            showToast('Please enter a title.', 'error');
            return;
        }
        try {
            const fields = {
                name__v: aiTitle,
                retro_board__c: boardId,
                owner__c: currentUserId,
                status__c: 'open__c'
            };
            if (aiDue) fields.due_date__c = aiDue;

            const newId = await create('action_item__c', fields);
            setActions(prev => [...prev, { id: newId, ...fields }]);
            setAiModal(false);
            setAiTitle('');
            setAiDue('');
            showToast('Action item added!', 'success');
        } catch (err) {
            showToast('Failed to add action item: ' + err.message, 'error');
        }
    }

    async function updateActionStatus(actionId, newStatus) {
        try {
            const fields = { status__c: newStatus };
            if (newStatus === 'done__c') {
                fields.completed_at__c = new Date().toISOString();
            }
            await update('action_item__c', actionId, fields);
            setActions(prev => prev.map(a =>
                a.id === actionId ? { ...a, ...fields } : a
            ));
        } catch (err) {
            showToast('Failed to update status: ' + err.message, 'error');
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
                    <p className="vault-page-header__subtitle">
                        {formatDate(board.board_date__c)}
                        {board.release_tag__c && ` · ${board.release_tag__c}`}
                        {` · Facilitator: ${userMap[board.facilitator__c] || 'Unknown'}`}
                    </p>
                </div>
                <button className="vault-btn vault-btn--secondary" onClick={() => navigate('dashboard')}>
                    ← Back
                </button>
            </div>

            <div className="vault-columns">
                {CATEGORIES.map(cat => {
                    const items = feedback
                        .filter(fi => fi.category__c === cat.key)
                        .sort((a, b) => (parseInt(b.vote_count__c || 0, 10)) - (parseInt(a.vote_count__c || 0, 10)));

                    return (
                        <div key={cat.key} className="vault-column">
                            <div className={'vault-column__header vault-column__header--' + cat.color}>
                                <span>{cat.label}</span>
                                <span className="vault-column__count">{items.length}</span>
                            </div>
                            <div className="vault-column__body">
                                {currentUserId && (
                                    <button
                                        className="vault-btn vault-btn--small vault-btn--secondary"
                                        style={{ width: '100%', marginBottom: 4 }}
                                        onClick={() => { setFbModal({ category: cat.key }); setFbContent(''); setFbTheme(''); }}
                                    >
                                        + Add
                                    </button>
                                )}
                                {items.length === 0 ? (
                                    <div className="vault-empty vault-text-small" style={{ padding: 16 }}>No items yet</div>
                                ) : (
                                    items.map(item => (
                                        <FeedbackCard
                                            key={item.id}
                                            item={item}
                                            authorName={userMap[item.author__c] || 'Unknown'}
                                            isVoted={!!userVotes[item.id]}
                                            onVote={() => toggleVote(item.id)}
                                            canVote={!!currentUserId}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="vault-card vault-mt-24">
                <div className="vault-card__header">
                    <span className="vault-card__title">Action Items ({actions.length})</span>
                    {currentUserId && (
                        <button className="vault-btn vault-btn--small vault-btn--primary" onClick={() => setAiModal(true)}>
                            + Add
                        </button>
                    )}
                </div>
                {actions.length === 0 ? (
                    <div className="vault-card__body"><EmptyState message="No action items yet." /></div>
                ) : (
                    <table className="vault-table">
                        <thead>
                            <tr>
                                <th>Title</th><th>Owner</th><th>Status</th><th>Due Date</th><th>Completed</th>
                            </tr>
                        </thead>
                        <tbody>
                            {actions.map(a => (
                                <tr key={a.id}>
                                    <td>{a.name__v}</td>
                                    <td>{userMap[a.owner__c] || 'Unassigned'}</td>
                                    <td>
                                        <select
                                            className="vault-status-select"
                                            value={a.status__c}
                                            onChange={(e) => updateActionStatus(a.id, e.target.value)}
                                        >
                                            <option value="open__c">Open</option>
                                            <option value="in_progress__c">In Progress</option>
                                            <option value="done__c">Done</option>
                                        </select>
                                    </td>
                                    <td>{formatDate(a.due_date__c)}</td>
                                    <td>{a.completed_at__c ? formatDateTime(a.completed_at__c) : ''}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Feedback Modal */}
            {fbModal && (
                <Modal
                    title="Add Feedback"
                    confirmLabel="Add Feedback"
                    onClose={() => setFbModal(null)}
                    onConfirm={submitFeedback}
                >
                    <div className="vault-form">
                        <div className="vault-form-group">
                            <label className="vault-label">Feedback *</label>
                            <textarea
                                className="vault-textarea"
                                placeholder="Share your feedback..."
                                value={fbContent}
                                onChange={(e) => setFbContent(e.target.value)}
                                rows={3}
                            />
                        </div>
                        <div className="vault-form-group">
                            <label className="vault-label">Theme</label>
                            <select className="vault-select" value={fbTheme} onChange={(e) => setFbTheme(e.target.value)}>
                                <option value="">None</option>
                                {THEMES.map(t => (
                                    <option key={t.name} value={t.name}>{t.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Action Item Modal */}
            {aiModal && (
                <Modal
                    title="Add Action Item"
                    confirmLabel="Add Item"
                    onClose={() => setAiModal(false)}
                    onConfirm={submitAction}
                >
                    <div className="vault-form">
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
                            <label className="vault-label">Due Date</label>
                            <input
                                className="vault-input"
                                type="date"
                                value={aiDue}
                                onChange={(e) => setAiDue(e.target.value)}
                            />
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
}

function FeedbackCard({ item, authorName, isVoted, onVote, canVote }) {
    const voteCount = parseInt(item.vote_count__c || 0, 10);
    return (
        <div className="vault-feedback-card">
            <div className="vault-feedback-card__content">{item.content__c}</div>
            <div className="vault-feedback-card__footer">
                <span className="vault-feedback-card__author">{authorName}</span>
                <div className="vault-feedback-card__actions">
                    {item.theme__c && <ThemeBadge theme={item.theme__c} />}
                    {canVote ? (
                        <button
                            className={'vault-vote-btn' + (isVoted ? ' vault-vote-btn--voted' : '')}
                            onClick={onVote}
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
