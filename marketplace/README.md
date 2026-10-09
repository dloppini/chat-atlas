# Chat Atlas by LPX

Chat Atlas organizes local Codex and Claude Code conversation history in a visual board inside Visual Studio Code. It is an independent community project and is not affiliated with OpenAI or Anthropic.

## Start

Requires Visual Studio Code 1.96 or newer and local history from either supported provider. Run **Chat Atlas: Open Board** from the Command Palette, or press **Ctrl+Alt+A** on Windows and Linux or **Cmd+Alt+A** on macOS.

## Features

- Group conversations by topic, workflow status, or creation date.
- Search and filter by project or provider. Keep separate folders distinct, including folders with matching project names.
- Hide or restore project entries. Sort projects alphabetically or arrange them manually.
- Resize the project sidebar and focus individual board columns.
- Pin conversations, add notes, and mark tasks Done. Completion can be reversed.
- Preview the latest message and reopen conversations through an installed provider extension or its command-line tool.
- Browse for an existing project folder during creation or link it later. The project page shows its linked path and retains assigned conversations.
- See a running spinner and frame for unfinished tasks. Activity checks update every two seconds; completion and interruption stop the indicator when detected. The inactivity timeout is configurable.
- Start new project chats in the provider's native UI in the current VS Code window, using its current workspace.

## Local data

The extension reads local conversation transcript files and saves organization preferences in Visual Studio Code's extension state. It does not change provider transcripts, read provider authentication files, make network requests, or collect telemetry. It requires no API key.

Local history paths are configurable in **Settings > Chat Atlas**. Conversation files are sampled for display, so search does not cover entire transcripts. Remote hosts, archived sessions, and cloud-only history are not indexed automatically. Reopening a conversation requires an installed and signed-in provider extension or command-line tool; provider routing may change with provider updates and its native flows have not been verified live for this release.

Organization preferences belong to each extension identity. This candidate uses **lpx.lpx-conversation-board**. Disable earlier Chat Atlas previews when switching to avoid duplicate commands; their organization preferences remain separate.

## Source and support

Source code, full usage documentation, and issue reporting are available in the public repository:

https://github.com/dloppini/chat-atlas

Released under the MIT license included in LICENSE.txt.
