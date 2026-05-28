#!/usr/bin/env node
// prune.mjs — clean up stale worktrees from killed run-loops.
//
// A "stale" worktree is one in swarm/worktrees/ (or a porter/ branch in
// .claude/worktrees/) that does NOT have an active run-porter.mjs
// process owning it. Killed loops leave these orphaned; this command
// reclaims them.
//
// Usage:
//   node swarm/bin/prune.mjs                 # show what would be pruned, no changes
//   node swarm/bin/prune.mjs --apply         # actually remove stale worktrees + branches
//   node swarm/bin/prune.mjs --force         # alias for --apply
//   node swarm/bin/prune.mjs --everything    # remove ALL porter/ worktrees regardless of activity

import { execSync } from 'child_process';
import { readdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { REPO_ROOT } from '../lib/state.mjs';

function sh(cmd, opts = {}) {
    try { return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', ...opts }).trim(); }
    catch { return ''; }
}

function activePorterPaths() {
    // Each live run-porter.mjs subprocess passes the worktree as --add-dir
    // (claude) or -C (codex). Walk ps output and extract them.
    const ps = sh('ps -ax -o args=');
    const set = new Set();
    for (const line of ps.split('\n')) {
        if (!/run-porter\.mjs|claude -p|codex exec/.test(line)) continue;
        const addDir = line.match(/--add-dir\s+(\S+)/);
        const cdir = line.match(/(?:^|\s)-C\s+(\S+)/);
        if (addDir) set.add(addDir[1]);
        if (cdir) set.add(cdir[1]);
    }
    return set;
}

function listWorktrees() {
    const out = sh('git worktree list --porcelain');
    const wts = [];
    let cur = {};
    for (const line of out.split('\n')) {
        if (line.startsWith('worktree ')) {
            if (cur.path) wts.push(cur);
            cur = { path: line.slice('worktree '.length) };
        } else if (line.startsWith('branch ')) {
            cur.branch = line.slice('branch '.length);
        } else if (line.startsWith('HEAD ')) {
            cur.head = line.slice('HEAD '.length);
        } else if (line === 'locked' || line.startsWith('locked ')) {
            cur.locked = true;
        }
    }
    if (cur.path) wts.push(cur);
    return wts;
}

function isPorterWorktree(wt) {
    if (!wt.path) return false;
    if (wt.path.includes('/swarm/worktrees/')) return true;
    if (wt.path.includes('/.claude/worktrees/') && wt.branch?.includes('porter/')) return true;
    return false;
}

function main() {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply') || args.includes('--force');
    const everything = args.includes('--everything');

    const live = activePorterPaths();
    const wts = listWorktrees().filter(isPorterWorktree);

    if (wts.length === 0) {
        console.log('No porter worktrees found.');
        return;
    }

    console.log(`Found ${wts.length} porter worktree(s):`);
    const toPrune = [];
    for (const wt of wts) {
        const isLive = live.has(wt.path);
        const status = everything ? 'PRUNE (everything mode)'
                      : isLive ? 'KEEP (active)'
                      : 'PRUNE (stale)';
        console.log(`  [${status}] ${wt.path} (${wt.branch || '?'})`);
        if (status.startsWith('PRUNE')) toPrune.push(wt);
    }

    if (!apply) {
        console.log(`\n${toPrune.length} would be pruned. Re-run with --apply to remove.`);
        return;
    }

    let removed = 0;
    for (const wt of toPrune) {
        const branch = wt.branch?.replace(/^refs\/heads\//, '');
        try {
            sh(`git worktree remove --force "${wt.path}"`);
        } catch {}
        if (existsSync(wt.path)) {
            try { rmSync(wt.path, { recursive: true, force: true }); } catch {}
        }
        if (branch) {
            try { execSync(`git branch -D "${branch}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch {}
        }
        console.log(`  removed ${wt.path}`);
        removed++;
    }
    // Also prune git's internal worktree records.
    sh('git worktree prune');
    console.log(`\nPruned ${removed} worktree(s).`);
}

main();
