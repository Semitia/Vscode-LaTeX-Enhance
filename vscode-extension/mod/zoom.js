// Local Zoom Mod v1: slider and editable percentage.
export function installLocalEditableZoom() {
    if (document.getElementById('localZoomInput')) {
        return;
    }
    const container = document.getElementById('scaleSelectContainer');
    if (!container || !globalThis.PDFViewerApplication?.pdfViewer) {
        console.warn('[Local Zoom Mod] Viewer API unavailable; skipping.');
        return;
    }
    if (!document.getElementById('surgeriiLocalZoomStyle')) {
        const stylesheet = document.createElement('link');
        stylesheet.id = 'surgeriiLocalZoomStyle';
        stylesheet.rel = 'stylesheet';
        stylesheet.href = new URL('./surgerii-local-zoom.css', import.meta.url).href;
        document.head.appendChild(stylesheet);
    }
    const slider = document.createElement('input');
    slider.id = 'localZoomSlider';
    slider.type = 'range';
    slider.min = String(Math.log(0.1));
    slider.max = String(Math.log(25));
    slider.step = 'any';
    slider.setAttribute('aria-label', '拖动调整缩放');
    slider.title = '拖动实时缩放（10%–2500%）';
    const input = document.createElement('input');
    input.id = 'localZoomInput';
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', '缩放百分比');
    input.title = '输入百分比后回车；↑/↓ 每次微调 1%；Esc 取消（10%–2500%）';
    const viewer = PDFViewerApplication.pdfViewer;
    const syncSlider = () => {
        slider.value = String(Math.log(viewer.currentScale));
        slider.setAttribute('aria-valuetext', `${Number((viewer.currentScale * 100).toFixed(2))}%`);
    };
    const showScale = () => {
        input.value = `${Number((viewer.currentScale * 100).toFixed(2))}%`;
        input.setCustomValidity('');
        syncSlider();
    };
    const readPercent = () => {
        const raw = input.value.trim().replace(/[%％]$/, '').trim();
        return /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
    };
    const apply = () => {
        const percent = readPercent();
        if (!Number.isFinite(percent) || percent < 10 || percent > 2500) {
            input.setCustomValidity('请输入 10 到 2500 之间的缩放百分比');
            return false;
        }
        viewer.currentScaleValue = String(percent / 100);
        showScale();
        return true;
    };
    input.addEventListener('input', () => input.setCustomValidity(''));
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (apply()) {
                input.blur();
                viewer.focus();
            }
            else {
                input.reportValidity();
            }
        }
        else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            showScale();
            input.blur();
            viewer.focus();
        }
        else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            const current = readPercent();
            const percent = Number.isFinite(current) ? current : viewer.currentScale * 100;
            input.value = String(Math.min(2500, Math.max(10,
                percent + (event.key === 'ArrowUp' ? 1 : -1))));
            apply();
        }
    });
    input.addEventListener('blur', () => {
        if (!apply()) {
            showScale();
        }
    });
    slider.addEventListener('input', () => {
        viewer.currentScaleValue = String(Number((Math.exp(Number(slider.value)) * 100).toFixed(2)) / 100);
        showScale();
    });
    slider.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight' ||
            event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
            event.preventDefault();
            event.stopPropagation();
            const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1;
            viewer.currentScaleValue = String(Math.min(25, Math.max(0.1,
                Number((viewer.currentScale * 100 + direction).toFixed(2)) / 100)));
            showScale();
        }
    });
    PDFViewerApplication.eventBus.on('scalechanging', () => {
        syncSlider();
        if (document.activeElement !== input) {
            showScale();
        }
    });
    container.appendChild(slider);
    container.appendChild(input);
    showScale();
}
