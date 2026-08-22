# harness-ai-desktop 开发约定

适用本仓库；工作区级红线与语言规范见根仓库 `F:\harness-ai\AGENTS.md`，冲突时本文件更具体的条目优先。

## 仓库定位

Electron 壳：主进程**同进程 `boot()`** 托管 dsh 运行时 + `loadURL` 直连 loopback 内嵌 dsh Web UI + 自研 Cordis 插件叠加。参照形态：anywhere-labs/deepseek-harness-desktop（只读参照，源码在工作区 `refs/`）。

## 目录结构

| 路径 | 职责 |
| --- | --- |
| `src/main/` | Electron 主进程；dsh 对接实现将收进 `src/main/harness/`（HarnessAdapter 窄接口，根 AGENTS 红线 #3） |
| `src/preload/` | 沙箱 preload（CJS 产物）；只暴露单一 API 面 |
| `src/renderer/` | 本地占位/兜底页（electron-vite 构建）。**dsh Web UI 不在这里**——它经 `loadURL('http://127.0.0.1:<port>')` 接入，禁走 `file://` |
| `src/shared/` | 主/渲染共享代码；UI 文案一律进 `src/shared/locales/`（zh-CN + en-US），禁止硬编码字面量 |
| `scripts/` | 工程脚本（如 `install-electron.mjs`：electron ≥43 无自带 postinstall，二进制由它显式拉取，默认 npmmirror 镜像） |

## 常用命令

```
pnpm install     # postinstall 会拉取 electron 二进制（ELECTRON_MIRROR 可覆盖镜像）
pnpm dev         # electron-vite dev，启动壳窗口
pnpm build       # electron-vite build（main/preload/renderer）
pnpm typecheck   # tsc --noEmit
```

最低验证：改动后 `pnpm typecheck` 与 `pnpm build` 必须通过；涉及窗口/启动行为的改动补 `pnpm dev` 冒烟。

## dsh 版本管理（根 AGENTS 红线 #2 的落地）

- 运行时 dsh = **npm 精确版本依赖**，全部经 `pnpm-workspace.yaml` 的 catalogs 引用（`catalog:dsh` / `catalog:cordis`），版本号只在 catalog 出现一次。
- 新增 dsh 依赖时必须写 `"@deepseek-ai/dsh-xxx": "catalog:dsh"`，并在 catalog 补条目；**禁止在 package.json 内写死版本**。
- 升级 dsh = 改 catalog 一处 + 独立任务回归；禁止顺手升级。
- 框架魔改走三级修改策略（根 AGENTS 红线 #1）；补丁产生时建 `docs/框架补丁清单.md`。

## 本仓库红线摘要

- dsh 永远 loopback，绝不对网络暴露；远程能力一律经 harness-ai-server 中转（根红线 #4）。
- `BrowserWindow` 安全默认不得回退：`sandbox: true` + `contextIsolation: true`；外链走系统浏览器。
- 代码注释、提交信息、日志全英文；UI 文案进 locales 目录，语言解析固定回退 `en-US`（台账 #11）。
- 凭据不落明文（根红线 #7）。
