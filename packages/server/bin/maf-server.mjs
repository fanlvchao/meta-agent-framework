#!/usr/bin/env node
/**
 * maf-server — Meta-Agent-Framework Server CLI
 *
 * 全局命令，不依赖当前目录。
 *
 * 用法：
 *   maf-server init          配置 Server（交互式）
 *   maf-server start         启动 Server（后台常驻）
 *   maf-server stop          停止 Server
 *   maf-server restart       重启 Server
 *   maf-server status        查看运行状态
 *   maf-server logs          查看日志（tail -f）
 *   maf-server version       版本信息
 *
 * 数据目录：~/.meta-agent-framework/
 *   data/       SQLite 数据库
 *   state/      PID、日志
 *   maf.config.json  配置文件
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, openSync, cpSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir, networkInterfaces } from "node:os";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// ============================================================
// 路径常量
// ============================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, "..");  // npm 包的根目录

const MAF_HOME = process.env.MAF_HOME || join(homedir(), ".meta-agent-framework");
const STATE_DIR = join(MAF_HOME, "state");
const PID_FILE = join(STATE_DIR, "server.pid");
const LOG_FILE = join(STATE_DIR, "server.log");
const CONFIG_FILE = join(MAF_HOME, "maf.config.json");

// 确保目录
mkdirSync(STATE_DIR, { recursive: true });
mkdirSync(join(MAF_HOME, "data"), { recursive: true });

// ============================================================
// 工作区同步：将 npm 包中的 agent/hook/scripts 同步到 MAF_HOME
// ============================================================

/** 需要同步到 MAF_HOME 的文件/目录（来自 PACKAGE_ROOT） */
const SYNC_ITEMS = [
  ".opencode",               // opencode agent 定义 + rules + skills
  ".claude",                 // claude hooks 配置
  "CLAUDE.md",              // claude system prompt
  "scripts/maf-server-hook.mjs",  // claude asyncRewake hook
  "scripts/poll-workflow.sh",     // 工作流轮询脚本
  "scripts/push-skill.sh",       // skill 推送脚本
];

/**
 * 同步工作区文件到 MAF_HOME。
 * 每次启动时覆盖（确保升级后新版本文件生效）。
 * 同时同步 opencode Plugin 到 ~/.config/opencode/plugins/（npm install -g 不会更新这里）。
 */
function syncWorkspace() {
  mkdirSync(join(MAF_HOME, "scripts"), { recursive: true });

  for (const item of SYNC_ITEMS) {
    const src = join(PACKAGE_ROOT, item);
    const dst = join(MAF_HOME, item);
    if (!existsSync(src)) continue;

    try {
      cpSync(src, dst, { recursive: true, force: true });
    } catch (err) {
      // 静默忽略，不影响启动
    }
  }

  // 同步 opencode Plugin（整个目录覆盖）
  const pluginSrc = join(PACKAGE_ROOT, "plugins", "opencode-plugin-meta-agent-framework");
  const pluginDst = join(homedir(), ".config", "opencode", "plugins", "opencode-plugin-meta-agent-framework");
  if (existsSync(pluginSrc) && existsSync(pluginDst)) {
    try { cpSync(pluginSrc, pluginDst, { recursive: true, force: true }); } catch {}
  }

  // 同步 Claude Code Plugin（整个 marketplace 目录覆盖）
  const ccMarketSrc = join(PACKAGE_ROOT, "plugins", ".claude-plugin");
  const ccMarketDst = join(homedir(), ".claude", "plugins", "marketplaces", "maf-plugins", ".claude-plugin");
  if (existsSync(ccMarketSrc) && existsSync(ccMarketDst)) {
    try { cpSync(ccMarketSrc, ccMarketDst, { recursive: true, force: true }); } catch {}
  }
  const ccPluginSrc = join(PACKAGE_ROOT, "plugins", "claude-code-plugin-maf");
  const ccPluginDst = join(homedir(), ".claude", "plugins", "marketplaces", "maf-plugins", "claude-code-plugin-maf");
  if (existsSync(ccPluginSrc) && existsSync(ccPluginDst)) {
    try { cpSync(ccPluginSrc, ccPluginDst, { recursive: true, force: true }); } catch {}
  }
}

// ============================================================
// 工具函数
// ============================================================

