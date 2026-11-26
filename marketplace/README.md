# Chat Atlas by LPX

Chat Atlas organizes local Codex and Claude Code conversation history in a visual board inside Visual Studio Code. It is an independent community project and is not affiliated with OpenAI or Anthropic.

## Start

Requires Visual Studio Code 1.96 or newer and local history from either supported provider. Run **Chat Atlas: Open Board** from the Command Palette, or press **Ctrl+Alt+A** on Windows and Linux or **Cmd+Alt+A** on macOS. While the board is focused, **Ctrl+N** (macOS: **Cmd+N**) starts a new chat in the selected project; change it with **Chat Atlas: Change New Chat Shortcut**.

## Engineering

Select a local Git project, open **Engineering**, and choose **Refresh analysis**. **Overview** shows the last observed branch, commit and working-tree counts. **Architecture** lists indexed files and resolved JS/TS imports, with links to source evidence. **Impact** traces dependents and copies a project-scoped Markdown brief. **Changes** opens the Git inspector, where **Analyze impact** starts from the current diff file.

Analysis uses local Git and the TypeScript compiler shipped with compatible desktop VS Code builds. Snapshots remain on the machine. Each project has **Clear snapshot**. Removed files, runtime relationships and unresolved imports can leave gaps in an impact report.

## Working across folders

- Set **Chat Atlas: Claude Tile Action** to **terminal** to focus an integrated terminal when you select a Claude chat title. Details also lets you explicitly open the chat window or start a hidden terminal.
- Choose **Details > Browse files in VS Code** to inspect a chat's working folder. Workspace folders open in Explorer. External folders appear in **Chat Atlas Files** in the same Explorer sidebar. Use its refresh button after files change.
- After moving or renaming a working folder, select the old project and choose **Reconnect folder**. Browse to its current location. Atlas keeps card notes and uses the original session ID to resume. Claude's terminal can find that ID across projects. Provider history files stay in place.
- On Windows, run **Chat Atlas: Enable Windows Explorer Project Menu** once. Right-click a folder or its background and choose **Create Chat Atlas project here** (under **Show more options** on Windows 11). Review the name and folder in the board, then create the project. Registration is per Windows user. Run **Chat Atlas: Remove Windows Explorer Project Menu** to uninstall the menu.


## Features

- Group conversations by topic, workflow status, or creation date.
- Search and filter by project or provider. Keep separate folders distinct, including folders with matching project names.
- Hide or restore project entries. Sort projects alphabetically or arrange them manually by dragging or Alt+Up/Down.
- Move tasks between projects while keeping the current project selected and sidebar visibility unchanged.
- Browse Timeline as a date-grouped list, or organize cards in Workflow and Topics. Resize the project sidebar on desktop; on narrow screens, open Projects from the workspace heading.
- Pin conversations, add notes, and mark tasks Done. Completion can be reversed.
- Preview the latest message and reopen conversations through an installed provider extension or its command-line tool.
- Browse for an existing project folder during creation or link it later. The project page shows its linked path and retains assigned conversations.
- See a running spinner and frame for unfinished tasks. Activity checks update every two seconds; completion and interruption stop the indicator when detected. The inactivity timeout is configurable.
- Start or resume chats in the current window. New Claude chats open in the sidebar. For another project, append your task below the folder instruction and press Send. Atlas uses the sent instruction to file the card. Existing chats resume by original ID and recorded directory. Its native toolbar and authentication remain in control. Retrieve a closed chat from its Atlas card; new cards appear after the first message.
- See a spinner beside sidebar project names while their chats have running tasks.

## Feedback

Use the **bug icon** beside Refresh to report a bug, request a feature, or view existing reports. The native VS Code picker opens [Chat Atlas Issues](https://github.com/dloppini/chat-atlas/issues) in your browser. New reports start as editable drafts with a `[Bug]` or `[Feature]` title and app, VS Code, and platform versions. GitHub sign-in is required to submit; reports are public. Conversation content, project paths and logs are not attached automatically.

## Git dashboard

Select a project and choose **Git** beside **+ Chat** to browse graphical commit history and branches. **All** shows local changes together, with yellow **M** for modified files and green **N** for new files. Select **Unstaged**, **Staged**, or **Untracked** for a narrower comparison. Git must be installed and the project folder must belong to a local repository. The dashboard shows the latest 100 commits, marks the checked-out HEAD, and compares the current branch with its upstream. Fetch updates remote references. Pull fast-forwards a clean working tree, and Push sends the current branch to its configured upstream without forcing. Merge comparisons use the first parent. Text previews are bounded, and binary files are identified without rendering their contents.

Stage or unstage the selected file from its diff toolbar, or use **Stage all / Unstage all** for the current comparison. Enter a **Commit message** (with an optional multiline description) and choose **Commit staged**. Only staged changes are included; drafts survive refresh, project switches and window reloads. Git identity, signing and hooks use your existing configuration.

For Azure DevOps Services repositories, **Create PR** opens the Azure PR creation form with the source branch selected. Push the branch first, then choose the target, title, description and reviewers in your authenticated browser and submit there. Azure HTTPS and SSH remotes are supported; choose the **PR remote** when more than one remote is configured. Self-hosted Azure DevOps Server is not detected.

Cross-project Claude tabs require verified Windows Claude Code bundles 2.1.323 and 2.1.325 through 2.1.330. Atlas opens these tabs beside the board and reuses the side group. A temporary directory bridge leaves installed Claude files and project settings unchanged. Unknown builds are rejected pending compatibility validation. Native tab restoration after a VS Code restart is not covered; retrieve saved chats through Atlas.

## Local data

The extension reads local conversation transcripts and selected repository history and file differences, and saves organization preferences in Visual Studio Code's extension state. It does not change provider transcripts, read provider authentication files, make network requests, or collect telemetry. It requires no API key.

Local history paths are configurable in **Settings > Chat Atlas**. Conversation previews are sampled for display; search indexes user and assistant messages throughout indexed transcripts. Remote hosts, archived sessions, and cloud-only history are not indexed automatically. Reopening a conversation requires an installed and signed-in provider extension or command-line tool; provider routing may change with provider updates. Claude create/resume routing was verified with local native fixture histories; authenticated model turns were not tested.

Organization preferences belong to each extension identity. This candidate uses **lpx.lpx-conversation-board**. Disable earlier Chat Atlas previews when switching to avoid duplicate commands; their organization preferences remain separate.

## Source and support

Source code, full usage documentation, and issue reporting are available in the public repository:

https://github.com/dloppini/chat-atlas

Released under the MIT license included in LICENSE.txt.

### Pick up and hand off work

- Right-click a local file in Explorer and choose **Chat Atlas: Find Chats for This File**. Select a result to resume the chat. Recorded edit and read actions appear before path mentions.
- Open a project and choose **Project pickup** for In progress and Waiting chats. Edit the next step in the chat’s handoff note.
- Search the board and choose **Passages** on a result, or use **Find passage…** in Details. Pick a message to open the match and the messages on either side in an editor.
- In Details, choose **Hand off…**, select an excerpt or write a decision, choose file paths, and enter the next step. Review the preview, then **Copy and open chat**. Paste into the new provider draft and send. Atlas links the chats in Details when it indexes the opening message with the source line.
