const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function workshopRoot() {
    if (process.env.LATEX_WORKSHOP_ROOT) return path.resolve(process.env.LATEX_WORKSHOP_ROOT);
    for (const folder of ['.vscode-server/extensions', '.vscode/extensions', '.vscode-insiders/extensions']) {
        const base = path.join(os.homedir(), folder);
        if (!fs.existsSync(base)) continue;
        const entries = fs.readdirSync(base).filter(name => name.startsWith('james-yu.latex-workshop-'))
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        if (entries.length) return path.join(base, entries[0]);
    }
    throw new Error('Install LaTeX Workshop or set LATEX_WORKSHOP_ROOT to its extension directory.');
}
function chromiumPath() {
    if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
    const base = path.join(os.homedir(), '.cache/ms-playwright');
    if (fs.existsSync(base)) {
        for (const name of fs.readdirSync(base).filter(n => n.startsWith('chromium-')).sort().reverse()) {
            for (const suffix of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
                const executable = path.join(base, name, suffix);
                if (fs.existsSync(executable)) return executable;
            }
        }
    }
    throw new Error('Set CHROMIUM_PATH to a Chromium/Chrome executable for browser checks.');
}
module.exports = { workshopRoot, chromiumPath };
