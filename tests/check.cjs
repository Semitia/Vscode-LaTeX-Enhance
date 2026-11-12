'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const base = path.resolve(__dirname, '..');
const patcher = require('../vscode-extension/patcher.cjs');

(async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zoom-mod-check-'));
    const storage = path.join(temporary, 'storage');
    const backup = path.join(base, 'tests/fixtures/original');
    const sourceRoot = require('./environment.cjs').workshopRoot();
    const loaderRelative = 'out/viewer/latexworkshop.js';
    const cssRelative = 'viewer/latexworkshop.css';
    const originalLoader = await fs.readFile(path.join(backup, loaderRelative), 'utf8');
    const originalCss = await fs.readFile(path.join(backup, cssRelative), 'utf8');
    const html = await fs.readFile(path.join(sourceRoot, 'viewer/viewer.html'), 'utf8');
    const hostRelative = 'out/src/preview/viewer.js';
    const connectionRelative = 'out/viewer/components/connection.js';
    const cleanBridge = source => source.replace(/\/\* SURGERII_PDF_CONTEXT_BEGIN \*\/[\s\S]*?\/\* SURGERII_PDF_CONTEXT_END \*\/\n/g, '');
    const originalHost = cleanBridge(await fs.readFile(path.join(sourceRoot, hostRelative), 'utf8'));
    const originalConnection = cleanBridge(await fs.readFile(path.join(sourceRoot, connectionRelative), 'utf8'));
    const makeInstallation = async (version, loader = originalLoader, css = originalCss) => {
        const root = path.join(temporary, `james-yu.latex-workshop-${version}`);
        for (const name of ['out/viewer/components', 'out/src/preview', 'viewer']) await fs.mkdir(path.join(root, name), { recursive: true });
        for (const [name, text] of [
            ['package.json', JSON.stringify({ name: 'latex-workshop', publisher: 'James-Yu', version })],
            [loaderRelative, loader], [cssRelative, css], ['viewer/viewer.html', html],
            [hostRelative, originalHost], [connectionRelative, originalConnection]
        ]) await fs.writeFile(path.join(root, name), text);
        return root;
    };
    try {
        const first = await makeInstallation('10.20.0');
        assert.equal((await patcher.apply(first, storage)).changed, true);
        assert.equal((await patcher.status(first)).installed, true);
        const before = await fs.stat(path.join(first, loaderRelative));
        assert.equal((await patcher.apply(first, storage)).changed, false);
        assert.equal((await fs.stat(path.join(first, loaderRelative))).mtimeMs, before.mtimeMs);
        await fs.appendFile(path.join(first, loaderRelative), '\n// unrelated user edit\n');
        await patcher.restore(first);
        assert.equal(await fs.readFile(path.join(first, loaderRelative), 'utf8'), originalLoader + '\n// unrelated user edit\n');
        assert.equal((await patcher.status(first)).installed, false);
        assert.equal(await fs.readFile(path.join(first, hostRelative), 'utf8'), originalHost);
        assert.equal(await fs.readFile(path.join(first, connectionRelative), 'utf8'), originalConnection);

        const upgrade = await makeInstallation('10.21.0', originalLoader + '\n// simulated upstream update\n');
        assert.equal((await patcher.apply(upgrade, storage)).version, '10.21.0');
        assert.equal((await patcher.status(upgrade)).installed, true);
        await patcher.restore(upgrade);
        assert.equal(await fs.readFile(path.join(upgrade, loaderRelative), 'utf8'), originalLoader + '\n// simulated upstream update\n');

        const legacy = await makeInstallation('legacy',
            await fs.readFile(path.join(base, 'tests/fixtures/legacy/latexworkshop.js'), 'utf8'),
            await fs.readFile(path.join(base, 'tests/fixtures/legacy/latexworkshop.css'), 'utf8'));
        await patcher.apply(legacy, storage);
        assert.equal(await fs.readFile(path.join(legacy, cssRelative), 'utf8'), originalCss);
        await patcher.restore(legacy);
        // The previous apply_patch edit added a final newline to this legacy file.
        assert.equal(await fs.readFile(path.join(legacy, loaderRelative), 'utf8'), originalLoader.replace(/\n?$/, '\n'));

        const incompatibleSource = originalLoader.replace('function onPDFViewerEvent(', 'function renamedViewerEvent(');
        const incompatible = await makeInstallation('99.0.0', incompatibleSource);
        await assert.rejects(patcher.apply(incompatible, storage), /事件接口已变化/);
        assert.equal(await fs.readFile(path.join(incompatible, loaderRelative), 'utf8'), incompatibleSource);
        assert.deepEqual((await fs.readdir(path.join(incompatible, 'out/viewer'))).sort(), ['components', 'latexworkshop.js']);

        const badBridge = await makeInstallation('99.1.0');
        await fs.writeFile(path.join(badBridge, hostRelative), originalHost.replace('switch (data.type) {', 'switch (packet.type) {'));
        await assert.rejects(patcher.apply(badBridge, storage), /消息接口已变化/);
        assert.equal(await fs.readFile(path.join(badBridge, loaderRelative), 'utf8'), originalLoader);

        // Verify activation only registers commands; each invocation resolves the current extension path.
        let activeRoot = first;
        const commands = new Map();
        const messages = [];
        const originalLoad = Module._load;
        Module._load = function(name, ...rest) {
            if (name === 'vscode') return {
                extensions: { getExtension: () => ({ extensionPath: activeRoot }) },
                commands: {
                    registerCommand: (id, callback) => { commands.set(id, callback); return { dispose() {} }; },
                    executeCommand: () => { throw new Error('Reload must require the user to click its button'); }
                },
                window: {
                    showInformationMessage: async text => { messages.push(text); return undefined; },
                    showErrorMessage: text => { throw new Error(text); }
                }
            };
            return originalLoad.call(this, name, ...rest);
        };
        try {
            const extension = require('../vscode-extension/extension.cjs');
            extension.activate({ subscriptions: [], globalStorageUri: { fsPath: storage } });
            assert.equal(commands.size, 7);
            assert.ok(commands.has('surgeriiZoom.setTranslationApiKey'));
            assert.ok(commands.has('surgeriiZoom.selectTranslationProvider'));
            assert.equal((await patcher.status(first)).installed, false);
            await commands.get('surgeriiZoom.apply')();
            assert.equal((await patcher.status(first)).installed, true);
            activeRoot = upgrade;
            await commands.get('surgeriiZoom.apply')();
            assert.equal((await patcher.status(upgrade)).installed, true);
            assert.ok(messages.some(text => text.includes('10.21.0')));
        } finally { Module._load = originalLoad; }
        console.log('PASS: clean install, idempotence, restoration preserving other edits, inline migration, simulated version upgrade, incompatible-version refusal, command-only activation, current-path resolution.');
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
