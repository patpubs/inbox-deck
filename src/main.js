const path = require('node:path');
const {
  app, BrowserWindow, WebContentsView, ipcMain, Menu, shell, session, dialog, clipboard,
} = require('electron');
const {
  GMAIL_URL, parseGmailTitle, cleanUserAgent, classifyLink, isGoogleHost, initials, AccountStore,
} = require('./lib');

const SIDEBAR_WIDTH = 76;
const IS_MAC = process.platform === 'darwin';
const SLEEP_OPTIONS = [0, 15, 30, 60, 120];

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let store = null;
let overlay = false; // true while the sidebar shows a full-window dialog
// account id -> { view, unread, lastActive }
const live = new Map();

const partitionFor = (id) => `persist:acct-${id}`;
const userAgent = () => cleanUserAgent(app.userAgentFallback);

// Gmail's desktop notifications don't say which account they came from, so
// wrap the page's Notification class and report clicks back through the console.
const NOTIFY_CLICK = '__inbox_deck_notification_click__';
const NOTIFY_HOOK = `(() => {
  if (window.__inboxDeckHooked || !window.Notification) return;
  window.__inboxDeckHooked = true;
  const Native = window.Notification;
  class Wrapped extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener('click', () => console.debug('${NOTIFY_CLICK}'));
    }
  }
  Object.defineProperty(Wrapped, 'permission', { get: () => Native.permission });
  Wrapped.requestPermission = (...a) => Native.requestPermission(...a);
  window.Notification = Wrapped;
})();`;

// ---------- account sessions ----------

function setupSession(id) {
  const ses = session.fromPartition(partitionFor(id));
  ses.setUserAgent(userAgent());
  const allowed = new Set(['notifications', 'clipboard-sanitized-write', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  return ses;
}

function guardWebContents(wc, id) {
  wc.setUserAgent(userAgent());

  wc.setWindowOpenHandler(({ url }) => {
    const kind = classifyLink(url);
    if (kind === 'popup') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 960,
          height: 760,
          autoHideMenuBar: true,
          webPreferences: { partition: partitionFor(id), contextIsolation: true, sandbox: true },
        },
      };
    }
    if (kind === 'external') shell.openExternal(url);
    return { action: 'deny' };
  });

  // Pop-outs get the same rules as the main tab.
  wc.on('did-create-window', (child) => guardWebContents(child.webContents, id));

  wc.on('will-navigate', (event, url) => {
    if (!isGoogleHost(url)) {
      event.preventDefault();
      if (classifyLink(url) === 'external') shell.openExternal(url);
    }
  });

  wc.on('context-menu', (_e, params) => buildPageMenu(wc, params).popup());
}

