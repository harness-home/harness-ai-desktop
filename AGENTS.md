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
pnpm test             # vitest（纯逻辑单测：deep-link 解析、profile 插件审计/隔离）
```

最低验证：改动后 `pnpm typecheck`、`pnpm test` 与 `pnpm build` 必须通过；涉及窗口/启动/运行时行为的改动跑 `node scripts/smoke.mjs`。完整验收见 [docs/acceptance.md](docs/acceptance.md)。

## dsh 版本管理（根 AGENTS 红线 #2 的落地）

- 运行时 dsh = **npm 精确版本依赖**，全部经 `pnpm-workspace.yaml` 的 catalogs 引用（`catalog:dsh` / `catalog:cordis`），版本号只在 catalog 出现一次。
- 新增 dsh 依赖时必须写 `"@deepseek-ai/dsh-xxx": "catalog:dsh"`，并在 catalog 补条目；**禁止在 package.json 内写死版本**。
- 升级 dsh = `pnpm run dsh:version <版本>` 一条命令改全部 catalog 条目 + 独立任务回归；禁止顺手升级、禁止手改版本号（pnpm 会重写本文件并展开 YAML 锚点，脚本才是单点事实源）。
- **打包依赖闭包**：dsh 包把兄弟包声明为 peerDependencies，而 electron-builder 只走 dependencies——凡运行时要用的必须列进本仓库 `dependencies`。afterPack 的闭包校验会挡住遗漏。
- **打包冒烟必须在仓库外跑**：`dist/win-unpacked` 位于项目内，Node 向上查找会命中开发树 node_modules，缺依赖也能跑起来（真实事故：装到 Program Files 后 loader entries 全崩）。用 `scripts/smoke-packaged.mjs`，它会先复制到临时目录。
- 框架魔改走三级修改策略（根 AGENTS 红线 #1）；补丁产生时建 `docs/框架补丁清单.md`。

## Profile 插件不得成为承重墙（2026-08-23，真实事故）

**事故**：装在 `D:\Program Files` 的 0.1.0 打包版启动即死，错误是 `failed to import loader entry memo (dsh-memo)`。根因不是插件本身有问题——`dsh-memo` 就在 `~/.dsh/profiles/desktop/node_modules` 里躺着——而是那个构建早于 profile 回退解析器（`module-resolution.ts`），解析不到它；而 Loader 一条 entry 失败，**整棵插件树失败，客户端变砖，只剩堆栈**。市场装一个插件就能把客户端弄死。

**因此（不可回退的约定）**：市场装进 profile 的插件永远是可选项，任何一个坏掉都不能挡住启动。`src/main/harness/profile-plugins.ts` 是这层保险，两道防线：

1. **启动前审计**：`auditProfileBundles()` 逐个检查 profile 自有 bundle（包在不在、manifest 还声不声明 `dsh.bundle.patch`、patch 文件在不在），不合格的从 `dsh.profile.bundles` 摘掉并记进 `harness-quarantine.json`。
2. **启动失败兜底**：`boot()` 抛错时把**所有** profile 自有插件停用后重启一次（`quarantineBundles(..., 'boot-failed')`）。审计过不了的坏法（插件 import 时自己炸）由这道兜住。

配套约束：
- **`@deepseek-ai/dsh-*` 模板 bundle 永不隔离**——它们随安装包提供，坏了说明安装包坏了，掩盖只会更难查。
- **依赖条目保留不动**：只摘 bundle 注册，`dependencies` 留着，用户还能在市场里看到并修/删。
- **降级必须可见**：`/desktop/market/quarantined` + 市场面板顶部横幅列出被停用的插件与原因。**静默降级等同于 bug**——`releaseQuarantine()` 失败时绝不能顺手删掉记录（踩过：删了之后插件永远停用且界面上什么都不显示）。
- 改这块必须跑 `src/main/harness/profile-plugins.test.ts`，并至少手工验一次「插件包被挪走 → 客户端照常启动 + 横幅出现」。

## 换 dsh 内置行时必须整对替换（2026-08-23，真实事故）

**事故**：新建对话 → 点「选择工作区」**毫无反应**（0.1.0~0.1.2 全中，等于客户端根本没法开新工作区）。根因不在我们的 picker 实现，而在 overlay 的替换方式：上游 `directory-picker` 行指向 `@deepseek-ai/dsh-host-directory-picker-auto`，它挂载的是**一对**——host 后端 + **客户端界面包**（`dsh-client-ui-directory-picker-native`，负责填 ui-workspace 的 `conversation.hero.workspace.directoryFlow` / `sidebar.workspaces.directoryFlow` 两个洞）。我们把这一行整个 `disabled` 掉、只插回自己的 host 后端，客户端那一半就再没人挂载：`WorkspacePickFlow` 读到 `flowAvailable === false` → 菜单项列表为空 → **整个菜单渲染成 null**，按钮 `aria-expanded` 照常翻成 true，看起来就是「点了没反应」。上游源码里那句 `pinning an interaction remains composing that pair directly instead of this row` 说的就是这件事。

**约定**：**禁用一个上游组合行之前，先读它的源码，确认它到底挂载了几样东西，然后把它挂载的每一样都补回来。** 别只看行名字面上的那个包。替换逻辑收在 `src/main/harness/picker-overlay.ts`（无依赖、可单测），`picker-overlay.test.ts` 钉住「后端 + 客户端界面两半都在」这条规则。

**排查手法（下次同类问题直接用）**：
- 按钮 `aria-expanded` 翻了但 DOM 一点没变 = 菜单渲染成空，几乎一定是某个 slot 没人占。
- `performance.getEntriesByType('resource')` 里搜 `/plugins/<包名>/client.js` —— 能直接看出某个客户端插件包到底加载没加载。
- 原生对话框不出现在 `MainWindowTitle` 里，要用 `EnumWindows` 按标题找（我们的选择器窗口标题是 `Select a workspace folder`，窗口类 `#32770`）。
- **别用 SendKeys 去驱动原生对话框**：前台窗口切换会被系统拦，按键会打到别的应用上。

