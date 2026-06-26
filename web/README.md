# Red014.Podcast Web

这是 Red014.Podcast 的 Next.js Web 应用。项目完整说明、环境变量、启动方式和使用流程请看根目录 [README.md](../README.md)。

## 本地启动

```bash
cd web
npm install
npm run dev
```

打开 `http://localhost:3000`。

## 常用命令

```bash
npm run dev
npm run build
npm run lint
npm test
```

## 目录

- `src/app/`：页面与 API Route
- `src/importers/`：文本、PDF、网页导入
- `src/providers/`：脚本模型与 TTS 供应商适配
- `src/podcast/`：播客脚本 schema 与生成逻辑
- `src/audio/`：音频处理与渲染辅助
- `tests/`：单元测试

## 环境变量

密钥只通过环境变量读取。不要提交 `.env` 或任何真实 API key。

可用变量包括 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`HERMES_API_KEY`、`GEMINI_API_KEY`、`VOLC_APP_ID`、`VOLC_API_KEY` 和 `RED014_DATA_DIR`。
