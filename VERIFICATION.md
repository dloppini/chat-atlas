# Verification — 6 October 2026

## Project moves and manual sorting — 10 October 2026

- Local version 0.1.14 removes the Manual sorting arrow buttons, retaining native drag-and-drop and Alt+Up/Down keyboard reordering. Alphabetical sorting and the saved manual order remain available.
- Moving a task to an existing or newly created project retains the current project selection and open details. The selected source project stays in the sidebar after its last task moves away. Explicit sidebar visibility is preserved; details overlay the board at narrower desktop widths instead of hiding the project rail or its toggle.
- JavaScript checks and all 44 Node tests passed. The browser preview passed 57 project-move/sorting checks at 1440, 1000, 800, 681, and 390 pixels, plus all 30 existing scroll checks. Desktop and phone screenshots were inspected; the design detector reported no findings in the changed JavaScript and CSS.
- Packaged and installed 0.1.14 locally. Installed board JavaScript, CSS, and HTML hashes match source. Existing windows need **Developer: Reload Window**. The actual VS Code webview and Marketplace acceptance of this version were not exercised; browser checks use fictional preview conversations.

## Background project chats and sidebar activity — 10 October 2026

- Local version 0.1.13 supersedes the separate-window behavior in 0.1.12. Codex creates a persisted empty chat with the selected project folder through its shipped runtime, then opens that chat in the current sidebar. No workspace switch or prompt is sent. Claude Code's public command has no folder override; a different folder is rejected rather than starting in the wrong project.
- All 44 Node tests, JavaScript checks, and the diff whitespace check passed. Tests cover runtime initialization, folder validation, persistent naming, process cleanup, provider routing, and folder-backed card association. A separate smoke check against the installed Codex runtime created a chat in an isolated temporary home and resumed it in another process with the same ID and working folder. No signed-in request or model turn was made.
- The shared browser preview passed 15 sidebar activity checks and all 30 scroll checks at 1440, 800, and 390 px. Project indicators update in place, count manually assigned and filtered running tasks, clear when the last task stops, and respect reduced motion. Desktop and mobile screenshots were inspected. The design detector reported no findings in the changed board JavaScript and CSS.
- Packaged and installed 0.1.13; installed runtime files match the tested source and startup handoff activation is absent. Signed-in native sidebar launch and the live VS Code webview remain unverified. Existing windows need Developer: Reload Window to activate this update.

## Project chat working folders — 10 October 2026

- New project chats use the selected project's folder. A single matching workspace launches directly; a different, empty, or multi-root workspace opens a separate folder window, which consumes the saved launch request on startup. Requests expire after five minutes, wait for workspace trust, and are claimed once across matching windows.
- All 43 Node tests and JavaScript checks passed, covering both providers, equivalent Windows paths, source-window exclusion, concurrent claims, reload replay prevention, failed handoff cleanup, empty/multi-root workspaces, trust, expiry, and automatic card association with folder-backed projects. Inspected the installed Codex 26.1007.21434 command: New Chat accepts no folder argument and starts through its webview.
- The browser preview passed the project-key launch check and dialog checks at 1440 and 390 px; both screenshots were inspected. Packaged and installed local version 0.1.12 and verified installed runtime files and startup activation match the tested source. Signed-in provider launch and actual cross-window startup were not exercised; local tests simulate the VS Code/provider command boundary. Existing windows need Developer: Reload Window to activate this update.

## Scroll position preservation — 10 October 2026

- Preserve page and column positions before changing detail layout; build replacement board content offscreen and restore scrolling without moving keyboard focus into view. Selection notices also retain the page position.
- All 42 Node tests and JavaScript checks passed. The reusable preview check in `scripts/check-scroll-browser.cjs` passed 30 assertions across 1440, 800, and 390 px layouts, including details, resume selection, Done/reopen, host replies, refresh, and scrolled Topics, Workflow, and focused Timeline columns. Desktop and mobile screenshots were inspected; no horizontal overflow was detected.
- Packaged and installed local version 0.1.11. These checks used fictional conversations in the shared browser preview; signed-in provider resume and the live VS Code webview were not exercised. Existing windows need Developer: Reload Window to activate the installed update.

## Timeline startup and sidebar version — 9 October 2026

- The board starts in Timeline even when Topics or Workflow was saved previously. Focus from another view is discarded; project, search and sidebar preferences remain available.
- Display the package version beneath Chat Atlas at the top of the project sidebar, using the same manifest value in VS Code and the demo preview.
- A clean dependency install, all 42 Node tests and JavaScript checks passed. Browser preview checks passed for first open, reopening after Topics and Workflow, the visible sidebar version at 1440 and 800 pixels, spinner start/stop updates without replacing the card, and a 390-pixel layout without horizontal overflow. Screenshots use fictional conversations; live provider-to-webview behavior was not exercised.