function getLocalIP() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (!iface.internal && iface.family === "IPv4") return iface.address;
    }
  }
  return "127.0.0.1";
}

function readConfig() {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {}
  return null;
}

function getPort() {
  const cfg = readConfig();
  return parseInt(process.env.META_AGENT_PORT || process.env.PORT || "") || cfg?.server?.port || 3000;
}

function getServerPid() {
  if (!existsSync(PID_FILE)) return null;
  const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
  if (!pid) return null;
  try {
    process.kill(pid, 0);  // 检查进程是否存在
    return pid;
  } catch {
    return null;
  }
}

function isServerRunning() {
  const port = getPort();
  try {
    execSync(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}/api/health`, { timeout: 3000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// 子命令实现
// ============================================================

async function cmdInit() {
  // 复用现有的 maf-init.mjs，传入 server 参数
  const initScript = join(PACKAGE_ROOT, "scripts", "maf-init.mjs");
  if (!existsSync(initScript)) {
    console.error("❌ 初始化脚本不存在:", initScript);
    process.exit(1);
  }
  try {
    execSync(`node "${initScript}" server`, { stdio: "inherit" });
  } catch (e) {
    if (e.status) process.exit(e.status);
  }
}

async function cmdStart() {
  const port = getPort();

  // 检查是否已在运行
  if (isServerRunning()) {
    console.log(`✅ Server 已在运行 (port ${port})`);
    cmdStatus();
    cmdTui();
    return;
  }

  // 首次运行：检测不到配置 → 自动进入 init 流程
  const cfg = readConfig();
  if (!cfg || !cfg.server?.url) {
    console.log("🔧 首次运行，进入配置流程...\n");
    await cmdInit();
    // init 完成后重新读取配置
    const newCfg = readConfig();
    if (!newCfg || !newCfg.server?.url) {
      console.log("❌ 配置未完成，无法启动");
      process.exit(1);
    }
  }

  // 同步工作区文件到 MAF_HOME（每次启动覆盖，确保升级后生效）
  syncWorkspace();

  // 确保依赖已安装（首次运行 npm install）
  const nodeModules = join(PACKAGE_ROOT, "node_modules");
  if (!existsSync(nodeModules)) {
    console.log("📦 首次运行，安装依赖...");
    execSync("npm install --production", { cwd: PACKAGE_ROOT, stdio: "inherit" });
  }

  // 启动 Server（后台）
  console.log(`🚀 启动 Server (port ${port})...`);

  const tsxBin = join(PACKAGE_ROOT, "node_modules", ".bin", "tsx");
  const serverEntry = join(PACKAGE_ROOT, "src", "index.ts");

  if (!existsSync(tsxBin)) {
    console.error("❌ tsx 未安装，运行: cd", PACKAGE_ROOT, "&& npm install");
    process.exit(1);
  }

  // Server 自身的 console.log 已经写 LOG_FILE，这里 stdout/stderr 丢弃避免重复
  const devNull = openSync("/dev/null", "w");
  const child = spawn(tsxBin, [serverEntry], {
    cwd: PACKAGE_ROOT,
    detached: true,
    stdio: ["ignore", devNull, devNull],
    env: {
      ...process.env,
      MAF_HOME,
      PORT: String(port),
    },
  });
  child.unref();

  // 写 PID（先用 spawn PID，稍后从端口查真实 PID）
  writeFileSync(PID_FILE, String(child.pid));

  // 等待就绪
  process.stdout.write("   等待就绪");
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    process.stdout.write(".");
    if (isServerRunning()) {
      // 从端口查出真正监听的进程 PID
      try {
        const ssOut = execSync(`ss -tlnp 2>/dev/null | grep ":${port} "`, { encoding: "utf-8", timeout: 3000 });
        const match = ssOut.match(/pid=(\d+)/);
        if (match) writeFileSync(PID_FILE, match[1]);
      } catch {}
      console.log(` ✅ (${i + 1}s)`);
      console.log("");
      cmdStatus();
      cmdTui();
      return;
    }
  }

  console.log(" ❌ 超时");
  console.log("   查看日志: maf-server logs");
  process.exit(1);
}

function cmdStop() {
  const port = getPort();

  // 先尝试从 PID 文件杀
  const pid = getServerPid();
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`✅ Server 已停止 (PID: ${pid})`);
      try { unlinkSync(PID_FILE); } catch {}
      return;
    } catch {}
  }

  // PID 文件不靠谱，从端口查
  try {
    const ssOut = execSync(`ss -tlnp 2>/dev/null | grep ":${port} "`, { encoding: "utf-8", timeout: 3000 });
    const match = ssOut.match(/pid=(\d+)/);
    if (match) {
      process.kill(parseInt(match[1]), "SIGTERM");
      console.log(`✅ Server 已停止 (PID: ${match[1]}, port ${port})`);
      try { unlinkSync(PID_FILE); } catch {}
      return;
    }
  } catch {}

  console.log("ℹ️  Server 未在运行");
}

async function cmdRestart() {
  cmdStop();
  await new Promise(r => setTimeout(r, 1500));
  await cmdStart();
}

function cmdStatus() {
  const port = getPort();
  const pid = getServerPid();
  const running = isServerRunning();

  console.log("┌─────────────────────────────────────────┐");
  console.log("│       Meta-Agent-Server                  │");
  console.log("└─────────────────────────────────────────┘");
  console.log(`  状态:     ${running ? "🟢 运行中" : "🔴 未运行"}`);
  console.log(`  端口:     ${port}`);
  if (pid) console.log(`  PID:      ${pid}`);
  console.log(`  数据目录: ${MAF_HOME}`);
  console.log(`  日志:     ${LOG_FILE}`);
  console.log(`  配置:     ${CONFIG_FILE}`);

  if (running) {
    try {
      const health = JSON.parse(execSync(`curl -s http://localhost:${port}/api/health`, { encoding: "utf-8", timeout: 3000 }));
      console.log(`  版本:     ${health.server_version || "?"}`);
      console.log(`  运行时间: ${Math.round(health.uptime / 60)}min`);
    } catch {}
    try {
      const agents = JSON.parse(execSync(`curl -s http://localhost:${port}/api/agents`, { encoding: "utf-8", timeout: 3000 }));
      const online = agents.filter(a => a.status === "online").length;
      console.log(`  Agents:   ${agents.length} 注册, ${online} 在线`);
    } catch {}
  }
  console.log("");
}

