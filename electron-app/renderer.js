const ipcRenderer = window.electronAPI;

let ws;
let myName = '';
let isOperator = false;
let operatorList = [
  'GRIM 1',
  'GRIM 2'
];
let inactivityTimeout;
const screensaver = document.getElementById("screensaver");
let isInCall = false;
let currentRoomId = null;
let incomingCallAudioLoopTimer = null;
let incomingCallAudioLoopStart = 0;
const incomingCallAudio = document.getElementById('incomingCallAudio');

ipcRenderer.on('call-ended', () => {
  isInCall = false;
  currentRoomId = null;
  if (!isOperator) document.getElementById("logoutBtn").click();
  else {
    loginAsOperator();
  }
  resetInactivityTimer();
});

document.getElementById('operatorLoginBtn').onclick = () => {
  const form = document.getElementById('operatorForm');
  const operatorLoginBtn = document.getElementById('operatorLoginBtn');

  form.style.display = form.style.display === 'none' ? 'block' : 'none';

  if (form.style.display === 'none') {
    operatorLoginBtn.style.display = 'none';
  }
};

function resetInactivityTimer() {
  clearTimeout(inactivityTimeout);
  if (!isInCall) {
    screensaver.style.display = "none";
    inactivityTimeout = setTimeout(() => {
      screensaver.style.display = "block";
    }, 100000);
  }
}
['keydown', 'click', 'touchstart'].forEach(evt =>
  window.addEventListener(evt, resetInactivityTimer)
);
resetInactivityTimer();

function loginAsOperator() {
  const name = document.getElementById('operatorNameInput').value.trim();
  if (!name) return alert("Inserisci il tuo nome");
  myName = name;
  isOperator = true;
  connectWebSocket();
}

function loginAsGuest() {
  myName = 'Guest-' + Math.floor(Math.random() * 1000);
  isOperator = false;
  connectWebSocket();
}

function logout() {
  if (ws) {
    ws.close();
    ws = null;
  }
  myName = '';
  isOperator = false;
  document.getElementById('userListView').style.display = 'none';
  document.getElementById('loginView').style.display = 'block';
  document.getElementById('operatorForm').style.display = 'none';
  document.getElementById('logoutBtn').style.display = 'none';
}

function connectWebSocket() {
  ws = new WebSocket('wss://heroic-discrete-caribou.ngrok-free.app');
  // ws = new WebSocket('ws://81.28.10.87:3000');

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'login', name: myName }));
  };

  ws.onmessage = async (msg) => {
    let data;
    console.log('[SIGNAL] redender.js onmessage', data);
    if (typeof msg.data === "string") {
      data = JSON.parse(msg.data);
    } else if (msg.data instanceof Blob) {
      const text = await msg.data.text();
      data = JSON.parse(text);
    } else {
      console.error("Tipo di messaggio WebSocket non gestito:", msg.data);
      return;
    }

    if (data.type === 'userlist') {
      renderOperators(data.users);
    }

    if (data.type === 'queued') {
      alert('⏳ Attendi: tutti gli operatori sono occupati. Sarai contattato non appena uno si libera.');
    }

    if (data.type === 'incoming-call' && isOperator) {
      playIncomingCallAudioLoop();
      console.log('Ricevuta chiamata in arrivo:', data);
      document.getElementById('incomingCallPopup').style.display = 'flex';
      document.getElementById('callerNameText').innerText = `${data.from} ti sta chiamando`;

      document.getElementById('acceptCallBtn').onclick = () => {
        stopIncomingCallAudio();
        // 1. Apre la callWindow, anche qui serve passare la roomId
        ipcRenderer.send('open-call-window', { from: data.from, self: myName, roomId: data.room, isOperator: isOperator });

        // 2. Manda il join!
        ws.send(JSON.stringify({ type: 'join', name: myName, room: data.room }));

        document.getElementById('incomingCallPopup').style.display = 'none';
      };

      document.getElementById('rejectCallBtn').onclick = () => {
        stopIncomingCallAudio();
        ws.send(JSON.stringify({ type: 'reject', from: data.from }));
        document.getElementById('incomingCallPopup').style.display = 'none';
      };
    }

    if (data.type === 'call-rejected') {
      alert(`${data.from} ha rifiutato la chiamata`);
      ipcRenderer.send('force-end-call');
    }

    if (data.type === 'call-accepted') {
      // Non serve più: usiamo solo roomId/join per mesh
    }
  };

  document.getElementById('logoutBtn').onclick = logout;
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('userListView').style.display = 'block';
  document.getElementById('welcomeTitle').innerText = `Benvenuto ${myName}`;
  document.getElementById('logoutBtn').style.display = 'inline-block';
}

