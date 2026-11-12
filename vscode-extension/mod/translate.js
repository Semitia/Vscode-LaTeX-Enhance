import { send } from './components/connection.js';

export function installPdfTranslation() {
    if (document.getElementById('surgeriiPdfTranslation')) return;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./surgerii-local-translate.css', import.meta.url).href;
    document.head.appendChild(style);
    const popup = document.createElement('section');
    popup.id = 'surgeriiPdfTranslation';
    popup.setAttribute('role', 'region');
    popup.setAttribute('aria-label', '选区翻译');
    popup.hidden = true;
    const header = document.createElement('div');
    header.className = 'surgerii-translation-header';
    const label = document.createElement('span');
    label.textContent = '翻译';
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = '×'; close.title = '关闭（Esc）';
    close.setAttribute('aria-label', '关闭翻译');
    const output = document.createElement('div');
    output.className = 'surgerii-translation-output';
    output.setAttribute('aria-live', 'polite');
    header.append(label, close); popup.append(header, output); document.body.appendChild(popup);
    let pointerDown = false;
    let timer;
    let requestTimer;
    let currentId;
    let currentText = '';
    let enabled = true;
    let settingsError = '';
    const settingsId = crypto.randomUUID();
    const normalize = text => text.replace(/\u00ad\s*\r?\n\s*/g, '').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
    const selectionInfo = () => {
        const selection = window.getSelection();
        const viewer = document.getElementById('viewer');
        if (!selection?.rangeCount || selection.isCollapsed || !viewer ||
            !viewer.contains(selection.anchorNode) || !viewer.contains(selection.focusNode)) return null;
        const range = selection.getRangeAt(selection.rangeCount - 1);
        if (![...viewer.querySelectorAll('.textLayer')].some(layer => range.intersectsNode(layer))) return null;
        const text = normalize(selection.toString());
        if (!text || !/\p{L}/u.test(text)) return null;
        const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0 &&
            rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth);
        return rects.length ? { text, rect: rects.at(-1) } : null;
    };
    const invalidate = () => {
        clearTimeout(timer); clearTimeout(requestTimer);
        currentId = undefined; currentText = ''; popup.hidden = true;
    };
    const show = (info, text, error = false) => {
        output.textContent = text;
        popup.dataset.error = String(error);
        popup.hidden = false;
        // Measure after the text changes, so long translations stay on screen.
        const box = popup.getBoundingClientRect();
        const left = Math.max(12, Math.min(info.rect.left, innerWidth - box.width - 12));
        const below = info.rect.bottom + 8;
        const top = below + box.height <= innerHeight - 12 ? below : info.rect.top - box.height - 8;
        popup.style.left = `${left}px`;
        popup.style.top = `${Math.max(12, Math.min(top, innerHeight - box.height - 12))}px`;
    };
    const translate = () => {
        if (!enabled || pointerDown) return;
        const info = selectionInfo();
        if (!info || info.text === currentText) return;
        if (info.text.length > 5000) { show(info, '选区过长，请选择不超过 5000 字符的文字。', true); return; }
        currentText = info.text;
        if (settingsError) { show(info, settingsError, true); return; }
        const id = crypto.randomUUID();
        currentId = id;
        show(info, '正在翻译…');
        requestTimer = setTimeout(() => {
            if (currentId === id) { currentId = undefined; show(info, '翻译超时，请检查网络或代理。', true); }
        }, 70000);
        void send({ type: 'surgerii_pdf_translate', id, text: info.text }).catch(() => {
            if (currentId === id) {
                clearTimeout(requestTimer); currentId = undefined;
                show(info, '无法连接 PDF 查看器后台，请重新打开 PDF。', true);
            }
        });
    };
    const schedule = () => {
        clearTimeout(timer);
        if (enabled && !pointerDown) timer = setTimeout(translate, 160);
    };
    window.addEventListener('surgerii-pdf-translate-result', ({ detail }) => {
        if (!detail) return;
        if (detail.label) label.textContent = detail.label;
        if (detail.id === settingsId) {
            if (detail.ok) { enabled = detail.enabled !== false; settingsError = ''; }
            else settingsError = detail.message || '翻译后台暂不可用，请重新加载窗口。';
            if (!enabled) invalidate();
            else schedule();
            return;
        }
        if (detail.id !== currentId) return;
        clearTimeout(requestTimer);
        const info = selectionInfo();
        if (!info || info.text !== currentText || pointerDown) { invalidate(); return; }
        if (detail.enabled === false) { enabled = false; invalidate(); return; }
        show(info, detail.ok ? detail.translation : detail.message || '翻译失败，请稍后重选文字。', !detail.ok);
    });
    document.addEventListener('mousedown', event => {
        if (popup.contains(event.target)) return;
        pointerDown = true; invalidate();
    }, true);
    document.addEventListener('mouseup', event => {
        if (popup.contains(event.target)) return;
        pointerDown = false; schedule();
    }, true);
    document.addEventListener('selectionchange', () => {
        // Selecting a translation itself must not open another translation.
        const selection = window.getSelection();
        if (selection?.anchorNode && popup.contains(selection.anchorNode)) return;
        const info = selectionInfo();
        if (!info || info.text !== currentText) { invalidate(); schedule(); }
    });
    close.addEventListener('mousedown', event => event.preventDefault());
    close.addEventListener('click', invalidate);
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !popup.hidden) { invalidate(); event.stopPropagation(); }
    }, true);
    const viewerContainer = document.getElementById('viewerContainer');
    viewerContainer?.addEventListener('scroll', invalidate, { passive: true });
    window.addEventListener('resize', invalidate);
    window.addEventListener('blur', () => { pointerDown = false; invalidate(); });
    PDFViewerApplication.eventBus.on('scalechanging', invalidate);
    PDFViewerApplication.eventBus.on('pagesdestroy', invalidate);
    void send({ type: 'surgerii_pdf_translate', id: settingsId, action: 'settings' }).catch(() => {
        settingsError = '无法连接 PDF 查看器后台，请重新打开 PDF。';
    });
}
