const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3000 });

let users = [];
let rooms = {}; // { [roomId]: [userName, ...] }
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
function addToRoom(roomId, userName) {
  if (!rooms[roomId]) rooms[roomId] = [];
  if (!rooms[roomId].includes(userName)) rooms[roomId].push(userName);
}
function removeFromRoom(roomId, userName) {
  if (!rooms[roomId]) return;
  rooms[roomId] = rooms[roomId].filter(u => u !== userName);
  if (rooms[roomId].length === 0) delete rooms[roomId];
}
function getRoomPeers(roomId, exclude) {
  return (rooms[roomId] || []).filter(u => u !== exclude);
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

      // CALL (inizia una nuova room)
      if (data.type === 'call') {
        const caller = getUserBySocket(ws);
        const callee = getUserByName(data.target);
        if (!caller || !callee) {
          console.log("❌ [CALL] Caller or callee not found");
          return;
        }
        if (!callee.available || callee.inCall) {
          queue.push({ from: caller.name, to: callee.name });
          ws.send(JSON.stringify({ type: 'queued' }));
          console.log(`⏳ [QUEUE] ${caller.name} added to queue for ${callee.name}`);
        } else {
          // Genera una roomId unica
          const roomId = [caller.name, callee.name].sort().join('_');
          // Guest entra SUBITO nella stanza (così parte la cam)
          addToRoom(roomId, caller.name);
          caller.inCall = true;
          caller.available = false;
          caller.roomId = roomId;
          // Notifica popup a Mario Rossi con roomId
          callee.socket.send(JSON.stringify({ type: 'incoming-call', from: caller.name, room: roomId }));
          callee.inCall = false;    // Lui resta disponibile finché non accetta!
          callee.available = true;  // (oppure false se vuoi bloccare la chiamata)
          callee.roomId = roomId;
          console.log(`📞 [CALL] ${caller.name} is calling ${callee.name} (room: ${roomId})`);
        }
        broadcastUserList();
        return;
      }


      // JOIN (user entra in una room/chiamata mesh)
      if (data.type === 'join') {
        const user = getUserByName(data.name);
        if (!user) return;
        addToRoom(data.room, data.name);
        user.inCall = true;
        user.available = false;
        user.roomId = data.room;

        // Peer-list a chi join-a ORA (tutti gli altri già in room)
        const others = getRoomPeers(data.room, data.name);
        if (others.length) {
          user.socket.send(JSON.stringify({
            type: 'peer-list',
            peers: others
          }));
        }
        // Notifica agli altri che è arrivato un nuovo peer
        others.forEach(peerName => {
          const peer = getUserByName(peerName);
          if (peer && peer.socket && peer.socket.readyState === WebSocket.OPEN) {
            peer.socket.send(JSON.stringify({
              type: 'new-peer',
              name: data.name
            }));
          }
        });
        broadcastUserList();
        return;
      }

      // INVITE (aggiungi partecipante)
      if (data.type === 'invite') {
        const inviter = getUserBySocket(ws);
        const invited = getUserByName(data.to);
        if (!inviter || !invited) return;
        addToRoom(data.room, invited.name);
        invited.socket.send(JSON.stringify({
          type: 'incoming-call',
          from: inviter.name,
          room: data.room,
          invite: true
        }));
        invited.inCall = true;
        invited.available = false;
        invited.roomId = data.room;
        broadcastUserList();
        return;
      }

      // ACCEPT (entra nella stanza/room)
      if (data.type === 'accept') {
        const callee = getUserBySocket(ws);
        const caller = getUserByName(data.from);
        const roomId = data.room || (callee && callee.roomId) || (caller && caller.roomId);

        if (caller && callee && roomId) {
          addToRoom(roomId, caller.name);
          addToRoom(roomId, callee.name);

          // Tutti nella room ricevono call-accepted
          getRoomPeers(roomId).forEach(userName => {
            const peer = getUserByName(userName);
            if (peer && peer.socket && peer.socket.readyState === WebSocket.OPEN) {
              peer.socket.send(JSON.stringify({
                type: 'call-accepted',
                from: callee.name,
                room: roomId
              }));
            }
          });

          callee.inCall = true;
          callee.available = false;
          callee.roomId = roomId;
          caller.inCall = true;
          caller.available = false;
          caller.roomId = roomId;
          broadcastUserList();
        }
        return;
      }

      // END/BYE (utente lascia la chiamata)
      if (data.type === 'end' || data.type === 'bye') {
        const user = getUserBySocket(ws);
        if (user && user.roomId) {
          const roomId = user.roomId;
          removeFromRoom(roomId, user.name);
          user.inCall = false;
          user.available = true;
          delete user.roomId;
          console.log(`🔚 [END] ${user.name} left room ${roomId}`);
          // Notifica agli altri della stanza che qualcuno ha lasciato (opzionale)
          getRoomPeers(roomId).forEach(userName => {
            const peer = getUserByName(userName);
            if (peer && peer.socket && peer.socket.readyState === WebSocket.OPEN) {
              peer.socket.send(JSON.stringify({
                type: 'participant-left',
                name: user.name,
                room: roomId
              }));
            }
          });
          broadcastUserList();
          checkQueue();
        }
        return;
      }

      // OFFER/ANSWER/ICE (relay con info stanza)
      if (["offer", "answer", "ice"].includes(data.type)) {
        // In una mesh room, il messaggio va girato solo al target
        const peer = getUserByName(data.to);
        if (peer && peer.socket && peer.socket.readyState === WebSocket.OPEN) {
          peer.socket.send(msg); // puoi anche aggiungere room se necessario
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
    // Rimuovi utente da users e da ogni stanza
    const disconnectedUser = getUserBySocket(ws);
    if (disconnectedUser) {
      Object.keys(rooms).forEach(roomId => removeFromRoom(roomId, disconnectedUser.name));
      console.log(`🔴 [DISCONNECT] ${disconnectedUser.name} disconnected`);
      users = users.filter(u => u.socket !== ws);
      queue = queue.filter(q => getUserByName(q.from)?.socket !== ws);
      broadcastUserList();
      checkQueue();
    }
  });
});