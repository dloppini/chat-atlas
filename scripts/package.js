'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output');
fs.mkdirSync(output, { recursive: true });
const stage = fs.mkdtempSync(path.join(output, 'package-'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
// Preserve the accepted Marketplace shape while retaining local development scripts.
delete manifest.scripts;
delete manifest.devDependencies;
delete manifest.qna;
delete manifest.galleryBanner;
const runtimeFiles = [
  'LICENSE.txt',
  'src/extension.js', 'src/core.js', 'src/providers.js',
  'media/board.html', 'media/board.css', 'media/board.js', 'media/projects.js', 'media/icon.png',
];

try {
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const file of runtimeFiles) {
    const destination = path.join(stage, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  for (const file of ['README.md', 'CHANGELOG.md']) {
    fs.copyFileSync(path.join(root, 'marketplace', file), path.join(stage, file));
  }
  const included = ['package.json', 'README.md', 'CHANGELOG.md', ...runtimeFiles];
  fs.writeFileSync(path.join(stage, '.vscodeignore'), '**\n' + included.map(file => '!' + file).join('\n') + '\n');
  const cli = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce');
  const destination = path.join(root, `chat-atlas-${manifest.version}.vsix`);
  const result = spawnSync(process.execPath, [cli, 'package', '--no-dependencies', '--out', destination], { cwd: stage, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`VSIX packaging failed with exit code ${result.status}`);
} finally {
  // Remove only this invocation's generated staging directory within output/.
  const resolvedStage = path.resolve(stage);
  if (!resolvedStage.startsWith(path.resolve(output) + path.sep) || !/^package-/.test(path.basename(resolvedStage))) {
    throw new Error('Refusing to remove a staging directory outside output/');
  }
  fs.rmSync(resolvedStage, { recursive: true, force: true });
}