## asar 打开后客户端模块图静默清空（2026-08-25，真实事故）

**现象**：`asar: true` 之后客户端照常启动、端口在听、首页也吐得出来；`ctx.loader.entries()` 与非 asar **完全一致**（144 条 / 116 条有 fiber / 我们 5 个插件全部 `fiber=true disabled=false`），boot profile 照样 156 fiber，日志零错误。但首页只有 3,226 字符（非 asar 是 16,188）、`/plugins/*/client.js` **一条都没有**、自研插件全 404——**整个 Web UI 是空的**。

**根因**：`dsh-client-modules` 用 `createRequire(ctx.baseUrl)` 读包元数据，而这个 base 是组合树的根，也就是 **profile 目录**。从 profile 做 CJS 解析要够到装在应用里的包，唯一的路是 `healProfilesModuleFallback` 在 `<dsh home>/profiles/node_modules` 下建的那片**真实 OS 符号链接**。asar 之后它们指向 `...\app.asar\node_modules\<包>`，而 `app.asar` 是一个文件，内核走不进去 → `MODULE_NOT_FOUND` → `resolveMeta` **catch 住、缓存成「不是 client 包」、不打日志**。40 个 client 包全军覆没，全程零报错。

**修法**：`module-resolution.ts` 的 `installInstallationRequireFallback()`——给 CJS 侧补上与 ESM 侧对称的兜底：`Module._resolveFilename` 真抛 `MODULE_NOT_FOUND` 之后再去安装目录的 `node_modules` 找。只在失败后生效，遮蔽不了 profile 合法提供的包；`app.asar\...` 这个**路径字符串**带 `.asar`，Electron 的归档层会接管，所以读得到——过不去的只有内核解析符号链接那一步。

**教训（比修法重要）**：

- **`registerHooks` 只管 ESM。** 本仓库凡是「解析兜底」相关的改动，都要追问另一半（CJS / `createRequire`）谁在管。这里原本是那片符号链接农场在管，而这件事从没被写下来过。
- **判据必须落在会坏的那一侧。** 当时拿「BOOTED + fiber 数 + ready 耗时」判定 asar 通过——全是 node 侧指标，坏的却是 client 侧，**node 侧指标一个都不会变红**。打包形态类改动的验收口径以 `scripts/smoke-packaged.mjs` 为准（它查 boot graph 与 client.js 可达性），别拿「起来了」当通过。
- **别再依赖那片符号链接农场。** 它指向「最后一次启动的那个构建」——换构建、挪安装目录、装多个版本都会让它悬空，症状同样是静默变空。

## 应用升级（台账 #14 落地，2026-08-23）

