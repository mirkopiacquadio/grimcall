const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3000 });

let users = [];
let rooms = {}; // { roomId: [user1, user2, ...] }
let queue = [];

console.log("🚀 [SERVER] WebSocket server started on port 3000");

// Helpers
function getUserBySocket(ws) { return users.find(u => u.socket === ws); }
function getUserByName(name) { return users.find(u => u.name === name); }
function addToRoom(roomId, name) {
  if (!rooms[roomId]) rooms[roomId] = [];
  if (!rooms[roomId].includes(name)) rooms[roomId].push(name);
}
function removeFromRoom(roomId, name) {
  if (!rooms[roomId]) return;
  rooms[roomId] = rooms[roomId].filter(n => n !== name);
  if (rooms[roomId].length === 0) delete rooms[roomId];
}
function getRoomPeers(roomId, exclude) {
  return (rooms[roomId] || []).filter(u => u !== exclude);
}
function broadcastUserList() {
  const payload = {
    type: 'userlist',
    users: users.map(u => ({ name: u.name, available: u.available })),
  };
  users.forEach(u => {
    if (u.socket?.readyState === WebSocket.OPEN) {
      u.socket.send(JSON.stringify(payload));
    }
  });
  console.log("📡 [BROADCAST] User list sent:", payload.users);
}

// Connection handler
wss.on('connection', ws => {
  console.log("🟢 [CONNECT] New client connected");

  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg);
      console.log("📨 [RECV]", data);

      // --- LOGIN ---
      if (data.type === 'login') {
        // Cerca se la stessa utenza è già loggata (escludendo questa socket)
        let existing = users.find(u => u.name === data.name && u.socket !== ws && u.socket.readyState === WebSocket.OPEN);

        if (existing) {
          // Rispondi SOLO al client che sta tentando di accedere con l'errore
          ws.send(JSON.stringify({ type: 'login-error', message: 'Utenza già collegata' }));
          ws.close();
          return;
        }

        // Login normale
        let user = getUserByName(data.name);
        if (user) {
          user.socket = ws;
          user.available = true;
          user.inCall = false;
        } else {
          users.push({ name: data.name, socket: ws, available: true, inCall: false });
        }
        console.log(`✅ [LOGIN] ${data.name} logged in`);
        broadcastUserList();
        return;
      }

      // --- CALL: Avvio chiamata a 2 (solo guest/operator) ---
      if (data.type === 'call') {
        const caller = getUserBySocket(ws);
        const callee = getUserByName(data.target);
        if (!caller || !callee) return;
        // Genera roomId solo per questi due
        const roomId = [caller.name, callee.name].sort().join('_');
        // Notifica callee (operatore)
        callee.socket.send(JSON.stringify({ type: 'incoming-call', from: caller.name, room: roomId }));
        // Guest invia subito join da client, operator farà join quando accetta
        caller.roomId = roomId;
        callee.roomId = roomId;
        broadcastUserList();
        return;
      }

      // --- INVITE: Espandi la mesh SOLO quando clicchi “Aggiungi partecipante” ---
      if (data.type === 'invite') {
        const inviter = getUserBySocket(ws);
        const invited = getUserByName(data.to);
        if (!inviter || !invited) return;
        // NON aggiungere subito in room! Solo notifica
        invited.socket.send(JSON.stringify({
          type: 'incoming-call',
          from: inviter.name,
          room: data.room,
          invite: true
        }));
        console.log(`[INVITE] ${inviter.name} invita ${invited.name} nella room ${data.room}`);
        return;
      }

      // --- JOIN: chiunque fa join entra in mesh per room ---
      if (data.type === 'join') {
        const user = getUserByName(data.name);
        if (!user) return;
        addToRoom(data.room, user.name);
        user.inCall = true;
        user.available = false;
        user.roomId = data.room;
        console.log(`[ROOM] Dopo join: ${data.room} =`, rooms[data.room]);

        // Costruisci nuova peer-list per la stanza (escludendo se stessi)
        const roomUsers = rooms[data.room] || [];
        roomUsers.forEach(uName => {
          const u = getUserByName(uName);
          if (u?.socket?.readyState === WebSocket.OPEN) {
            const peers = roomUsers.filter(p => p !== uName);
            u.socket.send(JSON.stringify({ type: 'peer-list', peers }));
          }
        });

        // Notifica agli altri peer in room (così sanno di dover creare connessione mesh)
        const peers = getRoomPeers(data.room, user.name);
        peers.forEach(peerName => {
          const peer = getUserByName(peerName);
          if (peer?.socket?.readyState === WebSocket.OPEN) {
            peer.socket.send(JSON.stringify({ type: 'new-peer', name: user.name }));
          }
        });

        broadcastUserList();
        return;
      }

      // --- RELAY segnalazione WebRTC in mesh (offer, answer, ice) ---
      if (["offer", "answer", "ice"].includes(data.type)) {
        const sender = getUserBySocket(ws); // chi ha mandato il messaggio
        const peer = getUserByName(data.to); // chi deve ricevere
        if (peer?.socket?.readyState === WebSocket.OPEN) {
          const relayMsg = { ...data, from: sender?.name };
          peer.socket.send(JSON.stringify(relayMsg));
          console.log(`🔀 [RELAY] ${data.type} relayed from ${sender?.name} to ${peer.name}`);
        }
        return;
      }

      // --- END CALL ---
      if (data.type === 'end' || data.type === 'bye' || data.type === 'leave') {
        const user = getUserBySocket(ws);
        if (user && user.roomId) {
          const roomId = user.roomId;
          removeFromRoom(roomId, user.name);
          user.inCall = false;
          user.available = true;
          delete user.roomId;
          // Notifica agli altri nella room
          getRoomPeers(roomId).forEach(userName => {
            const peer = getUserByName(userName);
            if (peer?.socket?.readyState === WebSocket.OPEN) {
              peer.socket.send(JSON.stringify({
                type: 'participant-left',
                name: user.name,
                room: roomId
              }));
            }
          });
          broadcastUserList();
        }
        return;
      }

      // --- REJECT CALL ---
      if (data.type === 'reject') {
        // "from" è il chiamante guest (nome)
        const guest = getUserByName(data.from);
        if (guest?.socket?.readyState === WebSocket.OPEN) {
          guest.socket.send(JSON.stringify({ type: 'call-rejected', from: getUserBySocket(ws)?.name }));
        }
        return;
      }

    } catch (err) {
      console.error("❗ [ERROR] Failed to parse message:", msg, err);
    }
  });

  ws.on('close', () => {
    const disconnected = getUserBySocket(ws);
    if (disconnected) {
      Object.keys(rooms).forEach(roomId => removeFromRoom(roomId, disconnected.name));
      users = users.filter(u => u.socket !== ws);
      broadcastUserList();
    }
  });
});
