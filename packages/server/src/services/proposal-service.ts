import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database';
import { eventBus } from './event-bus';
import type { Proposal, ProposalCreatePayload, ProposalReviewPayload, ProposalStatus } from '../types';

/**
 * Proposal Service — Client → Server 的逆向提议通道
 *
 * 支持 Client 主动向 Server 贡献资源（skill 等）、反馈问题、提改进建议。
 * 提议存入 SQLite，通过 SSE 通知 Dashboard/Meta-Agent-Server 审核处理。
 */
export class ProposalService {

  /** 创建提议 */
  create(payload: ProposalCreatePayload, userId: string): Proposal {
    const db = getDb();
    const now = new Date().toISOString();
    const id = uuidv4();

    const proposal: Proposal = {
      id,
      from_agent: payload.from_agent,
      user_id: userId,
      type: payload.type || 'general',
      status: 'pending',
      title: payload.title,
      detail: payload.detail || '',
      target: payload.target || '',
      suggested_fix: payload.suggested_fix || '',
      files: JSON.stringify(payload.files || []),
      source_path: payload.source_path || '',
      priority: payload.priority || 'medium',
      review_comment: '',
      reviewed_by: '',
      created_at: now,
      updated_at: now,
    };

    db.prepare(`
      INSERT INTO proposals (id, from_agent, user_id, type, status, title, detail, target, suggested_fix, files, source_path, priority, review_comment, reviewed_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      proposal.id, proposal.from_agent, proposal.user_id,
      proposal.type, proposal.status, proposal.title, proposal.detail,
      proposal.target, proposal.suggested_fix, proposal.files,
      proposal.source_path, proposal.priority,
      proposal.review_comment, proposal.reviewed_by,
      proposal.created_at, proposal.updated_at,
    );

    console.log(`[Proposal] 📨 新提议: "${proposal.title}" from ${proposal.from_agent} (${proposal.type})`);

    eventBus.emit({
      type: 'proposal_created',
      data: {
        id: proposal.id,
        from_agent: proposal.from_agent,
        type: proposal.type,
        title: proposal.title,
        priority: proposal.priority,
      },
      timestamp: now,
    });

    return proposal;
  }

  /** 审核提议（接受/拒绝） */
  review(proposalId: string, payload: ProposalReviewPayload): Proposal | null {
    const db = getDb();
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId) as Proposal | undefined;
    if (!existing) return null;

    if (existing.status !== 'pending') {
      // 只能审核 pending 状态的提议
      return existing;
    }

    db.prepare(`
      UPDATE proposals SET status = ?, review_comment = ?, reviewed_by = ?, updated_at = ?
      WHERE id = ?
    `).run(
      payload.status,
      payload.review_comment || '',
      payload.reviewed_by || '',
      now,
      proposalId,
    );

    const updated = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId) as Proposal;

    console.log(`[Proposal] ${payload.status === 'accepted' ? '✅' : '❌'} 审核: "${updated.title}" → ${payload.status}`);

    eventBus.emit({
      type: 'proposal_reviewed',
      data: {
        id: updated.id,
        from_agent: updated.from_agent,
        type: updated.type,
        title: updated.title,
        status: updated.status,
        review_comment: updated.review_comment,
        reviewed_by: updated.reviewed_by,
      },
      timestamp: now,
    });

    return updated;
  }

  /** 标记为已应用 */
  markApplied(proposalId: string): Proposal | null {
    const db = getDb();
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId) as Proposal | undefined;
    if (!existing || existing.status !== 'accepted') return existing || null;

    db.prepare(`UPDATE proposals SET status = 'applied', updated_at = ? WHERE id = ?`).run(now, proposalId);

    const updated = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId) as Proposal;

    console.log(`[Proposal] 🚀 已应用: "${updated.title}"`);

    eventBus.emit({
      type: 'proposal_applied',
      data: { id: updated.id, title: updated.title, type: updated.type },
      timestamp: now,
    });

    return updated;
  }

  /** 获取单个提议 */
  getById(id: string): Proposal | null {
    return (getDb().prepare('SELECT * FROM proposals WHERE id = ?').get(id) as Proposal) || null;
  }

  /** 列出提议（支持按状态/类型/agent 过滤） */
  list(options?: {
    status?: ProposalStatus;
    type?: string;
    from_agent?: string;
    limit?: number;
  }): Proposal[] {
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options?.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }
    if (options?.from_agent) {
      conditions.push('from_agent = ?');
      params.push(options.from_agent);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit || 50;

    return db.prepare(`SELECT * FROM proposals ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit) as Proposal[];
  }

  /** 统计信息 */
  getStats(): { total: number; pending: number; accepted: number; rejected: number; applied: number; by_type: Record<string, number> } {
    const db = getDb();
    const all = db.prepare('SELECT status, type FROM proposals').all() as { status: string; type: string }[];

    const stats = { total: all.length, pending: 0, accepted: 0, rejected: 0, applied: 0, by_type: {} as Record<string, number> };
    for (const row of all) {
      if (row.status in stats) (stats as any)[row.status]++;
      stats.by_type[row.type] = (stats.by_type[row.type] || 0) + 1;
    }
    return stats;
  }
}

export const proposalService = new ProposalService();