## Current-window new chats — 9 October 2026

- Removed the project-folder window handoff and pending startup chat routing. New chats invoke the installed Codex or Claude Code extension in the current window and use its current workspace.
- All 42 Node tests and JavaScript checks passed, including both providers when another Atlas project is selected and when no workspace is open.
- Packaged and installed local version 0.1.10. Installed runtime files match the tested source, and the obsolete startup activation is absent. Existing VS Code windows need Developer: Reload Window to activate the update. Live signed-in provider UI behavior was not exercised.

## Local release 0.1.9 — 9 October 2026

- Fetched the GitHub remote and confirmed the local source has no missing remote commits. Included the folder controls, running-task improvements and native project-chat changes in version 0.1.9; package.json and package-lock.json agree.
- All 42 Node tests, JavaScript checks and the diff whitespace check passed. The standard Marketplace staging workflow produced chat-atlas-0.1.9.vsix, and its runtime files and listing documents match the local source byte for byte.
- Updated the clean LLMUtils checkout with a fast-forward pull, passed all 13 installer smoke-test groups, and archived the release through its importer. latest.json selects 0.1.9 with SHA256 7aee089cc336861814c67fee4e156b3af2a1f0d3ad3007449f7fbe0adef21469.
- Installed through the internal installer and verified lpx.lpx-conversation-board@0.1.9. Installed runtime files match the archive; its package.json matches after allowing VS Code's generated metadata. Existing board state and earlier packages were retained. The user's VS Code windows were not reloaded; reloading activates the installed update in existing windows.

## Running task detection — 9 October 2026

- Recognize Codex prompts, reasoning, both tool-call formats, final-answer phases, completion and interruption; recognize Claude thinking, tool results, stop reasons, turn duration and interruption prompts.
- Keep activity observations through sampling gaps, partial or oversized appends, malformed non-record lines and clock skew. Metadata-only writes do not revive expired tasks. The inactivity timeout defaults to 60 minutes and is configurable.
- Watch provider history folders with a two-second polling fallback while the board is visible. Activity messages update the spinner and frame in place. Timers and watchers are disposed with the board, and readings superseded by a full refresh are discarded.
- All 42 Node tests and JavaScript checks passed. Browser checks passed for matching spinner/frame transitions, unchanged DOM during repeated activity updates, retained scrolling, all three board views, a 390 px layout and reduced motion. Screenshots use fictional chats.
- A read-only check of local transcript record types confirmed compatibility with the current Codex and Claude formats. Live provider-to-webview operation was not exercised; providers that buffer transcript writes can still delay detection.

## LPX Marketplace package — 7 October 2026

- Set the publisher to the user-provided `LPX` ID and incremented the package to 0.1.4. Documented the separate identity used by earlier local previews.
- All 15 Node tests and JavaScript checks passed. The packaging validator accepts the publisher ID, and the VSIX manifest identifies LPX as its publisher.
- Marketplace upload remains pending publisher dashboard access; no local publishing credential is configured.

## Resizable sidebar — 7 October 2026

- Added a pointer- and keyboard-accessible separator at the sidebar's right edge. Width is saved with the existing sidebar preferences; double-click or Enter restores the default, and Escape cancels a drag.
- Sidebar width stays within 180–520 px and leaves room for the board. Conversation columns adapt to their container rather than only the window width.
- All 15 Node tests and JavaScript checks passed. Browser demo checks passed for native pointer dragging, bounds, arrow/Home/End controls, cancellation, reset, hide/show, retained manual order, and restored width after discarding the prior webview state.
- Checked 1440, 1200, 1100, 800, 681, and 390 px window widths without page-level horizontal overflow. The sidebar remains hidden on narrow layouts and restores its preferred width when the window grows.
- Screenshots contain fictional conversations. Persistence was checked through the shared preview's durable preference store; a live VS Code restart was not exercised.

## Sidebar management — 7 October 2026

