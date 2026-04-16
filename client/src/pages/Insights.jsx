import React, { useEffect, useState } from 'react';
import { fetchAllFeedback, fetchAllActions, fetchBoards, fetchTeams } from '../api/vault';
import Spinner, { EmptyState } from '../components/Spinner';
import { ThemeBadge } from '../components/Badge';

export default function Insights({ showToast }) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                const [feedback, actions, boards, teams] = await Promise.all([
                    fetchAllFeedback(),
                    fetchAllActions(),
                    fetchBoards(),
                    fetchTeams()
                ]);

                const boardTeam = {};
                boards.forEach(b => { boardTeam[b.id] = b.team__c; });
                const teamNames = {};
                teams.forEach(t => { teamNames[t.id] = t.name__v; });

                setData({
                    blockers: computeBlockers(feedback),
                    completion: computeCompletion(actions, boardTeam, teamNames),
                    sentiment: computeSentiment(feedback, boardTeam, teamNames)
                });
            } catch (err) {
                showToast('Failed to load insights: ' + err.message, 'error');
                console.error(err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    if (loading) return <Spinner />;
    if (!data) return <EmptyState message="No data available." />;

    return (
        <>
            <div className="vault-page-header">
                <div>
                    <h1 className="vault-page-header__title">Insights</h1>
                    <p className="vault-page-header__subtitle">Analytics across all retrospective boards</p>
                </div>
            </div>

            <BlockersPanel blockers={data.blockers} />
            <CompletionPanel rows={data.completion} />
            <SentimentPanel rows={data.sentiment} />
        </>
    );
}

/* ---------- Compute helpers ---------- */

function computeBlockers(feedback) {
    const negatives = feedback.filter(fi => fi.category__c === 'didnt_go_well__c' && fi.theme__c);
    const themeMap = {};
    negatives.forEach(fi => {
        const theme = fi.theme__c;
        if (!themeMap[theme]) themeMap[theme] = { theme, boards: new Set(), votes: 0, count: 0 };
        themeMap[theme].boards.add(fi.retro_board__c);
        themeMap[theme].votes += parseInt(fi.vote_count__c || 0, 10);
        themeMap[theme].count++;
    });

    return Object.values(themeMap)
        .map(t => ({ ...t, boardCount: t.boards.size }))
        .filter(t => t.boardCount >= 2)
        .sort((a, b) => b.boardCount - a.boardCount || b.votes - a.votes);
}

function computeCompletion(actions, boardTeam, teamNames) {
    const stats = {};
    actions.forEach(ai => {
        const teamId = boardTeam[ai.retro_board__c] || 'unknown';
        if (!stats[teamId]) stats[teamId] = { total: 0, done: 0, in_progress: 0, open: 0 };
        stats[teamId].total++;
        if (ai.status__c === 'done__c') stats[teamId].done++;
        else if (ai.status__c === 'in_progress__c') stats[teamId].in_progress++;
        else stats[teamId].open++;
    });

    return Object.entries(stats)
        .map(([tid, s]) => ({
            ...s,
            teamName: teamNames[tid] || 'Unknown',
            rate: s.total > 0 ? Math.round((s.done / s.total) * 100) : 0
        }))
        .sort((a, b) => b.rate - a.rate);
}

function computeSentiment(feedback, boardTeam, teamNames) {
    const data = {};
    feedback.forEach(fi => {
        const teamId = boardTeam[fi.retro_board__c] || 'unknown';
        if (!data[teamId]) data[teamId] = { went_well: 0, didnt_go_well: 0, boards: new Set() };
        if (fi.category__c === 'went_well__c') data[teamId].went_well++;
        else if (fi.category__c === 'didnt_go_well__c') data[teamId].didnt_go_well++;
        data[teamId].boards.add(fi.retro_board__c);
    });

    return Object.entries(data)
        .map(([tid, d]) => {
            const total = d.went_well + d.didnt_go_well;
            return {
                ...d,
                teamName: teamNames[tid] || 'Unknown',
                ratio: total > 0 ? Math.round((d.went_well / total) * 100) : 0,
                boardCount: d.boards.size
            };
        })
        .sort((a, b) => b.ratio - a.ratio);
}

/* ---------- Panels ---------- */

function BlockersPanel({ blockers }) {
    return (
        <div className="vault-card vault-mb-24">
            <div className="vault-card__header">
                <span className="vault-card__title">Recurring Blockers</span>
            </div>
            {blockers.length === 0 ? (
                <div className="vault-card__body">
                    <EmptyState message="No recurring blockers found (themes must appear on 2+ boards)." />
                </div>
            ) : (
                <table className="vault-table">
                    <thead>
                        <tr><th>Theme</th><th>Mentions</th><th>Boards</th><th>Total Votes</th></tr>
                    </thead>
                    <tbody>
                        {blockers.map(b => (
                            <tr key={b.theme}>
                                <td><ThemeBadge theme={b.theme} /></td>
                                <td>{b.count}</td>
                                <td>{b.boardCount}</td>
                                <td>{b.votes}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function CompletionPanel({ rows }) {
    return (
        <div className="vault-card vault-mb-24">
            <div className="vault-card__header">
                <span className="vault-card__title">Action Item Completion Rates</span>
            </div>
            {rows.length === 0 ? (
                <div className="vault-card__body"><EmptyState message="No action items found." /></div>
            ) : (
                <div className="vault-card__body">
                    <div className="vault-bar-chart vault-mb-24">
                        {rows.map(r => (
                            <div key={r.teamName} className="vault-bar-row">
                                <span className="vault-bar-label">{r.teamName}</span>
                                <div className="vault-bar-track">
                                    <div className="vault-bar-fill vault-bar-fill--green" style={{ width: r.rate + '%' }}>
                                        {r.rate > 15 && `${r.rate}%`}
                                    </div>
                                </div>
                                <span className="vault-bar-value">{r.rate}%</span>
                            </div>
                        ))}
                    </div>
                    <table className="vault-table">
                        <thead>
                            <tr><th>Team</th><th>Total</th><th>Done</th><th>In Progress</th><th>Not Started</th><th>Rate</th></tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.teamName}>
                                    <td className="vault-text-bold">{r.teamName}</td>
                                    <td>{r.total}</td>
                                    <td>{r.done}</td>
                                    <td>{r.in_progress}</td>
                                    <td>{r.open}</td>
                                    <td className="vault-text-bold">{r.rate}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function SentimentPanel({ rows }) {
    return (
        <div className="vault-card vault-mb-24">
            <div className="vault-card__header">
                <span className="vault-card__title">Team Sentiment</span>
            </div>
            {rows.length === 0 ? (
                <div className="vault-card__body"><EmptyState message="No feedback data found." /></div>
            ) : (
                <table className="vault-table">
                    <thead>
                        <tr>
                            <th>Team</th><th>Went Well</th><th>To Improve</th>
                            <th>Ratio</th><th>Positive %</th><th>Boards</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => {
                            const barW = r.went_well + r.didnt_go_well;
                            const greenPct = barW > 0 ? Math.round((r.went_well / barW) * 100) : 0;
                            const redPct = 100 - greenPct;
                            return (
                                <tr key={r.teamName}>
                                    <td className="vault-text-bold">{r.teamName}</td>
                                    <td>{r.went_well}</td>
                                    <td>{r.didnt_go_well}</td>
                                    <td>
                                        <div className="vault-bar-track" style={{ height: 16, width: 120, display: 'inline-flex' }}>
                                            <div className="vault-bar-fill vault-bar-fill--green" style={{ width: greenPct + '%', minWidth: 0, padding: 0 }}></div>
                                            <div className="vault-bar-fill vault-bar-fill--red" style={{ width: redPct + '%', minWidth: 0, padding: 0, borderRadius: '0 12px 12px 0' }}></div>
                                        </div>
                                    </td>
                                    <td className="vault-text-bold">{r.ratio}%</td>
                                    <td>{r.boardCount}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </div>
    );
}
