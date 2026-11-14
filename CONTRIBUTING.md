# Contributing to Chat Atlas

Bug reports, feature requests, documentation improvements, and pull requests are welcome.

For an issue, include your VS Code version, operating system, Chat Atlas version, provider extension or CLI version, and steps to reproduce. Use fictional examples; remove conversation text, personal project paths, and credentials before posting logs or screenshots.

## Develop

Use Node.js 22 or newer. Clone the repository, run `npm ci`, then `npm run check` and `npm test`. On Windows PowerShell use `npm.cmd` if script execution is restricted. Press **F5** in VS Code to open an Extension Development Host.

`npm run preview` serves fictional chats at `http://127.0.0.1:4317`. It does not read your conversation history. `npm run package` builds an installable VSIX using the Marketplace staging workflow in `scripts/package.js`.

The published extension identity is `LPX.lpx-conversation-board`. Keep that identity for updates. The packager copies only runtime assets, removes development-only manifest fields, and uses the plain listing documents in `marketplace/`. The previous `chat-atlas` identifier was repeatedly rejected by Marketplace; the new identity and simplified package were accepted together. The exact server-side trigger was not identified, so do not assume that any single removed field caused it. Keep screenshots and detailed documentation in the repository README unless a future Marketplace update is validated explicitly.

Keep both providers supported, preserve stable ordering and reversible completion, and never modify provider transcripts. Native provider routes can change: keep routing changes in `src/providers.js` and describe which provider version you checked. Add focused tests when changing parsing, persistence, or resume behavior.

Contributions are licensed under the repository's MIT license.

## Architecture

`src/core.js` contains the bounded history readers, classifiers and stable metadata reconciliation; `src/extension.js` owns VS Code integration and storage; `media/` is the CSP-protected webview. The webview renders conversation content with `textContent`, and only validated UUIDs enter resume commands.

## Provider integration notes

Claude native routing was inspected and exercised with unmodified Anthropic extension `2.1.323`: the sidebar command selects its location, then the editor command receives the session ID and `{ programmatic: 'honor-preferred-location' }` as its sixth positional argument. Explicit editor actions omit this option. Claude may reuse a session already open in an editor; close that tab before resuming it in the sidebar.

Codex session routing was inspected in the installed extension `26.930.51102` (`/local/<id>` and `openai-codex://route/local/<id>`). These routes are implementation details, not a stable public API. A future provider update may require an adapter change. The exact native resume flow still needs a live user check; the board and extension activation are tested separately.

Integration references: [Codex IDE commands](https://developers.openai.com/codex/ide/commands), [Claude CLI resume](https://code.claude.com/docs/en/cli-reference), [VS Code webviews](https://code.visualstudio.com/api/extension-guides/webview).

Claude new chats open its sidebar and invoke `claude-vscode.newConversation`. Claude reads the first workspace folder, so a cross-project action promotes the target root while preserving all roots and labels. A short-lived request in global state survives the initial workspace transition; it moves into the destination workspace's state before reloading the same window, since `env.sessionId` changes on window reload. The board serializer restores its message handlers. Do not replace the reload with only an extension-host restart: rendered webviews can survive with disconnected handlers.

Native verification used an isolated, normally installed VS Code copy, unmodified Claude 2.1.323, and fictional histories. A-to-B-to-A resume loaded the exact histories in the native sidebar and retained the same window target. Claude's launch logs confirmed the requested directories and resume UUIDs; a new Project B chat launched in Project B. No authenticated model turn or production project permission/settings behavior was tested. Extension Development Host suppresses automatic workspace restarts, so it is insufficient to validate this handoff alone. See [VS Code workspace updates](https://code.visualstudio.com/api/references/vscode-api#workspace.updateWorkspaceFolders). Codex routing remains unchanged.
