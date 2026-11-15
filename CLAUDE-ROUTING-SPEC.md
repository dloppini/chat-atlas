# Claude routing requirements

- Support concurrent chats across projects in one VS Code window, with no reload, restart, workspace reordering, or interruption of other chats.
- Leave Claude's installed files unchanged. The user now accepts native editor tabs; retain Claude's own controls and authentication.
- Remove the 0.1.20 reload workaround and pending startup handoff. Retain the corrected sixth routing argument for the native sidebar.
- Cross-project create/resume opens Claude's native editor command with an explicit column. A serialized, one-shot directory bridge redirects only Claude's panel-construction realpath call in the current async context. Restore the filesystem function immediately on interception and in finally. Never redirect unrelated filesystem operations.
- Gate the bridge on the tested Windows Claude 2.1.323 bundle fingerprint. Unknown builds fail before opening a tab. Replace the bridge when Anthropic exposes a cwd argument. No project hooks, transcript copies, replacement UI, auth handling, or persistent Claude modifications.
- Resume uses the original UUID; native Claude reuses an open session. Closed chats are retrieved from the existing Atlas history index. New chats appear after the first message; untouched drafts remain native tabs.
- Preserve Codex routing, the Git dashboard, explicit terminal actions, and board restoration.
- Test isolation, restoration on failure, unsupported builds, invalid directories/IDs, parallel requests and native reuse. In isolated VS Code, verify two projects' original histories and launch cwd, new-chat cwd, close/reopen, unchanged host identity, and unchanged Claude files. No paid model requests are required for routing verification.