- `src/main/updater.ts`：electron-updater + generic feed。**feed 来源**：打包产物里的 `app-update.yml`（由 `electron-builder.yml` 的 `publish` 段生成），可被 `HARNESS_UPDATE_FEED_URL` 运行时覆盖（免重新打包，测试与私有部署都靠它）；`HARNESS_UPDATE_AUTO=0` 关掉自动检查。
- **口径**：自动下载、**绝不自动安装**——装与不装由用户点（托盘「重启并安装」）或下次真正退出时执行。启动 45s 后首查，之后每 6 小时。
- **更新链路不能碰运行时**：feed 不可达只写进状态（`phase: 'error'`）并显示在托盘，dsh 侧零影响。托盘那一行既是状态也是操作，不另开菜单项。
- `electron-builder.yml` 的 `publish.url` 目前是占位域名（分发位置未定，台账 #14/#30）；`dist:win` 带 `--publish never`，本地打包不会真的上传。
- **验证方式**（已实测）：`-c.directories.output=dist/next` 打一个更高版本 → 静态服务器起 feed → 低版本 `win-unpacked` 带 `HARNESS_UPDATE_FEED_URL` 启动 → 应看到 checking → available → downloading → ready。差分下载会因为 feed 里没有旧版 blockmap 而回落全量，这是预期的。

## 安装耗时的成本模型（2026-08-25 实测，别再凭直觉优化体积）

同一台机器、同一个 0.1.5、每轮之间完整卸载重装、两组交替各跑 2 轮（`baseline → trimmed → trimmed → baseline`，避免运行顺序偏袒某一组）：

| 构建 | 安装包 | 铺盘文件数 | 铺盘体积 | 安装耗时 |
| --- | --- | --- | --- | --- |
| 原版 | 139.8 MB | 19,691 | 507 MB | 299.3s |
| 只砍 53 个语言包（−45 MB） | 131.4 MB | 19,655 | 459 MB | 330.6s |
| 再砍 `.map` + `.d.ts`（−7,285 文件） | 123.1 MB | 12,371 | 420 MB | 210.2s |
| asar spike | 115.0 MB | **105** | 423.1 MB | **12.3s** |

**结论：安装成本按文件数付，不按字节付。** 砍掉 45 MB（53 个大文件）耗时没动；asar 铺盘字节数反而比上一档多 3 MB，安装却快 17 倍。约 15ms/文件是这台机器上的经验系数（NSIS 逐文件创建 + Defender 逐文件扫描）。

- **别再提「减小安装包体积」当性能改进**——除非它同时大幅减少文件数。下载大小和安装耗时是两件事，混着说会把人带沟里。
- 单次测量不可信：这台机器的本底噪声很大（同一构建两轮实测出现过 250s vs 170s、296s vs 365s）。**小于 20% 的差异必须多轮交替才能下结论**，一轮就下结论等于编。
- 复现方式见 `scripts/`（测量脚本在 scratchpad，不入库）：静默安装 `/S`，**完成信号取「卸载器已写出 + 目录大小不再增长」，不要等安装进程退出**——它在拷贝结束后仍存活很久，等它退出量到的是别的东西。

**同一条成本模型也解释「装完第一次打开很卡」**：装完立刻冷启，12,371 文件那版 ready 用了 **38.8s**（`HostResolvedRootInclude` 独占 28.0s——导入整棵模块树，逐文件冷读 + 首次扫描），第二次热启 6.6s；同样刚装完冷启的 asar 版是 **3.4s**。文件数不只买安装时间，也买首次启动时间，而首次启动正是用户形成印象的那一次。（冷启各测 1 次，量级差异可信，精确值别当结论。）

**asar 已在 2026-08-25 切换落地**（`asar: true` + `asarUnpack: '**/*.{node,exe,dll}'`）。三道预设验证的结果：① `verify-packaged.cjs` 改成读归档清单，并**注入四种坏情况做了证伪**（归档里没有的必需路径、被当成 unpacked 的打包文件、不存在的 unpacked 路径、闭包缺包——全部拦下），控制组通过；② pnpm 从归档内跑通（`--version` + 真装一个包进 profile 形状目录）；③ ripgrep / node-pty（conpty 回显）/ sharp（libvips 编解码）/ koffi（FFI 对 pid）四件套从 `app.asar.unpacked` 实跑通过。

**但真正的坑不在这三条里**——见上面「asar 打开后客户端模块图静默清空」。预设的验证清单只覆盖了想得到的风险，漏掉的那个恰好没有任何报错。

## 安装后可改的配置（2026-08-25）

`src/main/runtime-config.ts` + 安装目录下的 `harness-ai.config.json`（模板在 `config/`，经 `electron-builder.yml` 的 `extraFiles` 落到 exe 同级；`verify-packaged.cjs` 会检查它在不在）。

