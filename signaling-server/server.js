const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3000 });

let clients = {}; // { username: { ws, available } }

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
        break;

      case 'call':
        if (clients[data.target] && clients[data.target].available) {
          clients[data.target].ws.send(JSON.stringify({
            type: 'incoming-call',
            from: currentUser
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
        break;

      case 'offer':
        if (clients[data.to]) {
          clients[data.to].ws.send(JSON.stringify({
            type: 'offer',
            offer: data.offer,
            from: currentUser,
            to: data.to
          }));
        }
        break;

      case 'answer':
        if (clients[data.to]) {
          clients[data.to].ws.send(JSON.stringify({
            type: 'answer',
            answer: data.answer,
            from: currentUser,
            to: data.to
          }));
        }
        break;

      case 'ice':
        if (clients[data.to]) {
          clients[data.to].ws.send(JSON.stringify({
            type: 'ice',
            candidate: data.candidate,
            from: currentUser,
            to: data.to
          }));
        }
        break;


      case 'bye':
        if (clients[currentUser]) {
          clients[currentUser].available = true;
          sendUserList();
        }
        break;
    }
  });

  ws.on('close', () => {
    if (currentUser && clients[currentUser]) {
      clients[currentUser].available = false;
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
});

console.log('📡 Signaling server attivo su ws://localhost:3000');