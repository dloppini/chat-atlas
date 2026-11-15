# Changelog

## 0.1.25 - 15 November 2026

- Replace the Git text button with an accessible branch icon.
- Make diffs easier to read with larger text, tighter gutters, and compact patch headers.
- Give the diff more room by default and reduce file-list space on narrow screens.

## 0.1.24 - 15 November 2026

- Focus Git history on local or remote branches from the Tree toolbar or branch labels.
- Remember branch focus per project while preserving the open diff and pane heights.
- Load focused history directly from Git and recover when a saved branch is unavailable.

## 0.1.23 - 15 November 2026

- Improve Git history with coloured branch paths and named branch badges.
- Compact the Git header and remember independent tree and diff heights.
- Clarify file diffs with sticky filenames, change counts, and correct line highlighting.

## 0.1.22 - 14 November 2026

- Create and retrieve cross-project Claude chats in native editor tabs without reloading VS Code or changing workspace roots.
- Keep Claude's own toolbar, permissions, and authentication; reuse open sessions by their original ID.
- Guard the directory bridge against unverified Claude builds (validated on Windows 2.1.323); leave installed Claude files unchanged.

## 0.1.21 - 14 November 2026

- Remove automatic window reloads and workspace reordering for Claude chats.
- Keep native sidebar routing for the first workspace folder and report unsupported cross-project actions without interrupting running chats.

## 0.1.20 - 14 November 2026

- Switch between conversations and a read-only Git dashboard for the selected project.
- Browse graphical commit history, branches, and changed files with highlighted, line-numbered diffs.
- Inspect staged, unstaged, untracked, and committed changes, including first-parent merge comparisons.

- Open Claude conversations in its native sidebar by default.
- Create and resume Claude chats across projects in one VS Code window, retaining workspace folders and restoring the board after a same-window reload.
- Block project switching when indexed chats are running, and validate and expire pending handoffs.

## 0.1.19 - 4 November 2026

- Rename projects on the board while retaining their folders and chat assignments.
- Open new Codex chats without waiting for the background helper to finish shutting down.
- Use conversation text for titles when saved titles are placeholders or skill invocations.

## 0.1.18 - 19 October 2026

- Search user and assistant messages throughout indexed conversations, including the middle of long chats.
- Cache conversation search text and refresh it when transcript files change.

## 0.1.17 - 17 October 2026

- Select all tasks in a section or individual tasks and change their status in one batch. Selection respects the current filters.

## 0.1.16 ? 12 October 2026

- Open the selected project folder or subfolder in Windows Explorer from the folder path.

## 0.1.15 ? 11 October 2026

- Leave new project chats untitled so Codex can generate a title from the conversation.

## 0.1.14 — 10 October 2026

- Remove the Manual sorting arrows; reorder projects by dragging or Alt+Up/Down instead.
- Keep your current project and sidebar visibility when moving tasks between projects.

## 0.1.13 — 10 October 2026

- Show a spinner beside projects with running tasks and their running count on hover.
- Start Codex project chats in the selected folder in the current window. Claude Code requires that folder to be open already.

## 0.1.12 — 10 October 2026

- Start chats in the selected project's working folder and keep their cards under that project, opening a separate project window when needed.

## 0.1.11 — 10 October 2026

- Keep your scroll position when selecting chats, opening or closing details, marking chats done, and refreshing the board.

## 0.1.10 — 9 October 2026

- Open in Timeline view and display the installed version at the top of the project sidebar.
- Open new Codex and Claude Code chats in the current VS Code window and workspace, including when another Atlas project is selected.

## 0.1.9 — 9 October 2026

- Browse for a project folder during creation or link one later, and show the linked path beneath the project title.
- Preserve conversation assignments and sidebar preferences when linking a folder.
- Detect running tasks from reasoning, tool activity, completion, and interruption records, including sampled or partially written transcripts.
- Update the running spinner and frame in place with file notifications and two-second activity checks, and allow a configurable inactivity timeout.
- Open new project chats in the provider's native VS Code UI, with a project-window handoff when another folder is selected.

## 0.1.8 — 9 October 2026

- Keep terminal resume sessions hidden and make CLI resume an explicit action.
- Add optional subfolder filters and editable project placement, with new projects that can link to an existing folder.
- Show a running indicator and frame for recent unfinished turns.
- Start new Codex or Claude Code chats in the provider's native VS Code UI, opening a project window when needed.
- Order the board tabs as Timeline, Workflow, and Topics.

## 0.1.7

- Prepare a separate first-publication candidate with a distinct extension identifier and a plain Marketplace listing.
- Retain the complete conversation board, project controls, and both provider integrations from version 0.1.6.
