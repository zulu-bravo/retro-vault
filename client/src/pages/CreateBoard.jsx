import React, { useEffect, useState } from 'react';
import { fetchTeams, fetchUsers, create } from '../api/vault';
import Spinner from '../components/Spinner';
import { toISODate } from '../utils/format';

export default function CreateBoard({ navigate, showToast }) {
    const [loading, setLoading] = useState(true);
    const [teams, setTeams] = useState([]);
    const [users, setUsers] = useState([]);
    const [submitting, setSubmitting] = useState(false);

    const [name, setName] = useState('');
    const [teamId, setTeamId] = useState('');
    const [facilitatorId, setFacilitatorId] = useState('');
    const [releaseTag, setReleaseTag] = useState('');
    const [boardDate, setBoardDate] = useState(toISODate(new Date()));

    useEffect(() => {
        (async () => {
            try {
                const [t, u] = await Promise.all([fetchTeams(), fetchUsers()]);
                setTeams(t);
                setUsers(u);
            } catch (err) {
                showToast('Failed to load form data: ' + err.message, 'error');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!name || !teamId || !facilitatorId || !boardDate) {
            showToast('Please fill in all required fields.', 'error');
            return;
        }
        setSubmitting(true);
        try {
            const fields = {
                name__v: name,
                team__c: teamId,
                facilitator__c: facilitatorId,
                board_date__c: boardDate,
                status__c: 'active__c'
            };
            if (releaseTag) fields.release_tag__c = releaseTag;

            const newId = await create('retro_board__c', fields);
            showToast('Board created!', 'success');
            navigate('board', { boardId: newId });
        } catch (err) {
            showToast('Failed to create board: ' + err.message, 'error');
            setSubmitting(false);
        }
    }

    if (loading) return <Spinner />;

    return (
        <div style={{ maxWidth: 640 }}>
            <div className="vault-page-header">
                <div>
                    <h1 className="vault-page-header__title">Create New Board</h1>
                    <p className="vault-page-header__subtitle">Set up a new retrospective session</p>
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
                            <select className="vault-select" value={facilitatorId} onChange={(e) => setFacilitatorId(e.target.value)} required>
                                <option value="">Select a facilitator</option>
                                {users.map(u => (
                                    <option key={u.id} value={u.id}>{u.name__v}</option>
                                ))}
                            </select>
                        </div>

                        <div className="vault-form-group">
                            <label className="vault-label">Release Tag</label>
                            <input
                                className="vault-input"
                                type="text"
                                placeholder="e.g., v2.4.1"
                                value={releaseTag}
                                onChange={(e) => setReleaseTag(e.target.value)}
                            />
                        </div>

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

                        <div className="vault-flex-between vault-mt-16">
                            <button type="button" className="vault-btn vault-btn--secondary" onClick={() => navigate('dashboard')}>
                                Cancel
                            </button>
                            <button type="submit" className="vault-btn vault-btn--primary" disabled={submitting}>
                                {submitting ? 'Creating...' : 'Create Board'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
