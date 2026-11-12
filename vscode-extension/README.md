# VS Code LaTeX Enhance

为 [LaTeX Workshop](https://github.com/James-Yu/LaTeX-Workshop) 的内置 PDF 查看器提供缩放控制、划词翻译和 Codex 选区附件功能，方便在 VS Code 中阅读与处理 LaTeX 文档。

## 功能

- **精细缩放**：通过滑条或百分比输入框调整缩放比例，支持小数和键盘微调。
- **划词翻译**：选择单词或段落后，在选区旁显示译文。支持 Google 网页翻译、OpenAI 兼容接口和自托管 LibreTranslate。
- **选区附件**：按 `Alt+A` 将选中文字、PDF 来源和页码加入 Codex 输入框，保留原文上下文。

## 环境要求

- VS Code 1.85 或更新版本，以及 LaTeX Workshop。
- 从源码打包需要 Node.js、npm 和可用的 `code` 命令。
- 使用 Google 或 OpenAI 兼容翻译服务时，需要 Python 3；仅使用 LibreTranslate 时不需要 Python。
- 使用 Codex 选区附件功能时，需要提供 `chatgpt.addFileToThread` 命令的 Codex 扩展。

## 安装

### 从源码安装

```bash
git clone https://github.com/Semitia/Vscode-LaTeX-Enhance.git
cd Vscode-LaTeX-Enhance
npm run install:local
```

也可以执行 `npm run package` 生成 VSIX，再通过 VS Code 扩展面板的 **从 VSIX 安装…** 安装。产物位于 `dist/`。

安装后，在命令面板执行 **VS Code LaTeX Enhance: 应用 / 重新应用补丁**，然后重新加载窗口。

在 WSL 或 Remote SSH 环境中，应将本扩展与 LaTeX Workshop 安装到同一扩展宿主环境。

## 使用

### PDF 缩放

在 LaTeX Workshop 内置 PDF 查看器中拖动缩放滑条，或输入百分比后按回车确认。输入框支持方向键微调，按 `Esc` 可取消编辑。

### 划词翻译

选择 PDF 正文中的单词或段落，译文会显示在选区旁。按 `Esc`、点击关闭按钮或取消选区可收起弹窗。

执行 **VS Code LaTeX Enhance: 切换翻译服务** 选择服务：

| 服务 | 所需配置 | 说明 |
| --- | --- | --- |
| Google 网页翻译 | 无需 API 密钥；可选代理 | 使用网页翻译接口，可能受到限流 |
| OpenAI 兼容接口 | 完整接口地址、模型名称和 API 密钥 | 可接入兼容 Chat Completions 的翻译服务 |
| LibreTranslate | `/translate` 接口地址 | 支持本机、局域网或其他自托管部署 |

在 VS Code 设置中搜索 `surgeriiZoom.translation`。主要配置如下：

| 设置后缀 | 用途 |
| --- | --- |
| `enabled` | 开启或关闭自动划词翻译 |
| `provider` | `google`、`openai` 或 `libretranslate` |
| `targetLanguage` | 目标语言，例如 `zh-CN`、`en` |
| `endpoint` | OpenAI 兼容接口的完整 HTTPS 地址 |
| `model` | AI 服务的模型名称 |
| `pythonPath` | Python 3 可执行文件路径 |
| `proxy` | Google 和 AI 请求使用的可选 HTTP/HTTPS 代理 |
| `libreEndpoint` | LibreTranslate 的完整翻译接口地址 |
| `libreSourceLanguage` | LibreTranslate 源语言，支持 `en` 或 `auto` 等语言代码 |

使用 AI 服务前，配置服务地址和模型，再执行 **VS Code LaTeX Enhance: 设置 AI 翻译密钥**。密钥保存在 VS Code SecretStorage 中，并按接口地址分别保存。

LibreTranslate 配置示例（服务运行在扩展宿主所在机器的 5000 端口）：

```json
{
  "surgeriiZoom.translation.provider": "libretranslate",
  "surgeriiZoom.translation.libreEndpoint": "http://127.0.0.1:5000/translate",
  "surgeriiZoom.translation.libreSourceLanguage": "en",
  "surgeriiZoom.translation.targetLanguage": "zh-CN"
}
```

远程部署时，将示例地址替换为扩展宿主能够访问的服务器地址。LibreTranslate 请求直接连接该地址，不使用插件的代理设置。

单次选区最多 5000 字符。插件会合并重复请求并缓存成功结果；请求失败时显示错误，不自动切换服务。

### 添加 Codex 附件

选中文字后按 `Alt+A`，插件会将摘录加入 Codex 输入框，由用户确认后发送。附件包含文字、PDF 文件路径和页码，不包含整份 PDF。

摘录文件保存在扩展存储目录的 `pdf-selections/` 中。确认相关会话不再需要附件后，可手动清理。

## 数据处理

翻译请求只发送选中文字和翻译所需参数，不上传 PDF 文件或其路径。文本会交由所选翻译服务处理；选择自托管 LibreTranslate 时，请求发送到配置的服务器。

Codex 附件包含来源路径。翻译和添加附件是两个独立操作，划词翻译不会自动向 Codex 发送内容。

## 更新与卸载

本扩展通过补丁增强 LaTeX Workshop 的内置查看器。LaTeX Workshop 更新后，需要重新执行 **应用 / 重新应用补丁**。

当前已验证 LaTeX Workshop 10.20.0。查看器结构不兼容时，补丁会拒绝修改。原文件备份保存在本扩展的存储目录中。

卸载前先执行 **VS Code LaTeX Enhance: 移除补丁**，然后重新加载窗口并卸载扩展。

## 开发与测试

```bash
npm test                 # 补丁、摘录及翻译客户端检查
npm run test:browser     # 真实 PDF.js 查看器回归检查
npm run package          # 打包 VSIX
npm run install:local    # 打包并安装到当前 VS Code 环境
```

浏览器测试自动查找已安装的 LaTeX Workshop 和 Playwright Chromium，也可以通过以下环境变量指定路径：

```bash
export LATEX_WORKSHOP_ROOT=/path/to/latex-workshop
export CHROMIUM_PATH=/path/to/chrome
```

测试默认使用仓库内的示例 PDF，可通过 `TEST_PDF` 指定其他文件。测试不需要真实 API 密钥；仅在显式传入 `--live-google` 时，浏览器测试会请求真实 Google 翻译服务。

```text
vscode-extension/  扩展入口、翻译客户端及查看器补丁
scripts/           测试、打包及示例文件生成脚本
tests/             回归测试与测试夹具
dist/              VSIX 构建产物
```

为兼容已有安装，内部扩展 ID `surgerii-local.latex-workshop-zoom-mod`、命令 ID `surgeriiZoom.*` 和设置前缀保持不变。

## 许可证

本项目采用 [MIT License](https://github.com/Semitia/Vscode-LaTeX-Enhance/blob/main/LICENSE)。测试夹具中的 LaTeX Workshop 代码遵循其自身的 MIT 许可证，见 `tests/fixtures/LICENSE.LaTeX-Workshop`。
