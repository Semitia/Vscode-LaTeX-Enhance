'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const LOADER = 'out/viewer/latexworkshop.js';
const CSS = 'viewer/latexworkshop.css';
const MODULE = 'out/viewer/surgerii-local-zoom.js';
const STYLE = 'out/viewer/surgerii-local-zoom.css';
const CONTEXT = 'out/viewer/surgerii-local-context.js';
const CONTEXT_STYLE = 'out/viewer/surgerii-local-context.css';
const TRANSLATE = 'out/viewer/surgerii-local-translate.js';
const TRANSLATE_STYLE = 'out/viewer/surgerii-local-translate.css';
const HOST = 'out/src/preview/viewer.js';
const CONNECTION = 'out/viewer/components/connection.js';
const IMPORT = `/* SURGERII_ZOOM_IMPORT_BEGIN */
import { installLocalEditableZoom as installSurgeriiZoom } from './surgerii-local-zoom.js';
import { installPdfContext } from './surgerii-local-context.js';
import { installPdfTranslation } from './surgerii-local-translate.js';
/* SURGERII_ZOOM_IMPORT_END */\n`;
const HOOK = `/* SURGERII_ZOOM_HOOK_BEGIN */
onPDFViewerEvent('pagesinit', () => {
    try { installSurgeriiZoom(); }
    catch (error) { console.error('[Local Zoom Mod]', error); }
    try { installPdfContext(); }
    catch (error) { console.error('[Local PDF Context]', error); }
    try { installPdfTranslation(); }
    catch (error) { console.error('[Local PDF Translation]', error); }
}, { once: true });
/* SURGERII_ZOOM_HOOK_END */\n`;
const BRIDGE_BEGIN = '/* SURGERII_PDF_CONTEXT_BEGIN */';
const BRIDGE_END = '/* SURGERII_PDF_CONTEXT_END */\n';
const HOST_CASE = `${BRIDGE_BEGIN}
        case 'surgerii_pdf_context':
        case 'surgerii_pdf_translate': {
            void (async () => {
                let result;
                try {
                    const command = data.type === 'surgerii_pdf_translate' ? 'surgeriiZoom.translatePdfSelection' : 'surgeriiZoom.addPdfSelection';
                    result = await vscode.commands.executeCommand(command, data);
                    if (!result?.ok) throw new Error('PDF 增强命令未返回成功结果。');
                } catch (error) {
                    result = { ok: false, message: typeof error?.message === 'string' ? error.message : String(error) };
                }
                try { websocket.send(JSON.stringify({ type: data.type + '_result', id: data.id, ...result })); }
                catch (error) { logger.log('PDF context response failed: ' + String(error)); }
            })();
            break;
        }
${BRIDGE_END}`;
const CONNECTION_CASE = `${BRIDGE_BEGIN}
        case 'surgerii_pdf_context_result':
        case 'surgerii_pdf_translate_result': {
            window.dispatchEvent(new CustomEvent(data.type.replace(/_/g, '-'), { detail: data }));
            break;
        }
${BRIDGE_END}`;
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

