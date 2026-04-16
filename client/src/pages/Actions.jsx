import React, { useEffect, useState } from 'react';
import { fetchTeams, fetchBoards, fetchAllActions } from '../api/vault';
import Spinner, { EmptyState } from '../components/Spinner';
import Modal from '../components/Modal';
import { toISODate, formatDateMonthDay } from '../utils/format';

export default function Actions({ showToast }) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [drilldown, setDrilldown] = useState(null); // { assigneeName, items }

    useEffect(() => {
        (async () => {
            try {
                const [teams, boards, actions] = await Promise.all([
                    fetchTeams(),
                    fetchBoards(),
                    fetchAllActions()
                ]);
                setData(computeAll(teams, boards, actions));
            } catch (err) {
                showToast('Failed to load actions: ' + err.message, 'error');
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
                    <h1 className="vault-page-header__title">Actions</h1>
                    <p className="vault-page-header__subtitle">
                        Per-team overdue actions and completion rate
                    </p>
                </div>
            </div>

            {data.teams.length === 0 ? (
                <EmptyState message="No teams found." />
            ) : (
                data.teams.map(team => (
                    <TeamSection
                        key={team.id}
                        team={team}
                        overdue={data.overdueByTeam[team.id] || []}
                        completion={data.completionByTeam[team.id] || []}
                        onOverdueRowClick={(row) => setDrilldown({
                            assigneeName: row.assigneeName,
                            items: row.items
                        })}
                    />
                ))
            )}

            {drilldown && (
                <Modal
                    title={`Overdue — ${drilldown.assigneeName}`}
                    confirmLabel="Close"
                    onClose={() => setDrilldown(null)}
                    onConfirm={() => setDrilldown(null)}
                >
                    <table className="vault-table">
                        <thead>
                            <tr>
                                <th>Title</th>
                                <th>Board</th>
                                <th>Due Date</th>
                                <th>Days Overdue</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {drilldown.items.map(item => (
                                <tr key={item.id}>
                                    <td className="vault-text-bold">{item.title}</td>
                                    <td>{item.boardName}</td>
                                    <td>{formatDateMonthDay(item.dueDate)}</td>
                                    <td>{item.daysOverdue}</td>
                                    <td>
                                        <button
                                            className="vault-btn vault-btn--secondary vault-btn--small"
                                            onClick={async () => {
                                                try {
                                                    await navigator.clipboard.writeText(formatItemForClipboard(item));
                                                    showToast('Copied to clipboard', 'success');
                                                } catch (err) {
                                                    showToast('Copy failed: ' + err.message, 'error');
                                                }
                                            }}
                                            title="Copy details to clipboard"
                                        >
                                            Copy
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Modal>
            )}
        </>
    );
}

function TeamSection({ team, overdue, completion, onOverdueRowClick }) {
    return (
        <div className="vault-section">
            <h2 className="vault-section__title">{team.name__v}</h2>
            <div className="vault-grid vault-grid--2">
                <OverduePanel rows={overdue} onRowClick={onOverdueRowClick} />
                <CompletionRatePanel rows={completion} />
            </div>
        </div>
    );
}

function OverduePanel({ rows, onRowClick }) {
    return (
        <div className="vault-card">
            <div className="vault-card__header">
                <span className="vault-card__title">Overdue Open Actions</span>
            </div>
            <div className="vault-card__body">
                {rows.length === 0 ? (
                    <EmptyState message="No overdue actions." />
                ) : (
                    <table className="vault-table">
                        <thead>
                            <tr><th>Assignee</th><th>Overdue Items</th></tr>
                        </thead>
                        <tbody>
                            {rows.map(row => (
                                <tr
                                    key={row.assigneeId}
                                    onClick={() => onRowClick(row)}
                                    className="vault-table__row--clickable"
                                    title="Click to see overdue items"
                                >
                                    <td className="vault-text-bold">{row.assigneeName}</td>
                                    <td>{row.count}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

function CompletionRatePanel({ rows }) {
    const maxTotal = rows.reduce((m, r) => Math.max(m, r.total), 0);

    return (
        <div className="vault-card">
            <div className="vault-card__header">
                <span className="vault-card__title">Completion Rate</span>
            </div>
            <div className="vault-card__body">
                {rows.length === 0 ? (
                    <EmptyState message="No completed action items yet." />
                ) : (
                    <>
                        <div className="vault-chart-legend">
                            <span className="vault-chart-legend__item">
                                <span className="vault-chart-swatch vault-chart-swatch--green" />
                                Completed on-time
                            </span>
                            <span className="vault-chart-legend__item">
                                <span className="vault-chart-swatch vault-chart-swatch--red" />
                                Completed late
                            </span>
                        </div>
                        <div className="vault-bar-chart">
                            {rows.map(r => {
                                const onTimePct = maxTotal > 0 ? (r.onTime / maxTotal) * 100 : 0;
                                const overduePct = maxTotal > 0 ? (r.overdue / maxTotal) * 100 : 0;
                                const hasBoth = r.onTime > 0 && r.overdue > 0;
                                return (
                                    <div className="vault-bar-row" key={r.userId}>
                                        <span className="vault-bar-label">{r.userName}</span>
                                        <div className="vault-bar-track" style={{ display: 'flex' }}>
                                            {r.onTime > 0 && (
                                                <div
                                                    className="vault-bar-fill vault-bar-fill--green"
                                                    style={{
                                                        width: onTimePct + '%',
                                                        minWidth: 0,
                                                        padding: 0,
                                                        borderRadius: hasBoth ? '12px 0 0 12px' : ''
                                                    }}
                                                    title={`${r.onTime} completed on-time`}
                                                />
                                            )}
                                            {r.overdue > 0 && (
                                                <div
                                                    className="vault-bar-fill vault-bar-fill--red"
                                                    style={{
                                                        width: overduePct + '%',
                                                        minWidth: 0,
                                                        padding: 0,
                                                        borderRadius: hasBoth ? '0 12px 12px 0' : ''
                                                    }}
                                                    title={`${r.overdue} completed late`}
                                                />
                                            )}
                                        </div>
                                        <span className="vault-bar-value">
                                            {r.onTime} / {r.overdue}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function formatItemForClipboard(item) {
    return [
        item.title,
        `Board: ${item.boardName}`,
        `Due Date: ${item.dueDate}`,
        `Days Overdue: ${item.daysOverdue}`
    ].join('\n');
}

/* ---------- Compute helpers ---------- */

function computeAll(teams, boards, actions) {
    const boardTeam = {};
    const boardName = {};
    boards.forEach(b => {
        boardTeam[b.id] = b.team__c;
        boardName[b.id] = b.name__v;
    });

    const todayYmd = toISODate(new Date());
    const todayMs = new Date(todayYmd + 'T00:00:00').getTime();
    const MS_PER_DAY = 86400000;

    // Overdue (not-done + past due) grouped by assignee per team
    const overdueMap = {};
    // Completion rate (done actions, on-time vs overdue) grouped by assignee per team
    const completionMap = {};

    actions.forEach(a => {
        const teamId = boardTeam[a.retro_board__c];
        if (!teamId) return;
        const userId = a.assignee__c || '__unassigned__';
        const userName = a['assignee__cr.name__v'] || 'Unassigned';
        const dueYmd = a.due_date__c ? String(a.due_date__c).slice(0, 10) : '';

        if (a.status__c === 'done__c') {
            if (!a.completed_at__c) return;
            const completedYmd = String(a.completed_at__c).slice(0, 10);
            const wasOverdue = dueYmd && completedYmd > dueYmd;
            if (!completionMap[teamId]) completionMap[teamId] = {};
            if (!completionMap[teamId][userId]) {
                completionMap[teamId][userId] = { userId, userName, onTime: 0, overdue: 0 };
            }
            if (wasOverdue) completionMap[teamId][userId].overdue++;
            else completionMap[teamId][userId].onTime++;
        } else {
            if (!dueYmd || dueYmd >= todayYmd) return;
            const dueMs = new Date(dueYmd + 'T00:00:00').getTime();
            const daysOverdue = Math.round((todayMs - dueMs) / MS_PER_DAY);
            if (!overdueMap[teamId]) overdueMap[teamId] = {};
            if (!overdueMap[teamId][userId]) {
                overdueMap[teamId][userId] = { assigneeId: userId, assigneeName: userName, items: [] };
            }
            overdueMap[teamId][userId].items.push({
                id: a.id,
                title: a.name__v,
                boardId: a.retro_board__c,
                boardName: boardName[a.retro_board__c] || 'Unknown board',
                dueDate: dueYmd,
                daysOverdue
            });
        }
    });

    const overdueByTeam = {};
    Object.entries(overdueMap).forEach(([teamId, byUser]) => {
        overdueByTeam[teamId] = Object.values(byUser)
            .map(r => ({
                ...r,
                count: r.items.length,
                // Most-overdue first inside the drill-down
                items: r.items.slice().sort((a, b) => b.daysOverdue - a.daysOverdue)
            }))
            .sort((a, b) => b.count - a.count);
    });

    const completionByTeam = {};
    Object.entries(completionMap).forEach(([teamId, byUser]) => {
        completionByTeam[teamId] = Object.values(byUser)
            .map(r => ({ ...r, total: r.onTime + r.overdue }))
            .sort((a, b) => b.total - a.total);
    });

    return { teams, overdueByTeam, completionByTeam };
}
