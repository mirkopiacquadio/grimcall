const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow, callWindow;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    kiosk: false,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function createCallWindow(data) {
  let callWindow = new BrowserWindow({
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  callWindow.loadFile(path.join(__dirname, 'callWindow.html'));

  callWindow.webContents.once('did-finish-load', () => {
    callWindow.webContents.send('call-data', data);
    callWindow.webContents.openDevTools();
  });

  callWindow.on('close', () => {
    callWindow = null;
  });
}

app.whenReady().then(() => {
  createMainWindow();

  ipcMain.on('call-data', (event, data) => {
    createCallWindow(data);
  });

  ipcMain.on('open-call-window', (event, callData) => {
    if (callWindow) {
      callWindow.focus();
      return;
    }

    callWindow = new BrowserWindow({
      fullscreen: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    callWindow.loadFile(path.join(__dirname, 'callWindow.html'));
    callWindow.webContents.once('did-finish-load', () => {
      callWindow.webContents.send('call-data', callData);
      // callWindow.webContents.openDevTools();
    });

    callWindow.on('closed', () => {
      callWindow = null;
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
