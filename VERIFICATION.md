# Verification — 6 October 2026

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
