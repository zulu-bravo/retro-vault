import React, { useEffect, useState, useCallback } from 'react';
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
import { formatDate, formatDateTime } from '../utils/format';

const CATEGORIES = [
    { key: 'went_well__c', label: 'Went Well', color: 'green' },
    { key: 'didnt_go_well__c', label: 'To Improve', color: 'red' }
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
    const [userVotes, setUserVotes] = useState({}); // feedbackItemId -> voteRecordId

    const [fbModal, setFbModal] = useState(null); // { category } or { id, category }
    const [fbContent, setFbContent] = useState('');
    const [fbTheme, setFbTheme] = useState('');
    const [fbFeature, setFbFeature] = useState('');

    const [aiModal, setAiModal] = useState(false);
    const [aiTitle, setAiTitle] = useState('');
    const [aiDue, setAiDue] = useState('');

    const loadData = useCallback(async () => {
        try {
            const [b, f, a, v] = await Promise.all([
                fetchBoard(boardId),
                fetchFeedbackForBoard(boardId),
                fetchActionsForBoard(boardId),
                currentUserId ? fetchVotesForUser(currentUserId) : Promise.resolve([])
            ]);
            setBoard(b);
            setFeedback(f);
            setActions(a);

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

    /* ---------- Add / Edit Feedback ---------- */

    function openEditFeedback(item) {
        setFbModal({ id: item.id, category: item.category__c });
        setFbContent(item.content__c || '');
        setFbTheme(item.theme__c || '');
        setFbFeature(item.feature__c || '');
    }

    function resetFbModal() {
        setFbModal(null);
        setFbContent('');
        setFbTheme('');
        setFbFeature('');
    }

    async function submitFeedback() {
        if (!fbContent.trim()) {
            showToast('Please enter feedback content.', 'error');
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
                await update('feedback_item__c', fbModal.id, updates);
                setFeedback(prev => prev.map(fi =>
                    fi.id === fbModal.id ? { ...fi, ...updates } : fi
                ));
                showToast('Feedback updated!', 'success');
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

                const newId = await create('feedback_item__c', fields);
                setFeedback(prev => [...prev, { id: newId, ...fields }]);
                showToast('Feedback added!', 'success');
            }
            resetFbModal();
        } catch (err) {
            showToast(`Failed to ${isEdit ? 'update' : 'add'} feedback: ${err.message}`, 'error');
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
                        {` · Facilitator: ${userName(board, 'facilitator')}`}
                    </p>
                </div>
                <div className="vault-flex vault-gap-8">
                    <button className="vault-btn vault-btn--secondary" onClick={() => navigate('create-board', { boardId })}>
                        Edit Board
                    </button>
                    <button className="vault-btn vault-btn--secondary" onClick={() => navigate('dashboard')}>
                        ← Back
                    </button>
                </div>
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
                                        onClick={() => {
                                            setFbModal({ category: cat.key });
                                            setFbContent('');
                                            setFbTheme('');
                                            setFbFeature('');
                                        }}
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
                                            authorName={userName(item, 'author')}
                                            isVoted={!!userVotes[item.id]}
                                            onVote={() => toggleVote(item.id)}
                                            canVote={!!currentUserId}
                                            onEdit={() => openEditFeedback(item)}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    );
                })}

                {/* Action Items as the 3rd column */}
                <div className="vault-column">
                    <div className="vault-column__header vault-column__header--blue">
                        <span>Action Items</span>
                        <span className="vault-column__count">{actions.length}</span>
                    </div>
                    <div className="vault-column__body">
                        {currentUserId && (
                            <button
                                className="vault-btn vault-btn--small vault-btn--secondary"
                                style={{ width: '100%', marginBottom: 4 }}
                                onClick={() => setAiModal(true)}
                            >
                                + Add
                            </button>
                        )}
                        {actions.length === 0 ? (
                            <div className="vault-empty vault-text-small" style={{ padding: 16 }}>No action items yet</div>
                        ) : (
                            actions.map(a => (
                                <ActionCard
                                    key={a.id}
                                    item={a}
                                    ownerName={userName(a, 'owner')}
                                    onStatusChange={(s) => updateActionStatus(a.id, s)}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Feedback Modal */}
            {fbModal && (() => {
                const boardFeatures = (board?.features__c || '')
                    .split('\n')
                    .map(s => s.trim())
                    .filter(Boolean);
                return (
                    <Modal
                        title={fbModal.id ? 'Edit Feedback' : 'Add Feedback'}
                        confirmLabel={fbModal.id ? 'Save Changes' : 'Add Feedback'}
                        onClose={resetFbModal}
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
                );
            })()}

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

function ActionCard({ item, ownerName, onStatusChange }) {
    return (
        <div className="vault-action-card">
            <div className="vault-action-card__title">{item.name__v}</div>
            <div className="vault-action-card__meta">
                <span className="vault-action-card__owner">{ownerName}</span>
                {item.due_date__c && (
                    <span className="vault-action-card__due">Due {formatDate(item.due_date__c)}</span>
                )}
            </div>
            <select
                className="vault-status-select"
                value={item.status__c}
                onChange={(e) => onStatusChange(e.target.value)}
            >
                <option value="open__c">Open</option>
                <option value="in_progress__c">In Progress</option>
                <option value="done__c">Done</option>
            </select>
            {item.completed_at__c && (
                <div className="vault-text-small vault-text-muted">
                    Completed {formatDateTime(item.completed_at__c)}
                </div>
            )}
        </div>
    );
}

function FeedbackCard({ item, authorName, isVoted, onVote, canVote, onEdit }) {
    const voteCount = parseInt(item.vote_count__c || 0, 10);
    return (
        <div
            className="vault-feedback-card vault-feedback-card--clickable"
            onClick={onEdit}
            title="Click to edit"
        >
            <div className="vault-feedback-card__content">{item.content__c}</div>
            {item.feature__c && (
                <div className="vault-feedback-card__feature">{item.feature__c}</div>
            )}
            <div className="vault-feedback-card__footer">
                <span className="vault-feedback-card__author">{authorName}</span>
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
