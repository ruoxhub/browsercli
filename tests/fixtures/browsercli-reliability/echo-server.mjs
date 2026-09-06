/**
 * Deterministic local fixture server for proxycli-reliability integration tests.
 *
 * Serves static fixture files over HTTP, a JSON fetch/XHR endpoint, and a WebSocket
 * echo endpoint. Binds loopback on an ephemeral port and closes all sockets in teardown.
 *
 * Usage:
 *   node tests/fixtures/proxycli-reliability/echo-server.mjs
 * Prints the bound URL as the final line of stdout, e.g. "http://127.0.0.1:PORT".
 */

import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/api/data') {
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({ok: true, source: 'fixture-api', ts: Date.now()}));
      return;
    }
    if (pathname === '/submit') {
      response.writeHead(200, {'content-type': 'text/plain'});
      response.end('form-submitted');
      return;
    }
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    const content = await readFile(path.join(fixtureRoot, file));
    const extension = path.extname(file).toLowerCase();
    response.writeHead(200, {'content-type': MIME[extension] ?? 'application/octet-stream'});
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});

const wss = new WebSocketServer({noServer: true});
wss.on('connection', socket => {
  socket.on('message', data => {
    // Echo every frame verbatim back to the same client.
    socket.send(data);
  });
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit('connection', ws, request);
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object') {
    process.stdout.write(`ECHO_SERVER_URL=http://127.0.0.1:${address.port}\n`);
  }
});

function shutdown() {
  for (const client of wss.clients) {
    client.terminate();
  }
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);