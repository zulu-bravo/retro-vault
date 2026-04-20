import React, { useEffect, useState, useMemo } from 'react';
import {
    fetchTeams, fetchReleases, fetchBoard, fetchFeaturesForRelease,
    fetchBoardFeatures, create, update, createRelease, createFeature,
    assignFeatureToBoard, unassignFeatureFromBoard,
    getCurrentUserId, getCurrentUserName, userName,
} from '../api/vault';
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
    const [releaseId, setReleaseId] = useState('');
    const [newReleaseName, setNewReleaseName] = useState('');
    const [boardDate, setBoardDate] = useState(toISODate(new Date()));
    const [status, setStatus] = useState('active__c');

    // Features belonging to the currently-selected release (persisted records).
    const [releaseFeatures, setReleaseFeatures] = useState([]);
    // Feature IDs currently selected for this board (checked checkboxes).
    const [selectedFeatureIds, setSelectedFeatureIds] = useState(() => new Set());
    // Pending feature names typed in but not yet saved (used for new release or to add to existing release).
    const [pendingFeatureNames, setPendingFeatureNames] = useState([]);
    const [newFeatureDraft, setNewFeatureDraft] = useState('');
    // When editing an existing board, track which junction rows exist so we can diff on save.
    const [existingBoardFeatures, setExistingBoardFeatures] = useState([]);
    const [loadingFeatures, setLoadingFeatures] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const [t, r, existing] = await Promise.all([
                    fetchTeams(),
                    fetchReleases(),
                    isEdit ? fetchBoard(boardId) : Promise.resolve(null),
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
                    if (existing.release__c) {
                        const [feats, bfs] = await Promise.all([
                            fetchFeaturesForRelease(existing.release__c),
                            fetchBoardFeatures(boardId),
                        ]);
                        setReleaseFeatures(feats);
                        setExistingBoardFeatures(bfs);
                        setSelectedFeatureIds(new Set(bfs.map(bf => bf.retro_feature__c)));
                    }
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

    // Load release features when the picker changes to an existing release.
    useEffect(() => {
        if (!releaseId || releaseId === NEW_RELEASE) {
            setReleaseFeatures([]);
            // Keep pendingFeatureNames — they roll over into the new release if user picked that path.
            return;
        }
        let cancelled = false;
        setLoadingFeatures(true);
        (async () => {
            try {
                const feats = await fetchFeaturesForRelease(releaseId);
                if (!cancelled) setReleaseFeatures(feats);
            } catch (err) {
                showToast && showToast('Failed to load release features: ' + err.message, 'error');
            } finally {
                if (!cancelled) setLoadingFeatures(false);
            }
        })();
        return () => { cancelled = true; };
    }, [releaseId]);

    const isNewRelease = releaseId === NEW_RELEASE;

    function toggleFeature(fid) {
        setSelectedFeatureIds(prev => {
            const next = new Set(prev);
            if (next.has(fid)) next.delete(fid);
            else next.add(fid);
            return next;
        });
    }

    function handleAddPendingFeature() {
        const v = newFeatureDraft.trim();
        if (!v) return;
        // de-duplicate against already-existing release features + other pending names
        const existingNames = new Set([
            ...releaseFeatures.map(f => (f.display_name__c || f.name__v).toLowerCase()),
            ...pendingFeatureNames.map(n => n.toLowerCase()),
        ]);
        if (existingNames.has(v.toLowerCase())) {
            showToast && showToast(`"${v}" already exists`, 'info');
            setNewFeatureDraft('');
            return;
        }
        setPendingFeatureNames(prev => [...prev, v]);
        setNewFeatureDraft('');
    }

    function removePendingFeature(idx) {
        setPendingFeatureNames(prev => prev.filter((_, i) => i !== idx));
    }

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
            // 1. Resolve release ID (create new release if needed).
            let finalReleaseId = releaseId && releaseId !== NEW_RELEASE ? releaseId : null;
            let finalReleaseName = '';
            if (isNewRelease) {
                finalReleaseName = newReleaseName.trim();
                finalReleaseId = await createRelease(finalReleaseName);
            } else if (finalReleaseId) {
                const selected = releases.find(r => r.id === finalReleaseId);
                finalReleaseName = selected ? selected.name__v : '';
            }

            // 2. Create any pending feature records on the release.
            const newlyCreatedFeatureIds = [];
            if (finalReleaseId) {
                for (const pName of pendingFeatureNames) {
                    const fid = await createFeature(pName, finalReleaseId, finalReleaseName);
                    newlyCreatedFeatureIds.push(fid);
                }
            }

            // 3. Create/update the board itself.
            const fields = {
                name__v: name,
                team__c: teamId,
                facilitator__c: facilitatorId,
                board_date__c: boardDate,
                status__c: status,
                release__c: finalReleaseId,
            };
            let savedBoardId = boardId;
            if (isEdit) {
                await update('retro_board__c', boardId, fields);
            } else {
                savedBoardId = await create('retro_board__c', fields);
            }

            // 4. Diff feature assignments on this board.
            const desiredFeatureIds = new Set([...selectedFeatureIds, ...newlyCreatedFeatureIds]);
            const existingByFeatureId = new Map(existingBoardFeatures.map(bf => [bf.retro_feature__c, bf.id]));

            // Assign newly-selected features
            for (const fid of desiredFeatureIds) {
                if (!existingByFeatureId.has(fid)) {
                    await assignFeatureToBoard(savedBoardId, fid);
                }
            }
            // Remove de-selected features
            for (const [fid, junctionId] of existingByFeatureId.entries()) {
                if (!desiredFeatureIds.has(fid)) {
                    await unassignFeatureFromBoard(junctionId);
                }
            }

            showToast(isEdit ? 'Board updated!' : 'Board created!', 'success');
            navigate('board', { boardId: savedBoardId });
        } catch (err) {
            showToast(`Failed to ${isEdit ? 'update' : 'create'} board: ${err.message}`, 'error');
            setSubmitting(false);
        }
    }

    if (loading) return <Spinner />;

    const showFeatureSection = isNewRelease || !!releaseId;

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
                                onChange={(e) => {
                                    setReleaseId(e.target.value);
                                    setSelectedFeatureIds(new Set());
                                    setPendingFeatureNames([]);
                                }}
                            >
                                <option value="">No release</option>
                                {releases.map(r => (
                                    <option key={r.id} value={r.id}>{r.name__v}</option>
                                ))}
                                <option value={NEW_RELEASE}>+ New release…</option>
                            </select>
                        </div>

                        {isNewRelease && (
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
                        )}

                        {showFeatureSection && (
                            <div className="vault-form-group">
                                <label className="vault-label">Features this team is working on</label>
                                {loadingFeatures ? (
                                    <Spinner />
                                ) : (
                                    <FeatureChecklist
                                        releaseFeatures={releaseFeatures}
                                        selectedIds={selectedFeatureIds}
                                        onToggle={toggleFeature}
                                        pending={pendingFeatureNames}
                                        onRemovePending={removePendingFeature}
                                    />
                                )}
                                <div className="vault-flex vault-gap-8 vault-mt-8">
                                    <input
                                        className="vault-input"
                                        type="text"
                                        placeholder="Add a new feature…"
                                        value={newFeatureDraft}
                                        onChange={e => setNewFeatureDraft(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddPendingFeature(); } }}
                                    />
                                    <button type="button" className="vault-btn vault-btn--secondary" onClick={handleAddPendingFeature}>
                                        Add
                                    </button>
                                </div>
                                <div className="vault-text-small vault-text-muted">
                                    New features are saved to the release and automatically assigned to this board.
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

function FeatureChecklist({ releaseFeatures, selectedIds, onToggle, pending, onRemovePending }) {
    if (releaseFeatures.length === 0 && pending.length === 0) {
        return (
            <div className="vault-text-small vault-text-muted">
                No features yet. Add one below.
            </div>
        );
    }
    return (
        <div className="vault-feature-checklist">
            {releaseFeatures.map(f => (
                <label key={f.id} className="vault-feature-checklist__item">
                    <input
                        type="checkbox"
                        checked={selectedIds.has(f.id)}
                        onChange={() => onToggle(f.id)}
                    />
                    <span>{f.display_name__c || f.name__v}</span>
                </label>
            ))}
            {pending.map((name, idx) => (
                <div key={`pending-${idx}`} className="vault-feature-checklist__item vault-feature-checklist__item--pending">
                    <span className="vault-chip">{name}<button type="button" onClick={() => onRemovePending(idx)} aria-label="Remove">×</button></span>
                    <span className="vault-text-small vault-text-muted">(new)</span>
                </div>
            ))}
        </div>
    );
}
