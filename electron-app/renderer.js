const { ipcRenderer } = require('electron');

let ws;
let myName = '';
let isOperator = false;
let operatorList = ['Mario Rossi', 'Laura Bianchi', 'Marco Neri', 'Giulia Verdi', 'Antonio Esposito'];

document.getElementById('operatorLoginBtn').onclick = () => {
  const form = document.getElementById('operatorForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
};


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
 // ws = new WebSocket_('ws://79.3.219.198:3000');
  ws = new WebSocket('wss://fa80-79-3-219-198.ngrok-free.app');
  // ws = new WebSocket('ws://localhost:3000');

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'login', name: myName }));
  };

  ws.onmessage = msg => {
    const data = JSON.parse(msg.data);

    if (data.type === 'userlist') {
      renderOperators(data.users);
    }

    if (data.type === 'incoming-call' && isOperator) {
      document.getElementById('incomingCallPopup').style.display = 'flex';
      document.getElementById('callerNameText').innerText = `${data.from} ti sta chiamando`;
    
      document.getElementById('acceptCallBtn').onclick = () => {
        console.log('TESTAAAA')
        console.log(data.from)
        console.log(myName)
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
      console.log('TEST')
      ipcRenderer.send('call-data', { from: data.from, self: myName });
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
    // 🔒 Escludi l’utente attualmente loggato
    if (op === myName) return;

    const isAvailable = usersOnline.find(u => u.name === op && u.available);

    const card = document.createElement('div');
    card.className = 'user-card';

    const img = document.createElement('img');
    img.src = './image.png'; // avatar placeholder
    card.appendChild(img);

    const name = document.createElement('div');
    name.className = 'user-name';
    name.innerText = op;
    card.appendChild(name);

    const status = document.createElement('div');
    status.className = isAvailable ? 'user-status available' : 'user-status unavailable';
    status.innerText = isAvailable ? 'Disponibile' : 'Non disponibile';
    card.appendChild(status);

    // 🟢 Aggiungi bottone “Chiama” solo se disponibile e non sei tu
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


module.exports = { myName, ws };
