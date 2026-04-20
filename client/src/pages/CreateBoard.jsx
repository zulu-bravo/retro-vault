import React, { useEffect, useState } from 'react';
import { fetchTeams, fetchReleases, fetchBoard, create, update, createRelease, getCurrentUserId, getCurrentUserName, userName } from '../api/vault';
import Spinner from '../components/Spinner';
import UserTypeAhead from '../components/UserTypeAhead';
import { toISODate } from '../utils/format';

const NEW_RELEASE = '__new__';

export default function CreateBoard({ boardId, navigate, showToast }) {
    const isEdit = !!boardId;
    const currentUserId = getCurrentUserId();
    const currentUserName = getCurrentUserName();
    const [loading, setLoading] = useState(true);
    const [teams, setTeams] = useState([]);
    const [releases, setReleases] = useState([]);
    const [submitting, setSubmitting] = useState(false);

    const [name, setName] = useState('');
    const [teamId, setTeamId] = useState('');
    const [facilitatorId, setFacilitatorId] = useState('');
    const [facilitatorDisplay, setFacilitatorDisplay] = useState('');
    const [releaseId, setReleaseId] = useState('');           // existing release id, NEW_RELEASE, or ''
    const [newReleaseName, setNewReleaseName] = useState('');
    const [newReleaseFeatures, setNewReleaseFeatures] = useState('');
    const [boardDate, setBoardDate] = useState(toISODate(new Date()));
    const [status, setStatus] = useState('active__c');

    useEffect(() => {
        (async () => {
            try {
                const [t, r, existing] = await Promise.all([
                    fetchTeams(),
                    fetchReleases(),
                    isEdit ? fetchBoard(boardId) : Promise.resolve(null)
                ]);
                setTeams(t);
                setReleases(r);
                if (existing) {
                    setName(existing.name__v || '');
                    setTeamId(existing.team__c || '');
                    setFacilitatorId(existing.facilitator__c || currentUserId || '');
                    setFacilitatorDisplay(userName(existing, 'facilitator') || currentUserName || currentUserId || '');
                    setReleaseId(existing.release__c || '');
                    setBoardDate(existing.board_date__c || toISODate(new Date()));
                    setStatus(existing.status__c || 'active__c');
                } else {
                    setFacilitatorId(currentUserId || '');
                    setFacilitatorDisplay(currentUserName || currentUserId || '');
                }
            } catch (err) {
                showToast('Failed to load form data: ' + err.message, 'error');
            } finally {
                setLoading(false);
            }
        })();
    }, [boardId]);

    const selectedRelease = releases.find(r => r.id === releaseId);
    const isNewRelease = releaseId === NEW_RELEASE;

    async function handleSubmit(e) {
        e.preventDefault();
        if (!name || !teamId || !facilitatorId || !boardDate) {
            showToast('Please fill in all required fields.', 'error');
            return;
        }
        if (isNewRelease && !newReleaseName.trim()) {
            showToast('Please enter a name for the new release.', 'error');
            return;
        }
        setSubmitting(true);
        try {
            let finalReleaseId = releaseId && releaseId !== NEW_RELEASE ? releaseId : null;
            if (isNewRelease) {
                finalReleaseId = await createRelease(newReleaseName.trim(), newReleaseFeatures);
            }

            const fields = {
                name__v: name,
                team__c: teamId,
                facilitator__c: facilitatorId,
                board_date__c: boardDate,
                status__c: status,
                release__c: finalReleaseId,
            };

            if (isEdit) {
                await update('retro_board__c', boardId, fields);
                showToast('Board updated!', 'success');
                navigate('board', { boardId });
            } else {
                const newId = await create('retro_board__c', fields);
                showToast('Board created!', 'success');
                navigate('board', { boardId: newId });
            }
        } catch (err) {
            showToast(`Failed to ${isEdit ? 'update' : 'create'} board: ${err.message}`, 'error');
            setSubmitting(false);
        }
    }

    if (loading) return <Spinner />;

    return (
        <div style={{ maxWidth: 640 }}>
            <div className="vault-page-header">
                <div>
                    <h1 className="vault-page-header__title">{isEdit ? 'Board Settings' : 'Create New Board'}</h1>
                    <p className="vault-page-header__subtitle">
                        {isEdit ? 'Update this retrospective board' : 'Set up a new retrospective session'}
                    </p>
                </div>
            </div>

            <div className="vault-card">
                <div className="vault-card__body">
                    <form className="vault-form" onSubmit={handleSubmit}>
                        <div className="vault-form-group">
                            <label className="vault-label">Board Name *</label>
                            <input
                                className="vault-input"
                                type="text"
                                placeholder="e.g., Sprint 12 Retro"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                            />
                        </div>

                        <div className="vault-form-group">
                            <label className="vault-label">Team *</label>
                            <select className="vault-select" value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
                                <option value="">Select a team</option>
                                {teams.map(t => (
                                    <option key={t.id} value={t.id}>{t.name__v}</option>
                                ))}
                            </select>
                        </div>

                        <div className="vault-form-group">
                            <label className="vault-label">Facilitator *</label>
                            <UserTypeAhead
                                value={facilitatorId}
                                displayName={facilitatorDisplay}
                                onChange={(id, name) => {
                                    setFacilitatorId(id || '');
                                    setFacilitatorDisplay(name || '');
                                }}
                                placeholder="Search users..."
                            />
                        </div>

                        <div className="vault-form-group">
                            <label className="vault-label">Release</label>
                            <select
                                className="vault-select"
                                value={releaseId}
                                onChange={(e) => setReleaseId(e.target.value)}
                            >
                                <option value="">No release</option>
                                {releases.map(r => (
                                    <option key={r.id} value={r.id}>{r.name__v}</option>
                                ))}
                                <option value={NEW_RELEASE}>+ New release…</option>
                            </select>
                            <div className="vault-text-small vault-text-muted">
                                Releases are shared across teams. Edit features on the Releases tab.
                            </div>
                        </div>

                        {isNewRelease && (
                            <>
                                <div className="vault-form-group">
                                    <label className="vault-label">New Release Name *</label>
                                    <input
                                        className="vault-input"
                                        type="text"
                                        placeholder="e.g., 26R1.0"
                                        value={newReleaseName}
                                        onChange={(e) => setNewReleaseName(e.target.value)}
                                    />
                                </div>
                                <div className="vault-form-group">
                                    <label className="vault-label">Features</label>
                                    <textarea
                                        className="vault-textarea"
                                        placeholder={'One feature per line, e.g.\nCheckout redesign\nSearch v2\nOnboarding flow'}
                                        value={newReleaseFeatures}
                                        onChange={(e) => setNewReleaseFeatures(e.target.value)}
                                        rows={6}
                                    />
                                    <div className="vault-text-small vault-text-muted">
                                        Feedback authors will pick from this list when adding items.
                                    </div>
                                </div>
                            </>
                        )}

                        {!isNewRelease && selectedRelease && selectedRelease.features__c && (
                            <div className="vault-form-group">
                                <label className="vault-label">Features (from {selectedRelease.name__v})</label>
                                <pre className="vault-release-preview">{selectedRelease.features__c}</pre>
                                <div className="vault-text-small vault-text-muted">
                                    Edit features on the Releases tab.
                                </div>
                            </div>
                        )}

                        <div className="vault-form-group">
                            <label className="vault-label">Board Date *</label>
                            <input
                                className="vault-input"
                                type="date"
                                value={boardDate}
                                onChange={(e) => setBoardDate(e.target.value)}
                                required
                            />
                        </div>

                        {isEdit && (
                            <div className="vault-form-group">
                                <label className="vault-label">Status</label>
                                <select className="vault-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                                    <option value="active__c">Active</option>
                                    <option value="closed__c">Closed</option>
                                </select>
                            </div>
                        )}

                        <div className="vault-flex-between vault-mt-16">
                            <button
                                type="button"
                                className="vault-btn vault-btn--secondary"
                                onClick={() => navigate(isEdit ? 'board' : 'dashboard', isEdit ? { boardId } : {})}
                            >
                                Cancel
                            </button>
                            <button type="submit" className="vault-btn vault-btn--primary" disabled={submitting}>
                                {submitting
                                    ? (isEdit ? 'Saving...' : 'Creating...')
                                    : (isEdit ? 'Save Changes' : 'Create Board')}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
