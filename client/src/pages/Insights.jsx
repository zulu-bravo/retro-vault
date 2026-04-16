// Insights — Release Sentiment chart.
// One line per team across releases (X-axis Z→A, newest left), Y-axis 0–100%
// where sentiment = sum(votes for went_well) / sum(votes for went_well + to_improve).
// If a (release, team) bucket has zero votes, falls back to item-count ratio so
// the chart isn't blank for unvoted boards.
import React, { useEffect, useState, useMemo } from 'react';
import { fetchAllFeedback, fetchBoards, fetchTeams } from '../api/vault';
import Spinner, { EmptyState } from '../components/Spinner';

// Up to 6 distinct team colors. Cycles if more teams.
const TEAM_PALETTE = [
    'var(--vault-success)',
    'var(--vault-primary)',
    'var(--vault-orange-darkest)',
    'var(--vault-danger)',
    'var(--vault-gold-default)',
    'var(--vault-text-secondary)',
];

export default function Insights({ showToast }) {
    const [loading, setLoading] = useState(true);
    const [feedback, setFeedback] = useState([]);
    const [boards, setBoards] = useState([]);
    const [teams, setTeams] = useState([]);
    const [hover, setHover] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                const [f, b, t] = await Promise.all([fetchAllFeedback(), fetchBoards(), fetchTeams()]);
                setFeedback(f);
                setBoards(b);
                setTeams(t);
            } catch (err) {
                showToast && showToast('Failed to load insights: ' + err.message, 'error');
                console.error(err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const chart = useMemo(() => buildChart(feedback, boards, teams), [feedback, boards, teams]);

    if (loading) return <Spinner />;
    if (!chart || chart.releases.length === 0) {
        return (
            <>
                <Header />
                <div className="vault-card vault-mb-24">
                    <div className="vault-card__body">
                        <EmptyState message="No release sentiment yet — add some Went Well / To Improve feedback to a board with a Release Tag." />
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            <Header />
            <div className="vault-card vault-mb-24">
                <div className="vault-card__header">
                    <span className="vault-card__title">Release Sentiment</span>
                </div>
                <div className="vault-card__body">
                    <p className="vault-text-small vault-text-muted vault-mb-16">
                        For each release × team, sentiment = vote-weighted Went Well share of the total Went Well + To Improve. Higher means a happier retro.
                    </p>
                    <Legend teams={chart.teamMeta} />
                    <SentimentChart chart={chart} hover={hover} setHover={setHover} />
                    <SentimentTable chart={chart} />
                </div>
            </div>
        </>
    );
}

function Header() {
    return (
        <div className="vault-page-header">
            <div>
                <h1 className="vault-page-header__title">Insights</h1>
                <p className="vault-page-header__subtitle">Cross-release retrospective signals</p>
            </div>
        </div>
    );
}

/* ---------- Compute ---------- */

function buildChart(feedback, boards, teams) {
    if (!feedback.length || !boards.length) return null;

    const boardById = new Map(boards.map(b => [b.id, b]));
    const teamNameById = new Map(teams.map(t => [t.id, t.name__v]));

    // bucket key = `${release}|${teamId}`
    const buckets = new Map();
    for (const fi of feedback) {
        const board = boardById.get(fi.retro_board__c);
        if (!board || !board.release_tag__c || !board.team__c) continue;
        const cat = fi.category__c;
        if (cat !== 'went_well__c' && cat !== 'didnt_go_well__c') continue;
        const weight = Number(fi.vote_count__c) || 0;
        const key = `${board.release_tag__c}|${board.team__c}`;
        if (!buckets.has(key)) buckets.set(key, { wwVotes: 0, totalVotes: 0, wwCount: 0, totalCount: 0 });
        const b = buckets.get(key);
        b.totalVotes += weight;
        b.totalCount += 1;
        if (cat === 'went_well__c') {
            b.wwVotes += weight;
            b.wwCount += 1;
        }
    }

    if (buckets.size === 0) return null;

    // Releases sorted Z→A (descending alphabetical = newest first for the YYRX.X scheme)
    const releases = [...new Set([...buckets.keys()].map(k => k.split('|')[0]))].sort().reverse();
    // Team IDs that have at least one data point
    const teamIds = [...new Set([...buckets.keys()].map(k => k.split('|')[1]))];

    // Stable team order: by name asc
    teamIds.sort((a, b) => (teamNameById.get(a) || a).localeCompare(teamNameById.get(b) || b));

    const teamMeta = teamIds.map((id, i) => ({
        id,
        name: teamNameById.get(id) || id,
        color: TEAM_PALETTE[i % TEAM_PALETTE.length],
    }));

    // Series: for each team, a list of points {release, x: index, sentiment, ...}
    const series = teamMeta.map(t => {
        const points = [];
        releases.forEach((rel, x) => {
            const b = buckets.get(`${rel}|${t.id}`);
            if (!b || (b.totalCount === 0)) {
                points.push({ release: rel, x, sentiment: null });
                return;
            }
            // Vote-weighted; fall back to item-count if no votes recorded
            const sentiment = b.totalVotes > 0
                ? Math.round((b.wwVotes / b.totalVotes) * 100)
                : Math.round((b.wwCount / b.totalCount) * 100);
            points.push({
                release: rel,
                x,
                sentiment,
                wwVotes: b.wwVotes,
                totalVotes: b.totalVotes,
                wwCount: b.wwCount,
                totalCount: b.totalCount,
            });
        });
        return { teamId: t.id, teamName: t.name, color: t.color, points };
    });

    return { releases, teamMeta, series };
}

/* ---------- Render ---------- */

function Legend({ teams }) {
    return (
        <div className="vault-chart-legend">
            {teams.map(t => (
                <span key={t.id} className="vault-chart-legend__item">
                    <span className="vault-chart-legend__swatch" style={{ background: t.color }} />
                    {t.name}
                </span>
            ))}
        </div>
    );
}

function SentimentChart({ chart, hover, setHover }) {
    const { releases, series } = chart;
    // Use a fixed viewBox; CSS scales it to container width
    const W = 800, H = 320;
    const PADDING = { top: 16, right: 24, bottom: 48, left: 44 };
    const plotW = W - PADDING.left - PADDING.right;
    const plotH = H - PADDING.top - PADDING.bottom;

    // X positions: equally spaced, with half-step margin on each side
    const n = releases.length;
    const stepX = n > 1 ? plotW / (n - 1) : 0;
    const xAt = i => PADDING.left + (n > 1 ? i * stepX : plotW / 2);

    // Y: 0 at bottom, 100 at top
    const yAt = pct => PADDING.top + plotH * (1 - pct / 100);

    const yTicks = [0, 25, 50, 75, 100];

    return (
        <div className="vault-chart" onMouseLeave={() => setHover(null)}>
            <svg className="vault-chart__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Release sentiment by team">
                {/* Y gridlines */}
                {yTicks.map(t => (
                    <g key={t}>
                        <line
                            x1={PADDING.left} x2={W - PADDING.right}
                            y1={yAt(t)} y2={yAt(t)}
                            className="vault-chart__gridline"
                        />
                        <text
                            x={PADDING.left - 8} y={yAt(t)}
                            className="vault-chart__y-label"
                            textAnchor="end" dominantBaseline="middle"
                        >
                            {t}%
                        </text>
                    </g>
                ))}

                {/* X labels */}
                {releases.map((rel, i) => (
                    <text
                        key={rel}
                        x={xAt(i)} y={H - PADDING.bottom + 18}
                        className="vault-chart__x-label"
                        textAnchor="middle"
                    >
                        {rel}
                    </text>
                ))}

                {/* X axis baseline */}
                <line
                    x1={PADDING.left} x2={W - PADDING.right}
                    y1={yAt(0)} y2={yAt(0)}
                    className="vault-chart__axis"
                />

                {/* Series lines */}
                {series.map(s => {
                    const segments = buildSegments(s.points);
                    return (
                        <g key={s.teamId}>
                            {segments.map((seg, idx) => (
                                <polyline
                                    key={idx}
                                    points={seg.map(p => `${xAt(p.x)},${yAt(p.sentiment)}`).join(' ')}
                                    fill="none"
                                    stroke={s.color}
                                    strokeWidth="2"
                                    strokeLinejoin="round"
                                    strokeLinecap="round"
                                />
                            ))}
                        </g>
                    );
                })}

                {/* Markers + hover hit-areas (render on top of lines) */}
                {series.map(s => (
                    <g key={s.teamId + '-markers'}>
                        {s.points.filter(p => p.sentiment !== null).map(p => {
                            const cx = xAt(p.x), cy = yAt(p.sentiment);
                            const isHover = hover && hover.teamId === s.teamId && hover.release === p.release;
                            return (
                                <g key={p.release}>
                                    <circle
                                        cx={cx} cy={cy}
                                        r={isHover ? 6 : 4}
                                        fill="white" stroke={s.color} strokeWidth="2"
                                    />
                                    {/* Larger transparent hit area */}
                                    <circle
                                        cx={cx} cy={cy} r="14"
                                        fill="transparent"
                                        onMouseEnter={() => setHover({ teamId: s.teamId, teamName: s.teamName, color: s.color, ...p })}
                                    />
                                </g>
                            );
                        })}
                    </g>
                ))}

                {/* Tooltip */}
                {hover && hover.sentiment !== null && (
                    <Tooltip x={xAt(hover.x)} y={yAt(hover.sentiment)} hover={hover} chartW={W} />
                )}
            </svg>
        </div>
    );
}

// Split a series into contiguous non-null segments so we don't draw lines
// across "no data" gaps.
function buildSegments(points) {
    const segs = [];
    let cur = [];
    for (const p of points) {
        if (p.sentiment === null) {
            if (cur.length > 1) segs.push(cur);
            cur = [];
        } else {
            cur.push(p);
        }
    }
    if (cur.length > 1) segs.push(cur);
    return segs;
}

function Tooltip({ x, y, hover, chartW }) {
    const W = 200, H = 78;
    // Flip horizontally if tooltip would overflow the right side
    const onRight = x + W + 12 > chartW;
    const tx = onRight ? x - W - 12 : x + 12;
    const ty = Math.max(8, y - H / 2);
    const voted = hover.totalVotes > 0;

    return (
        <g className="vault-chart__tooltip" pointerEvents="none">
            <rect x={tx} y={ty} width={W} height={H} rx="4" className="vault-chart__tooltip-bg" />
            <text x={tx + 12} y={ty + 18} className="vault-chart__tooltip-title">
                <tspan fill={hover.color}>● </tspan>{hover.teamName}
            </text>
            <text x={tx + 12} y={ty + 36} className="vault-chart__tooltip-meta">
                {hover.release} — <tspan className="vault-chart__tooltip-value">{hover.sentiment}%</tspan>
            </text>
            <text x={tx + 12} y={ty + 54} className="vault-chart__tooltip-meta">
                {voted
                    ? `${hover.wwVotes} of ${hover.totalVotes} votes positive`
                    : `${hover.wwCount} of ${hover.totalCount} items positive`}
            </text>
            <text x={tx + 12} y={ty + 70} className="vault-chart__tooltip-meta">
                {hover.totalCount} feedback item{hover.totalCount === 1 ? '' : 's'}{voted ? '' : ' (no votes)'}
            </text>
        </g>
    );
}

function SentimentTable({ chart }) {
    const { releases, series } = chart;
    return (
        <table className="vault-table vault-mt-24">
            <thead>
                <tr>
                    <th>Team</th>
                    {releases.map(r => <th key={r}>{r}</th>)}
                </tr>
            </thead>
            <tbody>
                {series.map(s => (
                    <tr key={s.teamId}>
                        <td className="vault-text-bold">
                            <span className="vault-chart-legend__swatch" style={{ background: s.color }} /> {s.teamName}
                        </td>
                        {s.points.map(p => (
                            <td key={p.release}>{p.sentiment === null ? '—' : `${p.sentiment}%`}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
