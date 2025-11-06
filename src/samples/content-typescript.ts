export const typescriptContent = `
const { app, BrowserWindow } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';

let mainWindow;

function createWindow() {
mainWindow = new BrowserWindow({
width: 900,
height: 680,
webPreferences: {
nodeIntegration: true,
contextIsolation: false
}
});

const url = isDev
? 'http://localhost:5173'
: \`file://\${path.join(__dirname, '../dist/index.html')}\`;

mainWindow.loadURL(url);

if (isDev) {
mainWindow.webContents.openDevTools();
}

mainWindow.on('closed', () => {
mainWindow = null;
});
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
if (process.platform !== 'darwin') {
app.quit();
}
});

app.on('activate', () => {
if (mainWindow === null) {
createWindow();
}
});

app.on('window-all-closed', () => {
if (process.platform !== 'darwin') {
app.quit();
}
});

app.on('activate', () => {
if (mainWindow === null) {
createWindow();
}
});

app.on('window-all-closed', () => {
if (process.platform !== 'darwin') {
app.quit();
}
});

app.on('activate', () => {
if (mainWindow === null) {
createWindow();
}
});
const a = 1;
`

// For the playground we also expose this as `vueContent` to stream under the Vue label
export const vueContent = typescriptContent
