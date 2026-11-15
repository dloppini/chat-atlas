# Claude sidebar integration evidence

## Current status: native editor tabs in 0.1.22

The user relaxed the sidebar requirement while retaining Claude's native controls, simultaneous project work, one window, no reloads, and unchanged installed Claude files. Cross-project create/resume now uses native editor tabs. Same-project sidebar behavior remains available.

The installed Windows 2.1.323 panel constructor resolves its default directory through fs.realpathSync. Chat Atlas temporarily substitutes only that call, within its own AsyncLocalStorage context, for the selected directory. Requests are serialized, the function is restored immediately on interception and in finally, and an explicit editor column avoids deferred group construction. Other filesystem calls retain their real paths. The bundle SHA-256 is checked before activation or dispatch; unverified builds are rejected. No installed extension file, transcript, or project hook is edited.

The bridge was informed by [Claude Folder's published architecture](https://marketplace.visualstudio.com/items?itemName=opdify.claude-folder). Its repository links returned 404; no third-party source was copied. Our narrower Windows bridge was implemented and tested independently.

### Verification on 14 November 2026

An isolated portable VS Code loaded the unchanged Claude extension and the actual src/claude-tabs.js implementation. Fixture A and B histories were shown in native tabs. The lifecycle test opened both, closed B, reopened its original UUID, created a new B tab, and retrieved A/B without duplicating the tabs. A stayed open throughout. The extension-host PID remained 37388 and the session identifier remained 7fd433c8-02bb-4535-82c5-877e54d3df4c1794619795060; the only workspace root stayed Project A. The filesystem function was restored. Native launch/config logs show separate A/B directories, and the webview launch requests carry resume IDs for the restored conversations.

The live frames contained each project's distinct fixture history and Claude's own model, effort, and permission controls. New B retained its own native tab. Evidence is under ignored output/claude-tabs-test (result.jsonl, native-histories.json, final-native.png, and the isolated profile's Claude logs). Automated tests: 60 passing, including concurrent requests, out-of-context filesystem calls, failures, unknown versions/bundles, invalid directories/UUIDs, provider dispatch and existing Codex flows. Syntax and whitespace checks pass. The updated project dialog was inspected at 1440, 768 and 390 pixels in dark/light themes, with keyboard order and Escape checks.

These are native routing and history-retrieval checks, not authenticated model-turn proof. No real model prompt was submitted. Paid API turns, subscriber turns, project tool execution and automatic native tab restoration after a later VS Code restart remain unverified. Retrieve saved chats through Atlas; close a stale restored tab first if necessary. Claude updates require repeating compatibility checks before accepting a new fingerprint.

### Local installation

Chat Atlas 0.1.22 was installed through the VS Code CLI. All 15 installed extension files match the VSIX (ignoring VS Code installation metadata in package.json). VSIX SHA-256: `5dd9ea30eaac8eb87fb80be0b639230e36d1350fdfa51cfdb02368335e58b1c3`. Claude's extension bundle fingerprint remains unchanged. The user's active window was not reloaded; existing extension hosts may need the next normal restart to activate this one-time update. No project switch invokes a reload.

## Historical 0.1.21 rollback

The reload workaround was removed before the native-tab approach. Cross-project actions then failed without changing workspace state. The optional API-sidebar proposal was subsequently rejected because native controls are required.

## Historical 0.1.20 result

Chat Atlas 0.1.20 opens Claude chats in the same VS Code window without modifying Claude. For another project, it promotes that directory to the first workspace root, retains all other roots and their labels, reloads the same window, restores the board, then opens the exact session or a new chat in the native sidebar.

This is a reload-based workaround. It cannot provide Codex-style uninterrupted switching between concurrently running projects. Indexed running work blocks the switch. Claude may reuse an already-open editor session; close that tab before requesting the sidebar.

## Why this route

Inspection and the read-only `scripts/probe-claude-routing.js` probe of installed Claude 2.1.323 established:

- `claude-vscode.editor.open` takes six positional arguments. The sixth routing argument must contain `{ programmatic: 'honor-preferred-location' }` for sidebar preference.
- Sidebar construction takes the first workspace root; native activation does not forward arbitrary cwd options. Its session resolver searches that project and related worktrees.
- Internal frontend sessions can retain separate directories, but this capability has no complete public command for arbitrary-project sidebar routing.
- The published `opdify.claude-folder` workaround temporarily replaces shared filesystem methods to influence editor creation. That does not retarget the existing sidebar. No implementation was copied or applied.

The user explicitly chose to keep Claude's installation unchanged. At that stage no local patch or runtime bridge was used. Version 0.1.22 adds the scoped, temporary native-tab bridge described above; installed files still remain unchanged.

## Native checks, 14 November 2026

An isolated portable VS Code installation used the packaged Chat Atlas extension and unchanged Claude 2.1.323. Two fictional projects contained distinct completed histories. No authenticated model prompt was submitted.

- Resume B, resume A: both exact histories rendered in Claude's native sidebar (`purpose=webviewView`) with their original UUIDs. The Electron window target remained `7EEB3377CBAC0CAF51A00A017E1ED7A6` throughout.
- Starting from a plain single-folder window also succeeded: VS Code created an untitled workspace containing B and A, kept the same window, and Claude loaded B with its original UUID.
- Both folders remained in the workspace; `Project A retained` kept its custom label. The board restored and accepted the next action after each reload.
- Claude's own launch log showed `cwd` matching each project and the corresponding original resume UUID.
- New chat in B opened the native sidebar and logged a launch with B's cwd and no resume UUID.
- Extension Development Host suppresses automatic folder-change restarts, so validation used a normally installed package. An extension-host-only restart could leave webviews with disconnected message handlers; the final flow uses a window reload.
- `env.sessionId` changes on reload. The first handoff is scoped to the originating window, then transferred to the destination workspace's persisted state before reload. Requests expire after two minutes and are consumed once.

Regression tests cover directory validation, command routing, original UUID/editor intent, root preservation, concurrent requests, running-work rejection, reload failure cleanup, trust, expiry, and changing session identity. Native fixture checks do not establish authenticated model execution, project-specific instructions/permissions, or behavior after future Claude updates.

Local screenshots and logs are under ignored `output/claude-native-test/`.

## References

- [VS Code workspace API](https://code.visualstudio.com/api/references/vscode-api#workspace.updateWorkspaceFolders)
- [VS Code webview restoration](https://code.visualstudio.com/api/extension-guides/webview#serialization)
- [Experimental Claude Folder extension](https://marketplace.visualstudio.com/items?itemName=opdify.claude-folder)

## Earlier isolated local installation

Version 0.1.20 was installed through the VS Code CLI. Runtime files were compared byte-for-byte against the isolated VSIX (the manifest comparison ignores VS Code's installation metadata). Package SHA-256: `7e0101535a2dd6eace12fd796228ce02776ee23137c04464395df1ffbbde7b37`.

Concurrent Git dashboard work appeared during final packaging. The installed artifact was built from the previously tested board plus this fix, with 56 tests passing in that isolated staging tree. Parallel source edits were preserved; they are not part of this installed artifact. The running user window was not reloaded automatically.

The final combined 0.1.20 release also includes the Git dashboard. Its package supersedes the isolated artifact described above; that earlier SHA-256 identifies only the Claude routing verification build.
