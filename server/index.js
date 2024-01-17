const { createServer } = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { readdirSync, readFileSync } = require('fs');
const { randomUUID } = require('crypto');
const { EventEmitter } = require('stream');

const files = (function() {
  const f = new Map();
  function l(p) {
    readdirSync(p, { withFileTypes: true }).forEach(v => {
      const n = p + '/' + v.name;
      if (v.isDirectory()) l(n);
      else f.set(n.slice('./public'.length), readFileSync(n));
    });
  }
  l('./public');
  f.set('/', f.get('/index.html'));
  return f;
}());

let desktopSocket;
const peerSockets = new Map();
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws, req, isDesktop) => {
  const id = randomUUID();
  console.log(id, isDesktop);
  if (isDesktop) {
    ws.send = s => WebSocket.prototype.send.call(ws, JSON.stringify(s));
    desktopSocket = ws;
    ws.on('message', data => {
      // console.log(data.toString());
      const parsed = JSON.parse(data);
      const peer = peerSockets.get(parsed.id);
      if (!peer) return;
      switch (parsed.action) {
        case 'forward':
          peer.send(data);
          break;
        case 'disconnect':
          peer.send(data);
          peer.close();
          break;
      }
    });
    ws.on('close', () => {
      console.log('desktop closed');
      desktopSocket = null;
    });
  } else {
    peerSockets.set(id, ws);
    if (desktopSocket) desktopSocket.send({ id, type: 'connect' });
    ws.on('message', data => {
      // console.log(data.toString());
      try {
        data = JSON.parse(data);
        if (desktopSocket) desktopSocket.send(Object.assign(data, { id, type: 'message' }));
      } catch (e) {
        console.log('error parsing json', e);
      }
    });
    ws.on('close', () => {
      if (desktopSocket) desktopSocket.send({ id, type: 'disconnect' });
    });
  }
});
const server = createServer((req, res) => {
  if (files.has(req.url)) return res.end(files.get(req.url));
  res.end('hi');
});
server.on('upgrade', (req, socket, head) => {
  const isDesktop = (!!req.headers.authorization && req.headers.authorization === Buffer.from('a', 'utf8').toString('base64'));
  wss.handleUpgrade(req, socket, head, (ws, req) => {
    ws.emit = (...args) => {
      console.log(args[0], isDesktop);
      EventEmitter.prototype.emit.apply(ws, args);
    };
    wss.emit('connection', ws, req, isDesktop);
  });
});
server.listen(80, () => {
  console.log('server open');
});