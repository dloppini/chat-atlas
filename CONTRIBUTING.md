# Contributing to Chat Atlas

Bug reports, feature requests, documentation improvements, and pull requests are welcome.

For an issue, include your VS Code version, operating system, Chat Atlas version, provider extension or CLI version, and steps to reproduce. Use fictional examples; remove conversation text, personal project paths, and credentials before posting logs or screenshots.

## Develop

Use Node.js 22 or newer. Clone the repository, run `npm ci`, then `npm run check` and `npm test`. On Windows PowerShell use `npm.cmd` if script execution is restricted. Press **F5** in VS Code to open an Extension Development Host.

`npm run preview` serves fictional chats at `http://127.0.0.1:4317`. It does not read your conversation history. `npm run package` builds an installable VSIX.

Keep both providers supported, preserve stable ordering and reversible completion, and never modify provider transcripts. Native provider routes can change: keep routing changes in `src/providers.js` and describe which provider version you checked. Add focused tests when changing parsing, persistence, or resume behavior.

Contributions are licensed under the repository's MIT license.
