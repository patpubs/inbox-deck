# Inbox Deck

A desktop app for Mac and Windows that keeps many Gmail accounts signed in at once. Each account lives in its own isolated tab with its own cookies and storage, so signing in to one never signs you out of another. It works like Kiwi for Gmail, Shift or Wavebox.

## Features

- Sidebar with one tile per account, unread count badges, and a total on the Dock icon and window title
- Add, rename, reorder, sleep and remove accounts (right-click a tile)
- Keyboard: `⌘1`–`⌘9` (Windows: `Ctrl+1`–`Ctrl+9`) jumps to an account, `Ctrl+Tab` / `Ctrl+Shift+Tab` cycles, `⌘N` adds one
- Gmail desktop notifications; clicking one jumps to the right account
- Optional auto-sleep for accounts you haven't opened in a while (Accounts › Sleep Inactive Accounts After) to save memory with 10–20 accounts
- Links in emails open in your normal browser; Gmail pop-outs and attachments stay inside the app with the right account

## Run it

Requires [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
npm start
```

## Build an installer

```bash
npm run dist:mac   # on a Mac: dist/Inbox Deck-<version>-arm64.dmg and -x64.dmg
npm run dist:win   # on Windows: dist/Inbox Deck Setup <version>.exe
```

GitHub Actions also builds both installers on every push to `main`; download them from the run's **Artifacts** section.

These builds are unsigned. An app you build on your own Mac opens normally. One downloaded from GitHub will be blocked the first time: open it from **System Settings › Privacy & Security › Open Anyway**. On Windows, click **More info › Run anyway** on the SmartScreen prompt.

To share it without those warnings, sign the Mac build with an Apple Developer ID ($99/year) and notarize it, and sign the Windows build with a code-signing certificate. electron-builder handles both once the certificates are configured.

## How it works

- `src/main.js` creates the window, one `WebContentsView` per account in its own persistent partition (`persist:acct-<id>`), the menus and the account actions.
- `src/lib.js` holds the pure logic: account storage (`accounts.json` in the app's data folder), Gmail title parsing for unread counts, link routing and the user-agent cleanup. It's covered by `npm test`.
- `src/renderer/` is the sidebar UI.

Google can refuse sign-in from browsers it thinks are embedded. The app presents itself as plain Chrome (it strips the `Electron` token from the user agent), which is what similar apps do. If an account is still refused, please note which step fails.
