# Changelog

## 0.1.53 - 27 November 2026

- See when each conversation was last active: every card shows **Active 3h ago** (a date after 30 days), next to the created date outside Timeline.
- Sort conversations by **Last updated** or **Newest first** from the new **Sort** menu beside **Show done**. With **Last updated**, Timeline groups chats by the day they were last active. Your choice is remembered.
- Open and refresh the Git view faster: independent Git reads now run together, which matters most on Windows.

## 0.1.52 - 26 November 2026

- Start a new chat in the selected project with **Ctrl+N** (macOS: **Cmd+N**) while the board is focused. Change it with **Chat Atlas: Change New Chat Shortcut** or from the Chat Atlas settings.
- Understand each **Where to start** step in Quality: every recommendation explains why it matters and how to fix it.
- Skip `vendor` folders in Engineering analysis, like `node_modules` and build output.

## 0.1.51 - 25 November 2026

Includes the changes from the 0.1.50 preview package.

- Analyze MATLAB, Java, Kotlin, Scala, C#, Go, Rust, Swift, Dart, PHP, Ruby, Lua, R, Julia, shell and Objective-C projects in Engineering: complexity, complex functions, imports and by-name references (MATLAB path and package functions, same-folder classes), cycles and test reach, including tests matched by name such as FooTest.java or filtTest.m.
- Let Claude Code, Codex and other MCP clients query Engineering evidence through a local, read-only MCP server: quality report, file impact and architecture map. Choose **Connect agents** in Engineering, or run **Chat Atlas: Register MCP Server with Agents**, to register it with the installed agents.
- See each import cycle in Quality as its shortest loop, with the file and line where each file imports the next, and open the first import directly. The quality brief lists the same loop.
- Open Engineering from its own icon button in the board header, beside the Conversations and Git switch.
- Keep Git at the bottom of the board: **Keep at bottom** docks the Git view below your conversations as a compact, resizable pane that updates live as files and branches change. **Expand** returns to the full Git view.

## 0.1.49 - 25 November 2026

- Analyze C, C++, Arduino and Python projects in Engineering: includes and imports, complexity, complex functions, cycles and test reach. Header and implementation pairs appear as one unit on the dependency map.
- List large generated data files (images, fonts, sounds) without reading them, and mark files that are not analyzed with the reason.
- Highlight the selected Engineering view.
- Start new Claude chats and handoffs in the terminal when Claude chats are set to open there.

## 0.1.48 - 25 November 2026

- See Engineering architecture as a layered dependency map: drill into folders, trace a file's imports and importers, and spot cycles and hotspots at a glance.
- Review code quality in the new Quality view: hotspots (complexity × recent commits), complex functions, folder coupling, import cycles, files without importers and source not reached by tests, with a ranked Where to start list and a copyable quality brief for agents.

## 0.1.47 - 23 November 2026

- Open Git Local changes in All, with yellow M badges for modified files and green N badges for new files.

## 0.1.46 - 23 November 2026

- Keep Engineering refresh running through Windows file access-time notifications, temporary Git locks, and Git-ignored output. Real edits still mark the snapshot stale.

## 0.1.45 - 23 November 2026

- Open Engineering from a selected project to capture a local repository snapshot, explore JS/TS imports and review file impact with source evidence.
- Analyze a file from the Git diff inspector and copy a scoped impact brief.

## 0.1.44 - 22 November 2026

- Find chats for a file, review next steps by project, open matching passages with context, and prepare linked handoffs to Codex or Claude Code.

## 0.1.43 - 22 November 2026

- Scan conversations in a date-grouped Timeline list. Workflow and Topics keep their draggable cards.
- Open Projects from narrow windows without changing the desktop sidebar preference.
- Keep keyboard focus and in-progress edits in Details when conversation excerpts arrive.

## 0.1.40 - 22 November 2026

- Start a Claude sidebar draft for another project, append your task, and send it when ready. Atlas uses the folder instruction to file the card and the task for its fallback title. Added Claude 2.1.330 to the verified Windows resume builds.

## 0.1.36 - 21 November 2026

- Choose a focused integrated terminal or native chat window for Claude conversation titles.
- Browse chat files in the current VS Code window, reconnect moved project folders, and create a project from the optional Windows Explorer menu.

## 0.1.34 - 21 November 2026

- Open other projects' Claude chats beside the board and reuse the side editor group. Added compatibility for Windows Claude Code 2.1.326 through 2.1.329.

## 0.1.33 - 15 November 2026

- Add a header bug icon for reporting bugs, requesting features, and viewing existing GitHub issues.
- Open editable report drafts with version details while keeping conversation content private.

## 0.1.32 - 15 November 2026

- Stream large Git diffs into bounded previews, fixing stdout maxBuffer errors in local changes and commit inspection.
- Preserve UTF-8 text, file switching, and Git failure feedback when a preview is truncated.

## 0.1.31 - 15 November 2026

- Stage and unstage individual files or a full comparison without discarding working files.
- Commit staged changes with a multiline message, persistent project drafts, and stale-index validation.
- Publish branches without an upstream and open Azure DevOps PR creation for the pushed source branch.

## 0.1.30 - 15 November 2026

