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

const localVideo = document.getElementById('localVideo');
const remoteVideos = document.getElementById('remoteVideos') || makeRemoteVideosContainer();
const callStatus = document.getElementById('callStatus');
const endCallBtn = document.getElementById('endCallBtn');

function log(...args) {
  console.log('[CALL]', ...args);
  if (callStatus) callStatus.innerText = args.map(String).join(' ');
}

// Chiamata mesh: sempre a 2 di default, AUMENTA SOLO quando fai INVITE
ipcRenderer.on('call-data', async (event, data) => {
  log('Received call-data', data);
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
    console.log('MSG', JSON.stringify(data, null, 2));

    // === HANDLE SIGNALING ===
    if (data.type === 'peer-list') {
      for (const peer of data.peers) {
        log('Connecting to peer (peer-list)', peer);
        await connectToPeer(peer, true);
      }
    }
    if (data.type === 'new-peer') {
      log('Connecting to peer (new-peer)', data.name);
      await connectToPeer(data.name, false);
    }
    if (data.type === 'offer') {
      log('Received offer from', data.from);
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
        // Peer connection non ancora pronta: metti in coda
        if (!iceQueue[data.from]) iceQueue[data.from] = [];
        iceQueue[data.from].push(data.candidate);
        console.log("[CALL] ICE candidate QUEUED for", data.from);
      } else {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          console.log("[CALL] ICE candidate ADDED for", data.from);
        } catch (err) {
          console.warn("[CALL] ICE candidate FAILED for", data.from, err);
        }
      }
    }

    if (data.type === 'incoming-call' && data.invite) {
      log('Sei stato invitato a una chiamata!', data);
      // TODO: UI per accetta/rifiuta
    }
    if (data.type === 'participant-left') {
      log('Peer ha lasciato:', data.name);
      closePeer(data.name);
    }
  };

  ws.onclose = (e) => { log('[WS] closed', e); };
  ws.onerror = (err) => { log('[WS] error', err); };
}

// Mesh: ogni nuovo peer = nuova connessione P2P
async function connectToPeer(peerName, isOfferer, remoteOffer = null) {
  if (peerConnections[peerName]) {
    log('Connessione già esistente verso', peerName);
    return;
  }
  log('Nuova RTCPeerConnection verso', peerName, 'isOfferer:', isOfferer);
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peerConnections[peerName] = pc;
  remoteStreams[peerName] = null;
  iceQueue[peerName] = iceQueue[peerName] || [];

  // STATO DIAGNOSTICA
  pc.oniceconnectionstatechange = () => {
    log('ICE state', pc.iceConnectionState, 'con', peerName);
  };
  pc.onconnectionstatechange = () => {
    log('ConnState', pc.connectionState, 'con', peerName);
  };

  pc.onicecandidate = event => {
    if (event.candidate) {
      log('Invio ICE candidate verso', peerName);
      ws.send(JSON.stringify({ type: 'ice', candidate: event.candidate, to: peerName }));
    }
  };

  pc.ontrack = event => {
    console.log("[CALL] ontrack event received", event);
    log('ontrack da', peerName, event.streams);
    let stream = event.streams[0];
    if (!remoteStreams[peerName]) {
      remoteStreams[peerName] = stream;
      let v = document.getElementById('video_' + peerName);
      if (!v) {
        v = document.createElement('video');
        v.id = 'video_' + peerName;
        v.autoplay = true;
        v.playsInline = true;
        v.className = 'remote-video';
        remoteVideos.appendChild(v);
      }
      v.srcObject = stream;
      v.style.display = "block";
      log('Attaccato remote video', peerName);
    }
  };

  // TRACK LOCALE: dev’essere sempre dopo ontrack per evitare race
  await setupLocalStream();
  log('Aggiungo track locali verso', peerName);
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  if (isOfferer) {
    log('Creo offer verso', peerName);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: 'offer', offer, to: peerName }));
      log('Offer spedita a', peerName);
    } catch (err) {
      log('Errore createOffer:', err);
    }
  } else if (remoteOffer) {
    log('Ricevuto offer, imposto remoteDesc verso', peerName);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer || data.answer));
      console.log("[CALL] RemoteDescription set, flushing ICE queue", peerName, iceQueue[peerName]);
      // Dopo che la remoteDescription è settata
      if (iceQueue[peerName]?.length) {
        for (const candidate of iceQueue[peerName]) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
            console.log("[CALL] ICE candidate ADDED from queue for", peerName);
          } catch (err) {
            console.warn("[CALL] ICE candidate from queue FAILED for", peerName, err);
          }
        }
        iceQueue[peerName] = [];
      }
    } catch (err) {
      log('Errore in risposta offer:', err);
    }
  }

  if (iceQueue[peerName].length) {
    log('Processo coda ICE per', peerName, iceQueue[peerName].length, 'candidates');
    for (const candidate of iceQueue[peerName]) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        log('Errore addIceCandidate:', err);
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
