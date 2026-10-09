# Chat Atlas by LPX

A local VS Code extension that gives Codex and Claude Code conversations a stable home. Topics stay visible, cards keep their position when messages arrive, and a Done checkbox separates finished tasks from active work.

## Start

Install [Chat Atlas by LPX](https://marketplace.visualstudio.com/items?itemName=LPX.lpx-conversation-board) from the VS Code Marketplace, or run:

```powershell
code --install-extension LPX.lpx-conversation-board
```

Run **Chat Atlas: Open Board** from the Command Palette, or press **Ctrl+Alt+A** (macOS: **Cmd+Alt+A**). After first activation, **Chat Atlas** is also available in the status bar. Keep the board in the editor while working in the provider sidebar.

The published extension ID is `LPX.lpx-conversation-board`. Earlier packages used `local-tools.chat-atlas` or `lpx.chat-atlas`, separate extension identities with separate organization metadata. When switching, disable earlier installations to avoid duplicate commands. Existing transcripts are unaffected.

The current local package is **chat-atlas-0.1.10.vsix**. Published installers are available from the [latest GitHub release](https://github.com/dloppini/chat-atlas/releases/latest). Use **Extensions → … → Install from VSIX…** to install a package.

![Chat Atlas topic board with fictional Codex and Claude Code conversations](https://raw.githubusercontent.com/dloppini/chat-atlas/v0.1.6/media/board-preview.png)

Requires VS Code 1.96 or newer and local conversation history from Codex or Claude Code. An installed provider extension or CLI is needed to resume chats. Chat Atlas is an independent community project, unaffiliated with OpenAI or Anthropic.

## Use the board

- The board opens in **Timeline** view. The installed version appears beneath **Chat Atlas** at the top of the project sidebar.
- **Topics** automatically groups new conversations using local keyword rules against titles and the first prompt. Initial topics cover interface, fixes, features, research, releases, and general work. Use **+ Topic** to define a subject and its matching keywords. This is deterministic grouping, not an AI semantic classifier.
- **Workflow** groups the same cards into Inbox, In progress, Waiting, and Done. Progress is set by you; it does not pretend to know whether an agent is running or waiting for approval.
- Cards with an unfinished turn show a **Running** ring and thin frame. Chat Atlas recognizes start, reasoning, tool, completion, and interruption records from Codex and Claude Code, including long and partially written transcripts. File notifications and a two-second activity check update the indicator without rebuilding the board. Completion and interruption stop it as soon as they are detected. The default inactivity timeout is 60 minutes; increase **Settings → Chat Atlas → Running Timeout Minutes** for longer tools or builds. Activity is inferred from local history, so a provider that buffers its transcript can delay the indicator. It is separate from the manual Workflow status.
- Columns use taller scrolling lists. Click **Focus** in any column header to show only that group with more room for its conversations. Click **Exit focus** or press **Escape** to return to the board; each view retains its scroll positions. Focus survives refreshes; a focused Timeline day also survives reopening the board. Switching between Topics, Workflow, and Timeline returns to the overview.
- **Timeline** shows creation dates, newest first. All views order cards by creation time so new messages do not reshuffle them. New conversations enter at their chronological position.
- Tick **Done** on any card. It is saved locally and hidden from the active board. Enable **Show done** to see finished cards, then untick to reopen one. This never archives or deletes the original conversation.
- Click a card title to resume it. Use **Details** for excerpts, editable board titles, topic/progress selectors, and a handoff note. These selectors also provide a keyboard alternative to drag and drop.
- Drag cards between topics or workflow columns. Manual topic choices are retained. Existing cards are not automatically reclassified after a new topic is created.
- Pin important chats with the star. Their shortcuts remain visible above the board.
- Use the sidebar toggle beside the page heading to hide or show the project list and give the board more space. Your choice is remembered when you reopen the board. Narrow layouts continue to hide the sidebar automatically.
- Drag the sidebar's right edge to resize it. Its width is saved across board reopenings and VS Code restarts. Focus the edge and use the arrow keys to adjust it, or double-click it (or press Enter) to restore the default width. The board adapts to the available space.
- Cards preview the latest conversation message, skipping internal context metadata. Handoff notes remain available in Details.
- Filter by project/provider or search titles, latest message previews, topics, projects, and notes. Press **/** to focus search. **Escape** closes details.
- Equivalent Windows path spellings share one project entry. Different folders with the same project name stay separate and show their paths below the name. Hover an entry to see its full folder path.
- Choose **Show subfolders** beneath **PROJECTS** to see one folder level below each project. The parent project still shows all its conversations, and hiding the folder level restores the original project view. Chat Atlas suggests a folder when the recorded working directories clearly point to one; use **Details → Subfolder within project** to assign or correct a conversation. Chats without a clear folder remain under **Project root**. Folder choices are saved with the card and do not change the original transcript or its working directory.
- Projects follow each conversation's recorded working folder by default. In **Details → Project**, choose another existing project or create one for an exception; choose **Automatic** to restore folder-based grouping. The warning in Details explains that manual placement only changes Chat Atlas. Use the **+** beside **PROJECTS** to create an empty project. Enter an existing folder path or choose **Browse…** when creating it; leaving the folder blank creates a board-only label. You can select that project later and use **Link folder…** beneath its title to add a folder while keeping its assigned chats. Linked folder paths appear in the project subheader, and future chats started there group automatically. Neither option creates a folder or changes a transcript.
- Select a folder-backed project and click **+ Chat**, or use the **+** beside its name, to start a new Codex or Claude Code chat in the provider's native UI in the current VS Code window. The chat uses that window's current workspace; choosing an Atlas project does not switch folders or open another window. The provider extension must be installed and signed in. Its card appears after you send the first message and return to the board, grouped by the conversation's recorded working folder. For a project without a folder, **+ Chat** opens the folder-linking dialog first.
- Use **×** beside a project to remove its sidebar entry. Its chats remain in **All projects**; use **Hidden projects** to restore it. Choose **A–Z** or **Manual** beside **PROJECTS**. In Manual mode, drag projects or use their up/down buttons. Your manual order is retained when switching to alphabetical sorting, and sidebar preferences survive reopening the board and restarting VS Code.

## Provider integration

| Provider | Discovery | Resume |
| --- | --- | --- |
| Codex | `CODEX_HOME/sessions`, otherwise `~/.codex/sessions`; titles from `session_index.jsonl` | Installed `openai.chatgpt` sidebar via session URI; optional editor beside board; explicit CLI action |
| Claude Code | `CLAUDE_CONFIG_DIR/projects`, otherwise `~/.claude/projects` | Installed `anthropic.claude-code` sidebar; existing editor session reused when already open; explicit CLI action |

Chat Atlas opens an existing conversation through its installed provider extension. If that extension is unavailable, Chat Atlas shows an error instead of opening a terminal. The separate **Start in hidden terminal** action runs the corresponding CLI without revealing the Terminal panel; open that panel when you want to interact with it. The CLI must be installed and signed in. Provider integration can change with provider updates. The native resume flows have not been verified live for this release; parser and routing checks use fixtures. See [integration notes](https://github.com/dloppini/chat-atlas/blob/main/CONTRIBUTING.md#provider-integration-notes) for the tested versions and routing details.

Only local history is indexed. Cloud-only chats, Codex archived sessions, Claude subagent transcripts, and remote hosts are not discovered automatically. Local source folders can be changed in **Settings → Chat Atlas**. The extension runs on the local UI host in SSH/WSL windows; explicitly point it at an accessible history folder when needed.

## Local data and limits

The extension has no production dependencies, network requests, telemetry, model calls, or API-key requirement. It reads conversation files and stores only organization metadata in VS Code's extension global state (per profile, shared between workspaces). It does not modify provider transcripts or read provider authentication files. Conversations are sampled in memory: up to 256 KiB from the start and 128 KiB from the end, with recent plain-text excerpts shown in Details. This is not full-transcript search.

The default limit is 1,000 recent transcript files per provider, configurable up to 10,000. Full refresh runs every 20 seconds while the board is visible; activity checks run every two seconds, and file notifications can discover new conversations sooner. Cached file signatures avoid rereading unchanged transcripts. Scan errors and missing folders are visible on the board. Completion, notes, and grouping survive VS Code restarts. Separate VS Code windows should not edit the same board metadata simultaneously in this first version; cross-window conflict resolution is not implemented.

## Development

See [Contributing](https://github.com/dloppini/chat-atlas/blob/main/CONTRIBUTING.md) for development setup, the fictional-data preview, architecture, and provider integration notes.

## Community

[Report a bug or suggest a feature](https://github.com/dloppini/chat-atlas/issues). Please remove private conversation text and personal paths from reports. See [Contributing](https://github.com/dloppini/chat-atlas/blob/main/CONTRIBUTING.md) for development guidance. Released under the [MIT license](https://github.com/dloppini/chat-atlas/blob/main/LICENSE.txt).
