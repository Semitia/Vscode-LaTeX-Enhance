const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = require('../vscode-extension/package.json');
const output = path.join(root, 'dist', `vscode-latex-enhance-${manifest.version}.vsix`);
fs.mkdirSync(path.dirname(output), { recursive: true });
function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
run('npx', ['--yes', '@vscode/vsce@4.1.0', 'package', '--allow-missing-repository', '-o', output], path.join(root, 'vscode-extension'));
if (process.argv.includes('--install')) run('code', ['--install-extension', output, '--force'], root);
