# Claude routing fix

- All chats stay in the current VS Code window; Claude's installed files and runtime remain unchanged.
- Default resume and new-chat actions request Claude's sidebar. Explicit editor actions retain tab routing.
- Claude reads the first workspace folder. Promote the requested project to that position with the VS Code workspace API, preserving every other root and its display name. Persist a short-lived window-specific request before the change, transfer it to the destination workspace state, and reload the same window. Consume it once on startup in the matching folder.
- Open the requested session ID, or a new conversation, automatically in Claude's sidebar after the reload. Expire stale requests, reject unavailable directories, and clean up failed handoffs.
- Restore the Chat Atlas webview after the reload. Refuse a workspace change while indexed chats report running work, since restarting extensions could interrupt them.
- Preserve Codex routing. Do not open another window, rewrite transcripts, patch Claude, or override shared filesystem functions.
- Verify A-to-B-to-A routing and real native history loading in an isolated VS Code window. This provides one-window operation with a window reload, not Codex's uninterrupted per-thread directory switching.
