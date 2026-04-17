// Insights — Release Sentiment chart.
// One line per team across releases (X-axis Z→A, newest left), Y-axis 0–100%
// where sentiment = sum(votes for went_well) / sum(votes for went_well + to_improve).
// If a (release, team) bucket has zero votes, falls back to item-count ratio so
// the chart isn't blank for unvoted boards.
import React, { useEffect, useState, useMemo } from 'react';
import { fetchAllFeedback, fetchFeedbackForBoard, fetchBoards, fetchTeams, userName } from '../api/vault';
import Spinner, { EmptyState } from '../components/Spinner';
import { ThemeBadge } from '../components/Badge';

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
    const [hiddenTeams, setHiddenTeams] = useState(() => new Set());
    const [drillDown, setDrillDown] = useState(null);  // { boardId, boardName, teamName, teamColor, release }
    const [drillFeedback, setDrillFeedback] = useState(null);

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

    function toggleTeam(teamId) {
        setHiddenTeams(prev => {
            const next = new Set(prev);
            if (next.has(teamId)) next.delete(teamId);
            else next.add(teamId);
            return next;
        });
        // Hovering a now-hidden team's marker would leave a stale tooltip
        setHover(null);
    }

    function isolateTeam(teamId) {
        if (!chart) return;
        const others = chart.teamMeta.map(t => t.id).filter(id => id !== teamId);
        const allOthersHidden = others.every(id => hiddenTeams.has(id));
        // Already isolated → restore all
        setHiddenTeams(allOthersHidden && !hiddenTeams.has(teamId) ? new Set() : new Set(others));
        setHover(null);
    }

    function showAll() {
        setHiddenTeams(new Set());
    }

    async function handleDrillDown(point, teamName, teamColor) {
        if (!point || !point.boardId) return;
        setDrillDown({ boardId: point.boardId, boardName: point.boardName || point.release, teamName, teamColor, release: point.release });
        setDrillFeedback(null);
        try {
            const items = await fetchFeedbackForBoard(point.boardId);
            setDrillFeedback(items);
        } catch (err) {
            showToast && showToast('Failed to load board feedback: ' + err.message, 'error');
            setDrillFeedback([]);
        }
    }

    function closeDrillDown() {
        setDrillDown(null);
        setDrillFeedback(null);
    }

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

    const visibleSeries = chart.series.filter(s => !hiddenTeams.has(s.teamId));

    return (
        <>
            <Header />
            <div className="vault-card vault-mb-24">
                <div className="vault-card__header">
                    <span className="vault-card__title">Release Sentiment</span>
                </div>
                <div className="vault-card__body">
                    <p className="vault-text-small vault-text-muted vault-mb-16">
                        For each release × team, sentiment = vote-weighted Went Well share of the total Went Well + To Improve. Higher means a happier retro. Click a team to hide it; double-click to isolate.
                    </p>
                    <Legend
                        teams={chart.teamMeta}
                        hiddenTeams={hiddenTeams}
                        onToggle={toggleTeam}
                        onIsolate={isolateTeam}
                        onShowAll={showAll}
                    />
                    <SentimentChart chart={{ ...chart, series: visibleSeries }} hover={hover} setHover={setHover} onSelect={handleDrillDown} />
                </div>
            </div>

            {drillDown && (
                <DrillDownPanel
                    drillDown={drillDown}
                    feedback={drillFeedback}
                    onClose={closeDrillDown}
                />
            )}
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
        if (!buckets.has(key)) buckets.set(key, { wwVotes: 0, totalVotes: 0, wwCount: 0, totalCount: 0, boardId: board.id, boardName: board.name__v });
        const b = buckets.get(key);
        b.totalVotes += weight;
        b.totalCount += 1;
        b.boardId = board.id;
        b.boardName = board.name__v;
        if (cat === 'went_well__c') {
            b.wwVotes += weight;
            b.wwCount += 1;
        }
    }

    if (buckets.size === 0) return null;

    // Releases sorted A→Z (ascending alphabetical = oldest first for the YYRX.X scheme,
    // i.e. standard left-to-right timeline orientation)
    const releases = [...new Set([...buckets.keys()].map(k => k.split('|')[0]))].sort();
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
                tiVotes: b.totalVotes - b.wwVotes,
                wwCount: b.wwCount,
                totalCount: b.totalCount,
                boardId: b.boardId,
                boardName: b.boardName,
            });
        });
        return { teamId: t.id, teamName: t.name, color: t.color, points };
    });

    return { releases, teamMeta, series };
}

/* ---------- Render ---------- */