- Ignore Companion Page snapshots when deriving conversation titles, previews, and activity.
- Recover meaningful card titles when the saved Codex title contains full or truncated page metadata.

## 0.1.29 - 15 November 2026

- Mark the checked-out HEAD and distinguish it from the commit being inspected.
- Show upstream ahead/behind counts and compare focused branches with HEAD.
- Add Fetch, fast-forward Pull, and explicit upstream Push with progress, validation, and error feedback.

## 0.1.28 - 15 November 2026

- Fit the Git workspace to the window, giving local changes the remaining height instead of restoring a cramped legacy size.
- Compact history rows and repository controls; hide history for a larger code review area.
- Add saved line wrapping and layout preferences while retaining custom pane heights.

## 0.1.27 - 15 November 2026

- Restore cross-project Claude tabs for Windows Claude 2.1.325, retaining exact bundle compatibility checks.

## 0.1.26 - 15 November 2026

- Add saved Pearl and Dark themes with a VS Code theme option.
- Refine buttons with soft raised and inset surfaces and violet accents for primary actions.
- Improve heading hierarchy, theme contrast, focus states and responsive header controls.

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

- Remove the project reorder arrows from Manual sorting; retain drag-and-drop and Alt+Up/Down keyboard sorting.
- Keep the current project selected when moving a task, including moves into a new project or moving the last task out.
- Keep the project sidebar visible when task details are open in narrower desktop windows.

## 0.1.13 — 10 October 2026

- Show a spinner beside each sidebar project with running tasks, with its running count on hover.
- Start Codex project chats in the selected working folder in the current window, setting the folder in the background. Claude Code project chats require that folder to be open already.

## 0.1.12 — 10 October 2026

- Start new project chats in the selected project's working folder so their cards join that project. Open a separate project window when another workspace is active.

## 0.1.11 — 10 October 2026

- Keep the page and conversation lists at their current scroll position when selecting chats, opening or closing details, marking chats done, and refreshing the board.

## 0.1.10 — 9 October 2026

- Open the board in Timeline view and show the current version beneath the sidebar title.
- Keep new Codex and Claude Code chats in the current VS Code window, using its current workspace even when another Atlas project is selected.
- Remove the project-window handoff and pending startup chat requests.

## 0.1.9 — 9 October 2026

- Detect running tasks from reasoning, tool activity, completion, and interruption records even when start markers are absent from transcript samples.
- Update the running spinner and frame in place using file notifications and two-second activity checks; retain long-running tasks with a configurable 60-minute inactivity timeout.
- Browse for an existing folder during project creation, or link one later from the project page.
- Show the linked folder beneath the project title and keep conversation assignments and sidebar preferences when linking.
- Open new project chats in the provider's native VS Code UI, with a project-window handoff when another folder is selected.

## 0.1.8 — 9 October 2026

- Keep terminal resume sessions hidden and make CLI resume an explicit action.
- Add optional subfolder filters and editable project placement, with new projects that can link to an existing folder.
- Show a running indicator and frame for recent unfinished turns.
- Start new Codex or Claude Code chats in the provider's native VS Code UI, opening a project window when needed.
- Order the board tabs as Timeline, Workflow, and Topics.

## 0.1.7 — 8 October 2026

- Publish Chat Atlas by LPX as `LPX.lpx-conversation-board` in the VS Code Marketplace.
- Retain the complete conversation board and both provider integrations.
- Use the accepted plain listing and minimal package metadata for future builds.

## 0.1.6 — 8 October 2026

- Give the extension listing the descriptive name Chat Atlas - Local Conversation Board.
- Align the publisher identifier with the publisher dashboard and the license reference with its packaged filename.
- Use descriptive board keywords and a direct, versioned screenshot URL.
- Package only the listed runtime files, documentation, and PNG assets.

## 0.1.5 — 8 October 2026

- Clarify the extension description, publisher attribution, license, category, and support links.
- Keep Marketplace documentation focused on using the board, with development and integration details in the contributor guide.

## 0.1.4 — 7 October 2026

- Prepare Chat Atlas for Marketplace publishing under LPX.

## 0.1.3 — 7 October 2026

- Resize the project sidebar by dragging its right edge or using the arrow keys, and retain its width when reopening the board.
- Double-click the edge or press Enter to restore the default width.
- Keep the conversation board responsive as the sidebar grows or the window narrows.

## 0.1.2 — 7 October 2026

- Remove projects from the sidebar and restore them through Hidden projects.
- Choose alphabetical or manual project sorting. Drag projects or use the up/down controls to reorder them.
- Remember hidden projects and manual order across board reopenings and VS Code restarts.

## 0.1.1 — 7 October 2026

First community release of Chat Atlas.

- Organize local Codex and Claude Code conversations by topic, workflow, or timeline.
- Search and filter conversations, pin important chats, and keep handoff notes.
- Mark conversations Done and reopen them without changing the original chat.
- Focus a single column and hide the project sidebar for more room.
- Preview the latest conversation message while keeping cards in chronological order.
- Add the Chat Atlas icon to the extension, editor tab, and board.
- Combine equivalent Windows path spellings and show paths for separate folders with matching project names.

## 0.1.0 — 6 October 2026

Initial local preview.
