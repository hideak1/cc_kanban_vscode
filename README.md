# Claude Kanban

在 VS Code 里用一张看板管理本机所有 Claude Code session：自己定义列、拖拽归类、实时看状态，点击卡片就在终端里 attach。

所有数据都来自官方 CLI（`claude agents --json --all`、`claude --bg`、`claude attach`、`claude stop`）。插件不读取 Claude Code 的内部文件，也不托管 session。session 关掉 VS Code 后照样在后台运行。

## 安装

```bash
npm install
npm run package          # 生成 claude-kanban-0.1.0.vsix
code --install-extension claude-kanban-0.1.0.vsix
```

`code` 不在 PATH 时，用 `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`。

## 使用

- 命令面板运行 **Claude Kanban: Open Board**，或点击左下角状态栏的 **Claude**。有 session 在等你输入时，状态栏会显示数量并变色。
- **未归类**列固定在最左，新出现的 session 先放这里；**已完成**列固定在最右，默认折叠。用「新建列」加你自己的列，双击列名改名。
- 列头左边的 ⌄ 可以把列折叠成一条窄竖条（显示卡片数和等待输入的数量），点竖条展开。不想看的 session 拖进一个折叠的列即可；折叠的列也能直接拖进去。
- 卡片可以拖到任意列、任意位置。归类只保存在插件里，不影响 session 本身。
- 点击卡片：在 VS Code 终端里 `claude attach <id>`。同一个 session 复用同一个终端，退出终端只是 detach。
- 悬停卡片的按钮：
  - **停止**：停掉 session 进程，卡片留在原列，之后可以恢复。
  - **完成**：把卡片移到「已完成」最上面，并停掉还在运行的 session。
  - **恢复**：对已停止 / 已中断（比如关机后）的后台 session 执行 `claude respawn <id>`，在后台接着原来的对话跑起来；直接点卡片 attach 也会恢复。
- **新建 Task**：写下标题和指令、选好目录，先存成草稿；点「启动」用 `claude --bg` 在后台开一个 session，卡片原地变成 session 卡。

状态（以 CLI 的任务状态 `state` 为准，没有时看进程状态 `status`）：运行中（蓝，色条有流动光效）、**等待你回复**（Claude 问了你问题）/ 等待输入（橙色高亮）、待查看（Claude 做完了，绿）、已中断（关机或崩溃打断，红）、已停止、空闲。

## 限制

- 直接在别的终端里开的 interactive session 也会显示，但官方 CLI 不支持 attach 到它们。
- 在没被 Claude Code 信任过的目录里启动会失败（"Workspace not trusted"）。先在那个目录里运行一次 `claude`，接受信任提示即可。
- 看板数据存在 VS Code 的全局存储里，同一台机器上的所有 VS Code 窗口共享，不跨机器同步。

## 设置

| 设置 | 说明 |
|---|---|
| `claudeKanban.claudePath` | `claude` 的绝对路径。留空则自动查找：先查 PATH，再通过你的登录 shell 查找。 |

## 开发

```bash
npm test            # 单元测试（vitest）
npm run typecheck
npm run test:e2e    # 在真实 VS Code 里做冒烟测试
npm run test:real   # 用真实 claude CLI 走一遍：启动一个极小的后台 session，验证后停止并删除
```
