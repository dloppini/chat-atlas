async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => {
    localStorage.removeItem('atlasDemoUi');
    localStorage.removeItem('atlasDemoData');
    localStorage.removeItem('atlasDemoSidebar');
  });
  await page.reload();
  await page.evaluate(() => {
    const atlas = window.atlasPreview;
    const post = atlas.postMessage;
    const graph = { files: 2, modules: 1, edges: 1, engine: 'fixture', sourceFiles: 2, unresolved: 0 };
    const edge = { from: 'src/app.test.ts', to: 'src/shared.ts', line: 1, distance: 1 };
    atlas.postMessage = m => {
      if (m.type === 'engineeringRead' || m.type === 'engineeringRefresh') {
        const isAtlas = m.projectKey.toLowerCase().includes('chat atlas');
        window.postMessage({ type: 'engineeringResult', projectKey: m.projectKey, requestId: m.requestId,
          state: isAtlas ? 'Current' : 'Never analyzed',
          snapshot: isAtlas ? { time: 1780000000000, graph, repo: {
            root: 'C:/Code/chat-atlas', branch: 'main', head: 'abc0123456789', subject: 'Example fixture', counts: { staged: 0, unstaged: 1, untracked: 0 }
          } } : undefined });
      } else if (m.type === 'engineeringQuery') {
        const files = ['src/app.test.ts', 'src/shared.ts'].filter(file => file.includes(m.query));
        window.postMessage({ type: 'engineeringGraph', projectKey: m.projectKey, requestId: m.requestId,
          graph: { files, modules: ['src'], total: files.length, selected: ['src/app.test.ts', 'src/shared.ts'].includes(m.target) ? m.target : '', direct: [edge], dependencies: [],
            dependents: [edge], tests: [edge.from], affected: ['src'], unresolved: [] } });
      } else post(m);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Chat Atlas, 1 conversations', exact: true }).click();
  await page.getByRole('button', { name: 'Engineering', exact: true }).click();
  await page.getByRole('heading', { name: 'Repository' }).waitFor();
  await page.getByRole('button', { name: 'Architecture', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect src/shared.ts', exact: true }).click();
  await page.getByRole('heading', { name: 'Selected file' }).waitFor();
  const checks = [];
  for (const theme of ['pearl', 'dark']) {
    await page.evaluate(theme => window.postMessage({ type: 'theme', theme }), theme);
    for (const width of [1440, 800, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const view of ['Overview', 'Architecture', 'Impact']) {
        await page.getByRole('button', { name: view, exact: true }).click();
        const heading = { Overview: 'Repository', Architecture: 'Selected file', Impact: 'Candidate tests' }[view];
        await page.getByRole('heading', { name: heading, exact: true }).waitFor();
        const metrics = await page.evaluate(() => {
          const bounds = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
          return { overflow: document.documentElement.scrollWidth > innerWidth,
            views: bounds('#project-views'), actions: bounds('.header-utilities'), refresh: bounds('#engineering-refresh'),
            nav: bounds('.engineering-toolbar > .segments') };
        });
        if (metrics.overflow || metrics.views.right > width || metrics.actions.right > width || metrics.nav.right > width ||
          (width === 390 && metrics.refresh.height < 44)) throw Error(JSON.stringify({ theme, width, view, metrics }));
        if (view === 'Architecture' && width !== 800) await page.screenshot({ path: `output/playwright/engineering-${theme}-${width}.png` });
        checks.push([theme, width, view]);
      }
      await page.getByRole('button', { name: 'Changes', exact: true }).click();
      await page.locator('.git-patch').waitFor();
      const impact = page.getByRole('button', { name: 'Analyze impact', exact: true });
      const box = await impact.boundingBox();
      if (!box || box.x < 0 || box.x + box.width > width) throw Error('Git impact action overflows at ' + width);
      await impact.click();
      await page.getByText('The target is absent from this snapshot.', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Inspect src/shared.ts', exact: true }).click();
      await page.getByRole('heading', { name: 'Candidate tests', exact: true }).waitFor();
    }
  }
  await page.keyboard.press('/');
  if (!(await page.locator('#engineering-search:focus').count())) throw Error('Engineering search shortcut did not focus the search');
  await page.setViewportSize({ width: 1440, height: 900 });
  const other = page.locator('#projects .project-entry').filter({ hasNotText: 'Chat Atlas' }).first().locator('button.nav');
  await other.click();
  await page.getByText('Never analyzed', { exact: true }).waitFor();
  await page.evaluate(() => window.postMessage({ type: 'engineeringState', projectKey: 'path:c:/code/chat atlas', state: 'Stale' }));
  if (await page.getByRole('heading', { name: 'Candidate tests' }).count()) throw Error('Previous project content leaked');
  await page.getByRole('button', { name: 'Chat Atlas, 1 conversations', exact: true }).click();
  await page.getByRole('heading', { name: 'Candidate tests' }).waitFor();
  await page.keyboard.press('Control+g');
  if (await page.locator('#conversation-switch:focus').getAttribute('aria-pressed') !== 'true') throw Error('Ctrl+G did not return to Chats');
  if (errors.length) throw Error(errors.join('\n'));
  return checks;
}
