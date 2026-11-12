'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function validateSelection(vscode, data) {
    if (!data || typeof data.text !== 'string' || !data.text.trim() || data.text.length > 50000) {
        throw new Error('PDF 选区为空或超过 5 万字符。');
    }
    if (typeof data.pdfFileUri !== 'string' || data.pdfFileUri.length > 8192) throw new Error('无效的 PDF 路径。');
    const uri = vscode.Uri.parse(data.pdfFileUri, true);
    if (uri.scheme !== 'file' || path.extname(uri.fsPath).toLowerCase() !== '.pdf') {
        throw new Error('仅支持当前文件系统中的 PDF。');
    }
    if (!Array.isArray(data.pages) || !data.pages.length || data.pages.length > 1000 ||
        data.pages.some(page => !Number.isSafeInteger(page) || page < 1)) throw new Error('无效的 PDF 页码。');
    const pages = [...new Set(data.pages)].sort((a, b) => a - b);
    return { source: uri.fsPath, pages, text: data.text.replace(/\r\n?/g, '\n').replace(/\u00ad/g, '').trim() };
}

async function addPdfSelection(vscode, context, data) {
    const { source, pages, text } = validateSelection(vscode, data);
    const available = await vscode.commands.getCommands(true);
    if (!available.includes('chatgpt.addFileToThread')) throw new Error('当前环境没有可用的 Codex 添加文件命令。');
    const content = `PDF: ${path.basename(source)}\nSource: ${source}\nPages: ${pages.join(', ')}\n\nSelected text:\n${text}\n`;
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 20);
    const label = path.basename(source, path.extname(source)).replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 70);
    const pageLabel = pages.length === 1 ? String(pages[0]) : `${pages[0]}-${pages.at(-1)}`;
    const directory = path.join(context.globalStorageUri.fsPath, 'pdf-selections');
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, `PDF-${label}-p${pageLabel}-${hash}.txt`);
    let created = false;
    try {
        try { await fs.writeFile(file, content, { flag: 'wx', mode: 0o600 }); created = true; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        await vscode.commands.executeCommand('chatgpt.addFileToThread', vscode.Uri.file(file));
    } catch (error) {
        if (created) await fs.rm(file, { force: true });
        throw error;
    }
    // Keep the excerpt: Codex reads attached files when the user sends a prompt.
    return { ok: true };
}

module.exports = { addPdfSelection, validateSelection };
