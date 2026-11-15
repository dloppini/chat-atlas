> Rejected: the user requires Claude native controls. The current solution uses native editor tabs; see CLAUDE-ROUTING-SPEC.md. This API sidebar proposal is not implemented.

# Optional Claude API sidebar

Status: feasibility verified; interface choice pending. This is a proposed addition, not a shipped feature.

## Requirement

Run Claude chats for unrelated project folders concurrently in one VS Code window. Never reload the window, reorder its folders, or stop another chat when changing the visible conversation. Keep Chat Atlas's project board, cards, status controls, and existing native Claude route.

The user's wording about changing controls is interpreted as preserving the overall controls and behavior. Native Claude's toolbar is preferred, but its implementation is private to that extension and cannot be embedded through a supported API.

## Concrete proposed interface

An optional Chat Atlas sidebar would show the selected conversation and project path, with a compact conversation selector. Its composer would group the model selector, Default / Plan / Accept edits mode, Send, and Stop. Tool permission requests and clarifying questions would appear in the conversation that owns them. Switching visible chats would leave the others running. API connection setup would sit in the sidebar toolbar; keys would be stored in VS Code SecretStorage and never sent to the webview or written to workspace settings.

The existing native route and native toolbar would remain available. API sessions would be clearly labeled as using API billing, with no silent change from subscription authentication. Native-only features would not be claimed as preserved merely because a similar button exists.

## Supported engine

Use the official Claude Agent SDK, with one independent query/runtime and cwd per conversation, resume by its original UUID, explicit project configuration loading, and per-session approval callbacks. Stop affects only its owning query. SDK model and permission setters provide control behavior; the UI must supply its own widgets.

Anthropic's SDK guidance does not permit third-party products to offer claude.ai login without approval. Therefore the supported proposed Atlas sidebar uses API credentials. Subscription chats retain the existing native Claude route and its current directory-routing limits.

## Evidence collected on 14 November 2026

An isolated probe loaded the published Agent SDK 0.3.325 and used the unchanged installed Claude 2.1.323 executable. It concurrently initialized Project A and Project B with distinct spawn cwd values, discovered five models, switched each query to plan and back to default, and exercised interrupt. Initialization succeeded independently for both. The probe used a dummy API key, a loopback-only API endpoint, an isolated config folder, and no model prompt. This proves process initialization and control transport, not authenticated generation, billing, permission UI, transcript resumption, or a finished sidebar.

Probe and machine-readable results: ignored `output/claude-api-probe/probe.cjs` and `result.json`. No runtime dependency or chat UI was added to the extension, and its installation was not changed during this feasibility check.

## Acceptance checks for implementation

- Run A and B concurrently through a controlled API fixture; switching views, changing model/mode, answering an approval, and stopping A must not affect B.
- Resume exact IDs in their recorded folders; keep credentials out of logs, UI messages, and transcripts authored by Chat Atlas.
- Exercise denial, cancelled approval, startup failure, process exit, unavailable folder, and pending tool questions without silently allowing tools.
- Verify the sidebar at wide and narrow widths in both themes, including keyboard interaction and permission controls.
- Distinguish fixture checks from a real API-key smoke test; do not send a paid model request merely to test setup.

## References

- [Agent SDK overview and authentication restriction](https://code.claude.com/docs/en/agent-sdk/overview)
- [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Approval and question handling](https://code.claude.com/docs/en/agent-sdk/user-input)
- [Missing native directory argument](https://github.com/anthropics/claude-code/issues/91097)
