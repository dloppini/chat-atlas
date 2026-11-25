# Chat Atlas Engineering Control Center

The implementation follows the brief's MVP boundary, phases 0–2. Chat Atlas's project catalog remains the source of project identity. The existing Conversations and Git views retain their routes and behavior. Overview, Architecture and Impact share the same selection. Changes opens the existing Git worktree and diff inspector.

The extension host resolves local folders and worktrees, runs bounded read-only discovery, and owns versioned, project-scoped snapshots. The webview remembers engineering controls alongside existing UI preferences. Jobs stay with their originating project and responses are correlated by project and request. Existing board data needs no migration.

Use Git for worktree evidence and VS Code's bundled TypeScript compiler for JS/TS indexing when compatible. No repository scripts, project-local modules or third-party analyzer executables are loaded. The graph exposes only static file relationships with source evidence. Unsupported resolution and missing historical evidence stay visible.

Keep the existing VS Code, Pearl and Dark palettes, project sidebar and narrow drawer. Integrate routes and contextual actions into existing header groups. Use compact, accessible evidence lists and a bounded dependency neighborhood.

Before changes, syntax checks passed and the Node suite reported 88 passed and one skipped. Validate project isolation with disposable repositories, including shared Git worktrees, dirty files and known dependency relationships. Run the existing checks and packaging path after each implemented phase.

## Usage

1. Select a folder-backed project from the sidebar or run **Chat Atlas: Select Project**.
2. Open **Engineering**, then choose **Refresh analysis**. Use a Git version supporting absolute common-directory paths. The graph uses the compiler that ships with compatible local VS Code installations.
3. Open **Architecture**, filter by file name or top-level folder, and select a file. Use the source-evidence buttons to jump to the relevant line. The neighborhood shows incoming and outgoing static imports.
4. The **Architecture** dependency map lays out the direct children of the current folder in layers: arrows point from code to what it imports, so foundations sit at the bottom. Hover or focus a node to trace its links; select a folder to open it or a file to inspect it. Red dashed links mark import cycles, an orange dot marks a hotspot, and the bar under each node shows its share of lines.
5. Open **Quality** for hotspots (complexity × commits in the last 180 days), complex functions, folder coupling (instability = efferent ÷ (afferent + efferent)), import cycles, files without static importers and source not reached from tests. **Where to start** ranks the next refactors; **Copy quality brief** puts them on the clipboard as Markdown for an agent.
6. Open **Impact** and choose a trace depth, or start from **Analyze impact** in the Git diff inspector. Review affected folders and candidate tests. **Copy agent brief** puts a scoped Markdown report on the clipboard.
7. Use **Changes** to review staged, unstaged, untracked and historical diffs in the existing Git inspector.

## Storage and rollback

The extension stores up to 12 versioned snapshots in VS Code global state, keyed by the project identifier and canonical folder. Snapshots record Git identity, branch and HEAD, counts, input fingerprints, file paths and import locations. Snapshots exclude source file contents. On restart, the last snapshot is stale until refreshed. Select **Clear snapshot** before rolling back to remove a project's data. Installing an older VSIX leaves conversation storage and project preferences available.

## Coverage

- The nearest Git worktree is associated with the linked folder. Remote and virtual projects and board-only labels have no analysis. Non-Git folders show an explicit state.
- Local JS/TS analysis uses literal import references and the closest local tsconfig.json or jsconfig.json compiler options. Extended configs, runtime relationships, Git submodules, package-manager-specific resolution and historical source graphs remain outside its coverage. The Git summary disables executable attribute filters, which can affect dirty counts for filtered paths.
- The analyzer considers at most 4,500 files, 512 KiB per source, 24 MiB of input and 18,000 references. Browser queries page the file list and limit dependents to 100 nodes over at most six levels.
- Quality metrics are static: complexity counts decision points (if, loops, case, catch, &&, ||, ??) per file and function body; test reach follows imports from test files; entry points come from package.json main, bin, exports and script paths. Files loaded at runtime (HTML, config, dynamic import) can appear without importers or untested. Commit counts read at most 400 commits from the last 180 days. Snapshots taken before this release need a refresh to show the map and Quality view.
- Explicit refreshes start a scan. Two projects can analyze concurrently. A canceled, interrupted or failed scan preserves prior evidence. OpenSpec, external health analyzers, check execution and the portfolio are later work.

## Verification

Run `npm.cmd run check`, then `npm.cmd test`. Set `ATLAS_TEST_TYPESCRIPT` to the bundled `typescript.js` path to include the live compiler fixture. Run `npm.cmd run preview` and execute `scripts/check-engineering-browser.cjs` with Playwright CLI's `run-code --filename` command to reproduce the preview layout and switching checks.

The suite passed 90 tests with one existing skip. Playwright passed Overview, Architecture and Impact at 390, 800 and 1440 px in Pearl and Dark, including keyboard navigation and project-switch isolation with fixture data.

Run `node scripts/benchmark-engineering.js <path-to-bundled-typescript.js>` for a host-only benchmark. On Windows with an Intel i7-7820HQ and TypeScript 6.0.3, the initial 2,000-file snapshot took 6.08 s. Across 100 cached reads over 10 disposable repositories, host p50 was 0.26 ms and p95 was 0.69 ms. These timings exclude the extension-host transport and webview rendering.
