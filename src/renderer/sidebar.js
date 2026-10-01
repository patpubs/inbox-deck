const list = document.getElementById('accounts');
const welcome = document.getElementById('welcome');
const dialog = document.getElementById('dialog');
const form = document.getElementById('dialog-form');
const input = document.getElementById('dialog-input');
let prompt = null;

function render(state) {
  document.body.classList.toggle('mac', state.isMac);
  welcome.hidden = state.accounts.length > 0;
  list.replaceChildren(...state.accounts.map((a, i) => {
    const li = document.createElement('li');
    const tile = document.createElement('button');
    tile.className = 'tile';
    tile.classList.toggle('active', a.id === state.activeId);
    tile.classList.toggle('sleeping', a.sleeping);
    tile.style.setProperty('--color', a.color);
    tile.textContent = a.initials;
    const shortcut = i < 9 ? ` (⌘${i + 1} / Ctrl+${i + 1})` : '';
    tile.title = `${a.label}${a.email ? `\n${a.email}` : ''}${a.sleeping ? '\nSleeping, click to wake' : ''}${shortcut}`;
    tile.setAttribute('aria-label', `${a.label}, ${a.unread} unread`);
    tile.addEventListener('click', () => window.deck.select(a.id));
    tile.addEventListener('contextmenu', (e) => { e.preventDefault(); window.deck.accountMenu(a.id); });
    if (a.unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = a.unread > 999 ? '999+' : String(a.unread);
      tile.append(badge);
    }
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = a.label;
    li.append(tile, name);
    return li;
  }));
}

function openPrompt(p) {
  prompt = p;
  const rename = p.kind === 'rename';
  document.getElementById('dialog-title').textContent = rename ? 'Rename account' : 'Add account';
  document.getElementById('dialog-ok').textContent = rename ? 'Save' : 'Add';
  document.getElementById('dialog-hint').hidden = rename;
  input.value = rename ? p.label : '';
  dialog.hidden = false;
  input.focus();
  input.select();
}

function closePrompt(result) {
  dialog.hidden = true;
  prompt = null;
  window.deck.promptDone(result);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  closePrompt({ ...prompt, label: input.value });
});
document.getElementById('dialog-cancel').addEventListener('click', () => closePrompt(null));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && prompt) closePrompt(null); });
document.getElementById('add').addEventListener('click', () => window.deck.addAccount());
document.getElementById('welcome-add').addEventListener('click', () => window.deck.addAccount());

window.deck.onState(render);
window.deck.onPrompt(openPrompt);
window.deck.ready();
