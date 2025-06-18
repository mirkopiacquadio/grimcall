const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3000 });

let users = [];
let queue = [];

console.log("🚀 [SERVER] WebSocket server started on port 3000");

// Helpers
function getUserBySocket(ws) {
  return users.find(u => u.socket === ws);
}

function getUserByName(name) {
  return users.find(u => u.name === name);
}

function broadcastUserList() {
  const payload = {
    type: 'userlist',
    users: users.map(u => ({
      name: u.name,
      available: u.available,
    })),
  };
  users.forEach(u => {
    if (u.socket && u.socket.readyState === WebSocket.OPEN) {
      u.socket.send(JSON.stringify(payload));
    }
  });
  console.log("📡 [BROADCAST] User list sent:", payload.users);
}

function checkQueue() {
  queue.forEach((entry, idx) => {
    const callee = getUserByName(entry.to);
    const caller = getUserByName(entry.from);

    if (callee && callee.available && !callee.inCall && caller) {
      callee.socket.send(JSON.stringify({ type: 'incoming-call', from: entry.from }));
      console.log(`📞 [QUEUE] Incoming call from ${entry.from} to ${entry.to}`);
      callee.inCall = true;
      callee.available = false;
      queue.splice(idx, 1);
    }
  });
}

// Evento nuova connessione
wss.on('connection', ws => {
  console.log("🟢 [CONNECT] New client connected");

  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg);
      console.log("📨 [RECV]", data);

      // LOGIN
      if (data.type === 'login') {
        // Se già presente, aggiorno il socket
        let existingUser = getUserByName(data.name);
        if (existingUser) {
          existingUser.socket = ws;
          existingUser.available = true;
          existingUser.inCall = false;
        } else {
          users.push({
            name: data.name,
            socket: ws,
            available: true,
            inCall: false,
          });
        }
        console.log(`✅ [LOGIN] ${data.name} logged in`);
        broadcastUserList();
        return;
      }

      // CALL (richiesta di chiamata)
      if (data.type === 'call') {
        const caller = getUserBySocket(ws);
        const callee = getUserByName(data.target);
        if (!caller || !callee) {
          console.log("❌ [CALL] Caller or callee not found");
          return;
        }
        if (!callee.available || callee.inCall) {
          // Metti in coda
          queue.push({ from: caller.name, to: callee.name });
          ws.send(JSON.stringify({ type: 'queued' }));
          console.log(`⏳ [QUEUE] ${caller.name} added to queue for ${callee.name}`);
        } else {
          callee.socket.send(JSON.stringify({ type: 'incoming-call', from: caller.name }));
          callee.inCall = true;
          callee.available = false;
          console.log(`📞 [CALL] ${caller.name} is calling ${callee.name}`);
        }
        broadcastUserList();
        return;
      }

      // ACCEPT (operatore accetta chiamata)
      if (data.type === 'accept') {
        const callee = getUserBySocket(ws);
        const caller = getUserByName(data.from);
        if (caller && callee) {
          caller.socket.send(JSON.stringify({ type: 'call-accepted', from: callee.name }));
          callee.socket.send(JSON.stringify({ type: 'call-accepted', from: caller.name }));
          caller.inCall = true;
          callee.inCall = true;
          caller.available = false;
          callee.available = false;
          console.log(`🟢 [ACCEPT] Call accepted: ${caller.name} <-> ${callee.name}`);
          broadcastUserList();
        }
        return;
      }

      // REJECT (operatore rifiuta chiamata)
      if (data.type === 'reject') {
        const callee = getUserBySocket(ws);
        const caller = getUserByName(data.from);
        if (caller) {
          caller.socket.send(JSON.stringify({ type: 'call-rejected', from: callee.name }));
        }
        if (callee) {
          callee.inCall = false;
          callee.available = true;
        }
        console.log(`❌ [REJECT] ${callee?.name} rejected call from ${caller?.name}`);
        broadcastUserList();
        return;
      }
      // END (chiusura chiamata)
      if (data.type === 'end' || data.type === 'bye') {
        const user = getUserBySocket(ws);
        if (user) {
          user.inCall = false;
          user.available = true;
          console.log(`🔚 [END] ${user.name} ended call`);
          broadcastUserList();
          checkQueue();
        }
        return;
      }

      // ICE/OFFER/ANSWER: Pass-through WebRTC (debug)
      if (["offer", "answer", "ice"].includes(data.type)) {
        const peer = getUserByName(data.to);
        if (peer && peer.socket && peer.socket.readyState === WebSocket.OPEN) {
          peer.socket.send(msg);
          console.log(`🔀 [RELAY] ${data.type} relayed from ${getUserBySocket(ws)?.name} to ${peer.name}`);
        } else {
          console.log(`⚠️ [RELAY] Target ${data.to} not found for ${data.type}`);
        }
        return;
      }

    } catch (err) {
      console.error("❗ [ERROR] Failed to parse message:", msg, err);
    }
  });

  ws.on('close', () => {
    // Rimuovi utente da users
    const disconnectedUser = getUserBySocket(ws);
    if (disconnectedUser) {
      console.log(`🔴 [DISCONNECT] ${disconnectedUser.name} disconnected`);
      users = users.filter(u => u.socket !== ws);
      queue = queue.filter(q => getUserByName(q.from)?.socket !== ws);
      broadcastUserList();
      checkQueue();
    }
  });
});
