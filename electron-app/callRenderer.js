const { ipcRenderer } = require('electron');

let pc;
let localStream;
const remoteVideo = document.getElementById('remoteVideo');
const localVideo = document.getElementById('localVideo');
const callStatus = document.getElementById('callStatus');
const endCallBtn = document.getElementById('endCallBtn');

let myName = '';
let otherUser = '';
let ws;
let isCaller = false;
let iceQueue = [];
let pcReady = false;


ipcRenderer.on('call-data', (event, data) => {
  myName = data.self;
  otherUser = data.to || data.from;
  isCaller = !!data.to;
  
  ws = new WebSocket('wss://f0ad-79-3-219-198.ngrok-free.app');
  // ws = new WebSocket('ws://localhost:3000');

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'login', name: myName }));
    //startCall();
    if (isCaller) {
      ws.send(JSON.stringify({ type: 'call', target: otherUser }));
    }
  };

  ws.onmessage = async (msg) => {
    const data = JSON.parse(msg.data);

    switch (data.type) {
      case 'call-accepted':
        console.log('📞 Chiamata accettata, avvio la connessione WebRTC...');
        startCall();
        break;
      case 'offer':
        console.log("📩 Ricevuta offer da:", data.from);

        // 👉 Inizializza subito la connessione!
        if (!pc) {
          pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
          });

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              console.log("📤 Inviando ICE...");
              ws.send(JSON.stringify({ type: 'ice', candidate: event.candidate, to: data.from }));
            }
          };

          pc.ontrack = (event) => {
            console.log('🎥 Ricevuto flusso remoto:', event.streams);
            if (event.streams && event.streams[0]) {
              remoteVideo.srcObject = event.streams[0];
            }
            callStatus.innerText = '';
          };
        }

        await ensureLocalStream(); // ✅ Ora pc esiste!
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        processIceQueue();

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'answer', answer, to: data.from }));
        break;

      case 'answer':
        console.log("✅ Answer ricevuta da:", data.from);
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        pcReady = true;
        processIceQueue();
        break;

      case 'ice':
        if (data.candidate) {
          console.log("❄️ ICE candidate ricevuto");
          if (pc && pcRemoteDescriptionSet()) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } else {
            iceQueue.push(data.candidate);
          }
        }
        break;
    }
  };
});

async function startCall() {
  console.log("🚀 Avvio chiamata. Caller?", isCaller);

  // pc = new RTCPeerConnection({
  //   iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    
  // });
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ],
    iceTransportPolicy: 'relay' // ✅ Questo forza l'uso del TURN
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("📤 Inviando ICE...");
      ws.send(JSON.stringify({ type: 'ice', candidate: event.candidate, to: otherUser }));
    }
  };

  pc.ontrack = (event) => {
    console.log('🎥 Ricevuto flusso remoto:', event.streams);
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    }
    callStatus.innerText = '';
  };

  await ensureLocalStream();

  if (isCaller) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      pcReady = true;
      processIceQueue();
      ws.send(JSON.stringify({ type: 'offer', offer, to: otherUser }));
    } catch (err) {
      console.error("❌ Errore creazione offerta:", err);
    }
  }
}

async function ensureLocalStream() {
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    } catch (err) {
      console.error("🎙️ Errore accesso dispositivi locali:", err);
    }
  }
}

endCallBtn.onclick = () => {
  ipcRenderer.send('close-call-window');
};

ipcRenderer.on('force-end-call', () => {
  endCall();
});

function endCall() {
  if (pc) {
    pc.close();
    pc = null; // ✅ Importante per forzare la creazione di una nuova connessione
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null; // ✅ Rilascia il flusso locale
  }
  if (ws) {
    ws.send(JSON.stringify({ type: 'bye' }));
    ws.close();
    ws = null; // ✅ Chiudi la WebSocket e rimuovi il riferimento
  }
}

function pcRemoteDescriptionSet() {
  return pc && pc.remoteDescription && pc.remoteDescription.type;
}

async function processIceQueue() {
  while (iceQueue.length && pcRemoteDescriptionSet()) {
    const candidate = iceQueue.shift();
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error("Errore nell'aggiungere ICE Candidate:", err);
    }
  }
}
