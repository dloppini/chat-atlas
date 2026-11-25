'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { createEngineering } = require('../src/engineering');

async function run() {
  const compiler = require(path.resolve(process.argv[2]));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-engineering-benchmark-'));
  const projects = [], state = new Map();
  let last;
  const engineering = createEngineering({ storage: { get: key => state.get(key), update: async (key, value) => state.set(key, structuredClone(value)) },
    catalog: () => projects, post: message => { last = message; }, local: true, compiler: () => compiler });
  const request = (type, project, id) => engineering.handle({ type, projectKey: project.key, requestId: id });
  try {
    for (let index = 0; index < 10; index++) {
      const cwd = path.join(root, String(index));
      await fs.mkdir(cwd);
      execFileSync('git', ['init', '--quiet'], { cwd });
      const count = index ? 24 : 2000;
      for (let start = 0; start < count; start += 40) await Promise.all(
        Array.from({ length: Math.min(40, count - start) }, (_, offset) => {
          const n = start + offset;
          return fs.writeFile(path.join(cwd, `module-${n}.ts`), n ? `import "./module-${n - 1}"; export const value = ${n};\n` : 'export const value = 0;\n');
        })
      );
      projects.push({ key: String(index), cwd });
    }
    const cold = performance.now();
    await request('engineeringRefresh', projects[0], 0);
    const coldMs = performance.now() - cold;
    if (last.snapshot?.graph?.files !== 2000) throw new Error('Medium fixture was not indexed.');
    for (const project of projects.slice(1)) await request('engineeringRefresh', project, 0);
    const timings = [];
    for (let id = 1; id <= 100; id++) {
      const project = projects[id % projects.length], start = performance.now();
      await request('engineeringRead', project, id);
      timings.push(performance.now() - start);
      if (last.projectKey !== project.key || !last.snapshot) throw new Error('Warm summary was missing or mis-scoped.');
    }
    timings.sort((a, b) => a - b);
    console.log(JSON.stringify({ platform: process.platform, cpu: os.cpus()[0].model, compiler: compiler.version, projects: 10,
      mediumFiles: 2000, coldMs: Math.round(coldMs), warmSummaryP50Ms: timings[49], warmSummaryP95Ms: timings[94] }, null, 2));
  } finally {
    engineering.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
