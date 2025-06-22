// === callRenderer.js ===
// Avvio modalità debug mesh 2 (espandi solo su INVITE)

const ipcRenderer = window.electronAPI;

let myName = '';
let roomId = '';
let ws;
let localStream;
let peerConnections = {}; // { peerName: RTCPeerConnection }
let remoteStreams = {};   // { peerName: MediaStream }
let iceQueue = {};        // { peerName: [candidate, ...] }
let latestUserList = [];
let connectedPeers = new Set();

const localVideo = document.getElementById('localVideo');
const remoteVideos = document.getElementById('remoteVideos') || makeRemoteVideosContainer();
const callStatus = document.getElementById('callStatus');
const endCallBtn = document.getElementById('endCallBtn');

function log(...args) {
//   console.log('[CALL]', ...args);
//   if (callStatus) {
//     callStatus.innerText = args.map(a =>
//       typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
//     ).join(' ');
//   }
}

function updateConnectedPeers() {
  connectedPeers = new Set(Object.keys(peerConnections));
  connectedPeers.add(myName); // Considera anche se stesso come "connesso"
}

function filterAvailableOperators() {
  // Solo operatori disponibili e NON già connessi
  return latestUserList
    .filter(u => u.available && u.name !== myName && !connectedPeers.has(u.name));
}

function handleUserList(data) {
  if (Array.isArray(data.users)) {
    latestUserList = data.users;
    updateConnectedPeers();
  }
}

window.requestAvailableUsersForDropdown = () => {
  updateConnectedPeers();
  const availableUsers = filterAvailableOperators().map(u => u.name);
  window.setAvailableUsersForDropdown(availableUsers);
}


// Chiamata mesh: sempre a 2 di default, AUMENTA SOLO quando fai INVITE
ipcRenderer.on('call-data', async (event, data) => {
  log('Received call-data', data);
  if (!data.isOperator) {
    document.getElementById('addParticipantBtn').style.display = 'none';
  }
  myName = data.self;
  roomId = data.roomId || 'room-default';
  await setupLocalStream();
  setupWebSocket();
});

// Mesh: puoi aggiungere partecipanti SOLO quando vuoi
window.addParticipantToCall = (username) => {
  log('Inviting participant', username);
  ws.send(JSON.stringify({ type: 'invite', to: username, room: roomId }));
};

// Crea il container video se manca
function makeRemoteVideosContainer() {
  const d = document.createElement('div');
  d.id = 'remoteVideos';
  d.style.display = 'flex';
  d.style.gap = '16px';
  d.style.justifyContent = 'center';
  d.style.marginTop = '1rem';
  document.body.appendChild(d);
  return d;
}

async function setupLocalStream() {
  if (localStream) return;
  try {
    log('Chiedo accesso a webcam/mic...');
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    log('Webcam/mic ready');
  } catch (err) {
    log("Errore accesso webcam/microfono:", err.message);
    alert("Errore accesso webcam/microfono: " + err.message);
    throw err;
  }
}

function setupWebSocket() {
  ws = new WebSocket('wss://heroic-discrete-caribou.ngrok-free.app');
  ws.onopen = () => {
    log('WebSocket aperto, login...');
    ws.send(JSON.stringify({ type: 'login', name: myName }));
    ws.send(JSON.stringify({ type: 'join', name: myName, room: roomId }));
  };

  ws.onmessage = async (e) => {
    let data;
    try {
      data = typeof e.data === "string" ? JSON.parse(e.data)
        : JSON.parse(await e.data.text());
    } catch (err) {
      log("[WS] JSON error", err, e.data);
      return;
    }
    log('MSG', data);

    if (data.type === 'userlist') handleUserList(data);
    if (callStatus) {
      callStatus.style.display = '';
      callStatus.innerText = "Sto chiamando l'operatore...";
    }
    
    // === SIGNALING ===
    if (data.type === 'peer-list') {
      // data.peers = array di nomi (escluso te stesso!)
      for (const peer of data.peers) {
        if (peer !== myName && !peerConnections[peer]) {
          // Il nuovo utente fa OFFER verso ogni altro peer
          log('Connecting to peer (peer-list)', peer);
          await connectToPeer(peer, true);
        }
      }
      if (callStatus) callStatus.style.display = 'none';
    }
    if (data.type === 'new-peer') {
      if (data.name !== myName && !peerConnections[data.name]) {
        // Tutti già presenti fanno OFFER verso il nuovo peer
        log('Connecting to peer (new-peer)', data.name);
        await connectToPeer(data.name, true);
      }
    }
    if (data.type === 'offer') {
      log('Received offer from', data.from);
      // Chiudi eventuale connessione pre-esistente:
      if (peerConnections[data.from]) {
        log('[SAFEGUARD] Esisteva già una connessione con', data.from, '-> la chiudo');
        closePeer(data.from);
      }
      await connectToPeer(data.from, false, data.offer);
    }
    if (data.type === 'answer') {
      log('Received answer from', data.from);
      try {
        await peerConnections[data.from]?.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (err) {
        log('setRemoteDescription (answer) failed:', err);
      }
    }
    if (data.type === 'ice') {
      const pc = peerConnections[data.from];
      if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
        if (!iceQueue[data.from]) iceQueue[data.from] = [];
        iceQueue[data.from].push(data.candidate);
        log("[CALL] ICE candidate QUEUED for", data.from, data.candidate);
      } else {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          log("[CALL] ICE candidate ADDED for", data.from);
        } catch (err) {
          log("[CALL] ICE candidate FAILED for", data.from, err);
        }
      }
    }
    if (data.type === 'incoming-call' && data.invite) {
      if (data.type === 'incoming-call' && data.invite) {
        log('Sei stato invitato a una chiamata!', data);
      }
    }

    if (data.type === 'participant-left') {
      log('Peer ha lasciato:', data.name);
      closePeer(data.name);
    }

    if (data.type === 'call-rejected') {
      alert(`${data.from} ha rifiutato la chiamata`);
      ws.send(JSON.stringify({ type: 'leave' }));
      ws.close();
      Object.keys(peerConnections).forEach(closePeer);
      if (localStream) localStream.getTracks().forEach(track => track.stop());
      ipcRenderer.send('call-ended');
      ipcRenderer.send('close-call-window');
    }
  };

  ws.onclose = (e) => { log('[WS] closed', e); };
  ws.onerror = (err) => { log('[WS] error', err); };
}

