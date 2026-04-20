import React, { useEffect, useState, useMemo } from 'react';
import {
    fetchTeams, fetchReleases, fetchBoard, fetchFeaturesForRelease,
    fetchBoardFeatures, create, update, createRelease, createFeature,
    assignFeatureToBoard, unassignFeatureFromBoard,
    getCurrentUserId, getCurrentUserName, userName,
} from '../api/vault';
import Spinner from '../components/Spinner';
import UserTypeAhead from '../components/UserTypeAhead';
import { Combobox, ComboboxMulti } from '../components/Combobox';
import { toISODate } from '../utils/format';

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
    const [boardDate, setBoardDate] = useState(toISODate(new Date()));
    const [status, setStatus] = useState('active__c');

    // Features belonging to the currently-selected release (persisted records).
    const [releaseFeatures, setReleaseFeatures] = useState([]);
    // Feature IDs currently selected for this board.
    const [selectedFeatureIds, setSelectedFeatureIds] = useState(() => new Set());
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

    // Load release features when the release selection changes.
    useEffect(() => {
        if (!releaseId) {
            setReleaseFeatures([]);
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

    function addFeature(fid) {
        setSelectedFeatureIds(prev => {
            if (prev.has(fid)) return prev;
            const next = new Set(prev);
            next.add(fid);
            return next;
        });
    }

    function removeFeature(fid) {
        setSelectedFeatureIds(prev => {
            if (!prev.has(fid)) return prev;
            const next = new Set(prev);
            next.delete(fid);
            return next;
        });
    }

    async function handleCreateRelease(releaseName) {
        try {
            const id = await createRelease(releaseName);
            setReleases(prev => [...prev, { id, name__v: releaseName }]);
            setReleaseId(id);
            setSelectedFeatureIds(new Set());
            showToast && showToast(`Release "${releaseName}" created`, 'success');
            return id;
        } catch (err) {
            showToast && showToast('Failed to create release: ' + err.message, 'error');
            return null;
        }
    }

    async function handleCreateFeature(featureName) {
        if (!releaseId) {
            showToast && showToast('Pick a release before adding features', 'info');
            return null;
        }
        try {
            const release = releases.find(r => r.id === releaseId);
            const id = await createFeature(featureName, releaseId, release ? release.name__v : '');
            const newRow = {
                id,
                name__v: `${release ? release.name__v : releaseId} . ${featureName}`,
                display_name__c: featureName,
                release__c: releaseId,
            };
            setReleaseFeatures(prev => [...prev, newRow]);
            addFeature(id);
            showToast && showToast(`Feature "${featureName}" added to release`, 'success');
            return id;
        } catch (err) {
            showToast && showToast('Failed to create feature: ' + err.message, 'error');
            return null;
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!name || !teamId || !facilitatorId || !boardDate) {
            showToast('Please fill in all required fields.', 'error');
            return;
        }
        setSubmitting(true);
        try {
            // Release and features are already persisted — the comboboxes create
            // them inline. Here we only save the board + diff the board-feature
            // junction.
            const fields = {
                name__v: name,
                team__c: teamId,
                facilitator__c: facilitatorId,
                board_date__c: boardDate,
                status__c: status,
                release__c: releaseId || null,
            };
            let savedBoardId = boardId;
            if (isEdit) {
                await update('retro_board__c', boardId, fields);
            } else {
                savedBoardId = await create('retro_board__c', fields);
            }

            const existingByFeatureId = new Map(existingBoardFeatures.map(bf => [bf.retro_feature__c, bf.id]));
            for (const fid of selectedFeatureIds) {
                if (!existingByFeatureId.has(fid)) {
                    await assignFeatureToBoard(savedBoardId, fid);
                }
            }
            for (const [fid, junctionId] of existingByFeatureId.entries()) {
                if (!selectedFeatureIds.has(fid)) {
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

    const showFeatureSection = !!releaseId;
    const releaseOptions = releases.map(r => ({ id: r.id, label: r.name__v }));
    const featureOptions = releaseFeatures.map(f => ({
        id: f.id,
        label: f.display_name__c || f.name__v,
    }));

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
                            <Combobox
                                value={releaseId}
                                options={releaseOptions}
                                onChange={(id) => {
                                    setReleaseId(id);
                                    setSelectedFeatureIds(new Set());
                                }}
                                onCreate={handleCreateRelease}
                                placeholder="Search or create a release…"
                            />
                        </div>

                        {showFeatureSection && (
                            <div className="vault-form-group">
                                <label className="vault-label">Features this team is working on</label>
                                {loadingFeatures ? (
                                    <Spinner />
                                ) : (
                                    <ComboboxMulti
                                        values={[...selectedFeatureIds]}
                                        options={featureOptions}
                                        onAdd={addFeature}
                                        onRemove={removeFeature}
                                        onCreate={handleCreateFeature}
                                        placeholder="Search or create a feature…"
                                    />
                                )}
                                <div className="vault-text-small vault-text-muted vault-mt-8">
                                    New features are created on the release and auto-assigned to this board.
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

