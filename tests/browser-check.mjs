import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const environment = createRequire(import.meta.url)('./environment.cjs');
const root = environment.workshopRoot();
const testPdf = process.env.TEST_PDF || fileURLToPath(new URL('./fixtures/reading-sample.pdf', import.meta.url));
const require = createRequire(import.meta.url);
const { WebSocketServer } = require(`${root}/node_modules/ws`);
const patcher = require('../vscode-extension/patcher.cjs');
const { addPdfSelection } = require('../vscode-extension/pdf-context.cjs');
const { createTranslator, runPython } = require('../vscode-extension/translation.cjs');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-context-browser-'));
const fixture = path.join(temporary, 'latex-workshop');
for (const relative of ['package.json', 'out/viewer/latexworkshop.js', 'viewer/latexworkshop.css',
    'viewer/viewer.html', 'out/src/preview/viewer.js', 'out/viewer/components/connection.js']) {
    await fs.mkdir(path.dirname(path.join(fixture, relative)), { recursive: true });
    await fs.copyFile(path.join(root, relative), path.join(fixture, relative));
}
await patcher.apply(fixture, path.join(temporary, 'backups'));
const attachments = [];
let failAttachment = false;
const translationRequests = [];
let holdTranslations = false;
let failTranslation = false;
const heldTranslations = [];
let liveTranslation;
const mockVscode = {
    workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    Uri: {
        parse: value => ({ scheme: new URL(value).protocol.slice(0, -1), fsPath: fileURLToPath(value) }),
        file: value => ({ fsPath: value })
    },
    commands: {
        getCommands: async () => ['chatgpt.addFileToThread'],
        executeCommand: async (command, arg) => {
            if (command === 'surgeriiZoom.translatePdfSelection') return translator(arg);
            if (command === 'surgeriiZoom.addPdfSelection') {
                return addPdfSelection(mockVscode, { globalStorageUri: { fsPath: path.join(temporary, 'storage') } }, arg);
            }
            assert.equal(command, 'chatgpt.addFileToThread');
            if (failAttachment) throw new Error('Codex unavailable in test');
            attachments.push({ file: arg.fsPath, content: await fs.readFile(arg.fsPath, 'utf8') });
        }
    }
};
const translator = createTranslator(mockVscode, path.resolve(import.meta.dirname, '../vscode-extension'),
    async (python, script, payload) => {
        translationRequests.push(payload);
        if (process.argv.includes('--live-google') && translationRequests.length === 1) {
            const result = await runPython(python, script, payload);
            liveTranslation = result.translation;
            return result;
        }
        if (failTranslation) throw new Error('Google offline in test');
        if (holdTranslations) return new Promise(resolve => heldTranslations.push({ payload, resolve }));
        return { ok: true, translation: '测试译文：' + payload.text, detectedSource: 'en' };
    });
