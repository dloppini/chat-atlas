'use strict';
const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const path = require('node:path');
const { readEngineeringGit, readOnlyGit } = require('./git');
const { containedFile, excluded, indexFiles, queryGraph } = require('./engineering-graph');

const storageKey = 'engineeringSnapshots.v1';
const requestTypes = new Set(['engineeringRead', 'engineeringRefresh', 'engineeringCancel', 'engineeringClear', 'engineeringQuery', 'engineeringOpen', 'engineeringCopy']);

function createEngineering({ storage, catalog, post, local, compiler, openFile, copy }) {
  const saved = storage.get(storageKey);
  const cache = new Map(Array.isArray(saved) ? saved : []);
  const jobs = new Map();
  const watchers = new Map();
  const status = new Map();
  let disposed = false;

  const publish = (type, projectKey, data) => {
    if (!disposed) post({ type, projectKey, ...data });
  };
  const persist = () => storage.update(storageKey, [...cache].slice(-12));
  const keyFor = (projectKey, cwd) => JSON.stringify([projectKey, cwd]);
  function stopWatching(key) {
    for (const watcher of watchers.get(key) || []) watcher.close();
    watchers.delete(key);
  }
  function observe(key, projectKey, snapshot, startedAt) {
    stopWatching(key);
    const { repo, cwd } = snapshot;
    const active = [];
    let pending = Promise.resolve();
    function stale() {
      if (watchers.get(key) !== active) return;
      stopWatching(key);
      if (cache.get(key) !== snapshot && !jobs.has(key)) return;
      status.set(key, 'Stale');
      if (cache.get(key) !== snapshot) jobs.get(key)?.abort('Source changed during analysis. Refresh to analyze the new state.');
      publish('engineeringState', projectKey, { state: 'Stale' });
    }
    try {
      const roots = new Map([[repo?.root || cwd, false]]);
      for (const root of [repo?.worktree, repo?.commonDir].filter(Boolean)) roots.set(root, true);
      for (const [root, git] of roots) {
        const watcher = watch(root, { recursive: true, persistent: false }, (event, name) => {
          if (!name) { stale(); return; }
          const file = String(name);
          if (git) {
            if (/\.lock$/i.test(file) || !/^(?:HEAD$|index$|packed-refs$|config(?:\.worktree)?$|info[/\\]exclude$|refs[/\\])/i.test(file)) return;
          } else if (excluded.test(file)) return;
          pending = pending.then(async () => {
            if (watchers.get(key) !== active) return;
            if (event !== 'rename') {
              const stat = await fs.lstat(path.join(root, file)).catch(() => null);
              // shortcut: Windows access-time notifications also advance ctime. Compare content if backdated writes need detection.
              if (stat && stat.mtimeMs < startedAt && (process.platform === 'win32' || stat.ctimeMs < startedAt)) return;
            }
            if (repo && !git && path.basename(file) !== '.gitignore') {
              try {
                await readOnlyGit(root, ['check-ignore', '-q', '--', './' + file.split(path.sep).join('/')]);
                return;
              } catch { /* Tracked, unignored, and unknown paths can affect the snapshot. */ }
            }
            stale();
          });
        });
        watcher.on('error', stale);
        active.push(watcher);
      }
      watchers.set(key, active);
      return () => pending;
    } catch {
      active.forEach(watcher => watcher.close());
      return false;
    }
  }
  async function handle(message) {
    if (!requestTypes.has(message?.type)) return false;
    const { projectKey, requestId, type } = message;
    if (typeof projectKey !== 'string' || !Number.isSafeInteger(requestId)) return true;
    const reply = data => publish(type === 'engineeringQuery' ? 'engineeringGraph' : 'engineeringResult', projectKey, { requestId, ...data });
    const project = catalog().find(item => item.key === projectKey);
    if (!local || !project?.cwd) {
      reply({ state: 'Unsupported', error: local ? 'Link a local project folder to view engineering evidence.' : 'Engineering analysis is available in local VS Code windows.' });
      return true;
    }
    let key;
    try {
      const cwd = await fs.realpath(project.cwd);
      key = keyFor(projectKey, cwd);
      const previous = cache.get(key);
      const overview = ({ graph, ...snapshot }) => ({ ...snapshot, graph: graph && { ...graph.summary, engine: graph.engine, insights: graph.insights } });
      if (type === 'engineeringQuery') {
        reply({ graph: previous?.graph ? queryGraph(previous.graph, message) : null });
        return true;
      }
      if (type === 'engineeringCopy' && message.brief === 'quality') {
        const insights = previous?.graph?.insights;
        if (!insights) throw new Error('Refresh analysis to compute quality insights.');
        await copy(qualityBrief(project, previous, insights));
        publish('notice', projectKey, { text: 'Quality brief copied.' });
        return true;
      }
      if (type === 'engineeringOpen' || type === 'engineeringCopy') {
        const graph = previous?.graph;
        if (!graph?.nodes.includes(message.target)) throw new Error('Select a file from this project’s indexed snapshot.');
        if (type === 'engineeringOpen') {
          const file = await containedFile(await fs.realpath(previous.repo.root), message.target);
          if (!file) throw new Error('The indexed file has moved or is outside this worktree.');
          const line = Number.isSafeInteger(message.line) && message.line > 0 ? message.line : 1;
          await openFile(file, line);
        } else {
          const result = queryGraph(graph, message);
          const objective = typeof message.objective === 'string' ? message.objective.trim().slice(0, 1000) : '';
          const repo = previous.repo;
          await copy([
            '# Chat Atlas impact brief', '', `Project: ${project.name}`, `Working directory: ${previous.cwd}`, `Repository: ${repo.root}`,
            `Worktree: ${repo.worktree}`, `Branch / HEAD: ${repo.branch || 'unborn'} / ${repo.head || 'unborn'}`,
            `Snapshot: ${new Date(previous.time).toISOString()} (${status.get(key) || 'Stale'}), TypeScript ${graph.engine || 'unavailable'}`,
            '', '## Objective', objective || `Review the impact of changing ${result.selected}.`, '',
            '## Evidence', `Target: ${result.selected}`, `Affected folders: ${result.affected.join(', ')}`,
            ...result.dependencies.map(edge => `- Dependency: ${edge.to} (${edge.from}:${edge.line})`),
            ...result.dependents.map(edge => `- Dependent (depth ${edge.distance}): ${edge.from}:${edge.line} → ${edge.to}`), '',
            '## Verification', ...result.tests.map(file => '- Review candidate test ' + file),
            '- Verify changed interfaces and run relevant project checks.', '',
            '## Coverage', 'Static file-level evidence only. Review runtime behavior, external callers, unresolved imports and removed paths separately.',
            ...(result.capped ? ['The report reached its result limit.'] : [])
          ].join('\n'));
          publish('notice', projectKey, { text: 'Impact brief copied.' });
        }
        return true;
      }
      if (type === 'engineeringCancel') {
        jobs.get(key)?.abort('Analysis canceled.');
        return true;
      }
      if (type === 'engineeringClear') {
        jobs.get(key)?.abort('Analysis canceled.');
        stopWatching(key);
        cache.delete(key);
        status.delete(key);
        await persist();
        reply({ state: 'Never analyzed' });
        return true;
      }
      if (type === 'engineeringRead') {
        reply({ state: status.get(key) || (previous ? 'Stale' : 'Never analyzed'), snapshot: previous && overview(previous) });
        return true;
      }
      if (jobs.has(key) || jobs.size >= 2) {
        reply({ state: jobs.has(key) ? 'Analyzing' : 'Busy', snapshot: previous && overview(previous), error: jobs.has(key) ? undefined : 'Two analyses can run at once. Retry when a slot is free.' });
        return true;
      }
      const controller = new AbortController();
      jobs.set(key, controller);
      status.set(key, 'Analyzing');
      reply({ state: 'Analyzing', snapshot: previous && overview(previous) });
      try {
        const startedAt = Date.now();
        const repo = await readEngineeringGit(cwd, controller.signal);
        const snapshot = { cwd, repo, time: Date.now() };
        controller.signal.throwIfAborted();
        const observing = observe(key, projectKey, snapshot, startedAt);
        if (repo) snapshot.graph = await indexFiles(repo, compiler?.(), controller.signal);
        const confirmed = await readEngineeringGit(cwd, controller.signal);
        if (observing) await observing();
        controller.signal.throwIfAborted();
        if (JSON.stringify(repo) !== JSON.stringify(confirmed)) throw new Error('Git state changed during analysis. Refresh to try again.');
        snapshot.time = Date.now();
        cache.delete(key);
        cache.set(key, snapshot);
        while (cache.size > 12) {
          const oldest = cache.keys().next().value;
          cache.delete(oldest);
          status.delete(oldest);
          stopWatching(oldest);
        }
        status.set(key, observing ? 'Current' : 'Stale');
        const saving = persist();
        publish('engineeringState', projectKey, { state: status.get(key), snapshot: overview(snapshot) });
        await saving;
      } catch (error) {
        stopWatching(key);
        const state = status.get(key) === 'Stale' ? 'Stale' : controller.signal.aborted ? 'Canceled' : 'Failed';
        if (status.has(key)) {
          status.set(key, state);
          publish('engineeringState', projectKey, { state, error: String(controller.signal.reason || error) });
        }
      } finally {
        jobs.delete(key);
      }
    } catch (error) {
      if (type === 'engineeringOpen' || type === 'engineeringCopy') publish('notice', projectKey, { text: error.message });
      else reply({ state: 'Failed', error: error.message });
    }
    return true;
  }
  return {
    handle,
    dispose() {
      disposed = true;
      for (const job of jobs.values()) job.abort('Extension closed.');
      for (const key of watchers.keys()) stopWatching(key);
    }
  };
}

