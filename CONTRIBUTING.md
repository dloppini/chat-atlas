# Contributing to Chat Atlas

Bug reports, feature requests, documentation improvements, and pull requests are welcome.

For an issue, include your VS Code version, operating system, Chat Atlas version, provider extension or CLI version, and steps to reproduce. Use fictional examples; remove conversation text, personal project paths, and credentials before posting logs or screenshots.

## Develop

Use Node.js 22 or newer. Clone the repository, run `npm ci`, then `npm run check` and `npm test`. On Windows PowerShell use `npm.cmd` if script execution is restricted. Press **F5** in VS Code to open an Extension Development Host.

`npm run preview` serves fictional chats at `http://127.0.0.1:4317`. It does not read your conversation history. `npm run package` builds an installable VSIX.

Keep both providers supported, preserve stable ordering and reversible completion, and never modify provider transcripts. Native provider routes can change: keep routing changes in `src/providers.js` and describe which provider version you checked. Add focused tests when changing parsing, persistence, or resume behavior.

Contributions are licensed under the repository's MIT license.

## Architecture

`src/core.js` contains the bounded history readers, classifiers and stable metadata reconciliation; `src/extension.js` owns VS Code integration and storage; `media/` is the CSP-protected webview. The webview renders conversation content with `textContent`, and only validated UUIDs enter resume commands.

## Provider integration notes

Claude native routing was inspected in Anthropic's published extension `2.1.289`: the sidebar command selects its location, then the editor command receives the session ID and `honor-preferred-location`. Without that extension/command pair, the fallback runs `claude --resume <session-id>` in a VS Code terminal, requiring the CLI to be installed and signed in. The parser and routing are fixture-tested; live Claude integration has not been verified for this release.

Codex session routing was inspected in the installed extension `26.930.51102` (`/local/<id>` and `openai-codex://route/local/<id>`). These routes are implementation details, not a stable public API. A future provider update may require an adapter change. The exact native resume flow still needs a live user check; the board and extension activation are tested separately.

Integration references: [Codex IDE commands](https://developers.openai.com/codex/ide/commands), [Claude CLI resume](https://code.claude.com/docs/en/cli-reference), [VS Code webviews](https://code.visualstudio.com/api/extension-guides/webview).