function createView(account) {
  setupSession(account.id);
  const view = new WebContentsView({
    webPreferences: {
      partition: partitionFor(account.id),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  const wc = view.webContents;
  guardWebContents(wc, account.id);

  wc.on('page-title-updated', (_e, title) => {
    const { unread, email } = parseGmailTitle(title);
    const entry = live.get(account.id);
    if (entry && unread !== null) entry.unread = unread;
    if (email && account.email !== email) store.update(account.id, { email });
    pushState();
  });

  wc.on('dom-ready', () => wc.executeJavaScript(NOTIFY_HOOK).catch(() => {}));
  wc.on('console-message', (event) => {
    if (event.message !== NOTIFY_CLICK || !win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    selectAccount(account.id);
  });

  view.setVisible(false);
  win.contentView.addChildView(view);
  wc.loadURL(GMAIL_URL);
  live.set(account.id, { view, unread: live.get(account.id)?.unread ?? 0, lastActive: Date.now() });
  layout();
  return view;
}

function sleepAccount(id) {
  const entry = live.get(id);
  if (!entry || !entry.view) return;
  win.contentView.removeChildView(entry.view);
  entry.view.webContents.close();
  entry.view = null;
  pushState();
}

function wakeAccount(id) {
  const account = store.find(id);
  const entry = live.get(id);
  if (!account || (entry && entry.view)) return;
  createView(account);
}

async function removeAccount(id) {
  const account = store.find(id);
  if (!account) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Remove', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Remove "${account.label}"?`,
    detail: 'This signs the account out of Inbox Deck and deletes its saved session. Your email is not affected.',
  });
  if (response !== 0) return;
  sleepAccount(id);
  live.delete(id);
  await session.fromPartition(partitionFor(id)).clearStorageData();
  store.remove(id);
  selectAccount(store.data.activeId);
}

// ---------- window and layout ----------

function layout() {
  if (!win) return;
  const [width, height] = win.getContentSize();
  const bounds = { x: SIDEBAR_WIDTH, y: 0, width: Math.max(0, width - SIDEBAR_WIDTH), height };
  for (const [id, entry] of live) {
    if (!entry.view) continue;
    entry.view.setBounds(bounds);
    entry.view.setVisible(!overlay && id === store.data.activeId);
  }
}

function selectAccount(id) {
  if (!id || !store.find(id)) {
    store.setActive(null);
  } else {
    store.setActive(id);
    wakeAccount(id);
    const entry = live.get(id);
    entry.lastActive = Date.now();
    if (!overlay) entry.view.webContents.focus();
  }
  layout();
  pushState();
}

function cycle(delta) {
  const list = store.accounts;
  if (list.length === 0) return;
  const i = list.findIndex((a) => a.id === store.data.activeId);
  selectAccount(list[(i + delta + list.length) % list.length].id);
}

function activeWebContents() {
  return live.get(store.data.activeId)?.view?.webContents ?? null;
}

function pushState() {
  if (!win) return;
  let total = 0;
  const accounts = store.accounts.map((a) => {
    const entry = live.get(a.id);
    const unread = entry?.unread ?? 0;
    total += unread;
    return {
      id: a.id,
      label: a.label,
      email: a.email,
      color: a.color,
      initials: initials(a.label),
      unread,
      sleeping: !entry?.view,
    };
  });
  win.webContents.send('state', { accounts, activeId: store.data.activeId, isMac: IS_MAC });
  buildAppMenu();
  app.setBadgeCount(total);
  win.setTitle(total > 0 ? `Inbox Deck (${total})` : 'Inbox Deck');
}

function createWindow() {
  const saved = store.data.bounds;
  win = new BrowserWindow({
    width: saved?.width ?? 1400,
    height: saved?.height ?? 900,
    x: saved?.x,
    y: saved?.y,
    minWidth: 700,
    minHeight: 480,
    title: 'Inbox Deck',
    backgroundColor: '#1f1f24',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 28, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('resize', layout);
  win.on('close', () => {
    store.data.bounds = win.getBounds();
    store.save();
  });
  win.on('closed', () => {
    for (const entry of live.values()) entry.view?.webContents.close();
    live.clear();
    win = null;
  });

  win.webContents.once('did-finish-load', () => {
    for (const account of store.accounts) {
      if (store.data.settings.sleepAfterMinutes === 0 || account.id === store.data.activeId) createView(account);
      else live.set(account.id, { view: null, unread: 0, lastActive: 0 });
    }
    selectAccount(store.data.activeId ?? store.accounts[0]?.id);
  });
}

// Put accounts you haven't looked at in a while to sleep to save memory.
function sleepIdleAccounts() {
  const minutes = store.data.settings.sleepAfterMinutes;
  if (!win || !minutes) return;
  const cutoff = Date.now() - minutes * 60_000;
  for (const [id, entry] of live) {
    if (entry.view && id !== store.data.activeId && entry.lastActive < cutoff) sleepAccount(id);
  }
}

// ---------- menus ----------

function buildPageMenu(wc, params) {
  const items = [];
  for (const word of params.dictionarySuggestions.slice(0, 5)) {
    items.push({ label: word, click: () => wc.replaceMisspelling(word) });
  }
  if (params.misspelledWord) {
    items.push({ label: 'Add to Dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
    items.push({ type: 'separator' });
  }
  if (params.linkURL) {
    items.push({ label: 'Open Link in Browser', click: () => shell.openExternal(params.linkURL) });
    items.push({ label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) });
    items.push({ type: 'separator' });
  }
  if (params.isEditable) items.push({ role: 'cut' });
  if (params.isEditable || params.selectionText) items.push({ role: 'copy' });
  if (params.isEditable) items.push({ role: 'paste' }, { role: 'selectAll' });
  if (items.length === 0) items.push({ label: 'Reload', click: () => wc.reload() });
  return Menu.buildFromTemplate(items);
}

function accountMenu(id) {
  const account = store.find(id);
  if (!account) return null;
  const index = store.accounts.indexOf(account);
  const sleeping = !live.get(id)?.view;
  return Menu.buildFromTemplate([
    { label: 'Rename…', click: () => promptRename(id) },
    { label: 'Move Up', enabled: index > 0, click: () => { store.move(id, -1); pushState(); } },
    { label: 'Move Down', enabled: index < store.accounts.length - 1, click: () => { store.move(id, 1); pushState(); } },
    { type: 'separator' },
    { label: 'Reload', enabled: !sleeping, click: () => live.get(id)?.view?.webContents.reload() },
    sleeping
      ? { label: 'Wake', click: () => { wakeAccount(id); pushState(); } }
      : { label: 'Sleep', enabled: id !== store.data.activeId, click: () => sleepAccount(id) },
    { type: 'separator' },
    { label: 'Remove Account…', click: () => removeAccount(id) },
  ]);
}

function setOverlay(on) {
  overlay = on;
  layout();
}

function promptAdd() {
  setOverlay(true);
  win.webContents.send('prompt', { kind: 'add' });
}

function promptRename(id) {
  setOverlay(true);
  win.webContents.send('prompt', { kind: 'rename', id, label: store.find(id)?.label ?? '' });
}

function buildAppMenu() {
  const nav = (fn) => () => { const wc = activeWebContents(); if (wc) fn(wc); };
  const accountsSubmenu = [
    { label: 'Add Account…', accelerator: 'CmdOrCtrl+N', click: promptAdd },
    { type: 'separator' },
    { label: 'Next Account', accelerator: 'Ctrl+Tab', click: () => cycle(1) },
    { label: 'Previous Account', accelerator: 'Ctrl+Shift+Tab', click: () => cycle(-1) },
    { type: 'separator' },
    ...store.accounts.map((a, i) => ({
      label: a.label,
      type: 'radio',
      checked: a.id === store.data.activeId,
      accelerator: i < 9 ? `CmdOrCtrl+${i + 1}` : undefined,
      click: () => selectAccount(a.id),
    })),
    ...(store.accounts.length ? [{ type: 'separator' }] : []),
    {
      label: 'Sleep Inactive Accounts After',
      submenu: SLEEP_OPTIONS.map((minutes) => ({
        label: minutes === 0 ? 'Never' : minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hour${minutes > 60 ? 's' : ''}`,
        type: 'radio',
        checked: store.data.settings.sleepAfterMinutes === minutes,
        click: () => { store.data.settings.sleepAfterMinutes = minutes; store.save(); },
      })),
    },
  ];

  const template = [
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: nav((wc) => wc.reload()) },
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: nav((wc) => wc.navigationHistory.goBack()) },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: nav((wc) => wc.navigationHistory.goForward()) },
        { label: 'Open Gmail Home', accelerator: 'CmdOrCtrl+Shift+H', click: nav((wc) => wc.loadURL(GMAIL_URL)) },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: nav((wc) => wc.setZoomLevel(wc.getZoomLevel() + 0.5)) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: nav((wc) => wc.setZoomLevel(wc.getZoomLevel() - 0.5)) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: nav((wc) => wc.setZoomLevel(0)) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Developer Tools', accelerator: IS_MAC ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: nav((wc) => wc.toggleDevTools()) },
      ],
    },
    { label: 'Accounts', submenu: accountsSubmenu },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC from the sidebar ----------

ipcMain.on('select', (_e, id) => selectAccount(id));
ipcMain.on('add-prompt', () => promptAdd());
ipcMain.on('account-menu', (_e, id) => accountMenu(id)?.popup({ window: win }));
ipcMain.on('prompt-done', (_e, result) => {
  setOverlay(false);
  if (!result) {
    selectAccount(store.data.activeId);
    return;
  }
  if (result.kind === 'add') {
    const account = store.add(result.label);
    createView(account);
    selectAccount(account.id);
  } else if (result.kind === 'rename' && result.label?.trim()) {
    store.update(result.id, { label: result.label.trim() });
    pushState();
    selectAccount(store.data.activeId);
  }
});
ipcMain.on('ready', () => pushState());

// ---------- app lifecycle ----------

app.userAgentFallback = cleanUserAgent(app.userAgentFallback);

app.whenReady().then(() => {
  store = new AccountStore(path.join(app.getPath('userData'), 'accounts.json'));
  buildAppMenu();
  createWindow();
  setInterval(sleepIdleAccounts, 60_000);

  app.on('activate', () => {
    if (!win) createWindow();
    else win.show();
  });
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit();
});
