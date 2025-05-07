const { ipcRenderer } = require('electron');

let pc;
let localStream;
let remoteVideo = document.getElementById('remoteVideo');
let localVideo = document.getElementById('localVideo');
let callStatus = document.getElementById('callStatus');
let endCallBtn = document.getElementById('endCallBtn');

let myName = '';
let otherUser = '';
let ws;

ipcRenderer.on('call-data', (event, data) => {
  myName = data.self;
  otherUser = data.to || data.from;
  const isCaller = !!data.to;

  ws = new WebSocket('wss://0912-79-3-219-198.ngrok-free.appp');
  //ws = new WebSocket('ws://localhost:3000');

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'login', name: myName }));

    if (isCaller) {
      startCall(true);  // il chiamante inizia con l'offerta
    } else {
      startCall(false); // il ricevente prepara la connessione e aspetta l'offerta
    }
  };

  ws.onmessage = async (msg) => {
    const data = JSON.parse(msg.data);

    switch (data.type) {
      case 'offer':
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'answer', answer, to: data.from }));
        callStatus.innerText = '';
        break;

      case 'answer':
        console.log("✅ Answer ricevuta da:", data.from);
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        callStatus.innerText = '';
        break;

      case 'ice':
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        break;
    }
  };
});

async function startCall(isCaller) {
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all',
    // Migliora compatibilità evitando binding falliti
    // preferisci magari "relay" se metti un TURN
  });

  pc.onicecandidate = event => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: 'ice', candidate: event.candidate, to: otherUser }));
    }
  };

  pc.ontrack = event => {

    console.log('MIRKOOO')
    console.log(event.streams[0])

    remoteVideo.srcObject = event.streams[0];
    callStatus.innerText = '';
  };

  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  
  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'offer', offer, to: otherUser }));
  }
}

endCallBtn.onclick = endCall;

window.onbeforeunload = () => {
  endCall();
};

function endCall() {
  if (pc) pc.close();
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }
  if (ws) ws.send(JSON.stringify({ type: 'bye' }));
}