- **收什么进来的判据**：属于**网络环境**、装完才发现不对、且用户自己能判断的设置。属于人的偏好进 dsh settings，属于代码的常量留在代码里。**别把这个文件做成第二套设置系统。**
- **优先级**：环境变量 > 配置文件 > 内置默认（与 `updater.ts` 的 feed 解析同序）。纯函数 `resolveRegistry()` 单测钉住优先级与拒绝规则，取值和 IO 分开。
- **绝不抛进启动**：文件缺失/读不了/JSON 坏了/类型不对，一律回落默认并 `log.warn` 说明原因。
- **解析点在启动，不在首次使用**：`index.ts` 一开机就调 `pluginRegistry()`，每次运行都打一行 `config: plugin registry <url> (<来源>)`。报障先看这行——它不能取决于用户有没有点开过市场。
- **registry 换镜像不降低供应链门槛**：packument 复核必须和 tarball 走同一个 registry（`createPackumentFetcher(registry)`），镜像给的字节与目录记录不符即拒绝。**改这块时别把复核写回硬编码 npmjs**——那样复核的就不是将要下载的那份了。profile 的 `.npmrc` 每次安装都重写 registry 行（配置改了之后旧行会盖过命令行参数）。
- **已知取舍**：更新会用随包默认值覆盖这个文件（`extraFiles` 的固有行为），README 两版都写明了。想让它跨更新存活，得换成 userData 副本或安装期保留，届时再定。

## 本仓库红线摘要

- dsh 永远 loopback，绝不对网络暴露；远程能力一律经 harness-ai-server 中转（根红线 #4）。
- `BrowserWindow` 安全默认不得回退：`sandbox: true` + `contextIsolation: true`；外链走系统浏览器。
- 代码注释、提交信息、日志全英文；UI 文案进 locales 目录，语言解析固定回退 `en-US`（台账 #11）。
- 凭据不落明文（根红线 #7）。

## 启动诊断与工作区准入（2026-08-25）

装机后启动失败、以及工作区选错位置导致的运行时失败，是两类「用户报障但我们拿不到现场」的问题。三层保险，改动时别拆：

1. **崩溃现场**（`src/main/crash.ts`）：Crashpad 本地采集，**`uploadToServer: false` 不可改**——上报端点是未定项（台账 #25），且转储可能含进程内存片段，没有遥测同意流程之前一律留在用户磁盘。`globalExtra` 带 dsh 版本：升级 dsh 后的崩溃要能和锁定版本对上（根红线 #2）。
2. **未清退出信号**：`run-marker.json` 存活即表示上次进程没走任何退出路径。`app.exit()` 不触发 `will-quit`，所以**每条主动退出路径都必须走 `exitApp()`**，新增退出点时别直接调 `app.exit()`。
3. **启动阶段**（`src/main/startup-stage.ts`）：失败页与日志都带阶段名。阶段名是诊断标识符，**保持英文、不翻译**，会被原样引用进日志和报障。`dsh-home`~`webserver-bind` 由适配器上报（根红线 #3：dsh 概念只留在 `src/main/harness/`）。日志里的 timeline 用来定位「哪一段吃掉了 45s 预算」。

4. **boot 内部打点**（`src/main/harness/boot-profile.ts`）：`runtime-boot` 是 dsh 的 `boot()`，不能为了看清楚它就去改框架。打法是订阅 Cordis 的 `internal/status`（纯事件订阅，红线 #1 一级），在 host 回调里挂上，按 fiber 计时。**计时是含子 fiber 的**：接近 wall clock 的那个是容器不是慢插件——实测 `HostResolvedRootInclude` 独占 99%，说明成本在解析+导入整棵模块树，不在任何单个插件。看这行时先看「inclusive vs wall」的比例，那是并发度，不是百分比。

**工作区准入**（`src/main/harness/workspace-location.ts`）：判据是**能力探测**（可写 + 支持目录 junction），不是卷类型推断——我们真正依赖的是 NTFS 语义（上游 Windows ACL pwsh 沙箱 + 运行时解析模块用的重解析点），而卷类型只是盒子上的标签，还得为此引 kernel32 FFI。网络共享因为可能挂死所以先按路径字符串直接拦，不进探测。**block 与 confirm 的分界不要随手挪**：不可写/网络共享是确定坏的，无 junction 只是降级（普通对话不受影响），把后者升成 block 会把人锁在自己的文件夹外面。探测目录必须清干净（`.harness-probe-*` 不得留在用户工作区）。
