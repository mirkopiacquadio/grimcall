const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3000 });

let users = [];              // [{ name, socket, roomId, inCall }]
let rooms = {};              // { roomId: [userName, ...] }

console.log("🚀 [SERVER] Mesh WebRTC server avviato");

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
      available: !u.inCall,
    })),
  };
  users.forEach(u => {
    if (u.socket && u.socket.readyState === WebSocket.OPEN) {
      u.socket.send(JSON.stringify(payload));
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

wss.on('connection', ws => {
  console.log("🟢 [CONNECT] New client connected");

  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg);
      // LOGIN: name
      if (data.type === 'login') {
        let existingUser = getUserByName(data.name);
        if (existingUser) {
          existingUser.socket = ws;
          existingUser.inCall = false;
        } else {
          users.push({
            name: data.name,
            socket: ws,
            inCall: false,
            roomId: null,
          });
        }
        broadcastUserList();
        return;
      }

      // CALL (guest chiede di avviare una room)
      if (data.type === 'call') {
        const caller = getUserBySocket(ws);
        const callee = getUserByName(data.target);
        if (!caller || !callee) return;
        // Crea roomId (sempre guest+callee)
        const roomId = [caller.name, callee.name].sort().join('_');
        // Notifica all’operatore: chiamata in arrivo
        callee.socket.send(JSON.stringify({ type: 'incoming-call', from: caller.name, room: roomId }));
        caller.roomId = roomId;
        callee.roomId = roomId;
        return;
      }

      // JOIN room (chiunque entra in room, mesh mode!)
      if (data.type === 'join') {
        const user = getUserByName(data.name);
        if (!user) return;
        addToRoom(data.room, user.name);
        user.inCall = true;
        user.roomId = data.room;

        // Invio peer-list SOLO ai nuovi entrati
        const peers = getRoomPeers(data.room, user.name);
        if (user.socket && user.socket.readyState === WebSocket.OPEN) {
          user.socket.send(JSON.stringify({ type: 'peer-list', peers }));
        }

        // Avviso tutti gli altri nella room del nuovo peer (così fanno l’offer verso di lui)
        peers.forEach(peerName => {
          const peer = getUserByName(peerName);
          if (peer && peer.socket && peer.socket.readyState === WebSocket.OPEN) {
            peer.socket.send(JSON.stringify({ type: 'new-peer', name: user.name }));
          }
        });

        broadcastUserList();
        return;
      }

      // INVITE: aggiungi un altro utente in room
      if (data.type === 'invite') {
        const inviter = getUserBySocket(ws);
        const invited = getUserByName(data.to);
        if (!inviter || !invited) return;
        const roomId = data.room;
        addToRoom(roomId, invited.name);
        invited.roomId = roomId;
        invited.inCall = true;
        invited.socket.send(JSON.stringify({
          type: 'incoming-call',
          from: inviter.name,
          room: roomId,
          invite: true
        }));
        broadcastUserList();
        return;
      }

      // OFFER/ANSWER/ICE: relay signaling verso target
      if (["offer", "answer", "ice"].includes(data.type)) {
        const peer = getUserByName(data.to);
        if (peer && peer.socket && peer.socket.readyState === WebSocket.OPEN) {
          peer.socket.send(msg);
        }
        return;
      }

      // END (utente lascia la room)
      if (data.type === 'leave' || data.type === 'end' || data.type === 'bye') {
        const user = getUserBySocket(ws);
        if (user && user.roomId) {
          const roomId = user.roomId;
          removeFromRoom(roomId, user.name);
          user.inCall = false;
          user.roomId = null;
          // Avvisa tutti nella stanza che è uscito
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
      if (disconnectedUser.roomId) {
        removeFromRoom(disconnectedUser.roomId, disconnectedUser.name);
      }
      users = users.filter(u => u.socket !== ws);
      broadcastUserList();
    }
  });
});
