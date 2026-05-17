/**
 * 向后兼容垫片 — 将旧的 feishuSync 导入重定向到新的 registry 模块
 *
 * @deprecated 请使用 import { getRegistry } from './registry' 代替
 */

import { getRegistry } from './registry';
import type { Agent } from '../types';

class FeishuSyncCompat {
  init(): boolean { return getRegistry().init(); }
  get isEnabled(): boolean { return getRegistry().isEnabled; }
  async pullFromFeishu(): Promise<Agent[]> { return getRegistry().pull(); }
  async pushStatus(agentName: string, status: string): Promise<void> { return getRegistry().pushStatus(agentName, status); }
  async pushInventory(agentName: string, skillsJson: string, mcpsJson: string, agentOnline: boolean): Promise<void> { return getRegistry().pushInventory(agentName, skillsJson, mcpsJson, agentOnline); }
  async pushAgent(agent: Agent): Promise<void> { return getRegistry().pushAgent(agent); }
}

export const feishuSync = new FeishuSyncCompat();

export function isManagedAgent(agentName: string): boolean {
  return getRegistry().isManaged(agentName);
}

export function getManagedAgentNames(): string[] {
  return getRegistry().getManagedNames();
}
