# harness-ai-desktop

**English** | [中文](#中文)

Harness AI desktop workbench: a Codex / Claude Code–style agent app built on [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). Hosts the dsh runtime in-process (Electron main) and embeds its Web UI, with our features layered on as Cordis plugins.

- Stack: Electron + electron-vite + TypeScript + pnpm; dsh pinned as exact-version npm dependencies via pnpm catalogs.
- Status: shell scaffold in place (window, preload, placeholder renderer, zh-CN/en-US locale groundwork); dsh runtime not wired up yet.
- Workspace docs & conventions: see the [harness-ai root repository](https://cnb.cool/kafudev/harness-home/harness-ai) (README / AGENTS / docs, in Chinese).

## 中文

Harness AI 桌面工作台：基于 deepseek-harness（dsh）的类 Codex / Claude Code 桌面 Agent 软件。dsh 运行时跑在 Electron 主进程内（同进程 boot）并内嵌其 Web UI，自有特性以 Cordis 插件叠加。

- 技术栈：Electron + electron-vite + TypeScript + pnpm；dsh 以 npm 精确版本依赖锁定（pnpm catalogs 集中管理）。
- 状态：壳工程骨架已建立（窗口、preload、占位渲染页、zh-CN/en-US 文案目录基建）；dsh 运行时尚未接入。
- 工作区约定与文档：见上级 [harness-ai 根仓库](https://cnb.cool/kafudev/harness-home/harness-ai)（README / AGENTS / docs）。
