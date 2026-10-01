// Pure helpers with no Electron dependency, so they can be unit tested with `node --test`.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GMAIL_URL = 'https://mail.google.com/mail/u/0/';

const COLORS = [
  '#e8453c', '#f4a50d', '#34a853', '#4285f4', '#a142f4',
  '#e52592', '#12a4af', '#f97316', '#5f6368', '#0b8043',
];

// Gmail titles look like "Inbox (12) - someone@gmail.com - Gmail".
function parseGmailTitle(title) {
  const result = { unread: null, email: null };
  if (typeof title !== 'string') return result;
  const count = title.match(/\((\d[\d,]*)\)/);
  if (count) result.unread = parseInt(count[1].replace(/,/g, ''), 10);
  else if (/ - Gmail$/.test(title)) result.unread = 0;
  const email = title.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
  if (email) result.email = email[0];
  return result;
}

// Google rejects sign-in from browsers that announce themselves as Electron,
// so present the plain Chrome identity Electron is built on.
function cleanUserAgent(ua) {
  // Electron/x.y.z plus the app's own token (inbox-deck/0.1.0 or InboxDeck/0.1.0).
  return ua.replace(/\s?(?:Electron|inbox-?deck)\/\S+/gi, '');
}

// Hosts that belong to Gmail and Google sign-in (2-step verification, consent,
// account chooser). Navigation to these stays inside the account's tab.
function isGoogleHost(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return false; }
  return ['google.com', 'googleusercontent.com', 'gstatic.com', 'youtube.com', 'gmail.com']
    .some((d) => host === d || host.endsWith('.' + d));
}

// Decide where a link opened from inside Gmail should go.
//  'popup'    : keep it in the app, in a window sharing the account's session
//               (compose and print pop-outs, attachments, Google sign-in)
//  'external' : hand it to the system browser
//  'deny'     : drop it
function classifyLink(url) {
  let u;
  try { u = new URL(url); } catch { return 'deny'; }
  // Gmail handles its own mailto links; anything that escapes is dropped.
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'deny';
  // Gmail wraps links in emails as https://www.google.com/url?q=<target>.
  if (u.hostname === 'www.google.com' && u.pathname === '/url') return 'external';
  // Attachments live on googleusercontent.com and need this account's cookies.
  return isGoogleHost(url) ? 'popup' : 'external';
}

function initials(label) {
  const words = String(label || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

class AccountStore {
  constructor(file) {
    this.file = file;
    this.data = { accounts: [], activeId: null, settings: { sleepAfterMinutes: 0 }, bounds: null };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = { ...this.data, ...raw, settings: { ...this.data.settings, ...(raw.settings || {}) } };
    } catch {
      // First run, or unreadable file: start empty.
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get accounts() { return this.data.accounts; }

  find(id) { return this.data.accounts.find((a) => a.id === id); }

  add(label) {
    const account = {
      id: crypto.randomUUID(),
      label: (label || '').trim() || `Account ${this.data.accounts.length + 1}`,
      color: COLORS[this.data.accounts.length % COLORS.length],
      email: null,
    };
    this.data.accounts.push(account);
    this.save();
    return account;
  }

  update(id, fields) {
    const account = this.find(id);
    if (!account) return null;
    Object.assign(account, fields);
    this.save();
    return account;
  }

  remove(id) {
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id);
    if (this.data.activeId === id) this.data.activeId = this.data.accounts[0]?.id ?? null;
    this.save();
  }

  move(id, delta) {
    const list = this.data.accounts;
    const from = list.findIndex((a) => a.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    this.save();
  }

  setActive(id) {
    this.data.activeId = id;
    this.save();
  }
}

module.exports = { GMAIL_URL, COLORS, parseGmailTitle, cleanUserAgent, classifyLink, isGoogleHost, initials, AccountStore };
