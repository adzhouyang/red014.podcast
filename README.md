# Red014.Podcast

Red014.Podcast 是一个本地运行的文章转播客实验工具。它可以把长文章、文字型 PDF 或网页正文改编成中文双人对谈脚本，并进一步生成可试听、可下载的播客音频。

项目当前定位是个人技术验证：重点验证“内容导入 → 脚本生成 → 人工编辑 → TTS 渲染 → MP3 输出”的完整链路，而不是商业化 SaaS 或公开多用户平台。

## 主要能力

- 支持三类输入：粘贴文本、上传文字型 PDF、输入网页 URL。
- 生成结构化双人播客脚本，包含标题、摘要、分段、说话人、台词和原文事实引用。
- 支持多脚本模型供应商：Anthropic、OpenAI、Hermes、Gemini。
- 支持 prompt 版本选择，便于对比不同脚本策略。
- 提供脚本工作台，可人工修改单句台词，也可按片段重新生成。
- 支持火山引擎播客/TTS 和 OpenAI TTS 作为语音渲染后端。
- 记录任务数据到本地目录，便于复盘模型、耗时和生成结果。

## 技术栈

- Web 应用：Next.js 16、React 19、TypeScript
- 校验与结构化数据：Zod
- 文本导入：Readability、jsdom、pdfjs-dist
- 测试：Vitest
- 命令行实验脚本：Node.js ESM

## 项目结构

```text
.
├── generate-script.mjs        # 命令行脚本生成实验
├── podcast.mjs                # 命令行端到端播客流程
├── tts-volcengine.mjs         # 火山引擎 TTS 实验脚本
├── volc-podcast.mjs           # 火山引擎播客渲染实验脚本
├── test-articles/             # 本地测试文章
├── PRD.md                     # 产品需求与实验目标
└── web/                       # Next.js Web 应用
    ├── src/app/               # 页面与 API Route
    ├── src/importers/         # 文本、PDF、网页导入
    ├── src/providers/         # 脚本模型与 TTS 供应商适配
    ├── src/podcast/           # 播客脚本 schema 与生成逻辑
    ├── src/audio/             # 音频处理与渲染辅助
    └── tests/                 # 单元测试
```

生成产物默认不进入 Git：

- `data/`：Web 任务数据目录，默认由 `RED014_DATA_DIR` 控制
- `jobs/`、`output/`、`tts-output/`：命令行实验产物
- `node_modules/`、`.next/`：依赖和构建产物

## 环境变量

项目只从环境变量读取密钥，不应把密钥写入源码或提交到 Git。

脚本模型：

```bash
ANTHROPIC_API_KEY=...
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MODEL=claude-sonnet-4-20250514

OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com
OPENAI_MODEL=gpt-5.1

HERMES_API_KEY=...
HERMES_BASE_URL=...
HERMES_MODEL=...

GEMINI_API_KEY=...
GEMINI_MODEL=...
```

语音生成：

```bash
VOLC_APP_ID=...
VOLC_API_KEY=...
VOLC_RESOURCE_ID=seed-tts-2.0
```

本地数据目录：

```bash
RED014_DATA_DIR=./data
```

## 本地启动

安装根目录命令行脚本依赖：

```bash
npm install
```

安装 Web 应用依赖并启动开发服务器：

```bash
cd web
npm install
npm run dev
```

打开：

```text
http://localhost:3000
```

## 使用流程

1. 在首页选择输入方式：粘贴文本、上传 PDF 或输入网页链接。
2. 设置目标时长、脚本模型和 prompt 版本。
3. 生成双人对谈脚本。
4. 在脚本工作台审阅、编辑台词，必要时局部重新生成片段。
5. 进入音频页面，选择语音供应商和说话人组合。
6. 渲染并下载最终音频。

## 命令行实验

生成脚本：

```bash
npm run script -- test-articles/article-1-opinion.md
```

运行端到端流程：

```bash
npm run p1 -- test-articles/article-1-opinion.md
```

只生成脚本、不跑 TTS：

```bash
npm run p1:skip-tts -- test-articles/article-1-opinion.md
```

## 测试

Web 应用单元测试：

```bash
cd web
npm test
```

Lint：

```bash
cd web
npm run lint
```

## 当前限制

- 当前主要面向个人本地实验，没有登录、权限、多租户和云端任务队列。
- PDF 仅支持文字型 PDF，不包含 OCR。
- 网页导入依赖公开页面正文提取，不处理登录、验证码或强反爬页面。
- 语音质量、生成速度和费用受第三方模型供应商限制。
- 生成内容需要人工审阅，尤其是事实准确性和引用一致性。

## 设计目标

Red014.Podcast 的核心不是“一键把文章变成音频”，而是把播客生成流程拆成可检查、可替换、可复盘的几个阶段：

```text
原始内容 → 清洗文本 → 结构化脚本 → 人工审阅 → 语音渲染 → 实验记录
```

这样可以比较不同模型、prompt 和语音方案的效果，也能在某个片段出错时只重做局部，而不是整期从头生成。
