/**
 * NoneRegistry — 无外部源模式
 *
 * 所有 Agent 通过 Daemon 自注册到 Server，SQLite 即唯一真相。
 * 所有方法都是空操作（no-op），不依赖任何外部服务。
 */

import type { Agent } from '../../types';
import type { ExternalRegistry } from './index';

export class NoneRegistry implements ExternalRegistry {
  private _enabled = false;

  init(): boolean {
    this._enabled = true;
    console.log('[Registry] 模式: none（纯自注册，SQLite 即权威源）');
    return true;
  }

  get isEnabled(): boolean {
    return this._enabled;
  }

  async pull(): Promise<Agent[]> {
    // 无外部源，不拉取
    return [];
  }

  async pushStatus(_agentName: string, _status: string): Promise<void> {
    // no-op
  }

  async pushInventory(_agentName: string, _skillsJson: string, _mcpsJson: string, _agentOnline: boolean): Promise<void> {
    // no-op
  }

  async pushAgent(_agent: Agent): Promise<void> {
    // no-op
  }

  isManaged(_agentName: string): boolean {
    // 无外部源管理，所有 agent 都是动态自注册的
    return false;
  }

  getManagedNames(): string[] {
    return [];
  }
}
