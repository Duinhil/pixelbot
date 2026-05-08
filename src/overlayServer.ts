import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config';
import { overlayBus, OverlayEvent } from './overlayEvents';

export function startOverlayServer(): void {
  const htmlPath = path.join(__dirname, '..', 'overlay', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    if (url.pathname === '/overlay' || url.pathname === '/overlay/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  const wss = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', (err) => {
      console.error('[overlay] ws error:', err);
      clients.delete(ws);
    });
  });

  overlayBus.on('event', (event: OverlayEvent) => {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  setInterval(() => {
    const ping = JSON.stringify({ type: 'ping', ts: Date.now() });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(ping);
      }
    }
  }, 30_000);

  server.listen(config.overlayPort, () => {
    console.log(`[overlay] Server listening on http://localhost:${config.overlayPort}/overlay`);
  });
}
