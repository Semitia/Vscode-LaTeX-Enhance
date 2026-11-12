'use strict';
const path = require('node:path');
const { translateLibre } = require('./libretranslate.cjs');
const { spawn } = require('node:child_process');

function normalizeText(text) {
    return text.replace(/\u00ad\s*\r?\n\s*/g, '').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
}

function runPython(executable, script, payload) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, ['-u', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        let output = '';
        let size = 0;
        let settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) { child.kill(); reject(error); } else resolve(value);
        };
        const timer = setTimeout(() => finish(new Error('翻译超时，请检查网络或代理。')), payload.provider === 'openai' ? 65000 : 10000);
        child.on('error', () => finish(new Error('无法启动 Python 3，请检查翻译设置中的 Python Path。')));
        child.stdin.on('error', () => {});
        child.stderr.resume();
        child.stdout.on('data', chunk => {
            size += chunk.length;
            if (size > 262144) finish(new Error('翻译返回内容过长。'));
            else output += chunk.toString('utf8');
        });
        child.on('close', code => {
            if (settled) return;
            if (code !== 0) { finish(new Error('翻译进程异常退出，请检查 Python Path。')); return; }
            try {
                const result = JSON.parse(output);
                if (!result.ok || typeof result.translation !== 'string' || !result.translation.trim()) {
                    finish(new Error(result.message || '翻译服务未返回译文。'));
                } else finish(null, result);
            } catch { finish(new Error('翻译服务未返回有效结果。')); }
        });
        child.stdin.end(JSON.stringify(payload));
    });
}

function createTranslator(vscode, extensionPath, runner = runPython, secrets) {
    const cache = new Map();
    const pending = new Map();
    return async data => {
        const config = vscode.workspace.getConfiguration('surgeriiZoom.translation');
        const provider = config.get('provider', 'google');
        const endpoint = provider === 'libretranslate' ? config.get('libreEndpoint', 'http://127.0.0.1:5000/translate') : config.get('endpoint', 'https://api.openai.com/v1/chat/completions');
        const source = config.get('libreSourceLanguage', 'en');
        const model = config.get('model', 'gpt-4.1-mini');
        const label = provider === 'libretranslate' ? '局域网翻译' : provider === 'openai' ? 'AI 翻译 · ' + model : 'Google 翻译';
        const enabled = config.get('enabled', true);
        const target = config.get('targetLanguage', 'zh-CN');
        if (data?.action === 'settings' || !enabled) return { ok: true, enabled, target, label, action: data?.action };
        if (typeof data?.text !== 'string' || data.text.length > 20000) throw new Error('请选择不超过 5000 字符的文字。');
        const text = normalizeText(data.text);
        if (!text || text.length > 5000) throw new Error('请选择不超过 5000 字符的文字。');
        if (typeof target !== 'string' || !/^[a-zA-Z-]{2,16}$/.test(target)) throw new Error('无效的翻译目标语言。');
        const key = JSON.stringify([provider, endpoint, model, source, target, text]);
        if (cache.has(key)) {
            const value = cache.get(key);
            cache.delete(key); cache.set(key, value);
            return { ...value, cached: true };
        }
        if (pending.has(key)) return pending.get(key);
        if (pending.size >= 4) throw new Error('翻译请求较多，请稍后重选文字。');
        const python = config.get('pythonPath', process.platform === 'win32' ? 'python' : 'python3');
        const proxy = config.get('proxy', '') || vscode.workspace.getConfiguration('http').get('proxy', '');
        if (typeof python !== 'string' || !python.trim() || typeof proxy !== 'string') throw new Error('无效的翻译进程配置。');
        const request = (async () => {
            let apiKey;
            if (provider === 'openai') {
                const url = new URL(endpoint);
                if (url.protocol !== 'https:' || url.username || url.password) throw new Error('AI 翻译接口必须是 HTTPS 地址。');
                apiKey = await secrets?.get('translation.apiKey:' + endpoint);
                if (!apiKey) throw new Error('请先执行命令“VS Code LaTeX Enhance: 设置 AI 翻译密钥”。');
            } else if (provider !== 'google' && provider !== 'libretranslate') throw new Error('未知翻译服务。');
            const script = provider === 'openai' ? 'ai_translate.py' : 'google_translate.py';
            const result = provider === 'libretranslate' ? await translateLibre({ endpoint, text, target, source }) : await runner(python, path.join(extensionPath, script), { text, target, proxy, provider, endpoint, model, apiKey });
            const value = { ok: true, enabled: true, label, translation: result.translation, detectedSource: result.detectedSource || '' };
            cache.set(key, value);
            if (cache.size > 256) cache.delete(cache.keys().next().value);
            return value;
        })();
        pending.set(key, request);
        try { return await request; } finally { pending.delete(key); }
    };
}

module.exports = { normalizeText, runPython, createTranslator };
