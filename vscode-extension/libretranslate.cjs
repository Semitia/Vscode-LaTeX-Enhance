'use strict';
const http = require('node:http');
const https = require('node:https');
const agents = { 'http:': new http.Agent({ keepAlive: true }), 'https:': new https.Agent({ keepAlive: true }) };
const language = code => ({ 'zh-cn': 'zh', 'zh-hans': 'zh', 'zh-tw': 'zt', 'zh-hant': 'zt' }[code.toLowerCase()] || code.toLowerCase());

function translateLibre({ endpoint, text, target, source = 'en' }) {
    return new Promise((resolve, reject) => {
        let url;
        try { url = new URL(endpoint); } catch { reject(new Error('LibreTranslate 接口地址无效。')); return; }
        if (!agents[url.protocol] || url.username || url.password) {
            reject(new Error('LibreTranslate 接口需要 HTTP 或 HTTPS 地址。')); return;
        }
        const body = JSON.stringify({ q: text, source: language(source), target: language(target), format: 'text' });
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(url, { method: 'POST', agent: agents[url.protocol], headers: {
            'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Accept': 'application/json'
        } }, res => {
            let size = 0;
            const chunks = [];
            res.on('data', chunk => {
                size += chunk.length;
                if (size > 262144) req.destroy(new Error('LibreTranslate 返回内容过长。'));
                else chunks.push(chunk);
            });
            res.on('error', () => finish(new Error('LibreTranslate 连接中断。')));
            res.on('end', () => {
                if (res.statusCode !== 200) { finish(new Error(`LibreTranslate 请求失败（HTTP ${res.statusCode}），请检查服务和语言配置。`)); return; }
                try {
                    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if (typeof result.translatedText !== 'string' || !result.translatedText.trim()) throw new Error();
                    finish(null, { translation: result.translatedText, detectedSource: result.detectedLanguage?.language || source });
                } catch { finish(new Error('LibreTranslate 未返回有效译文。')); }
            });
        });
        let settled = false;
        const timer = setTimeout(() => req.destroy(new Error('LibreTranslate 超时，请检查局域网服务。')), 30000);
        const finish = (error, value) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            if (error) reject(error); else resolve(value);
        };
        req.on('error', error => finish(new Error(error.message.startsWith('LibreTranslate') ? error.message : '无法连接 LibreTranslate，请检查服务器地址和网络。')));
        req.end(body);
    });
}
module.exports = { translateLibre, language };