function qualityBrief(project, snapshot, insights) {
  const list = (items, format) => items.length ? items.map(item => '- ' + format(item)) : ['- None found.'];
  return [
    '# Chat Atlas quality brief', '', `Project: ${project.name}`, `Repository: ${snapshot.repo?.root || snapshot.cwd}`,
    `Branch / HEAD: ${snapshot.repo?.branch || 'unborn'} / ${snapshot.repo?.head || 'unborn'}`, `Snapshot: ${new Date(snapshot.time).toISOString()}`, '',
    '## Objective', 'Propose and implement the smallest refactors that reduce risk in the hotspots below without changing behavior.', '',
    '## Hotspots (complexity × commits in 180 days)', ...list(insights.hotspots, item =>
      `${item.file}: ${item.loc} lines, complexity ${item.complexity ?? 'n/a'}, ${item.churn} commits, ${item.importers} importers`),
    '', '## Complex functions', ...list(insights.functions.slice(0, 10), item => `${item.file}:${item.line} ${item.name}: ${item.lines} lines, complexity ${item.complexity}`),
    '', '## Import cycles', ...list(insights.cycles, item => item.files.join(' ↔ ') + (item.size > item.files.length ? ` (+${item.size - item.files.length})` : '')),
    '', `## Files without static importers (${insights.orphans.total})`, ...list(insights.orphans.files.slice(0, 20), file => file),
    '', `## Source not reached from tests (${insights.untested.total})`, ...list(insights.untested.files.slice(0, 20), file => file),
    '', '## Coverage', 'Static evidence only: complexity counts branches, test reach follows imports, and runtime loading (HTML, config, dynamic import) is not seen.'
  ].join('\n');
}

module.exports = { createEngineering, excluded };
