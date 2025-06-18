// server.js aggiornato con gestione coda per più operatori
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3000 });

let clients = {}; // { username: { ws, available } }
let queue = [];   // [{ from: 'Guest-123' }]

wss.on('connection', (ws) => {
  let currentUser = null;

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch {
      return;
    }

    switch (data.type) {
      case 'login':
        currentUser = data.name;
        clients[currentUser] = { ws, available: true };
        sendUserList();
        processQueue();
        break;

      case 'call':
        const availableOperators = Object.entries(clients)
          .filter(([name, c]) => c.available && name !== currentUser);

        if (availableOperators.length > 0) {
          const [operatorName, operator] = availableOperators[0];

          operator.ws.send(JSON.stringify({
            type: 'incoming-call',
            from: currentUser
          }));

          // mark both temporarily unavailable
          clients[currentUser].available = false;
          clients[operatorName].available = false;
          sendUserList();
        } else {
          // nessun operatore disponibile, metti in coda
          queue.push({ from: currentUser });
          clients[currentUser].ws.send(JSON.stringify({
            type: 'queued'
          }));
        }
        break;

      case 'accept':
        if (clients[data.from] && clients[data.to]) {
          clients[data.from].ws.send(JSON.stringify({
            type: 'call-accepted',
            from: data.to
          }));
          clients[data.from].available = false;
          clients[data.to].available = false;
          sendUserList();
        }
        break;

      case 'reject':
        if (clients[data.from]) {
          clients[data.from].ws.send(JSON.stringify({
            type: 'call-rejected',
            from: currentUser
          }));
        }
        clients[currentUser].available = true;
        sendUserList();
        processQueue();
        break;

      case 'offer':
      case 'answer':
      case 'ice':
        if (clients[data.to]) {
          clients[data.to].ws.send(JSON.stringify({
            ...data,
            from: currentUser
          }));
        }
        break;

      case 'bye':
        if (clients[currentUser]) {
          clients[currentUser].available = true;
        }

        if (data.to && clients[data.to]) {
          clients[data.to].ws.send(JSON.stringify({
            type: 'call-ended',
            from: currentUser
          }));
          clients[data.to].available = true;
        }

        sendUserList();
        processQueue();
        break;
    }
  });

  ws.on('close', () => {
    if (currentUser && clients[currentUser]) {
      delete clients[currentUser];
      sendUserList();
    }
  });

  function sendUserList() {
    const list = Object.keys(clients).map(name => ({
      name,
      available: clients[name].available
    }));
    const msg = JSON.stringify({ type: 'userlist', users: list });
    Object.values(clients).forEach(c => c.ws.send(msg));
  }

  function processQueue() {
    if (queue.length === 0) return;

    const availableOperators = Object.entries(clients)
      .filter(([name, c]) => c.available);

    if (availableOperators.length === 0) return;

    const queuedUser = queue.shift();
    const [operatorName, operator] = availableOperators[0];

    operator.ws.send(JSON.stringify({
      type: 'incoming-call',
      from: queuedUser.from
    }));

    clients[queuedUser.from].available = false;
    clients[operatorName].available = false;
    sendUserList();
  }
});

console.log('📡 Signaling server con coda attivo su ws://localhost:3000');