async function atomicWrite(file, text) {
    let mode = 0o644;
    try { mode = (await fs.stat(file)).mode; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = `${file}.zoom-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
        await fs.writeFile(temporary, text, { mode });
        await fs.rename(temporary, file);
    } finally {
        await fs.rm(temporary, { force: true });
    }
}

async function assets() {
    const folder = path.join(__dirname, 'mod');
    const [module, style, legacy, legacyStyle, contextModule, contextStyle, translateModule, translateStyle] = await Promise.all([
        fs.readFile(path.join(folder, 'zoom.js'), 'utf8'),
        fs.readFile(path.join(folder, 'zoom.css'), 'utf8'),
        fs.readFile(path.join(folder, 'legacy-inline-function.txt'), 'utf8'),
        fs.readFile(path.join(folder, 'legacy-inline-style.txt'), 'utf8'),
        fs.readFile(path.join(folder, 'context.js'), 'utf8'),
        fs.readFile(path.join(folder, 'context.css'), 'utf8'),
        fs.readFile(path.join(folder, 'translate.js'), 'utf8'),
        fs.readFile(path.join(folder, 'translate.css'), 'utf8')
    ]);
    return { module, style, legacy, legacyStyle, contextModule, contextStyle, translateModule, translateStyle };
}

function stripBridge(source) {
    const a = source.indexOf(BRIDGE_BEGIN);
    const b = source.indexOf(BRIDGE_END);
    if ((a === -1) !== (b === -1) || (a !== -1 && b < a) ||
        (a !== -1 && source.indexOf(BRIDGE_BEGIN, a + BRIDGE_BEGIN.length) !== -1)) {
        throw new Error('PDF 摘录补丁标记不完整，未修改文件。');
    }
    return a === -1 ? source : source.slice(0, a) + source.slice(b + BRIDGE_END.length);
}

function injectCase(source, block) {
    const anchor = 'switch (data.type) {';
    const offset = source.indexOf(anchor);
    if (offset === -1 || source.indexOf(anchor, offset + anchor.length) !== -1) {
        throw new Error('新版查看器消息接口已变化，需要调整补丁；未修改原文件。');
    }
    return source.slice(0, offset + anchor.length) + block + source.slice(offset + anchor.length);
}

function stripBlocks(source) {
    for (const name of ['IMPORT', 'HOOK']) {
        const start = `/* SURGERII_ZOOM_${name}_BEGIN */`;
        const end = `/* SURGERII_ZOOM_${name}_END */\n`;
        const a = source.indexOf(start);
        const b = source.indexOf(end);
        if ((a === -1) !== (b === -1) || (a !== -1 && b < a)) {
            throw new Error('补丁标记不完整，未修改文件。');
        }
        if (a !== -1) {
            if (source.indexOf(start, a + start.length) !== -1) throw new Error('发现重复补丁标记，未修改文件。');
            source = source.slice(0, a) + source.slice(b + end.length);
        }
    }
    return source;
}

async function inspect(root) {
    const [manifestText, loader, css, html, mod, host, connection] = await Promise.all([
        fs.readFile(path.join(root, 'package.json'), 'utf8'),
        fs.readFile(path.join(root, LOADER), 'utf8'),
        fs.readFile(path.join(root, CSS), 'utf8'),
        fs.readFile(path.join(root, 'viewer/viewer.html'), 'utf8'),
        assets(),
        fs.readFile(path.join(root, HOST), 'utf8'),
        fs.readFile(path.join(root, CONNECTION), 'utf8')
    ]);
    const manifest = JSON.parse(manifestText);
    if (manifest.name !== 'latex-workshop' || manifest.publisher.toLowerCase() !== 'james-yu') {
        throw new Error('目标不是 LaTeX Workshop。');
    }
    let cleanLoader = stripBlocks(loader);
    let cleanCss = css;
    // Migrate the earlier inline customization only when its exact contents match.
    if (cleanLoader.includes('// Local customization: one-row zoom slider and editable percentage.')) {
        const call = '    installLocalEditableZoom();\n';
        if (!cleanLoader.includes(mod.legacy) || !cleanLoader.includes(call) || !css.includes(mod.legacyStyle)) {
            throw new Error('旧版手工补丁已被修改，未覆盖。');
        }
        cleanLoader = cleanLoader.replace(mod.legacy, '').replace(call, '');
        cleanCss = css.replace(mod.legacyStyle, '');
    }
    return { manifest, loader, css, html, mod, cleanLoader, cleanCss,
        host, connection, cleanHost: stripBridge(host), cleanConnection: stripBridge(connection) };
}

function validate(info) {
    if (!/function onPDFViewerEvent\s*\(/.test(info.cleanLoader)) {
        throw new Error('新版查看器事件接口已变化，需要调整补丁；未修改原文件。');
    }
    const imports = [...info.cleanLoader.matchAll(/await import\(['"]\.\.\/\.\.\/viewer\/viewer\.mjs['"]\);/g)];
    if (imports.length !== 1 || !info.html.includes('id="scaleSelectContainer"') ||
        !info.html.includes('id="scaleSelect"')) {
        throw new Error('新版查看器结构已变化，需要调整补丁；未修改原文件。');
    }
    if (!info.cleanHost.includes('function handler(websocket, msg) {') ||
        !info.cleanConnection.includes('function handler(event) {')) {
        throw new Error('新版查看器消息接口已变化，需要调整补丁；未修改原文件。');
    }
    return imports[0].index;
}

async function apply(root, storage) {
    const info = await inspect(root);
    const anchor = validate(info);
    const desired = IMPORT + info.cleanLoader.slice(0, anchor) + HOOK + info.cleanLoader.slice(anchor);
    const desiredHost = injectCase(info.cleanHost, HOST_CASE);
    const desiredConnection = injectCase(info.cleanConnection, CONNECTION_CASE);
    const directory = path.join(storage, 'backups', `${info.manifest.version}-${hash(path.resolve(root)).slice(0, 12)}-${hash(info.cleanLoader).slice(0, 12)}`);
    await fs.mkdir(directory, { recursive: true });
    for (const [name, contents] of [
        ['loader.original.js', info.cleanLoader], ['style.original.css', info.cleanCss],
        ['loader.before.js', info.loader], ['style.before.css', info.css],
        ['host.original.js', info.cleanHost], ['connection.original.js', info.cleanConnection],
        ['manifest.json', JSON.stringify({ extension: path.resolve(root), version: info.manifest.version, sha256: hash(info.cleanLoader) }, null, 2)]
    ]) {
        try { await fs.writeFile(path.join(directory, name), contents, { flag: 'wx' }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    let changed = false;
    for (const [relative, contents] of [[MODULE, info.mod.module], [STYLE, info.mod.style],
        [CONTEXT, info.mod.contextModule], [CONTEXT_STYLE, info.mod.contextStyle],
        [TRANSLATE, info.mod.translateModule], [TRANSLATE_STYLE, info.mod.translateStyle],
        [CSS, info.cleanCss], [CONNECTION, desiredConnection], [HOST, desiredHost], [LOADER, desired]]) {
        const target = path.join(root, relative);
        let existing;
        try { existing = await fs.readFile(target, 'utf8'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (existing !== contents) {
            await atomicWrite(target, contents);
            changed = true;
        }
    }
    return { changed, version: info.manifest.version, backup: directory };
}

async function restore(root) {
    const info = await inspect(root);
    if (info.loader !== info.cleanLoader) await atomicWrite(path.join(root, LOADER), info.cleanLoader);
    if (info.css !== info.cleanCss) await atomicWrite(path.join(root, CSS), info.cleanCss);
    if (info.host !== info.cleanHost) await atomicWrite(path.join(root, HOST), info.cleanHost);
    if (info.connection !== info.cleanConnection) await atomicWrite(path.join(root, CONNECTION), info.cleanConnection);
    for (const [relative, expected] of [[MODULE, info.mod.module], [STYLE, info.mod.style],
        [CONTEXT, info.mod.contextModule], [CONTEXT_STYLE, info.mod.contextStyle],
        [TRANSLATE, info.mod.translateModule], [TRANSLATE_STYLE, info.mod.translateStyle]]) {
        try {
            const target = path.join(root, relative);
            if (await fs.readFile(target, 'utf8') === expected) await fs.unlink(target);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return { version: info.manifest.version };
}

async function status(root) {
    const info = await inspect(root);
    let current = false;
    if (info.loader.includes(IMPORT) && info.loader.includes(HOOK)) {
        try {
            current = await fs.readFile(path.join(root, MODULE), 'utf8') === info.mod.module &&
                await fs.readFile(path.join(root, STYLE), 'utf8') === info.mod.style &&
                await fs.readFile(path.join(root, CONTEXT), 'utf8') === info.mod.contextModule &&
                await fs.readFile(path.join(root, CONTEXT_STYLE), 'utf8') === info.mod.contextStyle &&
                await fs.readFile(path.join(root, TRANSLATE), 'utf8') === info.mod.translateModule &&
                await fs.readFile(path.join(root, TRANSLATE_STYLE), 'utf8') === info.mod.translateStyle &&
                info.host === injectCase(info.cleanHost, HOST_CASE) &&
                info.connection === injectCase(info.cleanConnection, CONNECTION_CASE);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return { version: info.manifest.version, installed: current };
}

module.exports = { apply, restore, status };
