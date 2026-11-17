const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const TARGET_URL = `http://${HOST}:${PORT}`;

let serverProcess = null;
let mainWindow = null;

function waitForServer(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`${url}/api/health`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for Solana Spot Bot server at ${url}`));
        return;
      }
      setTimeout(check, 300);
    };

    check();
  });
}

function startBackendServer() {
  const rootDir = path.resolve(__dirname, '..');
  const tsxBin = process.platform === 'win32'
    ? path.join(rootDir, 'node_modules', '.bin', 'tsx.cmd')
    : path.join(rootDir, 'node_modules', '.bin', 'tsx');

  serverProcess = spawn(tsxBin, ['server.ts'], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST,
      PORT: String(PORT),
      NODE_ENV: process.env.NODE_ENV || 'production',
    },
    stdio: 'inherit',
  });

  serverProcess.on('exit', (code) => {
    serverProcess = null;
    if (code !== null && code !== 0 && !app.isQuitting) {
      console.error(`[Electron] Server exited unexpectedly with code ${code}`);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: 'Solana Spot Bot — Safety-First Terminal',
    backgroundColor: '#0A0D12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.loadURL(TARGET_URL);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  startBackendServer();
  try {
    await waitForServer(TARGET_URL);
  } catch (err) {
    console.error('[Electron] Failed to connect to local server:', err);
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
