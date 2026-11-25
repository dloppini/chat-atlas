'use strict';
const path = require('node:path');

function registerFiles(vscode, context, activity) {
  let root, view;
  const changed = new vscode.EventEmitter();
  const provider = {
    onDidChangeTreeData: changed.event,
    async getChildren(parent) {
      if (!parent) return root ? [{ uri: root, folder: true }] : [];
      const entries = await vscode.workspace.fs.readDirectory(parent.uri);
      return entries.map(([name, type]) => ({
        uri: vscode.Uri.joinPath(parent.uri, name),
        folder: !!(type & vscode.FileType.Directory)
      })).sort((a, b) => Number(b.folder) - Number(a.folder) || a.uri.path.localeCompare(b.uri.path));
    },
    getTreeItem(node) {
      const state = vscode.TreeItemCollapsibleState;
      const item = new vscode.TreeItem(node.uri, node.folder ? (node.uri === root ? state.Expanded : state.Collapsed) : state.None);
      item.tooltip = node.uri.fsPath;
      if (!node.folder) item.contextValue = 'atlasFile';
      const mark = !node.folder && activity.lookup(node.uri);
      if (mark) {
        item.iconPath = new vscode.ThemeIcon('file', mark.color);
        item.description = mark.tooltip;
      }
      if (!node.folder) item.command = { command: 'vscode.open', title: 'Open file', arguments: [node.uri] };
      return item;
    }
  };
  context.subscriptions.push(activity.onChange(() => { if (view) changed.fire(); }), changed, vscode.commands.registerCommand('chatAtlas.refreshFiles', () => changed.fire()));
  return async folder => {
    const uri = vscode.Uri.file(folder);
    if (vscode.workspace.getWorkspaceFolder(uri)) {
      await vscode.commands.executeCommand('revealInExplorer', uri);
      return;
    }
    root = uri;
    if (!view) {
      view = vscode.window.createTreeView('chatAtlas.files', { treeDataProvider: provider });
      context.subscriptions.push(view);
    }
    view.description = path.basename(folder);
    changed.fire();
    await vscode.commands.executeCommand('setContext', 'chatAtlas.browsingFiles', true);
    await vscode.commands.executeCommand('chatAtlas.files.focus');
  };
}
function registerActivity(vscode, context) {
  const changed = new vscode.EventEmitter();
  const key = file => process.platform === 'win32' ? file.toLowerCase() : file;
  let files = new Map();
  const provider = {
    onDidChangeFileDecorations: changed.event,
    provideFileDecoration(uri) {
      const label = uri.scheme === 'file' && files.get(key(uri.fsPath));
      if (label) return { badge: '\u25cf', color: new vscode.ThemeColor('charts.green'), tooltip: label };
    }
  };
  context.subscriptions.push(changed, vscode.window.registerFileDecorationProvider(provider));
  function update(sessions) {
    const labels = new Map();
    for (const session of sessions) {
      if (!session.running || !session.cwd || !path.isAbsolute(session.cwd)) continue;
      for (const name of session.activeFiles || []) {
        if (!name || name.includes('\0')) continue;
        const file = path.resolve(session.cwd, name);
        const relative = path.relative(session.cwd, file);
        if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue;
        const id = key(file);
        if (!labels.has(id)) labels.set(id, new Set());
        labels.get(id).add(session.provider === 'claude' ? 'Claude' : 'Codex');
      }
    }
    const next = new Map([...labels].map(([id, providers]) => [id, [...providers].sort().join(' and ') + ' - recent file activity']));
    const dirty = [...new Set([...files.keys(), ...next.keys()])].filter(id => files.get(id) !== next.get(id));
    files = next;
    if (dirty.length) changed.fire(dirty.map(id => vscode.Uri.file(id)));
  }
  return { update, lookup: provider.provideFileDecoration, onChange: changed.event };
}
module.exports = { registerFiles, registerActivity };
