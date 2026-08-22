# P1 桌面 MVP 验收清单

> 对应工作包 D6（docs/开发计划.md）。自动化部分用脚本执行，交互部分人工按步骤走。
> 每次发版前完整走一遍；结果记入根仓库 memory/MEMORY.md。

## 一、自动化冒烟（无需人工）

```
pnpm install          # postinstall 拉取 electron 二进制
pnpm typecheck        # 必须 0 错误
pnpm build            # 插件 + main/preload/renderer 构建
node scripts/smoke.mjs  # 启动壳 → loopback 端点 → dsh 页面 → 品牌插件三项断言
```

打包链路（含 License 闸门与 afterPack 硬校验）：

```
pnpm run dist:win     # dist/ 产出 HarnessAI-<ver>-x64-Setup.exe
```

对安装后的产物再跑一次冒烟：

```
node scripts/smoke.mjs "<安装目录>\Harness AI.exe"
```

## 二、交互验收（人工，需要 DeepSeek API Key）

| # | 步骤 | 预期 |
| --- | --- | --- |
| 1 | 双击安装包安装并启动 | 窗口标题「Harness AI」，侧栏品牌为 Harness AI（非 DeepSeek 官方标） |
| 2 | 设置 → 模型，填入 API Key | 保存成功 |
| 3 | 选择工作区（任选一个项目目录） | 进入会话界面 |
| 4 | 发送一条消息（如「列出当前目录文件」） | Agent 开始响应，轨迹流式渲染 |
| 5 | 让 Agent 执行写操作（如「新建 test.txt」） | 弹出工具审批；「允许」后执行成功 |
| 6 | 关闭应用重新打开 | 侧栏会话列表保留；打开旧会话历史完整，可继续对话 |
| 7 | 外部链接点击（如内测声明里的链接） | 在系统浏览器打开，窗口不跳转 |

## 三、可靠性专项

| # | 步骤 | 预期 |
| --- | --- | --- |
| 1 | 先占用 43110 端口再启动应用 | 应用落在 43111，功能正常 |
| 2 | 设 `DSH_HOME` 指向一个普通文件后启动 | 显示失败恢复页（重试 / 打开日志 / 退出 三按钮可用） |
| 3 | 启动第二个应用实例 | 不出现第二个窗口，第一个实例窗口被聚焦 |
| 4 | 查看 `%APPDATA%\Harness AI\logs\main.log` | 有带时间戳日志；密钥形状字符串已脱敏为 `****` |

## 已知边界（不阻塞 MVP）

- 外部浏览器访问 loopback 页面标题仍是上游「DeepSeek Harness」（构建期常量，B 级 PR 候选；Electron 窗口内已固定为 Harness AI）。
- 自定义主题（harness-light/harness-dark）已注册，上游外观选择器首版只展示内建三项。
- macOS 打包（#12）与自动更新（#14）按计划延后。
