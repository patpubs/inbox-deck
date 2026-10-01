const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseGmailTitle, cleanUserAgent, classifyLink, isGoogleHost, initials, AccountStore } = require('../src/lib');

test('parseGmailTitle reads unread count and address', () => {
  assert.deepStrictEqual(parseGmailTitle('Inbox (12) - jo@gmail.com - Gmail'), { unread: 12, email: 'jo@gmail.com' });
  assert.deepStrictEqual(parseGmailTitle('Inbox (1,204) - a.b+c@shop.co.uk - Gmail'), { unread: 1204, email: 'a.b+c@shop.co.uk' });
  assert.deepStrictEqual(parseGmailTitle('Inbox - jo@gmail.com - Gmail'), { unread: 0, email: 'jo@gmail.com' });
  assert.deepStrictEqual(parseGmailTitle('Gmail'), { unread: null, email: null });
  assert.deepStrictEqual(parseGmailTitle('Sign in - Google Accounts'), { unread: null, email: null });
});

test('cleanUserAgent removes Electron and app tokens', () => {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) inbox-deck/0.1.0 Chrome/140.0.0.0 Electron/44.5.1 Safari/537.36';
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  assert.strictEqual(cleanUserAgent(ua), chrome);
  assert.strictEqual(cleanUserAgent(ua.replace('inbox-deck', 'InboxDeck')), chrome);
});

test('classifyLink keeps Google pages in the app and sends others out', () => {
  assert.strictEqual(classifyLink('https://mail.google.com/mail/u/0/?view=cm'), 'popup');
  assert.strictEqual(classifyLink('https://mail-attachment.googleusercontent.com/x'), 'popup');
  assert.strictEqual(classifyLink('https://accounts.google.com/signin'), 'popup');
  assert.strictEqual(classifyLink('https://www.google.com/url?q=https://example.com'), 'external');
  assert.strictEqual(classifyLink('https://example.com/'), 'external');
  assert.strictEqual(classifyLink('https://evilgoogle.com/'), 'external');
  assert.strictEqual(classifyLink('mailto:a@b.com'), 'deny');
  assert.strictEqual(classifyLink('javascript:alert(1)'), 'deny');
  assert.strictEqual(classifyLink('not a url'), 'deny');
});

test('isGoogleHost matches only real Google domains', () => {
  assert.ok(isGoogleHost('https://accounts.google.com/'));
  assert.ok(isGoogleHost('https://ssl.gstatic.com/x.js'));
  assert.ok(!isGoogleHost('https://google.com.evil.net/'));
  assert.ok(!isGoogleHost('https://notgoogle.com/'));
});

test('initials', () => {
  assert.strictEqual(initials('Work'), 'WO');
  assert.strictEqual(initials('Pat Pubs'), 'PP');
  assert.strictEqual(initials('jason.k@gmail.com'), 'JK');
  assert.strictEqual(initials(''), '?');
});

test('AccountStore persists, reorders and removes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-'));
  const file = path.join(dir, 'accounts.json');
  const store = new AccountStore(file);
  const a = store.add('Work');
  const b = store.add('');
  assert.strictEqual(b.label, 'Account 2');
  assert.notStrictEqual(a.color, b.color);
  store.setActive(a.id);
  store.move(b.id, -1);
  const reloaded = new AccountStore(file);
  assert.deepStrictEqual(reloaded.accounts.map((x) => x.id), [b.id, a.id]);
  assert.strictEqual(reloaded.data.settings.sleepAfterMinutes, 0);
  reloaded.remove(a.id);
  assert.strictEqual(reloaded.data.activeId, b.id);
  assert.strictEqual(new AccountStore(file).accounts.length, 1);
});