const host = await fs.readFile(path.join(fixture, 'out/src/preview/viewer.js'), 'utf8');
const handlerSource = host.slice(host.indexOf('function handler(websocket, msg) {'), host.indexOf('function getParams() {'));
const hostHandler = vm.runInNewContext(`(${handlerSource})`, { vscode: mockVscode, logger: { log() {} } });
const entry = `import { installLocalEditableZoom } from '/out/viewer/surgerii-local-zoom.js';
import { installPdfContext } from '/out/viewer/surgerii-local-context.js';
import { installPdfTranslation } from '/out/viewer/surgerii-local-translate.js';
import { initConnect } from '/out/viewer/components/connection.js';
initConnect();
document.addEventListener('webviewerloaded', () => {
    PDFViewerApplicationOptions.setAll({disablePreferences: true, enableScripting: false,
        workerSrc: '/build/pdf.worker.mjs', cMapUrl: '/cmaps/', standardFontDataUrl: '/standard_fonts/'});
});
await import('/viewer.mjs');
await PDFViewerApplication.initializedPromise;
PDFViewerApplication.eventBus.on('pagesinit', installLocalEditableZoom);
PDFViewerApplication.eventBus.on('pagesinit', installPdfContext);
PDFViewerApplication.eventBus.on('pagesinit', installPdfTranslation);
`;
const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost').pathname;
        if (url === '/out/viewer/latexworkshop.js') {
            res.setHeader('Content-Type', 'text/javascript');
            res.end(entry);
            return;
        }
        const customAssets = {
            '/out/viewer/surgerii-local-zoom.js': fileURLToPath(new URL('../vscode-extension/mod/zoom.js', import.meta.url)),
            '/out/viewer/surgerii-local-zoom.css': fileURLToPath(new URL('../vscode-extension/mod/zoom.css', import.meta.url)),
            '/out/viewer/surgerii-local-context.js': `${fixture}/out/viewer/surgerii-local-context.js`,
            '/out/viewer/surgerii-local-context.css': `${fixture}/out/viewer/surgerii-local-context.css`,
            '/out/viewer/surgerii-local-translate.js': `${fixture}/out/viewer/surgerii-local-translate.js`,
            '/out/viewer/surgerii-local-translate.css': `${fixture}/out/viewer/surgerii-local-translate.css`,
            '/out/viewer/components/connection.js': `${fixture}/out/viewer/components/connection.js`,
            '/latexworkshop.css': fileURLToPath(new URL('./fixtures/original/viewer/latexworkshop.css', import.meta.url))
        };
        const file = customAssets[url] || (url.startsWith('/pdf..')
            ? testPdf
            : url.startsWith('/build/') || url.startsWith('/cmaps/') || url.startsWith('/standard_fonts/') || url.startsWith('/wasm/')
                ? `${root}/node_modules/pdfjs-dist/legacy${url}`
                : url.startsWith('/out/') ? `${root}${url}` : `${root}/viewer${url}`);
        const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf', '.ftl': 'text/plain' };
        res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        res.end(await fs.readFile(file));
    } catch {
        res.writeHead(404);
        res.end();
    }
});
const websocketServer = new WebSocketServer({ server });
websocketServer.on('connection', socket => socket.on('message', message => {
    if (['surgerii_pdf_context', 'surgerii_pdf_translate'].includes(JSON.parse(String(message)).type)) hostHandler(socket, String(message));
}));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = spawn(environment.chromiumPath(), [
    '--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    `--user-data-dir=${temporary}/browser`, '--window-size=1280,900', 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
    const debugUrl = await new Promise((resolve, reject) => {
        let output = '';
        browser.stderr.on('data', data => {
            output += data;
            const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (match) resolve(match[1]);
        });
        browser.once('error', reject);
        browser.once('exit', code => reject(new Error(`Browser exited: ${code}`)));
    });
    const port = new URL(debugUrl).port;
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(pages[0].webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    let id = 0;
    const pending = new Map();
    const errors = [];
    socket.addEventListener('message', ({ data }) => {
        const message = JSON.parse(data);
        if (message.id) {
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
        }
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
        const key = ++id;
        pending.set(key, { resolve, reject });
        socket.send(JSON.stringify({ id: key, method, params }));
    });
    const evaluate = async expression => {
        const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    await cdp('Runtime.enable');
    await cdp('Page.enable');
    const pdfUri = pathToFileURL(testPdf).href;
    const encoded = Buffer.from(encodeURIComponent(pdfUri)).toString('base64url');
    await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/viewer.html?file=pdf..${encoded}` });
    let ready = false;
    for (let i = 0; i < 100; i++) {
        ready = await evaluate('!!document.getElementById("localZoomInput") && !!PDFViewerApplication.pdfViewer.pagesCount');
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'PDF and editable zoom must load');
    await evaluate(`new Promise(resolve => {
        const link = document.getElementById('surgeriiLocalZoomStyle');
        if (link.sheet) resolve(); else link.addEventListener('load', resolve, { once: true });
    })`);
    const edit = async (value, key = 'Enter') => evaluate(`(() => {
        const input = document.getElementById('localZoomInput');
        input.focus(); input.value = ${JSON.stringify(value)};
        input.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
        return { scale: PDFViewerApplication.pdfViewer.currentScale, value: input.value, valid: input.validity.valid };
    })()`);
    assert.equal((await edit('137%')).scale, 1.37);
    assert.equal((await edit('132.5')).scale, 1.325);
    assert.equal((await edit('132.5%', 'ArrowUp')).scale, 1.335);
    assert.equal((await edit('133.5%', 'ArrowDown')).scale, 1.325);
    assert.equal((await edit('200%', 'Escape')).scale, 1.325);
    assert.equal((await edit('abc')).valid, false);
    assert.equal((await edit('9')).valid, false);
    assert.equal((await edit('2501')).valid, false);
    assert.equal((await edit('10')).scale, 0.1);
    assert.equal((await edit('2500')).scale, 25);
    await edit('137');
    const preset = await evaluate(`(() => {
        const select = document.getElementById('scaleSelect');
        select.value = 'page-width';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { scale: PDFViewerApplication.pdfViewer.currentScale, value: document.getElementById('localZoomInput').value };
    })()`);
    assert.equal(preset.value, `${Number((preset.scale * 100).toFixed(2))}%`);
    const sliderResult = await evaluate(`(() => {
        const slider = document.getElementById('localZoomSlider');
        slider.value = String(Math.log(1.42));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        return { scale: PDFViewerApplication.pdfViewer.currentScale, value: document.getElementById('localZoomInput').value };
    })()`);
    assert.equal(sliderResult.scale, 1.42);
    assert.equal(sliderResult.value, '142%');
    const sliderKeyboard = await evaluate(`(() => {
        const slider = document.getElementById('localZoomSlider');
        slider.focus();
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        return PDFViewerApplication.pdfViewer.currentScale;
    })()`);
    assert.equal(sliderKeyboard, 1.43);
    await evaluate("document.querySelector('.toolbar').classList.remove('hide')");
    await new Promise(resolve => setTimeout(resolve, 250));
    const rect = await evaluate(`(() => {
        const rect = document.getElementById('localZoomSlider').getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
    const point = { x: rect.x + rect.width * 0.65, y: Math.max(1, rect.y + rect.height / 2) };
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: point.x + 10, y: point.y });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x + 10, y: point.y });
    const dragged = await evaluate(`({ scale: PDFViewerApplication.pdfViewer.currentScale, value: document.getElementById('localZoomInput').value })`);
    assert.notEqual(dragged.scale, 1.43);
    assert.equal(dragged.value, `${Number((dragged.scale * 100).toFixed(2))}%`);
    await edit('137');
    await evaluate("document.querySelector('.toolbar').classList.remove('hide')");
    // Select actual PDF.js text and press the real browser Alt+A shortcut.
    await evaluate(`(() => {
        document.getElementById('localZoomInput').blur();
        PDFViewerApplication.pdfViewer.currentScaleValue = 'page-width';
        PDFViewerApplication.pdfViewer.scrollPageIntoView({pageNumber: 1});
        window.rebroadcastCount = 0;
        document.addEventListener('keydown', event => { if (event.altKey && event.key === 'a') window.rebroadcastCount++; });
    })()`);
    const waitFor = async (predicate, label) => {
        for (let i = 0; i < 240; i++) {
            if (await predicate()) return;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        const diagnostic = await evaluate("({popup:document.querySelector('#surgeriiPdfTranslation .surgerii-translation-output')?.textContent,selection:getSelection().toString(),hidden:document.getElementById('surgeriiPdfTranslation')?.hidden})");
        throw new Error(`Timed out: ${label}; ${JSON.stringify(diagnostic)}; requests=${translationRequests.length}; errors=${JSON.stringify(errors)}`);
    };
    await waitFor(() => evaluate("!!document.querySelector('#viewer .textLayer span')"), 'PDF text layer');
    const pointInWord = await evaluate(`(() => {
        for (const span of document.querySelectorAll('#viewer .textLayer span')) {
            const node = span.firstChild;
            const match = node?.nodeType === 3 && node.textContent.match(/[A-Za-z]{6,}/);
            if (!match) continue;
            const range = document.createRange();
            range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
            const rect = range.getBoundingClientRect();
            if (rect.y > 50 && rect.bottom < innerHeight && rect.width > 0) return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
        }
        throw new Error('No visible word');
    })()`);
    await cdp('Input.dispatchMouseEvent', {type: 'mousePressed', button: 'left', clickCount: 2, ...pointInWord});
    await cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', button: 'left', clickCount: 2, ...pointInWord});
    const word = await evaluate('getSelection().toString().trim()');
    assert.ok(word.length > 1);
    const popupText = () => evaluate("document.querySelector('#surgeriiPdfTranslation .surgerii-translation-output').textContent");
    await waitFor(async () => {
        const text = await popupText();
        return text.startsWith('测试译文：') || (!!liveTranslation && text === liveTranslation);
    }, 'automatic word translation without shortcut or button');
    assert.equal(translationRequests.length, 1);
    assert.equal(translationRequests[0].text, word);
    assert.equal(await evaluate("document.getElementById('surgeriiPdfTranslation').hidden"), false);
    const bounds = await evaluate(`(() => {
        const r = document.getElementById('surgeriiPdfTranslation').getBoundingClientRect();
        return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};
    })()`);
    assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height);
    await fs.mkdir('/tmp/latex-workshop-zoom-check', { recursive: true });
    const translationScreenshot = await cdp('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile('/tmp/latex-workshop-zoom-check/translation.png', Buffer.from(translationScreenshot.data, 'base64'));
    const altA = async () => {
        await cdp('Input.dispatchKeyEvent', {type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 1, windowsVirtualKeyCode: 65});
        await cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 0, windowsVirtualKeyCode: 65});
    };
    await altA();
    await waitFor(() => attachments.length === 1, 'word attachment');
    assert.ok(attachments[0].content.endsWith(`Selected text:\n${word}\n`));
    assert.match(attachments[0].content, /Pages: 1\n/);
    await waitFor(() => evaluate("document.getElementById('surgeriiPdfContextStatus').textContent.includes('已将')"), 'response through real bridge');
    assert.equal(await evaluate('window.rebroadcastCount'), 0);
    const sentence = await evaluate(`(() => {
        const spans = [...document.querySelectorAll('#viewer .page[data-page-number="1"] .textLayer span')].filter(e => e.textContent.trim());
        const range = document.createRange();
        range.setStart(spans[0].firstChild, 0); range.setEnd(spans[4].firstChild, spans[4].firstChild.length);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        return selection.toString().trim();
    })()`);
    await waitFor(async () => (await popupText()) === '测试译文：' + sentence.replace(/\s+/g, ' ').trim(), 'automatic multi-span sentence translation');
    assert.equal(translationRequests.at(-1).text, sentence.replace(/\s+/g, ' ').trim());
    await altA();
    await waitFor(() => attachments.length === 2, 'sentence attachment');
    assert.ok(attachments[1].content.endsWith(`Selected text:\n${sentence}\n`));
    await evaluate('getSelection().removeAllRanges()');
    await altA();
    assert.equal(attachments.length, 2);
    // Out-of-order replies must never replace the current selection's result.
    const selectSpan = index => evaluate(`(() => {
        const spans = [...document.querySelectorAll('#viewer .page[data-page-number="1"] .textLayer span')].filter(e => e.textContent.trim());
        const span = spans[${index}];
        const range = document.createRange(); range.selectNodeContents(span);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        return selection.toString().replace(/\\s+/g, ' ').trim();
    })()`);
    holdTranslations = true;
    const oldText = await selectSpan(10);
    await waitFor(() => heldTranslations.length === 1, 'first delayed translation');
    const latestText = await selectSpan(11);
    assert.notEqual(latestText, oldText);
    await waitFor(() => heldTranslations.length === 2, 'new delayed translation');
    heldTranslations[1].resolve({ok:true,translation:'最新译文'});
    await waitFor(async () => (await popupText()) === '最新译文', 'new result');
    heldTranslations[0].resolve({ok:true,translation:'过期译文'});
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await popupText(), '最新译文');
    holdTranslations = false;
    const countBeforeCache = translationRequests.length;
    await selectSpan(10);
    await waitFor(async () => (await popupText()) === '过期译文', 'cached result for reselected text');
    assert.equal(translationRequests.length, countBeforeCache);
    await cdp('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    assert.equal(await evaluate("document.getElementById('surgeriiPdfTranslation').hidden"), true);
    failTranslation = true;
    await selectSpan(12);
    await waitFor(async () => (await popupText()) === 'Google offline in test', 'translation error feedback');
    const previousCount = translationRequests.length;
    failTranslation = false;
    await evaluate('getSelection().removeAllRanges()');
    await new Promise(resolve => setTimeout(resolve, 180));
    await selectSpan(12);
    await waitFor(async () => (await popupText()).startsWith('测试译文：'), 'retry failed translation');
    assert.equal(translationRequests.length, previousCount + 1);
    assert.match(await evaluate("document.getElementById('surgeriiPdfContextStatus').textContent"), /先在 PDF/);
    // Inputs keep Alt+A for their own handling instead of sending stale PDF text.
    await evaluate("document.getElementById('localZoomInput').focus()");
    await altA();
    assert.equal(attachments.length, 2);
    await evaluate(`(() => {
        document.getElementById('localZoomInput').blur();
        const span = document.querySelector('#viewer .textLayer span');
        const range = document.createRange(); range.selectNodeContents(span);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    })()`);
    failAttachment = true;
    await altA();
    await waitFor(() => evaluate("document.getElementById('surgeriiPdfContextStatus').textContent.includes('Codex unavailable')"), 'attachment error feedback');
    assert.equal(attachments.length, 2);
    await fs.mkdir('/tmp/latex-workshop-zoom-check', { recursive: true });
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1280, height: 180, scale: 1 } });
    await fs.writeFile('/tmp/latex-workshop-zoom-check/toolbar.png', Buffer.from(screenshot.data, 'base64'));
    assert.deepEqual(errors, []);
    console.log('PASS: actual PDF.js viewer; numeric entry, decimals, 1% arrows, cancellation, invalid values, bounds, preset synchronization, slider input, keyboard, and mouse dragging.');
    console.log('PASS: real PDF word double-click and multi-span selection, Alt+A, WebSocket bridge, excerpt files, mocked Codex command, success/error feedback, no selection and input focus.');
    console.log('PASS: automatic word/sentence translation, popup bounds, stale reply rejection, cache reuse, Escape, error feedback and retry.');
    if (liveTranslation) console.log('PASS: live Google request through the actual Python client and browser popup: ' + liveTranslation);
} finally {
    socket?.close();
    if (browser.exitCode === null && browser.signalCode === null) {
        const stopped = new Promise(resolve => browser.once('exit', resolve));
        browser.kill();
        await stopped;
    }
    for (const client of websocketServer.clients) client.terminate();
    websocketServer.close();
    server.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
