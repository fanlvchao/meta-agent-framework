# opencode-plugin-meta-agent-framework

让 opencode 自动接入 [Meta-Agent-Framework](https://github.com/example/Meta-Agent-Framework) 分布式 Agent 网络。

## 安装

```bash
opencode plugin install opencode-plugin-meta-agent-framework
```

## 配置

在 `opencode.json` 中指定 Server 地址：

```json
{
  "plugin": [
    ["opencode-plugin-meta-agent-framework", { "server": "http://10.197.120.156:3000" }]
  ]
}
```

或通过环境变量：

```bash
export META_AGENT_SERVER=http://your-server:3000
```

## 功能

安装后，每次启动 opencode 会自动：

1. **扫描 agent** — 读取 `.opencode/agents/*.md` 和全局 agent 定义
2. **注册到 Server** — 上报 agent 列表 + opencode HTTP URL
3. **心跳保活** — 每 30 秒发心跳，Server 知道你在线
4. **任务回报** — Server 派发的任务完成后，自动提取结果回报

用户使用方式**零改变**，正常 `opencode` 启动即可。

## 原理

```
opencode 启动 → plugin 自动加载
  ├── POST /api/clients/register → 注册到 Meta-Agent Server
  ├── 心跳 30s → Server 知道你在线
  └── event hook → session 完成时自动回报结果
```

Server 可以通过 opencode 的 HTTP API 直接下发任务到你的实例。
