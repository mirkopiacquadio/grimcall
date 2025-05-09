const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow, callWindow;

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
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
  callWindow.loadFile('callWindow.html');
  callWindow.webContents.once('did-finish-load', () => {
    callWindow.webContents.send('call-data', data);
    callWindow.webContents.openDevTools();
  });

  callWindow.on('close', () => {
    callWindow.webContents.send('force-end-call');
  });
}

app.whenReady().then(() => {
  createMainWindow();

  ipcMain.on('call-data', (event, data) => {
    createCallWindow(data);
  });

  ipcMain.on('open-call-window', (event, callData) => {
    const callWin = new BrowserWindow({
      fullscreen: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: true,
        contextIsolation: false
      }
    });
  
    callWin.loadFile(path.join(__dirname, 'callWindow.html'));
    callWin.webContents.once('did-finish-load', () => {
      callWin.webContents.send('call-data', callData);
      callWin.webContents.openDevTools();
    });
  
    callWin.on('closed', () => {
      callWin = null;
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
