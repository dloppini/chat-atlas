'use strict';
// Model Context Protocol server (stdio, newline-delimited JSON-RPC) exposing Chat Atlas engineering evidence to LLM agents.
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { readEngineeringGit } = require('./git');
const { architectureMap, indexFiles, queryGraph } = require('./engineering-graph');

const { version } = require('../package.json');
const protocols = ['2024-11-05', '2025-03-26', '2025-06-18'];
const coverage = 'Static evidence only. Complexity counts decision points (if, loops, case, catch, &&, ||, ??); hotspot score = complexity × (1 + commits in 180 days); ' +
  'test reach follows imports from test files (and, outside JS/TS, Python and C, same-named sources such as FooTest.java → Foo.java); instability = efferent ÷ (afferent + efferent). Runtime loading (HTML, config, dynamic import) is not seen, so orphans and untested files can be false positives.';
const folderArg = { path: { type: 'string', description: 'Absolute path to a folder inside the Git worktree. Defaults to the server working directory.' },
  refresh: { type: 'boolean', description: 'Re-scan even when Git state is unchanged. Pass true after editing files.' } };
const definitions = [
  { name: 'quality_report', description: 'Chat Atlas quality insights for a Git repository: hotspots, complex functions, import cycles, folder coupling, files without importers and source not reached from tests. Start here to find risky code.',
    inputSchema: { type: 'object', properties: folderArg, additionalProperties: false } },
  { name: 'file_impact', description: 'Static impact of changing one file: its imports, direct and transitive importers, candidate tests, affected top-level folders and whether it is in an import cycle.',
    inputSchema: { type: 'object', properties: { ...folderArg, file: { type: 'string', description: 'File path relative to the repository root (absolute paths inside it are accepted).' },
      depth: { type: 'integer', minimum: 1, maximum: 6, description: 'Importer levels to trace (default 3).' } }, required: ['file'], additionalProperties: false } },
  { name: 'architecture', description: 'Dependency map of one folder’s direct children: lines, complexity, churn, hotspot and cycle counts per child, links between them and a layer (0 = foundation, imports nothing else in scope).',
    inputSchema: { type: 'object', properties: { ...folderArg, folder: { type: 'string', description: 'Folder relative to the repository root. Omit for the root.' } }, additionalProperties: false } }
];

function loadCompiler(file = process.env.ATLAS_TYPESCRIPT) {
  if (!file) return;
  try {
    const ts = require(file);
    if (ts.preProcessFile && ts.resolveModuleName) return ts;
  } catch { /* Every other language stays analyzable without the compiler. */ }
}

function createTools(ts, cwd = process.cwd()) {
  const cache = new Map();
  async function snapshot({ path: folder, refresh }) {
    if (folder !== undefined && (typeof folder !== 'string' || !path.isAbsolute(folder))) throw new Error('path must be an absolute folder path.');
    const signal = AbortSignal.timeout(120000);
    const repo = await readEngineeringGit(await fs.realpath(folder || cwd), signal);
    if (!repo) throw new Error(`${folder || cwd} is not inside a Git worktree; Chat Atlas analyzes Git repositories.`);
    const previous = cache.get(repo.root);
    // Concurrent calls for the same Git state share one scan.
    if (!refresh && previous && JSON.stringify(previous.repo) === JSON.stringify(repo)) return { ...(await previous.result), cached: true };
    const entry = { repo, result: indexFiles(repo, ts, signal).then(graph => ({ repo, graph, time: new Date().toISOString(), cached: false })) };
    cache.delete(repo.root);
    cache.set(repo.root, entry);
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    entry.result.catch(() => cache.get(repo.root) === entry && cache.delete(repo.root));
    return entry.result;
  }
  const header = ({ repo, graph, time, cached }) => ({ repository: repo.root, branch: repo.branch || 'unborn', head: repo.head || 'unborn', uncommitted: repo.counts,
    snapshot: time, cached, typescript: graph.engine || 'unavailable: JS/TS imports and complexity are not analyzed', partial: graph.summary.partial });
  const relative = (repo, file) => (path.isAbsolute(file) ? path.relative(repo.root, file) : file).split(path.sep).join('/').replace(/^\.\//, '');
  return {
    async quality_report(args) {
      const current = await snapshot(args);
      const { cycleFiles, ...insights } = current.graph.insights;
      return { ...header(current), summary: current.graph.summary, insights, coverage };
    },
    async file_impact(args) {
      if (typeof args.file !== 'string' || !args.file) throw new Error('file is required.');
      const current = await snapshot(args), file = relative(current.repo, args.file);
      if (!current.graph.nodes.includes(file)) {
        const name = path.posix.basename(file).toLowerCase();
        const similar = current.graph.nodes.filter(node => node.toLowerCase().endsWith(name)).slice(0, 10);
        throw new Error(`${file} is not in the indexed snapshot.` + (similar.length ? ' Did you mean: ' + similar.join(', ') : ''));
      }
      const { files, unanalyzed, modules, total, map, ...impact } = queryGraph(current.graph, { target: file, depth: args.depth });
      return { ...header(current), ...impact, coverage };
    },
    async architecture(args) {
      const current = await snapshot(args), folder = typeof args.folder === 'string' ? relative(current.repo, args.folder).replace(/\/+$/, '') : '';
      if (folder && !current.graph.nodes.some(node => node.startsWith(folder + '/'))) throw new Error(`${folder} has no indexed files.`);
      return { ...header(current), ...architectureMap(current.graph, folder) };
    }
  };
}

function createServer(tools) {
  const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
  const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  return async function handle(line) {
    let message;
    try { message = JSON.parse(line); } catch { return failure(null, -32700, 'Parse error'); }
    const { id, method, params = {} } = message || {};
    if (id === undefined || id === null) return; // Notifications need no response.
    if (method === 'initialize') return reply(id, {
      protocolVersion: protocols.includes(params.protocolVersion) ? params.protocolVersion : protocols.at(-1),
      capabilities: { tools: {} }, serverInfo: { name: 'chat-atlas', version },
      instructions: 'Read-only Chat Atlas engineering analysis of local Git repositories. Call quality_report first, then file_impact before changing a file.'
    });
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: definitions });
    if (method !== 'tools/call') return failure(id, -32601, `Method not found: ${method}`);
    if (!Object.hasOwn(tools, params.name)) return failure(id, -32602, `Unknown tool: ${params.name}`);
    try {
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(await tools[params.name](params.arguments || {})) }] });
    } catch (error) {
      return reply(id, { content: [{ type: 'text', text: error.message }], isError: true });
    }
  };
}

function serve(input = process.stdin, output = process.stdout) {
  const handle = createServer(createTools(loadCompiler()));
  readline.createInterface({ input }).on('line', async line => {
    if (!line.trim()) return;
    const response = await handle(line);
    if (response) output.write(JSON.stringify(response) + '\n');
  });
}

if (require.main === module) serve();
module.exports = { createServer, createTools, serve };
