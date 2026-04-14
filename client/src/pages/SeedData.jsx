import React, { useState } from 'react';
import { create, update, query, getCurrentUserId } from '../api/vault';

export default function SeedData({ navigate, showToast }) {
    const [running, setRunning] = useState(false);
    const [log, setLog] = useState([]);

    function append(msg, cls = '') {
        setLog(prev => [...prev, { msg, cls, id: Date.now() + Math.random() }]);
    }

    async function runSeed() {
        setRunning(true);
        setLog([]);
        try {
            // The SDK blocks direct user__sys queries on this Vault, so all
            // seeded authors/facilitators/owners are the current user.
            const currentUserId = getCurrentUserId();
            if (!currentUserId) {
                append('ERROR: No current user ID. Cannot proceed.', 'error');
                return;
            }
            const u = Array(9).fill({ id: currentUserId });
            append(`Seeding as current user ${currentUserId}`, 'success');

            append('\nCreating teams...', 'info');
            const teamData = [
                { name__v: 'Pegasus' },
                { name__v: 'Griffin' },
                { name__v: 'Orca' }
            ];
            const teamIds = [];
            for (const t of teamData) {
                const id = await create('retro_team__c', t);
                teamIds.push(id);
                append(`  Created team: ${t.name__v}`, 'success');
            }

            append('\nCreating retro boards...', 'info');
            const boardData = [
                { name__v: 'Sprint 10 Retro', team: 0, fac: 0, tag: 'v2.3.0', date: '2026-01-10', status: 'closed__c' },
                { name__v: 'Sprint 11 Retro', team: 0, fac: 1, tag: 'v2.4.0', date: '2026-01-24', status: 'closed__c' },
                { name__v: 'Sprint 12 Retro', team: 1, fac: 3, tag: 'v3.0.0', date: '2026-02-07', status: 'closed__c' },
                { name__v: 'Hotfix Post-Mortem', team: 2, fac: 6, tag: 'v2.4.1-hotfix', date: '2026-02-14', status: 'active__c' }
            ];
            const boardIds = [];
            for (const bd of boardData) {
                const id = await create('retro_board__c', {
                    name__v: bd.name__v,
                    team__c: teamIds[bd.team],
                    facilitator__c: u[bd.fac].id,
                    release_tag__c: bd.tag,
                    board_date__c: bd.date,
                    status__c: bd.status
                });
                boardIds.push(id);
                append(`  Created: ${bd.name__v}`, 'success');
            }

            append('\nCreating feedback items...', 'info');
            const feedbackData = [
                { board: 0, author: 1, cat: 'went_well__c', theme: 'tooling__c', content: 'New CI pipeline cut build times by 40%', votes: 5 },
                { board: 0, author: 2, cat: 'went_well__c', theme: 'process__c', content: 'Daily standups were focused and efficient', votes: 3 },
                { board: 0, author: 0, cat: 'didnt_go_well__c', theme: 'tooling__c', content: 'Flaky integration tests blocked deployments 3 times', votes: 7 },
                { board: 0, author: 1, cat: 'didnt_go_well__c', theme: 'scope__c', content: 'Mid-sprint scope changes derailed our estimates', votes: 4 },
                { board: 1, author: 1, cat: 'went_well__c', theme: 'communication__c', content: 'Cross-team sync meetings improved alignment', votes: 4 },
                { board: 1, author: 2, cat: 'went_well__c', theme: 'quality__c', content: 'Zero production incidents this sprint', votes: 5 },
                { board: 1, author: 0, cat: 'went_well__c', theme: 'morale__c', content: 'Team lunch boosted morale significantly', votes: 3 },
                { board: 1, author: 1, cat: 'didnt_go_well__c', theme: 'tooling__c', content: 'Build times increased after monorepo migration', votes: 6 },
                { board: 1, author: 2, cat: 'didnt_go_well__c', theme: 'staffing__c', content: 'Lost a senior engineer mid-sprint to another project', votes: 3 },
                { board: 2, author: 4, cat: 'went_well__c', theme: 'process__c', content: 'New code review checklist caught bugs early', votes: 4 },
                { board: 2, author: 5, cat: 'went_well__c', theme: 'communication__c', content: 'Architecture decision records improved knowledge sharing', votes: 3 },
                { board: 2, author: 3, cat: 'didnt_go_well__c', theme: 'scope__c', content: 'Feature requirements changed after development started', votes: 5 },
                { board: 2, author: 4, cat: 'didnt_go_well__c', theme: 'tooling__c', content: 'Staging environment was down for 2 days', votes: 4 },
                { board: 2, author: 5, cat: 'didnt_go_well__c', theme: 'process__c', content: 'PR reviews taking 3+ days on average', votes: 3 },
                { board: 3, author: 7, cat: 'went_well__c', theme: 'communication__c', content: 'Incident response communication was fast and clear', votes: 2 },
                { board: 3, author: 8, cat: 'went_well__c', theme: 'quality__c', content: 'Root cause identified within 30 minutes', votes: 3 },
                { board: 3, author: 6, cat: 'didnt_go_well__c', theme: 'tooling__c', content: 'Alert fatigue delayed initial response by 15 minutes', votes: 4 },
                { board: 3, author: 7, cat: 'didnt_go_well__c', theme: 'process__c', content: 'No runbook existed for this failure scenario', votes: 3 }
            ];

            const feedbackIds = [];
            const feedbackVotes = [];
            for (let i = 0; i < feedbackData.length; i++) {
                const fd = feedbackData[i];
                const id = await create('retro_feedback__c', {
                    name__v: fd.content.substring(0, 80),
                    retro_board__c: boardIds[fd.board],
                    author__c: u[fd.author].id,
                    category__c: fd.cat,
                    content__c: fd.content,
                    theme__c: fd.theme,
                    vote_count__c: fd.votes
                });
                feedbackIds.push(id);
                feedbackVotes.push(fd.votes);
            }
            append(`  Created all ${feedbackData.length} feedback items`, 'success');

            append('\nCreating action items...', 'info');
            const actionData = [
                { board: 0, owner: 2, title: 'Set up test quarantine system', status: 'done__c', due: '2026-01-24', completed: '2026-01-22T10:30:00Z' },
                { board: 0, owner: 0, title: 'Document scope change process', status: 'done__c', due: '2026-01-31', completed: '2026-01-28T14:00:00Z' },
                { board: 1, owner: 1, title: 'Implement build caching', status: 'done__c', due: '2026-02-07', completed: '2026-02-05T09:15:00Z' },
                { board: 1, owner: 2, title: 'Create onboarding guide for new engineers', status: 'done__c', due: '2026-02-14', completed: '2026-02-10T16:45:00Z' },
                { board: 2, owner: 4, title: 'Set up PR size linter', status: 'in_progress__c', due: '2026-02-21', completed: null },
                { board: 2, owner: 3, title: 'Fix staging environment reliability', status: 'in_progress__c', due: '2026-02-21', completed: null },
                { board: 2, owner: 5, title: 'Write ADR template and examples', status: 'done__c', due: '2026-02-14', completed: '2026-02-13T11:00:00Z' },
                { board: 3, owner: 7, title: 'Tune alerting thresholds', status: 'open__c', due: '2026-02-28', completed: null },
                { board: 3, owner: 6, title: 'Create runbooks for critical failures', status: 'open__c', due: '2026-03-07', completed: null },
                { board: 3, owner: 8, title: 'Post-mortem follow-up meeting', status: 'done__c', due: '2026-02-21', completed: '2026-02-18T10:00:00Z' }
            ];

            for (const ad of actionData) {
                const fields = {
                    name__v: ad.title,
                    retro_board__c: boardIds[ad.board],
                    owner__c: u[ad.owner].id,
                    status__c: ad.status,
                    due_date__c: ad.due
                };
                if (ad.completed) fields.completed_at__c = ad.completed;
                await create('retro_action__c', fields);
            }
            append(`  Created all ${actionData.length} action items`, 'success');

            append('\nCreating votes...', 'info');
            let voteCount = 0;
            for (let fi = 0; fi < feedbackIds.length; fi++) {
                const numVotes = Math.min(feedbackVotes[fi], u.length);
                for (let vi = 0; vi < numVotes; vi++) {
                    await create('retro_vote__c', {
                        name__v: `${feedbackIds[fi]}_${u[vi].id}`.slice(0, 80),
                        feedback_item__c: feedbackIds[fi],
                        voter__c: u[vi].id
                    });
                    voteCount++;
                }
            }
            append(`  Created ${voteCount} votes`, 'success');

            append('\n=== SEED COMPLETE ===', 'success');
            append(`3 teams, 4 boards, 24 feedback items, 10 action items, ${voteCount} votes`, 'success');
            showToast('Seed complete!', 'success');
        } catch (err) {
            append(`\nERROR: ${err.message}`, 'error');
            showToast('Seed failed: ' + err.message, 'error');
        } finally {
            setRunning(false);
        }
    }

    return (
        <>
            <div className="vault-page-header">
                <div>
                    <h1 className="vault-page-header__title">Seed Demo Data</h1>
                    <p className="vault-page-header__subtitle">Populate RetroVault with sample retrospective data</p>
                </div>
                <button className="vault-btn vault-btn--secondary" onClick={() => navigate('dashboard')}>← Back</button>
            </div>

            <div className="vault-card vault-mb-24">
                <div className="vault-card__body">
                    <p className="vault-mb-16">
                        This will create 3 teams, 4 retro boards, 24 feedback items, 10 action items,
                        and ~80 votes using existing Vault users.
                    </p>
                    <button className="vault-btn vault-btn--primary" onClick={runSeed} disabled={running}>
                        {running ? 'Running...' : 'Run Seed'}
                    </button>
                </div>
            </div>

            <div className="seed-log">
                {log.map(entry => (
                    <div key={entry.id} className={'seed-log__line ' + entry.cls}>{entry.msg}</div>
                ))}
            </div>
        </>
    );
}
