const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3000 });

let users = [];
let rooms = {}; // { [roomId]: [userName, ...] }
let queue = [];

console.log("🚀 [SERVER] WebSocket server started on port 3000");

function getUserBySocket(ws) { return users.find(u => u.socket === ws); }
function getUserByName(name) { return users.find(u => u.name === name); }
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

      // CALL (l'utente Guest vuole chiamare un operatore)
      if (data.type === 'call') {
        const caller = getUserBySocket(ws);
        const callee = getUserByName(data.target);
        if (!caller || !callee) return;
        // Genera roomId
        const roomId = [caller.name, callee.name].sort().join('_');
        callee.socket.send(JSON.stringify({ type: 'incoming-call', from: caller.name, room: roomId }));
        caller.roomId = roomId;
        console.log(`📞 [CALL] ${caller.name} is calling ${callee.name} (room: ${roomId})`);
        broadcastUserList();
        return;
      }

      // JOIN (partecipante entra in room)
      if (data.type === 'join') {
        const user = getUserByName(data.name);
        if (!user) return;

        addToRoom(data.room, user.name);
        user.inCall = true;
        user.available = false;
        user.roomId = data.room;
        console.log(`[ROOM] Dopo join: ${data.room} =`, rooms[data.room]);

        // Invio la lista peer agli altri nella stanza
        const peers = getRoomPeers(data.room, user.name);
        if (user.socket && user.socket.readyState === WebSocket.OPEN) {
          user.socket.send(JSON.stringify({ type: 'peer-list', peers }));
        }
        console.log(`[SIGNAL] Inviata peer-list a ${user.name} -> peers:`, peers);
        // Avviso chi è già in stanza che è entrato un nuovo peer
        peers.forEach(peerName => {
          const peer = getUserByName(peerName);
          if (peer && peer.socket && peer.socket.readyState === WebSocket.OPEN) {
            peer.socket.send(JSON.stringify({ type: 'new-peer', name: user.name }));
          }
        });

        broadcastUserList();
        return;
      }

      // OFFER/ANSWER/ICE (relay verso il target)
      if (["offer", "answer", "ice"].includes(data.type)) {
        const peer = getUserByName(data.to);
        if (peer && peer.socket && peer.socket.readyState === WebSocket.OPEN) {
          peer.socket.send(msg); // relay diretto!
          console.log(`🔀 [RELAY] ${data.type} relayed from ${getUserBySocket(ws)?.name} to ${peer.name}`);
        }
        return;
      }

      // END/BYE (utente lascia la chiamata)
      if (data.type === 'leave' || data.type === 'end' || data.type === 'bye') {
        const user = getUserBySocket(ws);
        if (user && user.roomId) {
          const roomId = user.roomId;
          removeFromRoom(roomId, user.name);
          user.inCall = false;
          user.available = true;
          delete user.roomId;
          console.log(`🔚 [END] ${user.name} left room ${roomId}`);
          getRoomPeers(roomId).forEach(userName => {
            const peer = getUserByName(userName);
            if (peer && peer.socket && peer.socket.readyState === WebSocket.OPEN) {
              peer.socket.send(JSON.stringify({
                type: 'peer-left',
                name: user.name,
                room: roomId
              }));
            }
          });
          broadcastUserList();
        }
        return;
      }

    } catch (err) {
      console.error("❗ [ERROR] Failed to parse message:", msg, err);
    }
  });

  ws.on('close', () => {
    const disconnectedUser = getUserBySocket(ws);
    if (disconnectedUser) {
      Object.keys(rooms).forEach(roomId => removeFromRoom(roomId, disconnectedUser.name));
      console.log(`🔴 [DISCONNECT] ${disconnectedUser.name} disconnected`);
      users = users.filter(u => u.socket !== ws);
      broadcastUserList();
    }
  });
});
