const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');

let mainWindow, callWindow;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: false,
    frame: false,         // Nessuna barra superiore
    kiosk: true,          // Modalità kiosk vera
    fullscreen: true,     // (opzionale, per massima compatibilità)
    alwaysOnTop: true,    // Non va mai dietro altre app
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,           // ✅ necessario per contextBridge
      nodeIntegration: false,           // ✅ più sicuro con preload
      enableRemoteModule: false
    }
  });

  //mainWindow.webContents.openDevTools();  // Facoltativo per debug
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createMainWindow();

  globalShortcut.register('Alt+F4', () => { /* NOP */ });
  globalShortcut.register('CommandOrControl+W', () => { /* NOP */ });
  globalShortcut.register('CommandOrControl+Q', () => { /* NOP */ });
  globalShortcut.register('CommandOrControl+Shift+Esc', () => { /* NOP */ });
  globalShortcut.register('F11', () => { /* NOP */ });

  ipcMain.on('call-data', (event, data) => {
    //createCallWindow(data);
  });

  ipcMain.on('open-call-window', (event, callData) => {
    if (callWindow) {
      callWindow.focus();
      return;
    }

    callWindow = new BrowserWindow({
      fullscreen: true,
      frame: false,         // Nessuna barra superiore
      kiosk: true,          // Modalità kiosk vera
      fullscreen: true,     // (opzionale, per massima compatibilità)
      alwaysOnTop: true,    // Non va mai dietro altre app
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        enableRemoteModule: false
      }
    });

    callWindow.loadFile(path.join(__dirname, 'callWindow.html'));
    callWindow.webContents.once('did-finish-load', () => {
      callWindow.webContents.send('call-data', callData);
      // callWindow.webContents.openDevTools();
    });

    callWindow.on('closed', () => {
      callWindow = null;
      if (mainWindow) {
        mainWindow.webContents.send('call-ended');
      }
    });
  });

  ipcMain.on('end-call', () => {
    if (callWindow) callWindow.close();
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('close-call-window', () => {
  if (callWindow) {
    callWindow.close();
    callWindow = null;
    mainWindow?.webContents.send('call-ended');
  }
});

ipcMain.on('exit-kiosk', () => {
  if (mainWindow) {
    mainWindow.close();
    mainWindow = null;
  }
  if (callWindow) {
    callWindow.close();
    callWindow = null;
  }
});