function cmdLogs() {
  if (!existsSync(LOG_FILE)) {
    console.log("ℹ️  暂无日志");
    return;
  }
  // tail -f 是永久阻塞的，用户 Ctrl+C 退出
  try {
    execSync(`tail -f "${LOG_FILE}"`, { stdio: "inherit" });
  } catch {
    // Ctrl+C 退出
  }
  process.exit(0);  // 直接退出，不走 main().then()
}

function detectRuntime() {
  // 优先级：命令行参数（仅 opencode/claude）> 配置文件 > 默认 opencode
  const argRuntime = process.argv[3];
  if (argRuntime && ["opencode", "claude"].includes(argRuntime)) {
    saveRuntime(argRuntime);
    return argRuntime;
  }

  const cfg = readConfig();
  if (cfg?.server?.runtime) return cfg.server.runtime;

  return "opencode";
}

/** 获取 tui 命令后面的额外参数（排除 runtime 参数） */
function getTuiExtraArgs() {
  const args = process.argv.slice(3);
  if (args[0] && ["opencode", "claude"].includes(args[0])) {
    return args.slice(1).join(" ");
  }
  return args.join(" ");
}

function saveRuntime(runtime) {
  try {
    const cfg = readConfig() || {};
    if (!cfg.server) cfg.server = {};
    cfg.server.runtime = runtime;
    writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
  } catch {}
}

