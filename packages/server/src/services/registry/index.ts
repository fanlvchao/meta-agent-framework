/**
 * External Registry — 抽象接口 + 工厂
 *
 * Agent 注册数据可以来自多种外部源（飞书多维表格、本地 Excel、纯自注册等）。
 * 所有调用方只依赖 ExternalRegistry 接口，不直接依赖具体实现。
 *
 * 工厂函数 createRegistry() 根据配置决定实例化哪个实现。
 */

import type { Agent } from '../../types';
import { getConfig } from '../../config';
import { FeishuRegistry } from './feishu-registry';
import { NoneRegistry } from './none-registry';

// ============================================================
// 接口定义
// ============================================================

/**
 * ExternalRegistry — 外部注册表的统一接口
 *
 * 职责：
 *   - pull(): 启动时从外部源拉取 Agent 列表（单向：外部 → SQLite）
 *   - pushStatus(): 运行时回写 Agent 状态到外部源
 *   - pushInventory(): 运行时回写 Skills/MCPs 到外部源
 *   - pushAgent(): 注册时回写 Agent 全量信息到外部源
 *   - isManaged(): 判断某个 agent 是否来自外部源（受管理的）
 *   - getManagedNames(): 获取所有外部源管理的 agent 名称
 */
export interface ExternalRegistry {
  /** 初始化（连接外部源、验证凭证等）。返回 true 表示启用成功 */
  init(): boolean;

  /** 是否已启用 */
  readonly isEnabled: boolean;

  /** 从外部源拉取 Agent 列表（启动时调用） */
  pull(): Promise<Agent[]>;

  /** 回写 Agent 状态到外部源（异步，不阻塞主流程） */
  pushStatus(agentName: string, status: string): Promise<void>;

  /** 回写 Agent 的 Skills + MCPs 到外部源（异步） */
  pushInventory(agentName: string, skillsJson: string, mcpsJson: string, agentOnline: boolean): Promise<void>;

  /** 回写 Agent 全量信息（状态 + inventory + endpoint） */
  pushAgent(agent: Agent): Promise<void>;

  /** 判断某个 agent 是否在外部源中注册（受管理的 agent） */
  isManaged(agentName: string): boolean;

  /** 获取所有外部源管理的 agent 名称 */
  getManagedNames(): string[];
}

// ============================================================
// 工厂
// ============================================================

let _instance: ExternalRegistry | null = null;

/**
 * 获取 ExternalRegistry 实例（单例）
 *
 * 根据配置中的 registry.type 决定使用哪个实现：
 *   - 'feishu': 飞书多维表格（bitable）
 *   - 'none': 纯自注册模式（SQLite 即权威源）
 *   - 未来: 'excel' 等
 *
 * 向后兼容：如果旧配置有 feishu.app_id 但没有 registry 字段，自动识别为 feishu 模式。
 */
export function getRegistry(): ExternalRegistry {
  if (_instance) return _instance;

  const cfg = getConfig();
  const registryType = cfg.registry?.type || detectLegacyType(cfg);

  switch (registryType) {
    case 'feishu':
      _instance = new FeishuRegistry();
      break;
    case 'none':
    default:
      _instance = new NoneRegistry();
      break;
  }

  return _instance;
}

/** 重置实例（测试用） */
export function resetRegistry(): void {
  _instance = null;
}

/**
 * 向后兼容：旧配置没有 registry 字段时，自动检测
 * - 有 feishu.app_id → 'feishu'
 * - 否则 → 'none'
 */
function detectLegacyType(cfg: any): string {
  if (cfg.feishu?.app_id) return 'feishu';
  return 'none';
}

// Re-export for convenience
export { FeishuRegistry } from './feishu-registry';
export { NoneRegistry } from './none-registry';
