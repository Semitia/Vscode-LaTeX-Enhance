const { spawnSync } = require('node:child_process');
const path = require('node:path');
for (const name of ['check', 'pdf-context-check', 'translation-check', 'ai-translation-check', 'libretranslate-check']) {
    const result = spawnSync(process.execPath, [path.join(__dirname, '../tests', name + '.cjs')], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
