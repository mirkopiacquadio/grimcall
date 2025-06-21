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
  roomId = data.roomId;
  await setupLocalStream();
  setupWebSocket();
});

async function setupLocalStream() {
  if (localStream) return;
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
}

function setupWebSocket() {
  ws = new WebSocket('wss://heroic-discrete-caribou.ngrok-free.app');
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'login', name: myName }));
    // Per compatibilità: la stanza (roomId) deve arrivare!
    ws.send(JSON.stringify({ type: 'join', name: myName, room: roomId }));
  };

  ws.onmessage = async (msg) => {
    let data;
    try { data = JSON.parse(msg.data); } catch (err) { return; }
    if (data.type === 'incoming-call' && data.room) {
      roomId = data.room;
      ws.send(JSON.stringify({ type: 'join', name: myName, room: roomId }));
    }
    if (data.type === 'peer-list') {
      for (const peer of data.peers) {
        await connectToPeer(peer, true); // mesh: offerta verso chi c’è già
      }
    }
    if (data.type === 'new-peer') {
      // È entrato qualcun altro dopo: attendi la sua offer (lui fa offer a te)
    }
    if (data.type === 'offer') {
      await connectToPeer(data.from, false, data.offer);
    }
    if (data.type === 'answer') {
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
      closePeer(data.name);
    }
  };

  ws.onclose = () => { };
  ws.onerror = (err) => { console.error('[WS] error', err); };
}

async function connectToPeer(peerName, isOfferer, remoteOffer = null) {
  if (peerConnections[peerName]) return;
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peerConnections[peerName] = pc;
  remoteStreams[peerName] = null;
  iceQueue[peerName] = iceQueue[peerName] || [];

  pc.onicecandidate = event => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: 'ice', candidate: event.candidate, to: peerName, from: myName }));
    }
  };

  pc.ontrack = event => {
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

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  if (isOfferer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'offer', offer, to: peerName, from: myName }));
  } else if (remoteOffer) {
    await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', answer, to: peerName, from: myName }));
  }

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