const ipcRenderer = window.electronAPI;

let ws;
let myName = '';
let isOperator = false;
let operatorList = ['Mario Rossi', 'Laura Bianchi', 'Marco Neri', 'Giulia Verdi', 'Antonio Esposito'];
let inactivityTimeout;
const screensaver = document.getElementById("screensaver");
let isInCall = false;

ipcRenderer.on('call-ended', () => {
  isInCall = false;
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
  // ws = new WebSocket('ws://localhost:3000');

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'login', name: myName }));
  };

  ws.onmessage = async (msg) => {
    let data;
    if (typeof msg.data === "string") {
      data = JSON.parse(msg.data);
    } else if (msg.data instanceof Blob) {
      // Blob: convertirlo in testo e poi in JSON
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
      document.getElementById('incomingCallPopup').style.display = 'flex';
      document.getElementById('callerNameText').innerText = `${data.from} ti sta chiamando`;

      document.getElementById('acceptCallBtn').onclick = () => {
        ws.send(JSON.stringify({ type: 'accept', from: data.from, to: myName }));
        ipcRenderer.send('open-call-window', { from: data.from, self: myName });
        document.getElementById('incomingCallPopup').style.display = 'none';
      };

      document.getElementById('rejectCallBtn').onclick = () => {
        ws.send(JSON.stringify({ type: 'reject', from: data.from }));
        document.getElementById('incomingCallPopup').style.display = 'none';
      };
    }

    if (data.type === 'call-rejected') {
      alert(`${data.from} ha rifiutato la chiamata`);
    }

    if (data.type === 'call-accepted') {
      ipcRenderer.send('call-data', { from: data.from, self: myName });
      isInCall = true;
      screensaver.style.display = "none";
    }
  };

  document.getElementById('logoutBtn').onclick = logout;
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('userListView').style.display = 'block';
  document.getElementById('welcomeTitle').innerText = `Benvenuto ${myName}`;
  document.getElementById('logoutBtn').style.display = 'inline-block';
}

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
        ws.send(JSON.stringify({ type: 'call', target: op }));
        ipcRenderer.send('open-call-window', { to: op, self: myName });
      };
      card.appendChild(btn);
    }

    container.appendChild(card);
  });
}

function closeSocket() {
  if (ws) {
    ws.close();
    ws = null;
  }

  setTimeout(() => {
    connectWebSocket();
  }, 500);
}

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