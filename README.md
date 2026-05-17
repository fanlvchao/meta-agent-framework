# Meta-Agent Framework

**打破编码 Agent 孤岛** —— 让内网中不同机器上的 AI Agent 自动组网互联，形成有组织架构的 Agent 集群。用户只需与 Server Agent 对话，即可指挥所有远端 Agent 协同工作。同时具备 Agent 间协同进化、互相学习的能力，持续提升整个团队的能力上限。

[English](./README.en.md) | 中文

## 架构

```
                    ┌─────────────────────────────┐
                    │     用户（自然语言对话）       │
                    └──────────────┬──────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Server（中控调度）                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Workflow  │ │  Agent   │ │  Health  │ │    Evolve     │  │
│  │  Engine   │ │ Registry │ │ Monitor  │ │ (协同进化)     │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │ push / heartbeat / result
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
     ┌────────────┐ ┌────────────┐ ┌────────────┐
     │  Machine A │ │  Machine B │ │  Machine C │
     │  Daemon    │ │  Daemon    │ │  Daemon    │
     │  ├ Agent 1 │ │  ├ Agent 3 │ │  ├ Agent 5 │
     │  └ Agent 2 │ │  └ Agent 4 │ │  └ Agent 6 │
     └────────────┘ └────────────┘ └────────────┘
```

## 核心特性

- **自动组网** — Agent 启动即注册，形成可调度的分布式网络
- **对话式调度** — 与 Server Agent 自然语言对话，它自动判断派给谁
- **异步协作** — 任务派发后不阻塞，结果自动回传并渲染展示
- **协同进化** — Server 可向所有 Agent 推送 skill / 配置 / MCP 工具，整体能力同步提升
- **按需拉起** — Agent 离线时 Daemon 自动通过 screen 拉起 TUI 执行
- **双 Runtime** — 支持 [opencode](https://opencode.ai) 和 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- **任务队列** — 连续多任务串行执行，不丢不乱
- **OTA 热更新** — Plugin 代码远程更新，Daemon 自重启，零停机

## 快速开始

### 1. 安装

```bash
# Server（调度中心，一台机器）
npm install -g https://github.com/fanlvchao/meta-agent-framework/releases/download/latest/meta-agent-server.tgz

# Client（Agent 运行的机器，可以多台）
npm install -g https://github.com/fanlvchao/meta-agent-framework/releases/download/latest/meta-agent-client.tgz
```

### 2. 启动 Server

```bash
maf-server start
```

首次运行自动进入配置，完成后启动 Server 并进入 Meta-Agent-Server 交互界面。

### 3. 配置 Client（远端机器）

```bash
maf-client init    # 交互式配置 Server 地址 + 安装 Plugin
```

安装完成后有两种运行模式：

**手动启动 Agent：**
```bash
opencode --agent <name>    # opencode Agent
claude --agent <name>      # Claude Code Agent
```

**自动拉起（推荐）：**

无需手动启动。只要 Client 机器的 Daemon 在运行（`maf-client init` 后自动常驻），Server 派发任务时会自动通过 `screen` 远程拉起对应 Agent。前提是在 Server 的 Agent 注册表中已配置该 Agent。

### 4. 使用

在 Server Agent 的对话中用自然语言描述需求即可：

> "帮我看看项目 A 最近有什么改动"
> "让前端组的 Agent 跑一下单元测试"
> "把这个 bug 修复方案同步给负责后端的 Agent"

Server Agent 自动判断派给谁、派发任务、等待结果、展示给你。

## 命令参考

```bash
# Server
maf-server start      # 启动（首次自动配置）+ 进入交互界面
maf-server stop       # 停止
maf-server restart    # 重启
maf-server status     # 查看状态
maf-server tui        # 进入交互界面
maf-server logs       # 查看日志
maf-server uninstall  # 卸载（停止 + 清数据 + 删 npm 包）
maf-server help       # 查看所有命令

# Client
maf-client init    # 配置 Server 地址 + 安装 Plugin
maf-client status     # 查看状态
maf-client uninstall  # 卸载（停 Daemon + 清 Plugin + 删 npm 包）
maf-client help       # 查看所有命令
```

## 开发

参见 [CONTRIBUTING.md](./CONTRIBUTING.md)（开发环境搭建、测试、发版流程）。

## License

MIT
