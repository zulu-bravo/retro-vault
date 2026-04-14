import React, { useEffect, useState } from 'react';
import { fetchTeams, fetchBoards, userName } from '../api/vault';
import Spinner, { EmptyState } from '../components/Spinner';
import { StatusBadge } from '../components/Badge';
import { formatDate } from '../utils/format';

export default function Dashboard({ navigate, showToast }) {
    const [loading, setLoading] = useState(true);
    const [teams, setTeams] = useState([]);
    const [boards, setBoards] = useState([]);

    useEffect(() => {
        (async () => {
            try {
                const [t, b] = await Promise.all([fetchTeams(), fetchBoards()]);
                setTeams(t);
                setBoards(b);
            } catch (err) {
                showToast('Failed to load data: ' + err.message, 'error');
                console.error(err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    if (loading) return <Spinner />;

    // Group boards by team
    const boardsByTeam = {};
    boards.forEach(b => {
        const t = b.team__c || 'unassigned';
        if (!boardsByTeam[t]) boardsByTeam[t] = [];
        boardsByTeam[t].push(b);
    });

    return (
        <>
            <div className="vault-page-header">
                <div>
                    <h1 className="vault-page-header__title">Retro Boards</h1>
                    <p className="vault-page-header__subtitle">Team retrospective boards grouped by team</p>
                </div>
                <div className="vault-flex vault-gap-8">
                    <button className="vault-btn vault-btn--secondary" onClick={() => navigate('seed')}>Seed Demo Data</button>
                    <button className="vault-btn vault-btn--primary" onClick={() => navigate('create-board')}>+ New Board</button>
                </div>
            </div>

            {teams.length === 0 ? (
                <EmptyState message="No teams found. Click 'Seed Demo Data' to get started." />
            ) : (
                teams.map(team => {
                    const teamBoards = boardsByTeam[team.id] || [];
                    return (
                        <div key={team.id} className="vault-section">
                            <h2 className="vault-section__title">
                                {team.name__v}
                                <span className="vault-text-muted vault-text-small">
                                    {' '}({teamBoards.length} board{teamBoards.length !== 1 ? 's' : ''})
                                </span>
                            </h2>
                            {teamBoards.length === 0 ? (
                                <EmptyState message="No boards for this team yet." />
                            ) : (
                                <div className="vault-grid vault-grid--3">
                                    {teamBoards.map(board => (
                                        <div
                                            key={board.id}
                                            className="vault-card vault-card--clickable"
                                            onClick={() => navigate('board', { boardId: board.id })}
                                        >
                                            <div className="vault-board-card">
                                                <div className="vault-flex-between">
                                                    <span className="vault-board-card__name">{board.name__v}</span>
                                                    <StatusBadge status={board.status__c} />
                                                </div>
                                                <div className="vault-board-card__meta">
                                                    {board.release_tag__c && (
                                                        <span className="vault-board-card__meta-item">{board.release_tag__c}</span>
                                                    )}
                                                    <span className="vault-board-card__meta-item">{formatDate(board.board_date__c)}</span>
                                                </div>
                                                <div className="vault-board-card__meta">
                                                    <span className="vault-board-card__meta-item">
                                                        Facilitator: {userName(board, 'facilitator')}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })
            )}
        </>
    );
}