// Semplice utilità per generare un roomId unico da due nomi
function generateRoomIdFromNames(a, b) {
  return [a, b].sort().join('_');
}

// QUI LA LOGICA PER LANCIARE LA CHIAMATA come guest (o operator su altro operator!)
function renderOperators(usersOnline) {
  const container = document.getElementById('operatorList');
  container.innerHTML = '';

  operatorList.forEach(op => {
    if (op === myName) return;

    const isAvailable = usersOnline.find(u => u.name === op && u.available);

    const card = document.createElement('div');
    card.className = 'user-card';

    const img = document.createElement('img');
    img.src = './image.png';
    card.appendChild(img);

    const name = document.createElement('div');
    name.className = 'user-name';
    name.innerText = op;
    card.appendChild(name);

    const status = document.createElement('div');
    status.className = isAvailable ? 'user-status available' : 'user-status unavailable';
    status.innerText = isAvailable ? 'Disponibile' : 'Non disponibile';
    card.appendChild(status);

    if (isAvailable && !isOperator) {
      const btn = document.createElement('button');
      btn.innerText = 'Chiama';
      btn.onclick = () => {
        // 1. Invia la richiesta di chiamata (NOTIFICA popup operatore)
        currentRoomId = generateRoomIdFromNames(myName, op);
        ws.send(JSON.stringify({ type: 'call', target: op }));
        // 2. Subito dopo, apri la finestra di chiamata e fai join nella room
        ipcRenderer.send('open-call-window', { self: myName, roomId: currentRoomId, isOperator: false });
        isInCall = true;
      };
      card.appendChild(btn);
    }

    container.appendChild(card);
  });
}


// Kiosk: easter egg per uscire
const welcomeTitle = document.getElementById("grimTitle");
let welcomeClickCount = 0;
welcomeTitle.onclick = () => {
  welcomeClickCount++;
  console.log(`👆 Click su Benvenuto: ${welcomeClickCount} / 15`);
  if (welcomeClickCount >= 15) {
    ipcRenderer.send("exit-kiosk");
    welcomeClickCount = 0;
    console.log("🚪 Uscita dalla modalità kiosk richiesta!");
  }
};

function stopIncomingCallAudio() {
  if (incomingCallAudio) {
    incomingCallAudio.pause();
    incomingCallAudio.currentTime = 0;
    incomingCallAudio.onended = null;
  }
  if (incomingCallAudioLoopTimer) {
    clearTimeout(incomingCallAudioLoopTimer);
    incomingCallAudioLoopTimer = null;
  }
}

function playIncomingCallAudioLoop() {
  if (!incomingCallAudio) return;
  stopIncomingCallAudio(); // ferma ogni loop precedente

  incomingCallAudioLoopStart = Date.now();
  // Handler alla fine dell’audio
  incomingCallAudio.onended = function () {
    if (!incomingCallAudioLoopTimer) return; // già stoppato
    // Se sono passati meno di 60s riparti, altrimenti stop
    if (Date.now() - incomingCallAudioLoopStart < 60000) {
      incomingCallAudio.currentTime = 0;
      incomingCallAudio.play().catch(() => { });
    } else {
      stopIncomingCallAudio();
    }
  };

  // Prima riproduzione
  incomingCallAudio.currentTime = 0;
  incomingCallAudio.play().catch(() => { });

  // Timer di emergenza, dopo 60s stop
  incomingCallAudioLoopTimer = setTimeout(() => {
    stopIncomingCallAudio();
  }, 60000);
}