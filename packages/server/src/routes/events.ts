import { Router, Request, Response } from 'express';
import { eventBus } from '../services/event-bus';

const router = Router();

/** GET /api/events — SSE 事件流（Web Dashboard 订阅） */
router.get('/', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 发送初始连接确认
  res.write(`event: connected\ndata: ${JSON.stringify({ message: 'SSE connected', timestamp: new Date().toISOString() })}\n\n`);

  // 注册到事件总线
  eventBus.subscribe(res);

  console.log(`[SSE] Client connected (total: ${eventBus.subscriberCount})`);

  req.on('close', () => {
    console.log(`[SSE] Client disconnected (total: ${eventBus.subscriberCount})`);
  });
});

export default router;