// Mesh: ogni nuovo peer = nuova connessione P2P
async function connectToPeer(peerName, isOfferer, remoteOffer = null) {
  if (peerConnections[peerName]) {
    log("[SAFEGUARD] peerConnections già esistente per", peerName, "(non ricreo)");
    return;
  }
  log("[DEBUG] connectToPeer", { peerName, isOfferer, remoteOffer: !!remoteOffer });

  // Assicurati localStream PRIMA di tutto
  await setupLocalStream();

  if (!localStream || localStream.getTracks().length === 0) {
    log("[ERROR] localStream non pronto o senza tracce!");
    alert("LocalStream non pronto: niente media inviabile.");
    return;
  }
  log("[CHECK] localStream tracks:", localStream.getTracks().map(t => t.kind));

  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peerConnections[peerName] = pc;
  remoteStreams[peerName] = null;
  iceQueue[peerName] = iceQueue[peerName] || [];

  pc.onicecandidate = event => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: 'ice', candidate: event.candidate, to: peerName }));
      log('[ICE] Invio ICE candidate verso', peerName, event.candidate);
    }
  };

  pc.onconnectionstatechange = () => {
    log('[STATE] Connessione verso', peerName, '->', pc.connectionState);
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      closePeer(peerName);
    }
  };

  pc.ontrack = event => {
    log("[TRACK] ontrack event received", event);
    if (event.streams && event.streams[0]) {
      remoteStreams[peerName] = event.streams[0];

      // Cerca video già esistente o creane uno
      let v = document.getElementById('video_' + peerName);
      if (!v) {
        v = document.createElement('video');
        v.id = 'video_' + peerName;
        v.autoplay = true;
        v.playsInline = true;
        v.className = 'remote-video';
        remoteVideos.appendChild(v);
      }
      v.srcObject = event.streams[0];
      v.play().catch(e => log("Video play error", e));

      // AGGIUNGI QUESTO:
      updateRemoteVideosLayout();
      log("[TRACK] Set remote video for", peerName, event.streams[0].id);
    }
  };


  // AGGIUNGI SEMPRE I TUOI TRACK PRIMA DI OFFER/ANSWER!
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
    log('[ADDTRACK] Aggiunta traccia', track.kind, 'a', peerName);
  });

  if (isOfferer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'offer', offer, to: peerName }));
    log("[OFFER] Sent offer to", peerName, offer);
  } else if (remoteOffer) {
    log("[ANSWER] Imposto remote offer per", peerName);
    await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', answer, to: peerName }));
    log("[ANSWER] Received offer, sent answer to", peerName, answer);
  }

  // Applica ICE candidate in coda (solo se ora abbiamo remoteDescription)
  if (iceQueue[peerName].length) {
    for (const candidate of iceQueue[peerName]) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        log("[ICE] Added queued candidate per", peerName, candidate);
      } catch (err) {
        log("[ICE] FAILED to add queued candidate", candidate, err);
      }
    }
    iceQueue[peerName] = [];
  }
}

function closePeer(peerName) {
  log('Chiudo peer', peerName);
  if (peerConnections[peerName]) {
    peerConnections[peerName].close();
    delete peerConnections[peerName];
  }
  if (remoteStreams[peerName]) {
    delete remoteStreams[peerName];
  }
  let v = document.getElementById('video_' + peerName);
  if (v) v.remove();
  // Aggiorna layout dopo rimozione
  updateRemoteVideosLayout();
}

if (endCallBtn) {
  endCallBtn.onclick = () => {
    log('Fine chiamata!');
    ws.send(JSON.stringify({ type: 'leave' }));
    ws.close();
    Object.keys(peerConnections).forEach(closePeer);
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    ipcRenderer.send('call-ended');
    ipcRenderer.send('close-call-window');
  };
}

ipcRenderer.on('force-end-call', () => {
  log('force-end-call');
  ws.send(JSON.stringify({ type: 'leave' }));
  ws.close();
  Object.keys(peerConnections).forEach(closePeer);
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  ipcRenderer.send('call-ended');
  ipcRenderer.send('close-call-window');
});

function updateRemoteVideosLayout() {
  const remoteVideosArr = Array.from(remoteVideos.querySelectorAll('video.remote-video'));
  remoteVideosArr.forEach(v => {
    v.classList.remove('half');
    v.style.height = '';
  });

  if (remoteVideosArr.length === 2) {
    remoteVideosArr.forEach(v => v.classList.add('half'));
  } else if (remoteVideosArr.length === 1) {
    remoteVideosArr[0].classList.remove('half');
    remoteVideosArr[0].style.height = '100vh';
  } else if (remoteVideosArr.length >= 3) {
    remoteVideosArr.forEach(v => v.style.height = (100 / remoteVideosArr.length) + 'vh');
  }
}