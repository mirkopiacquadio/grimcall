const ipcRenderer = window.electronAPI;

let myName = '';
let roomId = '';
let ws;
let localStream;
let peerConnections = {}; // { peerName: RTCPeerConnection }
let remoteStreams = {};   // { peerName: MediaStream }
let iceQueue = {};        // { peerName: [candidate, ...] }
let peers = {};           // Per la dropdown, tiene traccia dei peer

const localVideo = document.getElementById('localVideo');
const remoteVideos = document.getElementById('remoteVideos') || makeRemoteVideosContainer();
const callStatus = document.getElementById('callStatus');
const endCallBtn = document.getElementById('endCallBtn');

// Dropdown utenti disponibili
window.requestAvailableUsersForDropdown = () => {
  if (window.lastUserList) {
    const alreadyInCall = Object.keys(peers);
    const filtered = window.lastUserList.filter(
      name => !alreadyInCall.includes(name) && name !== myName
    );
    window.setAvailableUsersForDropdown(filtered);
  } else {
    window.setAvailableUsersForDropdown([]);
  }
};

window.addParticipantToCall = (username) => {
  ws.send(JSON.stringify({ type: 'invite', to: username, room: roomId }));
};

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

ipcRenderer.on('call-data', async (event, data) => {
  myName = data.self;
  roomId = data.roomId || 'room-default';
  await setupLocalStream();
  setupWebSocket();
});

function setupWebSocket() {
  ws = new WebSocket('wss://heroic-discrete-caribou.ngrok-free.app');

  ws.onopen = () => {
    console.log('[WS] OPEN! Faccio JOIN');
    ws.send(JSON.stringify({ type: 'join', name: myName, room: roomId }));
  };

  ws.onmessage = async (e) => {
    console.log('[WS] RAW onmessage:', e.data);
    let data;
    try { data = JSON.parse(e.data); }
    catch (err) { console.error('[WS] JSON PARSE ERROR', err, e.data); return; }

    console.log('[SIGNAL] onmessage', data);

    if (data.type === 'peer-list') {
      // SOLO chi entra dopo fa OFFER!
      for (const peer of data.peers) {
        peers[peer] = true;
        await connectToPeer(peer, true);
        console.log(`[SIGNAL] Faccio OFFER a ${peer} (peer-list)`);
      }
    }
    if (data.type === 'new-peer') {
      // Aggiorna lista, non fare OFFER
      peers[data.name] = true;
      console.log(`[SIGNAL] È entrato ${data.name}, attendo la sua OFFER`);
    }
    if (data.type === 'offer') {
      peers[data.from] = true;
      console.log(`[SIGNAL] Ricevuta OFFER da ${data.from}`);
      await connectToPeer(data.from, false, data.offer);
    }
    if (data.type === 'answer') {
      peers[data.from] = true;
      console.log(`[SIGNAL] Ricevuta ANSWER da ${data.from}`);
      await peerConnections[data.from]?.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
    if (data.type === 'ice') {
      if (!peerConnections[data.from]) {
        if (!iceQueue[data.from]) iceQueue[data.from] = [];
        iceQueue[data.from].push(data.candidate);
      } else {
        await peerConnections[data.from].addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    }
    if (data.type === 'peer-left') {
      delete peers[data.name];
      closePeer(data.name);
    }
  };

  ws.onclose = () => { console.log('[WS] closed'); };
  ws.onerror = (err) => { console.error('[WS] error', err); };
}

async function setupLocalStream() {
  if (localStream) {
    console.log("[MEDIA] localStream già esistente:", localStream);
    return;
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    console.log(`[MEDIA] localStream ottenuto OK:`, localStream);
  } catch (err) {
    console.error("Errore accesso webcam/microfono", err);
    alert("Errore accesso webcam/microfono: " + err.message);
    throw err;
  }
}

async function connectToPeer(peerName, isOfferer, remoteOffer = null) {
  console.log(`[PEER] connectToPeer: peerName=${peerName}, isOfferer=${isOfferer}, myName=${myName}, roomId=${roomId}`);
  if (peerConnections[peerName]) {
    console.log(`[PEER] Già connesso a ${peerName}, ignoro`);
    return;
  }

  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peerConnections[peerName] = pc;
  remoteStreams[peerName] = null;
  iceQueue[peerName] = iceQueue[peerName] || [];

  pc.onicecandidate = event => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: 'ice', candidate: event.candidate, to: peerName }));
    }
  };

  pc.ontrack = event => {
    console.log(`[TRACK] Ricevuto track da ${peerName}`, event);
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
    }
  };

  await setupLocalStream();
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  if (isOfferer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'offer', offer, to: peerName }));
  } else if (remoteOffer) {
    await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', answer, to: peerName }));
  }

  // Se avevi ICE in coda
  if (iceQueue[peerName].length) {
    for (const candidate of iceQueue[peerName]) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
    iceQueue[peerName] = [];
  }
}

function closePeer(peerName) {
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
    ws.send(JSON.stringify({ type: 'leave' }));
    ws.close();
    Object.keys(peerConnections).forEach(closePeer);
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    ipcRenderer.send('call-ended');
    ipcRenderer.send('close-call-window');
  };
}

ipcRenderer.on('force-end-call', () => {
  ws.send(JSON.stringify({ type: 'leave' }));
  ws.close();
  Object.keys(peerConnections).forEach(closePeer);
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  ipcRenderer.send('call-ended');
  ipcRenderer.send('close-call-window');
});