- Added reversible project hiding, a Hidden projects restore dialog, alphabetical sorting, and manual ordering with native drag/drop and keyboard-accessible up/down controls.
- Sidebar preferences are persisted separately in extension global state, allowing restoration after the webview is recreated.
- All 15 Node tests and JavaScript checks passed. Browser demo checks passed for alphabetical/manual switching, retained manual order, arrow controls, native mouse drag/drop, hiding and restoring multiple projects, recovery after hiding the selected project, refresh persistence, recreation without the prior webview state, and no horizontal overflow at 390 px.
- Verified that sidebar removal retains every original demo conversation. The screenshot was updated with fictional chats only.
- These browser checks use the shared webview preview with a separate durable preference store; a live VS Code restart was not exercised for this change.

## Community release and project identities — 7 October 2026

- Added the extension, editor-tab, and board icon; prepared public installation instructions, changelog, contribution guidance, and cross-platform packaging CI.
- Equivalent Windows path spellings now share one project entry. Different folders with matching names retain separate filters and show a path beneath the name.
- JavaScript checks and all 14 Node tests passed. Browser demo checks passed for equivalent-path counts, separate-folder counts and filters, selection persistence, migration of previous saved path filters, icon loading, and a 390 px layout without horizontal overflow.
- Release screenshots contain fictional conversations. No source transcripts or local board state are included in the source repository or VSIX.
- Browser checks exercise the shared webview through the preview. Live signed-in provider resume remains unverified as described below.

## Column height and focus — 7 October 2026

- Conversation lists now allow 60% of the viewport height, up from 31%; focused groups use a taller area and responsive card grid.
- Browser checks passed with fictional conversations: focus and exit in Topics, Workflow, and Timeline; reload persistence; focused refresh scrolling; separate overview/focus scroll positions; filtered conversation counts; recoverable empty searches; Escape closes details before exiting focus; switching views restores the overview.
- Desktop (1440 × 1000) and narrow (390 × 844) screenshots were inspected. Both the focused and overview narrow layouts had no horizontal overflow.
- JavaScript syntax checks and all 10 existing Node tests passed. These browser checks exercise the shared webview assets through the demo preview, not a live VS Code webview.

## Project sidebar toggle — 7 October 2026

- Added an accessible hide/show control beside the heading; the collapsed state is saved with the board preferences.
- Browser demo checks passed for hide/show, gained board width, retained project filtering, persistence after reload, retaining the focused column, and no horizontal overflow at 390 px. The desktop screenshot was inspected.
- JavaScript syntax checks and all 10 existing Node tests passed. The updated VSIX was packaged and installed; browser checks used the demo rather than a live VS Code webview.

## Latest conversation previews — 7 October 2026

- Cards now preview the latest user or assistant message, with handoff notes retained in Details.
- Internal page-context messages and citation blocks are excluded from previews and excerpts.
- All 13 Node tests and JavaScript syntax checks passed, including both providers, mixed context/text, cached refreshes, and bounded transcript sampling.
- A read-only scan of local history confirmed that the reported telemetry conversation uses its latest clean message. No conversation text was saved to the repository or preview.
- Live VS Code webview rendering was not checked for this change.

## Original extension verification

- JavaScript syntax checks passed.
- 10 Node tests passed: both transcript formats, ignored instruction/tool content, subagent exclusion, malformed records, bounded sampling, changing-file cache, retained completion/topic/note state, and both native routing adapters.
- A separate VS Code 1.140.0 Extension Development Host activated the extension, read fixture sessions through actual settings, saved board metadata, and opened the webview tab. The initial tab assertion ran before VS Code's tab event; the test now waits for the event to become observable and passes.
- Browser checks passed with fictional conversations: tick Done, show completed cards, untick/reopen, persistence after reload, note editing, topic reassignment, topic creation, native mouse drag/drop, project/view rendering, search and search persistence, stable card order after activity changes, stable per-column scroll after refresh, and card-open message dispatch.
- The 390 px layout had no page-level horizontal overflow. Desktop and narrow screenshots are in `output/playwright/`.
- A read-only scan of this computer's Codex history discovered 577 primary conversations from 595 transcript files in approximately 1.7 seconds, with no scan errors or missing project paths. Actual conversation content was not copied into the repository or browser preview.
- `npm audit` reported no vulnerabilities after upgrading the development packaging tool to version 4. The installed extension has no production dependencies.
- The VSIX was packaged and installed as `local-tools.chat-atlas@0.1.0`.

Native resume routes are source-inspected and unit-tested, not end-to-end verified with a signed-in conversation. Codex routing was inspected in the locally installed 26.930.51102 extension. Claude routing was inspected in Anthropic's published 2.1.289 extension package, downloaded temporarily and removed after inspection. Claude is not installed on this computer, so its history reader was verified with fixtures rather than live sessions. Provider updates can change these internal integration points. The explicit terminal action remains available.
