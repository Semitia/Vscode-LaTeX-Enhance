'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { addPdfSelection } = require('../vscode-extension/pdf-context.cjs');

(async () => {
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-context-check-'));
    const calls = [];
    const vscode = {
        Uri: {
            parse: value => ({ scheme: new URL(value).protocol.slice(0, -1), fsPath: value.startsWith('file:') ? fileURLToPath(value) : value }),
            file: value => ({ fsPath: value })
        },
        commands: {
            getCommands: async () => ['chatgpt.addFileToThread'],
            executeCommand: async (command, uri) => calls.push({ command, file: uri.fsPath, content: await fs.readFile(uri.fsPath, 'utf8') })
        }
    };
    const context = { globalStorageUri: { fsPath: storage } };
    const data = { pdfFileUri: pathToFileURL('/tmp/论文 $test.pdf').href, pages: [3, 2, 3], text: 'wristed instru\u00adment\r\nwith roll' };
    try {
        assert.deepEqual(await addPdfSelection(vscode, context, data), { ok: true });
        assert.equal(calls[0].command, 'chatgpt.addFileToThread');
        assert.match(calls[0].content, /PDF: 论文 \$test.pdf/);
        assert.match(calls[0].content, /Pages: 2, 3\n/);
        assert.ok(calls[0].content.endsWith('wristed instrument\nwith roll\n'));
        await addPdfSelection(vscode, context, data);
        assert.equal(calls[0].file, calls[1].file);
        assert.equal((await fs.readdir(path.join(storage, 'pdf-selections'))).length, 1);
        for (const bad of [
            { ...data, text: '' }, { ...data, text: 'x'.repeat(50001) },
            { ...data, pdfFileUri: 'https://example.com/paper.pdf' },
            { ...data, pdfFileUri: 'file:///tmp/notes.txt' },
            { ...data, pages: [-1] }, { ...data, pages: [1.5] }, { ...data, pages: [] }
        ]) await assert.rejects(addPdfSelection(vscode, context, bad));
        assert.equal(calls.length, 2);
        vscode.commands.getCommands = async () => [];
        await assert.rejects(addPdfSelection(vscode, context, data), /没有可用/);
        vscode.commands.getCommands = async () => ['chatgpt.addFileToThread'];
        vscode.commands.executeCommand = async () => { throw new Error('Codex unavailable'); };
        await assert.rejects(addPdfSelection(vscode, context, { ...data, text: 'new excerpt' }), /Codex unavailable/);
        assert.equal((await fs.readdir(path.join(storage, 'pdf-selections'))).length, 1);
        console.log('PASS: PDF provenance, normalized excerpt, deduplication, input validation, missing Codex and failed attachment cleanup.');
    } finally { await fs.rm(storage, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