function cmdTui() {
  // 在包目录下启动 TUI agent（支持 opencode 和 claude）
  if (!isServerRunning()) {
    console.log("⚠️  Server 未运行，先启动...");
    execSync(`node "${join(PACKAGE_ROOT, "bin", "maf-server.mjs")}" start`, { stdio: "inherit" });
  }

  const runtime = detectRuntime();
  if (!runtime) {
    console.error("❌ 未检测到 opencode 或 claude，请先安装其中之一：");
    console.error("   opencode: https://opencode.ai");
    console.error("   claude:   npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }

  // 确保工作区已同步
  syncWorkspace();

  // 读取上次的 session ID（用于恢复对话）
  const sessionFile = join(MAF_HOME, "state", "last-session");
  let lastSession = "";
  try { lastSession = readFileSync(sessionFile, "utf-8").trim(); } catch {}

  console.log(`📂 工作目录: ${MAF_HOME}`);
  console.log(`🤖 运行时:   ${runtime}`);
  if (lastSession) console.log(`🔄 恢复会话: ${lastSession}`);

  const extraArgs = getTuiExtraArgs();

  try {
    if (runtime === "opencode") {
      const sessionArg = lastSession && !extraArgs.includes("-s ") ? `-s ${lastSession}` : "";
      const cmd = `opencode --agent Meta-Agent-Server --hostname localhost ${sessionArg} ${extraArgs}`.trim();
      execSync(cmd, { cwd: MAF_HOME, stdio: "inherit" });
    } else {
      // Claude Code: --resume 恢复上次对话
      const resumeArg = lastSession && !extraArgs.includes("--resume") ? `--resume ${lastSession}` : "";
      const cmd = `claude ${resumeArg} ${extraArgs}`.trim();
      execSync(cmd, { cwd: MAF_HOME, stdio: "inherit" });
    }
  } catch {
    // 用户退出 TUI
  }

  // 退出后保存当前 session ID（从 opencode 的状态文件读取）
  try {
    // opencode 在 .opencode/state/ 下保存 session 信息
    const stateDir = join(MAF_HOME, ".opencode", "state");
    if (existsSync(stateDir)) {
      const files = require("fs").readdirSync(stateDir).filter(f => f.endsWith(".json")).sort();
      if (files.length > 0) {
        const latest = JSON.parse(readFileSync(join(stateDir, files[files.length - 1]), "utf-8"));
        if (latest.id) writeFileSync(sessionFile, latest.id);
      }
    }
  } catch {}

  process.exit(0);
}

function cmdVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8"));
    console.log(`maf-server v${pkg.version}`);
  } catch {
    console.log("maf-server (version unknown)");
  }
}

function cmdUninstall() {
  console.log("🗑  卸载 Meta-Agent-Framework Server...\n");

  // 停止 Server
  if (isServerRunning()) {
    cmdStop();
  }

  // 清理数据目录
  try {
    execSync(`rm -rf "${MAF_HOME}"`, { stdio: "ignore" });
    console.log(`  ✅ 已删除数据目录: ${MAF_HOME}`);
  } catch {}

  console.log("\n✅ Server 卸载完成");
  console.log("  移除 npm 包: npm uninstall -g @maf/meta-agent-server\n");

  // 最后一步：卸载自己（执行后 maf-server 命令不再可用）
  try {
    execSync("npm uninstall -g @maf/meta-agent-server", { cwd: homedir(), stdio: "inherit" });
  } catch {}
}

function cmdHelp() {
  console.log(`
Meta-Agent-Framework Server

用法: maf-server <command> [runtime]

命令:
  start         启动 Server（首次自动配置）
  stop          停止 Server
  restart       重启 Server
  tui [runtime] 进入交互界面（opencode 或 claude，默认上次使用的）
  status        查看运行状态
  logs          查看日志（tail -f）
  version       版本信息
  uninstall     卸载 Server（停止 + 清数据 + 删包）
  help          显示此帮助

数据目录: ${MAF_HOME}

快速开始:
  1. maf-server start         # 首次自动配置 + 启动
  2. maf-server tui           # 进入交互界面（默认 opencode）
  3. maf-server tui claude    # 用 Claude Code
`);
}

// ============================================================
// 入口
// ============================================================

const cmd = process.argv[2] || "help";

async function main() {
  switch (cmd) {
    case "init":    await cmdInit(); break;
    case "start":   await cmdStart(); break;
    case "stop":    cmdStop(); break;
    case "restart": await cmdRestart(); break;
    case "tui":     cmdTui(); break;
    case "status":  cmdStatus(); break;
    case "logs":    cmdLogs(); break;
    case "uninstall": cmdUninstall(); break;
    case "version": case "--version": case "-v": cmdVersion(); break;
    case "help": case "--help": case "-h": cmdHelp(); break;
    case "sync-plugins": syncWorkspace(); break;
    default:
      console.error(`未知命令: ${cmd}`);
      cmdHelp();
      process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error("❌", err.message);
  process.exit(1);
});
