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

// In callRenderer.js
// Elenco utenti connessi ma NON già in chiamata
window.requestAvailableUsersForDropdown = () => {
  // In un caso reale, qui dovresti avere una lista di utenti disponibili, esclusi quelli già in roomId
  // Esempio banale: 
  // window.setAvailableUsersForDropdown(["Laura Bianchi", "Marco Neri"]);
  // In un'app vera: aggiorna da WebSocket/userlist!

  // Placeholder: metti qui la logica per popolare la lista giusta!
  if (window.lastUserList) {
    // Esempio: filtra chi non è già nella chiamata
    const alreadyInCall = Object.keys(peers); // peers dev'essere globale in mesh
    const filtered = window.lastUserList.filter(
      name => !alreadyInCall.includes(name) && name !== myName
    );
    window.setAvailableUsersForDropdown(filtered);
  } else {
    window.setAvailableUsersForDropdown([]);
  }
};

// Handler che avvia la finestra per l’utente scelto
window.addParticipantToCall = (username) => {
  // Invii segnale al main process per aprire la finestra anche su quell’utente
  // (ad esempio, tramite WebSocket: invii un "invite" con roomId e username)
  ws.send(JSON.stringify({ type: 'invite', to: username, room: currentRoomId }));
};


// Utility per creare dinamicamente il container se non esiste
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

// 1. Ingresso dati chiamata
ipcRenderer.on('call-data', async (event, data) => {
  myName = data.self;
  roomId = data.roomId || 'room-default';
  await setupLocalStream();
  setupWebSocket(); // Non serve await qui!
});

// 2. Setup media
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

// 3. Signaling WebSocket
async function setupWebSocket() {
  ws = new WebSocket('wss://heroic-discrete-caribou.ngrok-free.app');
  ws.onopen = () => {
    console.log('[WS] OPEN! Faccio JOIN');
    ws.send(JSON.stringify({ type: 'join', name: myName, room: roomId }));
  };

  ws.onmessage = async e => {
    const data = JSON.parse(e.data);
    console.log('[SIGNAL] onmessage', data);
    // ...resto come già scritto...
  };

  ws.onclose = () => { console.log('[WS] closed'); };
  ws.onerror = (err) => { console.error('[WS] error', err); };
}

// 4. Connessione a un altro peer
async function connectToPeer(peerName, isOfferer, remoteOffer = null) {
  console.log(`[PEER] connectToPeer: peerName=${peerName}, isOfferer=${isOfferer}, myName=${myName}, roomId=${roomId}`);
  if (peerConnections[peerName]) {
    console.log(`[PEER] Già connesso a ${peerName}, ignoro`);
    return;
  }
  if (peerConnections[peerName]) return; // già connesso

  // Crea peerConnection
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


// 5. Chiusura peer (utente uscito)
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

// 6. Fine chiamata/chiusura
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

// (Optional) Gestione chiusura forzata
ipcRenderer.on('force-end-call', () => {
  ws.send(JSON.stringify({ type: 'leave' }));
  ws.close();
  Object.keys(peerConnections).forEach(closePeer);
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  ipcRenderer.send('call-ended');
  ipcRenderer.send('close-call-window');
});
