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
- **未归类**列固定在最左边，新出现的 session 会先放进这里。用「新建列」加你自己的列，双击列名可以改名。
- 卡片可以拖到任意列、任意位置。归类只保存在插件里，不影响 session 本身。
- 点击卡片：在 VS Code 终端里运行 `claude attach <id>`。同一个 session 会复用同一个终端，关掉终端只是 detach。
- **新建 Task**：写下标题和指令，选好目录，先保存成草稿；点「启动」后在后台开一个 session，卡片原地变成 session 卡。
- 悬停卡片可以「停止」session，或把它从看板上「隐藏」。

状态说明：运行中（蓝色，左边色条有流动光效）、等待输入（橙色高亮）、空闲、完成、已停止。

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
