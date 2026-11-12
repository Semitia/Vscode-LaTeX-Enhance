'use strict';
const vscode = require('vscode');
const patcher = require('./patcher.cjs');
const { addPdfSelection } = require('./pdf-context.cjs');
const { createTranslator } = require('./translation.cjs');

function activate(context) {
    const translate = createTranslator(vscode, context.extensionPath || __dirname, undefined, context.secrets);
    context.subscriptions.push(vscode.commands.registerCommand('surgeriiZoom.translatePdfSelection', translate));
    context.subscriptions.push(vscode.commands.registerCommand('surgeriiZoom.addPdfSelection', data =>
        addPdfSelection(vscode, context, data)));
    context.subscriptions.push(vscode.commands.registerCommand('surgeriiZoom.setTranslationApiKey', async () => {
        const config = vscode.workspace.getConfiguration('surgeriiZoom.translation');
        const endpoint = config.get('endpoint', 'https://api.openai.com/v1/chat/completions');
        const key = await vscode.window.showInputBox({ password: true, ignoreFocusOut: true,
            prompt: `输入 ${new URL(endpoint).hostname} 的 AI 翻译密钥（保存在 VS Code 安全存储）` });
        if (!key?.trim()) return;
        await context.secrets.store('translation.apiKey:' + endpoint, key.trim());
        await config.update('provider', 'openai', vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage('AI 翻译密钥已保存，已切换到 AI 翻译。');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('surgeriiZoom.selectTranslationProvider', async () => {
        const choice = await vscode.window.showQuickPick([
            { label: '局域网 LibreTranslate', value: 'libretranslate' },
            { label: 'AI 翻译', value: 'openai' }, { label: 'Google 翻译', value: 'google' }
        ], { placeHolder: '选择 PDF 划词翻译服务' });
        if (choice) await vscode.workspace.getConfiguration('surgeriiZoom.translation')
            .update('provider', choice.value, vscode.ConfigurationTarget.Global);
    }));
    let busy = false;
    const command = (name, action) => context.subscriptions.push(
        vscode.commands.registerCommand(name, async () => {
            if (busy) return;
            busy = true;
            try {
                const target = vscode.extensions.getExtension('james-yu.latex-workshop');
                if (!target) throw new Error('请先在当前环境安装 LaTeX Workshop。WSL 窗口请安装到 WSL。');
                await action(target.extensionPath);
            } catch (error) {
                void vscode.window.showErrorMessage(`VS Code LaTeX Enhance: ${error.message}`);
            } finally {
                busy = false;
            }
        })
    );
    const offerReload = async message => {
        const answer = await vscode.window.showInformationMessage(message, '重新加载窗口');
        if (answer) await vscode.commands.executeCommand('workbench.action.reloadWindow');
    };
    command('surgeriiZoom.apply', async root => {
        const result = await patcher.apply(root, context.globalStorageUri.fsPath);
        await offerReload(`VS Code LaTeX Enhance: ${result.changed ? '补丁已应用' : '补丁已是最新'}（LaTeX Workshop ${result.version}）。重新加载窗口后生效。`);
    });
    command('surgeriiZoom.restore', async root => {
        await patcher.restore(root);
        await offerReload('VS Code LaTeX Enhance: 补丁已移除，重新加载窗口后恢复原查看器。');
    });
    command('surgeriiZoom.status', async root => {
        const result = await patcher.status(root);
        void vscode.window.showInformationMessage(`VS Code LaTeX Enhance: LaTeX Workshop ${result.version}，${result.installed ? '已应用补丁' : '尚未应用，请执行“应用 / 重新应用补丁”'}。`);
    });
}

module.exports = { activate };
