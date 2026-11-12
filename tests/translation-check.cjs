'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createTranslator, normalizeText, runPython } = require('../vscode-extension/translation.cjs');

(async () => {
    assert.equal(normalizeText('instru\u00ad\nment\n  with  roll'), 'instrument with roll');
    assert.equal(normalizeText('continuum-\nwrist'), 'continuum- wrist');
    const values = { enabled: true, targetLanguage: 'zh-CN', pythonPath: 'python3', proxy: '' };
    const vscode = { workspace: { getConfiguration: name => ({ get: (key, fallback) =>
        name === 'surgeriiZoom.translation' ? values[key] ?? fallback : fallback }) } };
    const calls = [];
    let release;
    const runner = async (python, script, payload) => {
        calls.push({ python, script, payload });
        await new Promise(resolve => { release = resolve; });
        return { ok: true, translation: '逆运动学', detectedSource: 'en' };
    };
    const translator = createTranslator(vscode, path.resolve(__dirname, '../vscode-extension'), runner);
    assert.equal((await translator({ action: 'settings' })).enabled, true);
    const first = translator({ text: 'inverse\nkinematics' });
    const duplicate = translator({ text: 'inverse kinematics' });
    assert.equal(calls.length, 1);
    release();
    assert.equal((await first).translation, '逆运动学');
    assert.equal((await duplicate).translation, '逆运动学');
    assert.equal((await translator({ text: 'inverse kinematics' })).cached, true);
    assert.equal(calls.length, 1);
    values.enabled = false;
    assert.equal((await translator({ text: 'different word' })).enabled, false);
    assert.equal(calls.length, 1);
    values.enabled = true;
    await assert.rejects(translator({ text: 'x'.repeat(5001) }), /5000/);
    await assert.rejects(translator({ text: '' }), /5000/);
    let failures = 0;
    const failing = createTranslator(vscode, __dirname, async () => { failures++; throw new Error('offline'); });
    await assert.rejects(failing({ text: 'wrist' }), /offline/);
    await assert.rejects(failing({ text: 'wrist' }), /offline/);
    assert.equal(failures, 2, 'failed requests must not remain cached or pending');
    await assert.rejects(runPython('/nonexistent-python-for-test', '/unused', {}), /Python 3/);
    console.log('PASS: PDF line cleanup, request coalescing, cache reuse, disabling translation, validation, retry after failure, and missing interpreter.');
})().catch(error => { console.error(error); process.exitCode = 1; });
