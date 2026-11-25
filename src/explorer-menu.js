'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const run = require('node:util').promisify(execFile);

async function configureExplorerMenu(context, scheme, enable) {
  if (process.platform !== 'win32' || !/^[a-z][a-z0-9+.-]*$/.test(scheme)) throw new Error('This menu requires VS Code on Windows.');
  const helper = path.join(context.globalStorageUri.fsPath, 'explorer-project.ps1');
  const system = path.join(process.env.SystemRoot, 'System32');
  const reg = path.join(system, 'reg.exe');
  if (enable) {
    await fs.mkdir(context.globalStorageUri.fsPath, { recursive: true });
    await fs.copyFile(path.join(context.extensionPath, 'scripts', 'explorer-project.ps1'), helper);
  }
  for (const [location, placeholder] of [['Directory', '%1'], ['Directory\\Background', '%V']]) {
    const key = `HKCU\\Software\\Classes\\${location}\\shell\\ChatAtlasProject-${scheme}`;
    if (enable) {
      const powershell = path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const command = `"${powershell}" -NoProfile -ExecutionPolicy RemoteSigned -NonInteractive -WindowStyle Hidden -File "${helper}" -Scheme "${scheme}" -Folder "${placeholder}\\."`;
      await run(reg, ['add', key + '\\command', '/ve', '/d', command, '/f'], { windowsHide: true });
      await run(reg, ['add', key, '/ve', '/d', 'Create Chat Atlas project here', '/f'], { windowsHide: true });
    } else {
      try { await run(reg, ['query', key], { windowsHide: true }); }
      catch (error) { if (error.code === 1) continue; throw error; }
      await run(reg, ['delete', key, '/f'], { windowsHide: true });
    }
  }
  if (!enable) await fs.rm(helper, { force: true });
}
module.exports = { configureExplorerMenu };
