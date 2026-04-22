// Releases — Release Sentiment chart + release management.
// One line per team across releases, Y-axis 0–100% sentiment
// (Went Well score / (Went Well + To Improve) score). Each card contributes
// 1 + its vote_count__c to the score for its category.
// Below the chart: a list of releases with inline-editable features.
import React, { useEffect, useState, useMemo } from 'react';
import {
    fetchAllFeedback, fetchBoards, fetchTeams,
    fetchReleases, fetchFeatures, fetchAllBoardFeatures,
} from '../api/vault';
import Spinner, { EmptyState } from '../components/Spinner';

// Team palette — deliberately avoids green / blue / orange because those
// carry semantic meaning on the action-status bar (done / in progress /
// not started). Purple, teal, rose read as team identifiers instead.
const TEAM_PALETTE = [
    '#6B46C1',  // purple
    '#0D9488',  // teal
    '#BE185D',  // rose
    '#4C51BF',  // indigo
    '#92400E',  // sienna
    '#4B5563',  // slate
];

export default function Releases({ showToast }) {
    const [loading, setLoading] = useState(true);
    const [feedback, setFeedback] = useState([]);
    const [boards, setBoards] = useState([]);
    const [teams, setTeams] = useState([]);
    const [releases, setReleases] = useState([]);
    const [features, setFeatures] = useState([]);
    const [boardFeatures, setBoardFeatures] = useState([]);
    const [hover, setHover] = useState(null);
    const [hiddenTeams, setHiddenTeams] = useState(() => new Set());

    useEffect(() => {
        (async () => {
            try {
                const [f, b, t, r, ft, bf] = await Promise.all([
                    fetchAllFeedback(), fetchBoards(), fetchTeams(), fetchReleases(),
                    fetchFeatures(), fetchAllBoardFeatures(),
                ]);
                setFeedback(f);
                setBoards(b);
                setTeams(t);
                setReleases(r);
                setFeatures(ft);
                setBoardFeatures(bf);
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

    function openBoardInBoardsTab(boardId) {
        if (!boardId) return;
        try {
            const top = window.top;
            const tabCollection = new URLSearchParams(top.location.search).get('tab-collection');
            const search = tabCollection ? '?tab-collection=' + encodeURIComponent(tabCollection) : '';
            top.location.href = top.location.origin + '/ui/' + search + '#custom/page/retrovault/' + encodeURIComponent(boardId);
        } catch (e) {
            showToast && showToast('Cannot navigate: ' + e.message, 'error');
        }
    }

    if (loading) return <Spinner />;

    const visibleSeries = chart ? chart.series.filter(s => !hiddenTeams.has(s.teamId)) : [];

    return (
        <>
            <Header />

            <div className="vault-card vault-mb-24">
                <div className="vault-card__header">
                    <span className="vault-card__title">Overall Sentiment by Release</span>
                </div>
                <div className="vault-card__body">
                    {!chart || chart.releases.length === 0 ? (
                        <EmptyState message="No release sentiment yet — add some Went Well / To Improve feedback to a board linked to a release." />
                    ) : (
                        <>
                            <p className="vault-text-small vault-text-muted vault-mb-16">
                                Ratio of 'Went Well' to 'To Improve' score. Each card equals one point, each vote equals one point.
                            </p>
                            <Legend
                                teams={chart.teamMeta}
                                hiddenTeams={hiddenTeams}
                                onToggle={toggleTeam}
                                onIsolate={isolateTeam}
                                onShowAll={showAll}
                            />
                            <SentimentChart
                                chart={{ ...chart, series: visibleSeries }}
                                hover={hover}
                                setHover={setHover}
                                onOpenBoard={openBoardInBoardsTab}
                            />
                        </>
                    )}
                </div>
            </div>

            <ReleaseListPanel
                releases={releases}
                boards={boards}
                teams={teams}
                features={features}
                feedback={feedback}
                boardFeatures={boardFeatures}
            />
        </>
    );
}

function Header() {
    return (
        <div className="vault-page-header">
            <div>
                <h1 className="vault-page-header__title">Release Sentiment</h1>
                <p className="vault-page-header__subtitle">Cross-team signals and feature lists by release</p>
            </div>
            <button
                type="button"
                className="vault-btn vault-btn--secondary"
                disabled
                title="Coming soon"
            >
                Sync from JIRA
                <span className="vault-btn__badge">coming soon</span>
            </button>
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
        // Score = 1 (the card itself) + its vote count. Kept on the `…Votes`
        // field names for historical reasons; displayed as "N Went Well" etc.
        const score = 1 + (Number(fi.vote_count__c) || 0);
        const key = `${releaseName}|${board.team__c}`;
        if (!buckets.has(key)) buckets.set(key, { wwVotes: 0, totalVotes: 0, wwCount: 0, totalCount: 0, boardId: board.id, boardName: board.name__v });
        const b = buckets.get(key);
        b.totalVotes += score;
        b.totalCount += 1;
        b.boardId = board.id;
        b.boardName = board.name__v;
        if (cat === 'went_well__c') {
            b.wwVotes += score;
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

function SentimentChart({ chart, hover, setHover, onOpenBoard }) {
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

    // Cancel tooltip dismiss when the cursor leaves the marker only to re-enter
    // the tooltip card itself (so the button inside the tooltip is reachable).
    const dismissTimer = React.useRef(null);
    function scheduleDismiss() {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = setTimeout(() => setHover(null), 120);
    }
    function cancelDismiss() {
        clearTimeout(dismissTimer.current);
    }

    return (
        <div className="vault-chart" onMouseLeave={scheduleDismiss}>
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
                                        onMouseEnter={() => { cancelDismiss(); setHover({ teamId: s.teamId, teamName: s.teamName, color: s.color, ...p }); }}
                                        onMouseLeave={scheduleDismiss}
                                    />
                                </g>
                            );
                        })}
                    </g>
                ))}
            </svg>

            {hover && hover.sentiment !== null && (
                <Tooltip
                    hover={hover}
                    vbW={W}
                    vbH={H}
                    xPct={(xAt(hover.x) / W) * 100}
                    yPct={(yAt(hover.sentiment) / H) * 100}
                    onOpenBoard={onOpenBoard}
                    onMouseEnter={cancelDismiss}
                    onMouseLeave={scheduleDismiss}
                />
            )}
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

function Tooltip({ hover, xPct, yPct, onOpenBoard, onMouseEnter, onMouseLeave }) {
    // Flip horizontally so the card stays within the chart bounds.
    const onLeft = xPct > 60;
    const style = {
        left: `${xPct}%`,
        top: `${yPct}%`,
        transform: `translate(${onLeft ? 'calc(-100% - 12px)' : '12px'}, -50%)`,
    };

    return (
        <div
            className="vault-chart-tip"
            style={style}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            role="tooltip"
        >
            <div className="vault-chart-tip__title">
                {hover.boardName || hover.release}
            </div>
            <div className="vault-chart-tip__meta">
                <span className="vault-chart-tip__swatch" style={{ background: hover.color }} />
                {hover.teamName} · {hover.release}
            </div>
            <div className="vault-chart-tip__stats">
                <span className="vault-chart-tip__pct">{hover.sentiment}%</span>
                <span className="vault-chart-tip__stat vault-chart-tip__stat--positive">
                    <span className="vault-chart-tip__icon" aria-hidden="true">+</span>
                    {hover.wwVotes || 0} Went Well
                </span>
                <span className="vault-chart-tip__stat vault-chart-tip__stat--negative">
                    <span className="vault-chart-tip__icon" aria-hidden="true">−</span>
                    {hover.tiVotes || 0} To Improve
                </span>
            </div>
            {hover.boardId && (
                <button
                    type="button"
                    className="vault-btn vault-btn--secondary vault-btn--small vault-chart-tip__btn"
                    onClick={() => onOpenBoard(hover.boardId)}
                >
                    Open board →
                </button>
            )}
        </div>
    );
}

/* ---------- Release list (management) ---------- */

function ReleaseListPanel({ releases, boards, teams, features, feedback, boardFeatures }) {
    const teamNameById = new Map(teams.map(t => [t.id, t.name__v]));
    const boardById = new Map(boards.map(b => [b.id, b]));

    // Stable team ordering + palette (same palette as the sentiment chart).
    const sortedTeams = [...teams].sort((a, b) => (a.name__v || '').localeCompare(b.name__v || ''));
    const teamColorById = new Map();
    sortedTeams.forEach((t, i) => {
        teamColorById.set(t.id, TEAM_PALETTE[i % TEAM_PALETTE.length]);
    });

    const boardCountByRelease = new Map();
    for (const b of boards) {
        if (b.release__c) {
            boardCountByRelease.set(b.release__c, (boardCountByRelease.get(b.release__c) || 0) + 1);
        }
    }

    // (releaseId|teamId) -> [features...]  only features linked to that team's board.
    const featuresByRelTeam = new Map();
    const teamsByFeature = new Map();
    for (const bf of boardFeatures || []) {
        const board = boardById.get(bf.retro_board__c);
        if (!board || !board.team__c || !board.release__c) continue;
        if (!teamsByFeature.has(bf.retro_feature__c)) teamsByFeature.set(bf.retro_feature__c, new Set());
        teamsByFeature.get(bf.retro_feature__c).add(board.team__c);
    }

    const featureById = new Map(features.map(f => [f.id, f]));
    for (const [fid, teamIds] of teamsByFeature.entries()) {
        const f = featureById.get(fid);
        if (!f) continue;
        for (const tid of teamIds) {
            const key = `${f.release__c}|${tid}`;
            if (!featuresByRelTeam.has(key)) featuresByRelTeam.set(key, []);
            featuresByRelTeam.get(key).push(f);
        }
    }

    // (releaseId|teamId|featureName) -> { ww, ti } so each team's cell only
    // counts cards from its own board, not cards from other teams' boards that
    // happen to tag the same feature. Each card contributes 1 + its vote count.
    // Cards without a feature__c roll up into noFeatureByRelTeam.
    const countsByRelFeature = new Map();
    const noFeatureByRelTeam = new Map();
    for (const fi of feedback || []) {
        const board = boardById.get(fi.retro_board__c);
        if (!board || !board.release__c || !board.team__c) continue;
        const cat = fi.category__c;
        if (cat !== 'went_well__c' && cat !== 'didnt_go_well__c') continue;
        const score = 1 + (Number(fi.vote_count__c) || 0);
        const featureName = fi.feature__c;
        if (featureName) {
            const key = `${board.release__c}|${board.team__c}|${featureName}`;
            if (!countsByRelFeature.has(key)) countsByRelFeature.set(key, { ww: 0, ti: 0 });
            const c = countsByRelFeature.get(key);
            if (cat === 'went_well__c') c.ww += score;
            else c.ti += score;
        } else {
            const key = `${board.release__c}|${board.team__c}`;
            if (!noFeatureByRelTeam.has(key)) noFeatureByRelTeam.set(key, { ww: 0, ti: 0 });
            const c = noFeatureByRelTeam.get(key);
            if (cat === 'went_well__c') c.ww += score;
            else c.ti += score;
        }
    }

    const featureCountByRelease = new Map();
    for (const f of features) {
        featureCountByRelease.set(f.release__c, (featureCountByRelease.get(f.release__c) || 0) + 1);
    }

    return (
        <div className="vault-card vault-mb-24">
            <div className="vault-card__header">
                <span className="vault-card__title">Sentiment by Feature</span>
            </div>
            <div className="vault-card__body">
                {releases.length === 0 ? (
                    <EmptyState message="No releases yet. Create one when setting up a new board." />
                ) : (
                    <div
                        className="vault-release-matrix"
                        role="table"
                        style={{ '--team-count': sortedTeams.length }}
                    >
                        <div className="vault-release-matrix__row vault-release-matrix__row--header" role="row">
                            <div className="vault-release-matrix__cell vault-release-matrix__cell--corner" role="columnheader">Release</div>
                            {sortedTeams.map(t => (
                                <div
                                    key={t.id}
                                    className="vault-release-matrix__cell vault-release-matrix__cell--team-header"
                                    style={{ '--team-color': teamColorById.get(t.id) }}
                                    role="columnheader"
                                >
                                    <span className="vault-team-group__swatch" aria-hidden="true" />
                                    {t.name__v}
                                </div>
                            ))}
                        </div>
                        {releases.map(r => (
                            <ReleaseMatrixRow
                                key={r.id}
                                release={r}
                                boardCount={boardCountByRelease.get(r.id) || 0}
                                featureCount={featureCountByRelease.get(r.id) || 0}
                                teams={sortedTeams}
                                teamColorById={teamColorById}
                                featuresByRelTeam={featuresByRelTeam}
                                countsByRelFeature={countsByRelFeature}
                                noFeatureByRelTeam={noFeatureByRelTeam}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function ReleaseMatrixRow({
    release, boardCount, featureCount, teams, teamColorById,
    featuresByRelTeam, countsByRelFeature, noFeatureByRelTeam,
}) {
    const releaseHref = `/ui/#object/retro_release__c/${encodeURIComponent(release.id)}`;
    return (
        <div className="vault-release-matrix__row" role="row">
            <div className="vault-release-matrix__cell vault-release-matrix__cell--release" role="rowheader">
                <a
                    className="vault-release-row__name vault-release-row__name--link"
                    href={releaseHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open release in Vault (new tab)"
                >
                    {release.name__v}
                </a>
                <div className="vault-text-small vault-text-muted">
                    {boardCount} board{boardCount !== 1 ? 's' : ''} · {featureCount} feature{featureCount !== 1 ? 's' : ''}
                </div>
            </div>
            {teams.map(t => {
                const list = featuresByRelTeam.get(`${release.id}|${t.id}`) || [];
                const noFeatureCounts = noFeatureByRelTeam.get(`${release.id}|${t.id}`) || { ww: 0, ti: 0 };
                const hasNoFeature = noFeatureCounts.ww > 0 || noFeatureCounts.ti > 0;
                const color = teamColorById.get(t.id);
                return (
                    <div
                        key={t.id}
                        className="vault-release-matrix__cell vault-release-matrix__cell--feats"
                        style={{ '--team-color': color }}
                        role="cell"
                    >
                        {list.length === 0 && !hasNoFeature ? (
                            <span className="vault-release-matrix__empty">—</span>
                        ) : (
                            <FeatureChipList
                                features={list}
                                releaseId={release.id}
                                teamId={t.id}
                                countsByRelFeature={countsByRelFeature}
                                noFeatureCounts={noFeatureCounts}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function FeatureChipList({ features, releaseId, teamId, countsByRelFeature, noFeatureCounts }) {
    const sorted = [...features].sort((a, b) =>
        (a.display_name__c || a.name__v).localeCompare(b.display_name__c || b.name__v));
    const hasNoFeature = noFeatureCounts && (noFeatureCounts.ww > 0 || noFeatureCounts.ti > 0);
    return (
        <div className="vault-chip-list">
            {sorted.map(f => {
                const name = f.display_name__c || f.name__v;
                const key = `${releaseId}|${teamId}|${name}`;
                const counts = countsByRelFeature.get(key) || { ww: 0, ti: 0 };
                return (
                    <span key={f.id} className="vault-chip vault-chip--feature vault-chip--team">
                        <span className="vault-chip__label">{name}</span>
                        {counts.ww > 0 && (
                            <span className="vault-chip__count vault-chip__count--positive" title={`${counts.ww} Went Well`}>
                                +{counts.ww}
                            </span>
                        )}
                        {counts.ti > 0 && (
                            <span className="vault-chip__count vault-chip__count--negative" title={`${counts.ti} To Improve`}>
                                −{counts.ti}
                            </span>
                        )}
                    </span>
                );
            })}
            {hasNoFeature && (
                <span
                    className="vault-chip vault-chip--feature vault-chip--no-feature"
                    title="Feedback on this team's board for this release that didn't tag a feature"
                >
                    <span className="vault-chip__label">(no feature)</span>
                    {noFeatureCounts.ww > 0 && (
                        <span className="vault-chip__count vault-chip__count--positive" title={`${noFeatureCounts.ww} Went Well`}>
                            +{noFeatureCounts.ww}
                        </span>
                    )}
                    {noFeatureCounts.ti > 0 && (
                        <span className="vault-chip__count vault-chip__count--negative" title={`${noFeatureCounts.ti} To Improve`}>
                            −{noFeatureCounts.ti}
                        </span>
                    )}
                </span>
            )}
        </div>
    );
}