function Legend({ teams, hiddenTeams, onToggle, onIsolate, onShowAll }) {
    const anyHidden = hiddenTeams && hiddenTeams.size > 0;
    return (
        <div className="vault-chart-legend">
            {teams.map(t => {
                const hidden = hiddenTeams && hiddenTeams.has(t.id);
                return (
                    <button
                        key={t.id}
                        type="button"
                        className={'vault-chart-legend__item vault-chart-legend__item--clickable' + (hidden ? ' vault-chart-legend__item--hidden' : '')}
                        onClick={() => onToggle(t.id)}
                        onDoubleClick={() => onIsolate(t.id)}
                        title={hidden ? `Show ${t.name}` : `Hide ${t.name} (double-click to isolate)`}
                    >
                        <span className="vault-chart-legend__swatch" style={{ background: hidden ? 'var(--vault-gray-300)' : t.color }} />
                        {t.name}
                    </button>
                );
            })}
            {anyHidden && (
                <button
                    type="button"
                    className="vault-chart-legend__reset"
                    onClick={onShowAll}
                >
                    Show all
                </button>
            )}
        </div>
    );
}

function SentimentChart({ chart, hover, setHover, onSelect }) {
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
                {/* Sentiment zones — subtle green above 75%, subtle red below 25% (aligned to Y-axis ticks) */}
                <rect
                    x={PADDING.left}
                    y={PADDING.top}
                    width={plotW}
                    height={yAt(75) - PADDING.top}
                    className="vault-chart__zone vault-chart__zone--positive"
                />
                <rect
                    x={PADDING.left}
                    y={yAt(25)}
                    width={plotW}
                    height={yAt(0) - yAt(25)}
                    className="vault-chart__zone vault-chart__zone--negative"
                />

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
                                    {/* Larger transparent hit area — click to drill down */}
                                    <circle
                                        cx={cx} cy={cy} r="14"
                                        fill="transparent"
                                        style={{ cursor: 'pointer' }}
                                        onMouseEnter={() => setHover({ teamId: s.teamId, teamName: s.teamName, color: s.color, ...p })}
                                        onClick={() => onSelect && onSelect(p, s.teamName, s.color)}
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
    const W = 200, H = 60;
    const onRight = x + W + 12 > chartW;
    const tx = onRight ? x - W - 12 : x + 12;
    const ty = Math.max(8, y - H / 2);

    return (
        <g className="vault-chart__tooltip" pointerEvents="none">
            <rect x={tx} y={ty} width={W} height={H} rx="4" className="vault-chart__tooltip-bg" />
            <text x={tx + 12} y={ty + 18} className="vault-chart__tooltip-title">
                <tspan fill={hover.color}>● </tspan>{hover.teamName}
            </text>
            <text x={tx + 12} y={ty + 36} className="vault-chart__tooltip-meta">
                {hover.release} — <tspan className="vault-chart__tooltip-value">{hover.sentiment}%</tspan>
            </text>
            <text x={tx + 12} y={ty + 52} className="vault-chart__tooltip-meta">
                <tspan fill="var(--vault-success)">▲{hover.wwVotes || 0}</tspan>
                {'  '}
                <tspan fill="var(--vault-danger)">▼{hover.tiVotes || 0}</tspan>
                {'  '}· click to drill down
            </text>
        </g>
    );
}

/* ---------- Drill-down panel ---------- */

function DrillDownPanel({ drillDown, feedback, onClose }) {
    const { boardName, teamName, teamColor, release } = drillDown;

    const wentWell = (feedback || []).filter(fi => fi.category__c === 'went_well__c')
        .sort((a, b) => (Number(b.vote_count__c) || 0) - (Number(a.vote_count__c) || 0));
    const toImprove = (feedback || []).filter(fi => fi.category__c === 'didnt_go_well__c')
        .sort((a, b) => (Number(b.vote_count__c) || 0) - (Number(a.vote_count__c) || 0));

    return (
        <div className="vault-card vault-mb-24 vault-drilldown">
            <div className="vault-card__header">
                <span className="vault-card__title">
                    <span className="vault-chart-legend__swatch" style={{ background: teamColor }} />
                    {' '}{teamName} — {release}
                </span>
                <button className="vault-action-btn" onClick={onClose} title="Close">×</button>
            </div>
            <div className="vault-card__body">
                {!feedback ? (
                    <Spinner />
                ) : wentWell.length === 0 && toImprove.length === 0 ? (
                    <EmptyState message="No Went Well / To Improve items on this board." />
                ) : (
                    <div className="vault-drilldown__columns">
                        <DrillColumn title="Went Well" items={wentWell} accentClass="vault-drilldown__col--positive" />
                        <DrillColumn title="To Improve" items={toImprove} accentClass="vault-drilldown__col--negative" />
                    </div>
                )}
            </div>
        </div>
    );
}

function DrillColumn({ title, items, accentClass }) {
    return (
        <div className={'vault-drilldown__col ' + (accentClass || '')}>
            <div className="vault-drilldown__col-header">{title} ({items.length})</div>
            {items.map(fi => (
                <div key={fi.id} className="vault-drilldown__item">
                    <div className="vault-drilldown__item-content">{fi.content__c}</div>
                    <div className="vault-drilldown__item-meta">
                        <span>{userName(fi, 'author')}</span>
                        {fi.theme__c && <ThemeBadge theme={fi.theme__c} />}
                        {fi.feature__c && <span className="vault-feedback-card__feature">{fi.feature__c}</span>}
                        <span className="vault-drilldown__item-votes">▲ {Number(fi.vote_count__c) || 0}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}
