#!/usr/bin/env node
/**
 * MAF Agent for Claude Code
 *
 * 两种模式：
 *   --daemon: 连接/拉起 Node Daemon + 注册 agent（command hook）
 *   --wait:   long-poll Node Daemon 等任务 → exit 2 唤醒 Claude（asyncRewake hook）
 *
 * hooks.json 里配置两个 SessionStart hook：
 *   1. node maf-agent.mjs --daemon   （command hook，确保 Node Daemon 运行 + 注册 agent）
 *   2. node maf-agent.mjs --wait     （asyncRewake hook，后台等任务）
 */

import { readFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { spawn } from "node:child_process";

const STATE_DIR = join(homedir(), ".meta-agent-framework");
const MODE = process.argv.includes("--daemon") ? "daemon" : "wait";
const LOG_FILE = join(STATE_DIR, "claude-agent.log");

/** 读取 maf.config.json */
function loadMafConfig() {
  const paths = [
    join(homedir(), ".meta-agent-framework", "maf.config.json"),
    join(process.cwd(), "maf.config.json"),
  ];
  let cfg = {};
  for (const p of paths) {
    try { if (existsSync(p)) cfg = { ...cfg, ...JSON.parse(readFileSync(p, "utf-8")) }; } catch {}
  }
  return cfg;
}
const _mafCfg = loadMafConfig();

const NODE_PORT = parseInt(process.env.MAF_NODE_PORT || "0") || _mafCfg.daemon?.port || 4100;
const DAEMON_URL = `http://127.0.0.1:${NODE_PORT}`;

mkdirSync(STATE_DIR, { recursive: true });

function log(msg) {
  const line = `${new Date().toISOString().slice(11, 23)} [cc-${MODE}] ${msg}`;
  try { appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

// ============================================================
// 工具函数
// ============================================================
function detectAgentName() {
  if (process.env.MAF_AGENT_NAME) return process.env.MAF_AGENT_NAME;
  try {
    let pid = process.ppid;
    for (let i = 0; i < 8 && pid > 1; i++) {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8").replace(/\0/g, " ");
      const m = cmdline.match(/--agent\s+(\S+)/);
      if (m) return m[1];
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
      pid = parseInt(stat.split(" ")[3]);
    }
  } catch {}
  const dir = process.env.MAF_DIRECTORY || process.cwd();
  try {
    const agentDir = join(dir, ".claude", "agents");
    if (existsSync(agentDir)) {
      const first = readdirSync(agentDir).find(f => f.endsWith(".md"));
      if (first) return first.replace(/\.md$/, "");
    }
  } catch {}
  return `claude-agent-${homedir().split("/").pop()}`;
}

function findClaudePid() {
  try {
    let pid = process.ppid;
    for (let i = 0; i < 8 && pid > 1; i++) {
      const comm = readFileSync(`/proc/${pid}/comm`, "utf-8").trim();
      if (comm === "claude") return pid;
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
      pid = parseInt(stat.split(" ")[3]);
    }
  } catch {}
  return 0;
}

/** 检查 Node Daemon 是否在运行 */
async function checkDaemon() {
  try {
    const res = await fetch(`${DAEMON_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

/** 拉起 Node Daemon */
async function spawnNodeDaemon(agentName) {
  const paths = [
    join(homedir(), ".config", "opencode", "plugins", "opencode-plugin-meta-agent-framework", "daemon.mjs"),
    join(process.env.CLAUDE_PLUGIN_ROOT || "", "..", "opencode-plugin-meta-agent-framework", "daemon.mjs"),
  ];
  let script = "";
  for (const p of paths) { if (existsSync(p)) { script = p; break; } }
  if (!script) { log(`❌ daemon.mjs 未找到`); return false; }

  log(`拉起 Node Daemon: ${script}`);
  const child = spawn(process.execPath, [script], {
    stdio: "ignore",
    detached: true,
    env: {
      ...process.env,
      MAF_NODE_PORT: String(NODE_PORT),
      MAF_AGENT_NAME: agentName,
      MAF_RUNTIME: "claude-code",
      MAF_DIRECTORY: process.env.MAF_DIRECTORY || process.cwd(),
      MAF_PLUGIN_DIR: process.env.CLAUDE_PLUGIN_ROOT || "",
      META_AGENT_SERVER: process.env.META_AGENT_SERVER || _mafCfg.server?.url || "",
    },
  });
  child.unref();

  // 等待就绪
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const h = await checkDaemon();
    if (h) return true;
  }
  return false;
}

/** 连接 agent 到 Node Daemon */
async function connectAgent(agentName) {
  try {
    const res = await fetch(`${DAEMON_URL}/agents/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_name: agentName,
        runtime: "claude-code",
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      log(`✅ agent 已连接: ${agentName} (agents=[${data.agents?.join(", ")}])`);
      return true;
    }
  } catch {}
  return false;
}

// ============================================================
// DAEMON 模式：确保 Node Daemon 运行 + 注册 agent
// ============================================================
if (MODE === "daemon") {
  const agentName = detectAgentName();
  log(`Daemon 模式: agent=${agentName}`);

  // 检查 Node Daemon 是否已运行
  let health = await checkDaemon();

  if (health) {
    // 已在运行，直接连接 agent
    log(`Node Daemon 已在运行 (pid=${health.pid}, agents=[${health.agents?.join(", ")}])`);
    await connectAgent(agentName);
    process.exit(0);
  }

  // 没在运行，拉起
  const ok = await spawnNodeDaemon(agentName);
  if (!ok) {
    log(`⚠ Node Daemon 启动失败`);
    process.exit(0);
  }

  // 确认 agent 已注册（spawnNodeDaemon 通过 MAF_AGENT_NAME 环境变量已初始注册）
  // 如果 Daemon 是之前拉起的（端口冲突 exit(0)），需要手动连接
  health = await checkDaemon();
  if (health && !health.agents?.includes(agentName)) {
    await connectAgent(agentName);
  }

  log(`✅ Node Daemon 就绪 port=${NODE_PORT}`);
  process.exit(0);

// ============================================================
// WAIT 模式：long-poll Node Daemon 等任务 → exit 2 唤醒 Claude
// ============================================================
} else {
  const agentName = detectAgentName();
  const FAIL_MAX = 5;
  let fails = 0;

  log(`Wait 启动: agent=${agentName}, 等 Node Daemon...`);

  // 等 Node Daemon 就绪
  let daemonOk = false;
  for (let i = 0; i < 30; i++) {
    const h = await checkDaemon();
    if (h) { daemonOk = true; break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!daemonOk) { log(`Node Daemon 未就绪，退出`); process.exit(0); }

  log(`Wait: 连接 Node Daemon port=${NODE_PORT}`);

  // 确保 agent 已注册到 Node Daemon（Daemon 重启后需要重新注册）
  await connectAgent(agentName);

  // Long-poll 循环
  while (true) {
    try {
      const res = await fetch(`${DAEMON_URL}/tasks/wait?agent=${encodeURIComponent(agentName)}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      fails = 0;

      // 每次空返回时检查自己是否还在 Daemon 注册（Daemon 可能被重启过）
      if (!data.task) {
        const h = await checkDaemon();
        if (h && !h.agents?.includes(agentName)) {
          log(`agent ${agentName} 未注册，重新连接...`);
          await connectAgent(agentName);
        }
        continue;
      }

      if (data.task && data.task.id) {
        // 通知模式：/tasks/wait 只通知有任务，/tasks/take 取走
        let task = data.task;
        try {
          const takeRes = await fetch(`${DAEMON_URL}/tasks/take?agent=${encodeURIComponent(agentName)}`, {
            method: "POST", signal: AbortSignal.timeout(3000),
          });
          const takeData = await takeRes.json();
          if (takeData.task) task = takeData.task;
        } catch {}

        log(`🚀 唤醒 Claude: "${task.title || task.description}"`);

        const msg = `[MAF 远程任务] ${task.description || task.title}

执行完成后用以下命令回报结果:
curl -s -X POST ${DAEMON_URL}/tasks/done -H 'Content-Type: application/json' -d '{"task_id":"${task.id}","agent_name":"${agentName}","status":"completed","result":"<简述结果>"}'`;

        process.stderr.write(msg);
        process.exit(2);
      }
    } catch {
      fails++;
      if (fails >= FAIL_MAX) {
        // Node Daemon 不可达——可能是 OTA 自更新重启，尝试拉起
        log(`Node Daemon 不可达 ${fails} 次，尝试重新拉起...`);
        const ok = await spawnNodeDaemon(agentName);
        if (ok) {
          // 重新连接 agent
          await connectAgent(agentName);
          fails = 0;
          log(`✅ Node Daemon 恢复 port=${NODE_PORT}`);
          continue;
        }
        log(`❌ 无法恢复 Node Daemon，退出`);
        process.exit(0);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("uncaughtException", (err) => log(`异常: ${err.message}`));
