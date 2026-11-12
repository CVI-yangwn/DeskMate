import http from 'node:http';
import type { AddressInfo } from 'node:net';

interface EventBridgeOptions {
  port?: number;
  onTestResult: (result: 'pass' | 'fail') => Promise<unknown>;
}

export interface EventBridge {
  close: () => Promise<void>;
  port: number;
}

export async function startEventBridge(options: EventBridgeOptions): Promise<EventBridge> {
  const port = options.port ?? 39876;

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(404);
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }

    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (raw.length > 64 * 1024) {
      res.writeHead(413);
      res.end(JSON.stringify({ ok: false, error: 'body too large' }));
      return;
    }

    try {
      const body = JSON.parse(raw) as { type?: string; result?: string };
      if (body.type !== 'test.result' || (body.result !== 'pass' && body.result !== 'fail')) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: 'expected {type:"test.result", result:"pass"|"fail"}' }));
        return;
      }

      const payload = await options.onTestResult(body.result);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, payload }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: String(error) }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  const actualPort = (server.address() as AddressInfo).port;

  return {
    port: actualPort,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
