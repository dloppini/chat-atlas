# Changelog

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
