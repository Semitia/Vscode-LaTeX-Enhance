import { send } from './components/connection.js';
import { parseURL } from './components/utils.js';

// Installed in the PDF iframe, where the selectable PDF.js text layer lives.
export function installPdfContext() {
    if (document.getElementById('surgeriiPdfContextStatus')) return;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./surgerii-local-context.css', import.meta.url).href;
    document.head.appendChild(style);
    const status = document.createElement('div');
    status.id = 'surgeriiPdfContextStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    document.body.appendChild(status);
    const pending = new Map();
    let hideTimer;
    let newestId;
    const notify = (text, error = false) => {
        clearTimeout(hideTimer);
        status.textContent = text;
        status.dataset.error = String(error);
        status.hidden = false;
        hideTimer = setTimeout(() => { status.hidden = true; }, error ? 7000 : 3000);
    };
    const complete = (id, ok, message) => {
        const item = pending.get(id);
        if (!item) return;
        clearTimeout(item.timer);
        pending.delete(id);
        if (id === newestId) notify(message, !ok);
    };
    window.addEventListener('surgerii-pdf-context-result', ({ detail }) => {
        if (detail && typeof detail.id === 'string') {
            complete(detail.id, detail.ok === true, detail.ok ? '已将 PDF 摘录加入 Codex' : detail.message || '添加失败');
        }
    });
    window.addEventListener('keydown', (event) => {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
            event.key.toLowerCase() !== 'a' || event.isComposing) return;
        if (event.target instanceof Element &&
            event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        // Consume before the viewer rebroadcasts Alt+A to VS Code. The existing
        // text-editor command would otherwise attach a stale source selection.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.repeat) return;
        newestId = undefined;
        const selection = window.getSelection();
        const viewer = document.getElementById('viewer');
        if (!selection?.rangeCount || selection.isCollapsed || !viewer ||
            !viewer.contains(selection.anchorNode) || !viewer.contains(selection.focusNode)) {
            notify('请先在 PDF 正文中选中文字', true);
            return;
        }
        const text = selection.toString().replace(/\r\n?/g, '\n').replace(/\u00ad/g, '').trim();
        if (!text) { notify('请先在 PDF 正文中选中文字', true); return; }
        if (text.length > 50000) { notify('选区超过 5 万字符，请缩小选区', true); return; }
        const pages = new Set();
        for (let i = 0; i < selection.rangeCount; i++) {
            const range = selection.getRangeAt(i);
            for (const layer of viewer.querySelectorAll('.page .textLayer')) {
                if (range.intersectsNode(layer)) {
                    const page = Number(layer.closest('.page').dataset.pageNumber);
                    if (Number.isInteger(page) && page > 0) pages.add(page);
                }
            }
        }
        if (!pages.size) { notify('请选择 PDF 正文文字', true); return; }
        const pdfFileUri = parseURL().pdfFileUri;
        const pageNumbers = [...pages].sort((a, b) => a - b);
        const signature = JSON.stringify([pdfFileUri, pageNumbers, text]);
        const existing = [...pending].find(([, item]) => item.signature === signature);
        if (existing) { newestId = existing[0]; return; }
        const id = crypto.randomUUID();
        newestId = id;
        const timer = setTimeout(() => complete(id, false, '添加超时，可重新按 Alt+A'), 30000);
        pending.set(id, { timer, signature });
        notify('正在将 PDF 摘录加入 Codex…');
        void send({ type: 'surgerii_pdf_context', id, pdfFileUri, pages: pageNumbers, text })
            .catch(() => complete(id, false, '无法连接 PDF 查看器后台，请重新打开 PDF'));
    }, true);
}
