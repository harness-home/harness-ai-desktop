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
| `plugins/*/src/client/` | dsh 客户端 UI 插件源码：**组件用 TSX**（automatic runtime；`react`/`react/jsx-runtime` 保持 external，由 dsh 模块表供给），esbuild 打成 lazy-CJS bundle |

**预置插件机制（M3）**：`plugins/*` 下的第一方插件即产品预置插件——随安装包发布、经 `src/main/harness/dsh.ts` 的 `APP_ROWS` overlay 注入 dsh 树，无运行时安装。市场后端把同一批以 `preset: true` 展示（`harness-ai-server` 的 `market/seed.ts`）。新增预置插件 = 加 `plugins/<name>` + APP_ROWS 一行 + seed 一条。
| `scripts/` | 工程脚本（如 `install-electron.mjs`：electron ≥43 无自带 postinstall，二进制由它显式拉取，默认 npmmirror 镜像） |

## 常用命令

```
pnpm install          # postinstall 会拉取 electron 二进制（ELECTRON_MIRROR 可覆盖镜像）
pnpm dev              # 先构建 plugins/*，再 electron-vite dev 启动壳窗口
pnpm build            # 插件 + main/preload/renderer 构建
pnpm typecheck        # tsc --noEmit（含 plugins/*/src）
node scripts/smoke.mjs  # 自动化启动冒烟（端点/页面/品牌插件断言）
pnpm run dist:win     # License 闸门 + electron-builder Win x64 NSIS + afterPack 硬校验（关键路径 + 运行时闭包）
node scripts/smoke-packaged.mjs  # 打包产物冒烟：**先复制到仓库外**再启动（必须，见下）
pnpm run dsh:version 0.1.2-rc.1  # 一键改全部 dsh catalog 版本（不带参数 = 打印当前版本）
```

最低验证：改动后 `pnpm typecheck` 与 `pnpm build` 必须通过；涉及窗口/启动/运行时行为的改动跑 `node scripts/smoke.mjs`。完整验收见 [docs/acceptance.md](docs/acceptance.md)。

## dsh 版本管理（根 AGENTS 红线 #2 的落地）

- 运行时 dsh = **npm 精确版本依赖**，全部经 `pnpm-workspace.yaml` 的 catalogs 引用（`catalog:dsh` / `catalog:cordis`），版本号只在 catalog 出现一次。
- 新增 dsh 依赖时必须写 `"@deepseek-ai/dsh-xxx": "catalog:dsh"`，并在 catalog 补条目；**禁止在 package.json 内写死版本**。
- 升级 dsh = `pnpm run dsh:version <版本>` 一条命令改全部 catalog 条目 + 独立任务回归；禁止顺手升级、禁止手改版本号（pnpm 会重写本文件并展开 YAML 锚点，脚本才是单点事实源）。
- **打包依赖闭包**：dsh 包把兄弟包声明为 peerDependencies，而 electron-builder 只走 dependencies——凡运行时要用的必须列进本仓库 `dependencies`。afterPack 的闭包校验会挡住遗漏。
- **打包冒烟必须在仓库外跑**：`dist/win-unpacked` 位于项目内，Node 向上查找会命中开发树 node_modules，缺依赖也能跑起来（真实事故：装到 Program Files 后 loader entries 全崩）。用 `scripts/smoke-packaged.mjs`，它会先复制到临时目录。
- 框架魔改走三级修改策略（根 AGENTS 红线 #1）；补丁产生时建 `docs/框架补丁清单.md`。

## 本仓库红线摘要

- dsh 永远 loopback，绝不对网络暴露；远程能力一律经 harness-ai-server 中转（根红线 #4）。
- `BrowserWindow` 安全默认不得回退：`sandbox: true` + `contextIsolation: true`；外链走系统浏览器。
- 代码注释、提交信息、日志全英文；UI 文案进 locales 目录，语言解析固定回退 `en-US`（台账 #11）。
- 凭据不落明文（根红线 #7）。
