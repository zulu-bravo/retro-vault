// Teams — Star Performers per team.
// Each team gets its own section with a podium (top 3) and a compact table
// for the rest. Rankings are by total kudos votes then kudos count.
import React, { useEffect, useState, useMemo } from 'react';
import { fetchAllFeedback, fetchBoards, fetchTeams, userName } from '../api/vault';
import Spinner, { EmptyState } from '../components/Spinner';
import Avatar from '../components/Avatar';

export default function Teams({ showToast }) {
    const [loading, setLoading] = useState(true);
    const [feedback, setFeedback] = useState([]);
    const [boards, setBoards] = useState([]);
    const [teams, setTeams] = useState([]);

    useEffect(() => {
        (async () => {
            try {
                const [f, b, t] = await Promise.all([fetchAllFeedback(), fetchBoards(), fetchTeams()]);
                setFeedback(f);
                setBoards(b);
                setTeams(t);
            } catch (err) {
                showToast && showToast('Failed to load team insights: ' + err.message, 'error');
                console.error(err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const perTeam = useMemo(() => buildPerTeamStars(feedback, boards, teams), [feedback, boards, teams]);

    if (loading) return <Spinner />;

    return (
        <>
            <Header />

            {perTeam.length === 0 ? (
                <div className="vault-card">
                    <div className="vault-card__body">
                        <EmptyState message="No kudos yet — give some kudos on a retro board to populate Star Performers." />
                    </div>
                </div>
            ) : (
                perTeam.map(team => (
                    <TeamStarsSection key={team.id} team={team} />
                ))
            )}
        </>
    );
}

function Header() {
    return (
        <div className="vault-page-header">
            <div>
                <h1 className="vault-page-header__title">Teams</h1>
                <p className="vault-page-header__subtitle">Star Performers recognized via kudos, grouped by team</p>
            </div>
        </div>
    );
}

/* ---------- Compute ---------- */

// Per-team star rankings. A recipient is attributed to the team of the board
// the kudos was given on. Same person getting kudos across teams ranks in each.
function buildPerTeamStars(feedback, boards, teams) {
    const boardById = new Map(boards.map(b => [b.id, b]));
    const teamNameById = new Map(teams.map(t => [t.id, t.name__v]));

    // teamId -> (recipientId -> entry)
    const byTeam = new Map();

    for (const fi of feedback) {
        if (fi.category__c !== 'kudos__c' || !fi.kudos_recipient__c) continue;
        const board = boardById.get(fi.retro_board__c);
        if (!board || !board.team__c) continue;

        const teamId = board.team__c;
        if (!byTeam.has(teamId)) byTeam.set(teamId, new Map());
        const teamMap = byTeam.get(teamId);

        const rid = fi.kudos_recipient__c;
        if (!teamMap.has(rid)) {
            teamMap.set(rid, {
                id: rid,
                name: userName(fi, 'kudos_recipient'),
                kudosCount: 0,
                totalVotes: 0,
                boards: new Set(),
                topQuote: null,
                topVotes: -1,
                topRelease: '',
            });
        }
        const entry = teamMap.get(rid);
        const votes = Number(fi.vote_count__c) || 0;
        entry.kudosCount += 1;
        entry.totalVotes += votes;
        entry.boards.add(fi.retro_board__c);
        // Quote = the kudos with the highest vote count this person received.
        if (votes > entry.topVotes) {
            entry.topVotes = votes;
            entry.topQuote = fi.content__c;
            entry.topRelease = board['release__cr.name__v'] || '';
        }
    }

    const result = [];
    for (const [teamId, teamMap] of byTeam.entries()) {
        const ranked = [...teamMap.values()]
            .sort((a, b) => b.totalVotes - a.totalVotes || b.kudosCount - a.kudosCount)
            .map((r, i) => ({ ...r, rank: i + 1, boardCount: r.boards.size }));
        result.push({
            id: teamId,
            name: teamNameById.get(teamId) || teamId,
            ranked,
        });
    }

    // Stable order — team name asc
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

/* ---------- Render ---------- */

function TeamStarsSection({ team }) {
    const top3 = team.ranked.slice(0, 3);
    const rest = team.ranked.slice(3);

    return (
        <div className="vault-card vault-mb-24">
            <div className="vault-card__header">
                <span className="vault-card__title">{team.name}</span>
            </div>
            <div className="vault-card__body">
                <div className="vault-stars-row">
                    {top3.map(r => (
                        <StarCard key={r.id} entry={r} />
                    ))}
                </div>

                {rest.length > 0 && (
                    <table className="vault-table vault-mt-16">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Name</th>
                                <th>Kudos</th>
                                <th>Votes</th>
                                <th>Boards</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rest.map(r => (
                                <tr key={r.id}>
                                    <td>{r.rank}</td>
                                    <td className="vault-text-bold">
                                        <span className="vault-user">
                                            <Avatar userId={r.id} name={r.name} size="sm" />
                                            {r.name}
                                        </span>
                                    </td>
                                    <td>{r.kudosCount}</td>
                                    <td>{r.totalVotes}</td>
                                    <td>{r.boardCount}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

function StarCard({ entry: r }) {
    const rankClass = r.rank === 1 ? 'vault-star-card--gold'
        : r.rank === 2 ? 'vault-star-card--silver'
        : 'vault-star-card--bronze';
    const icon = r.rank === 1 ? '🏆' : r.rank === 2 ? '🥈' : '🥉';
    return (
        <div className={'vault-star-card ' + rankClass}>
            <div className="vault-star-card__header">
                <span className="vault-star-card__medal">{icon}</span>
                <span className="vault-star-card__rank-num">#{r.rank}</span>
            </div>
            <div className="vault-star-card__person">
                <Avatar userId={r.id} name={r.name} size="lg" />
                <div className="vault-star-card__name">{r.name}</div>
            </div>
            <div className="vault-star-card__stats">
                <span><strong>{r.kudosCount}</strong> kudos</span>
                <span><strong>{r.totalVotes}</strong> votes</span>
                <span><strong>{r.boardCount}</strong> board{r.boardCount !== 1 ? 's' : ''}</span>
            </div>
            {r.topQuote && (
                <blockquote className="vault-star-card__quote">
                    <span className="vault-star-card__quote-text">"{r.topQuote}"</span>
                    {r.topRelease && <span className="vault-star-card__release">{r.topRelease}</span>}
                </blockquote>
            )}
        </div>
    );
}
