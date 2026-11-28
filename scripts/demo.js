'use strict';
const { DEFAULT_TOPICS } = require('../src/core');
const { projectCatalog, usageDay } = require('../media/projects');
const pricing = require('../package.json').contributes.configuration.properties['chatAtlas.modelPricing'].default;
const names = [
  ['Dashboard layout refinements', 'interface', 'codex', 'Race Studio', 'Refine the dashboard cards and make the mobile controls easier to use.'],
  ['Replay picker navigation', 'interface', 'claude', 'Race Studio', 'Keep the current selection visible while switching between tracks.'],
  ['Session recovery after reconnect', 'fixes', 'codex', 'Race Studio', 'Find why reconnecting leaves the session loading indefinitely.'],
  ['Import validation edge cases', 'fixes', 'claude', 'Race Studio', 'Handle duplicate laps and incomplete timing files during import.'],
  ['Shared setup library', 'features', 'claude', 'Suspension Lab', 'Create a shared setup library with clear ownership and permissions.'],
  ['Compare suspension geometries', 'research', 'codex', 'Suspension Lab', 'Explore the tradeoffs between the two suspension configurations.'],
  ['October release notes', 'release', 'codex', 'Race Studio', 'Summarize the changes that matter to drivers in the next release.'],
  ['Prepare deployment checks', 'release', 'claude', 'Timing Desk', 'Check the release package and verify the deployment configuration.'],
  ['Weekend ideas', 'general', 'codex', 'Other conversations', 'Capture a few ideas for the next iteration.'],
  ['New conversation overview', 'features', 'codex', 'Chat Atlas', 'Build a stable workspace for all of our conversations.'],
  ['Responsive numeric controls', 'interface', 'codex', 'Suspension Lab', 'Make number fields usable in narrow cards.']
];
// Deterministic fictional token usage: a few days per chat, heavier for the first cards.
function demoUsage(provider, i, now) {
  const model = provider === 'claude' ? (i % 3 ? 'claude-fable-5-1' : 'claude-opus-5-5') : 'gpt-6.1-terra';
  const days = Array.from({ length: 1 + (i % 3) }, (_, d) => {
    const scale = (12 - i) * (d + 1) * 1000;
    return { day: usageDay(now - d * 86400000), model, input: 4 * scale, cacheRead: 60 * scale, cacheWrite: 6 * scale, output: Math.round(1.5 * scale) };
  });
  const limits = provider === 'codex' && i === 0 ? { limits: { plan: 'plus', primary: { used_percent: 62, window_minutes: 300, resets_at: Math.round(now / 1000) + 5400 }, secondary: { used_percent: 91, window_minutes: 10080, resets_at: Math.round(now / 1000) + 3 * 86400 }, credits: '18.50', at: now - 300000 } } : {};
  return { days, model, ...(provider === 'claude' && i === 3 ? { reportedCost: 1.84, linesAdded: 120, linesRemoved: 9 } : {}), ...limits };
}
function demo() {
  const now = Date.now();
  const board = { type: 'data', topics: structuredClone(DEFAULT_TOPICS), errors: [], busy: false, pricing,
    sources: [{ provider: 'codex', state: 'ready', count: 7 }, { provider: 'claude', state: 'ready', count: 4 }],
    subfolders: { 'path:c:/code/race studio': ['Dashboard', 'Import'], 'path:c:/code/suspension lab': ['Geometry', 'Setups'] },
    sessions: names.map(([title, topic, provider, project, preview], i) => ({ key: `${provider}:demo-${i}`, id: `demo-${i}`, provider, project, cwd: `C:/Code/${project}`, subfolderHint: i === 0 ? 'Dashboard' : i === 3 ? 'Import' : i === 4 ? 'Setups' : '', running: i === 0 || i === 4, attention: i === 2 ? 'question' : i === 1 ? 'finished' : '', title, topic, preview, createdAt: now - i * 3600000, updatedAt: now - i * 60000, status: i === 10 ? 'Done' : i === 0 ? 'In progress' : i === 2 ? 'Waiting' : 'Inbox', note: '', pinned: [0, 4, 9].includes(i), seenAt: i === 1 ? now - 999999 : now, usage: demoUsage(provider, i, now) })) };
  board.projectCatalog = projectCatalog(board.sessions);
  return board;
}
module.exports = { demo };
