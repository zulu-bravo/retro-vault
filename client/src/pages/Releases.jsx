// Releases — Release Sentiment chart + release management.
// One line per team across releases, Y-axis 0–100% sentiment
// (sum of votes on went_well / sum of votes on went_well + to_improve).
// Below the chart: a list of releases with inline-editable features.
import React, { useEffect, useState, useMemo } from 'react';
import {
    fetchAllFeedback, fetchFeedbackForBoard, fetchBoards, fetchTeams,
    fetchReleases, fetchFeatures, createFeature, deleteFeature, userName,
} from '../api/vault';
import Spinner, { EmptyState } from '../components/Spinner';
import { ThemeBadge } from '../components/Badge';

const TEAM_PALETTE = [
    'var(--vault-success)',
    'var(--vault-primary)',
    'var(--vault-orange-darkest)',
    'var(--vault-danger)',
    'var(--vault-gold-default)',
    'var(--vault-text-secondary)',
];

export default function Releases({ showToast }) {
    const [loading, setLoading] = useState(true);
    const [feedback, setFeedback] = useState([]);
    const [boards, setBoards] = useState([]);
    const [teams, setTeams] = useState([]);
    const [releases, setReleases] = useState([]);
    const [features, setFeatures] = useState([]);
    const [hover, setHover] = useState(null);
    const [hiddenTeams, setHiddenTeams] = useState(() => new Set());
    const [drillDown, setDrillDown] = useState(null);
    const [drillFeedback, setDrillFeedback] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                const [f, b, t, r, ft] = await Promise.all([
                    fetchAllFeedback(), fetchBoards(), fetchTeams(), fetchReleases(), fetchFeatures(),
                ]);
                setFeedback(f);
                setBoards(b);
                setTeams(t);
                setReleases(r);
                setFeatures(ft);
            } catch (err) {
                showToast && showToast('Failed to load releases: ' + err.message, 'error');
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
        setHover(null);
    }

    function isolateTeam(teamId) {
        if (!chart) return;
        const others = chart.teamMeta.map(t => t.id).filter(id => id !== teamId);
        const allOthersHidden = others.every(id => hiddenTeams.has(id));
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

    async function handleAddFeature(releaseId, name) {
        const trimmed = name.trim();
        if (!trimmed) return;
        const dupes = features.some(f => f.release__c === releaseId && (f.display_name__c || f.name__v).toLowerCase() === trimmed.toLowerCase());
        if (dupes) {
            showToast && showToast(`"${trimmed}" already exists on this release`, 'info');
            return;
        }
        try {
            const release = releases.find(r => r.id === releaseId);
            const id = await createFeature(trimmed, releaseId, release ? release.name__v : '');
            setFeatures(prev => [...prev, {
                id,
                name__v: `${release ? release.name__v : releaseId} . ${trimmed}`,
                display_name__c: trimmed,
                release__c: releaseId,
                'release__cr.name__v': release ? release.name__v : '',
            }]);
            showToast && showToast('Feature added', 'success');
        } catch (err) {
            showToast && showToast('Failed to add feature: ' + err.message, 'error');
        }
    }

    async function handleDeleteFeature(featureId) {
        try {
            await deleteFeature(featureId);
            setFeatures(prev => prev.filter(f => f.id !== featureId));
        } catch (err) {
            showToast && showToast('Failed to remove feature: ' + err.message, 'error');
        }
    }

    if (loading) return <Spinner />;

    const visibleSeries = chart ? chart.series.filter(s => !hiddenTeams.has(s.teamId)) : [];

    return (
        <>
            <Header />

            <div className="vault-card vault-mb-24">
                <div className="vault-card__header">
                    <span className="vault-card__title">Release Sentiment</span>
                </div>
                <div className="vault-card__body">
                    {!chart || chart.releases.length === 0 ? (
                        <EmptyState message="No release sentiment yet — add some Went Well / To Improve feedback to a board linked to a release." />
                    ) : (
                        <>
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
                        </>
                    )}
                </div>
            </div>

            <ReleaseListPanel
                releases={releases}
                boards={boards}
                features={features}
                onAddFeature={handleAddFeature}
                onDeleteFeature={handleDeleteFeature}
            />

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
                <h1 className="vault-page-header__title">Releases</h1>
                <p className="vault-page-header__subtitle">Cross-team signals and feature lists by release</p>
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
        if (!board) continue;
        const releaseName = board['release__cr.name__v'];
        if (!releaseName || !board.team__c) continue;
        const cat = fi.category__c;
        if (cat !== 'went_well__c' && cat !== 'didnt_go_well__c') continue;
        const weight = Number(fi.vote_count__c) || 0;
        const key = `${releaseName}|${board.team__c}`;
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

    const releases = [...new Set([...buckets.keys()].map(k => k.split('|')[0]))].sort();
    const teamIds = [...new Set([...buckets.keys()].map(k => k.split('|')[1]))];
    teamIds.sort((a, b) => (teamNameById.get(a) || a).localeCompare(teamNameById.get(b) || b));

    const teamMeta = teamIds.map((id, i) => ({
        id,
        name: teamNameById.get(id) || id,
        color: TEAM_PALETTE[i % TEAM_PALETTE.length],
    }));

    const series = teamMeta.map(t => {
        const points = [];
        releases.forEach((rel, x) => {
            const b = buckets.get(`${rel}|${t.id}`);
            if (!b || (b.totalCount === 0)) {
                points.push({ release: rel, x, sentiment: null });
                return;
            }
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
                <button type="button" className="vault-chart-legend__reset" onClick={onShowAll}>
                    Show all
                </button>
            )}
        </div>
    );
}

function SentimentChart({ chart, hover, setHover, onSelect }) {
    const { releases, series } = chart;
    const W = 800, H = 320;
    const PADDING = { top: 16, right: 24, bottom: 48, left: 44 };
    const plotW = W - PADDING.left - PADDING.right;
    const plotH = H - PADDING.top - PADDING.bottom;

    const n = releases.length;
    const stepX = n > 1 ? plotW / (n - 1) : 0;
    const xAt = i => PADDING.left + (n > 1 ? i * stepX : plotW / 2);
    const yAt = pct => PADDING.top + plotH * (1 - pct / 100);

    const yTicks = [0, 25, 50, 75, 100];

    return (
        <div className="vault-chart" onMouseLeave={() => setHover(null)}>
            <svg className="vault-chart__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Release sentiment by team">
                <rect x={PADDING.left} y={PADDING.top} width={plotW} height={yAt(75) - PADDING.top} className="vault-chart__zone vault-chart__zone--positive" />
                <rect x={PADDING.left} y={yAt(25)} width={plotW} height={yAt(0) - yAt(25)} className="vault-chart__zone vault-chart__zone--negative" />

                {yTicks.map(t => (
                    <g key={t}>
                        <line x1={PADDING.left} x2={W - PADDING.right} y1={yAt(t)} y2={yAt(t)} className="vault-chart__gridline" />
                        <text x={PADDING.left - 8} y={yAt(t)} className="vault-chart__y-label" textAnchor="end" dominantBaseline="middle">
                            {t}%
                        </text>
                    </g>
                ))}

                {releases.map((rel, i) => (
                    <text key={rel} x={xAt(i)} y={H - PADDING.bottom + 18} className="vault-chart__x-label" textAnchor="middle">
                        {rel}
                    </text>
                ))}

                <line x1={PADDING.left} x2={W - PADDING.right} y1={yAt(0)} y2={yAt(0)} className="vault-chart__axis" />

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

                {series.map(s => (
                    <g key={s.teamId + '-markers'}>
                        {s.points.filter(p => p.sentiment !== null).map(p => {
                            const cx = xAt(p.x), cy = yAt(p.sentiment);
                            const isHover = hover && hover.teamId === s.teamId && hover.release === p.release;
                            return (
                                <g key={p.release}>
                                    <circle cx={cx} cy={cy} r={isHover ? 6 : 4} fill="white" stroke={s.color} strokeWidth="2" />
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

                {hover && hover.sentiment !== null && (
                    <Tooltip x={xAt(hover.x)} y={yAt(hover.sentiment)} hover={hover} chartW={W} />
                )}
            </svg>
        </div>
    );
}

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
    const W = 220, H = 72;
    const onRight = x + W + 12 > chartW;
    const tx = onRight ? x - W - 12 : x + 12;
    const ty = Math.max(8, y - H / 2);

    return (
        <g className="vault-chart__tooltip" pointerEvents="none">
            <rect x={tx} y={ty} width={W} height={H} rx="4" className="vault-chart__tooltip-bg" />
            <text x={tx + 12} y={ty + 18} className="vault-chart__tooltip-title">
                {hover.boardName || hover.release}
            </text>
            <text x={tx + 12} y={ty + 33} className="vault-chart__tooltip-meta">
                <tspan fill={hover.color}>● </tspan>{hover.teamName} · {hover.release}
            </text>
            <text x={tx + 12} y={ty + 48} className="vault-chart__tooltip-meta">
                <tspan className="vault-chart__tooltip-value">{hover.sentiment}%</tspan>
                {'  '}
                <tspan fill="var(--vault-success)">▲{hover.wwVotes || 0}</tspan>
                {'  '}
                <tspan fill="var(--vault-danger)">▼{hover.tiVotes || 0}</tspan>
            </text>
            <text x={tx + 12} y={ty + 64} className="vault-chart__tooltip-hint">
                Click to view details
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

/* ---------- Release list (management) ---------- */

function ReleaseListPanel({ releases, boards, features, onAddFeature, onDeleteFeature }) {
    const boardCountByRelease = new Map();
    for (const b of boards) {
        if (b.release__c) {
            boardCountByRelease.set(b.release__c, (boardCountByRelease.get(b.release__c) || 0) + 1);
        }
    }
    const featuresByRelease = new Map();
    for (const f of features) {
        if (!featuresByRelease.has(f.release__c)) featuresByRelease.set(f.release__c, []);
        featuresByRelease.get(f.release__c).push(f);
    }

    return (
        <div className="vault-card vault-mb-24">
            <div className="vault-card__header">
                <span className="vault-card__title">Releases</span>
            </div>
            <div className="vault-card__body">
                {releases.length === 0 ? (
                    <EmptyState message="No releases yet. Create one when setting up a new board." />
                ) : (
                    <div className="vault-release-list">
                        {releases.map(r => (
                            <ReleaseRow
                                key={r.id}
                                release={r}
                                boardCount={boardCountByRelease.get(r.id) || 0}
                                features={featuresByRelease.get(r.id) || []}
                                onAddFeature={name => onAddFeature(r.id, name)}
                                onDeleteFeature={onDeleteFeature}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function ReleaseRow({ release, boardCount, features, onAddFeature, onDeleteFeature }) {
    const [draft, setDraft] = useState('');
    const [adding, setAdding] = useState(false);

    async function handleAdd() {
        const v = draft.trim();
        if (!v) return;
        setAdding(true);
        try {
            await onAddFeature(v);
            setDraft('');
        } finally {
            setAdding(false);
        }
    }

    return (
        <div className="vault-release-row">
            <div className="vault-release-row__header">
                <div>
                    <span className="vault-release-row__name">{release.name__v}</span>
                    <span className="vault-text-small vault-text-muted">
                        {' · '}{boardCount} board{boardCount !== 1 ? 's' : ''}
                        {' · '}{features.length} feature{features.length !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>
            {features.length === 0 ? (
                <div className="vault-text-small vault-text-muted vault-mb-8">
                    No features yet.
                </div>
            ) : (
                <div className="vault-chip-list vault-mb-8">
                    {features.map(f => {
                        const name = f.display_name__c || f.name__v;
                        return (
                        <span key={f.id} className="vault-chip">
                            {name}
                            <button
                                type="button"
                                aria-label={`Remove ${name}`}
                                title="Remove feature"
                                onClick={() => onDeleteFeature(f.id)}
                            >×</button>
                        </span>
                    );})}
                </div>
            )}
            <div className="vault-flex vault-gap-8">
                <input
                    className="vault-input"
                    type="text"
                    placeholder="Add a feature…"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
                    disabled={adding}
                />
                <button type="button" className="vault-btn vault-btn--secondary vault-btn--small" onClick={handleAdd} disabled={adding || !draft.trim()}>
                    {adding ? 'Adding…' : 'Add'}
                </button>
            </div>
        </div>
    );
}
