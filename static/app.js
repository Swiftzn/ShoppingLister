const $ = (id) => document.getElementById(id);
let items = [], editing = null, busy = false;
async function api(path = '', method = 'GET', body) {
  const response = await fetch('/api/items' + path, {method, headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
function showError(error) { $('error').textContent = error.message || 'Cannot reach the server. Please try again.'; $('error').hidden = false; $('status').textContent = 'Not synced'; }
async function refresh() {
  items = await api(); render(); $('loading').hidden = true;
  $('error').hidden = true; $('status').textContent = 'Up to date';
}
async function change(action) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await action(); await refresh(); } catch (error) { showError(error); }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
function render() {
  $('pending').replaceChildren(); $('done').replaceChildren();
  const remaining = items.filter(item => !item.checked).length;
  $('count').textContent = `${remaining} ${remaining === 1 ? 'item' : 'items'} to go`;
  $('empty').hidden = remaining > 0;
  $('empty').querySelector('h3').textContent = items.length ? 'All picked up.' : 'A fresh start.';
  $('empty').querySelector('p').textContent = items.length ? 'Everything on your list is in the basket.' : 'Add the first thing you need above.';
  $('done-section').hidden = remaining === items.length;
  $('done-count').textContent = items.length - remaining;
  for (const item of items) {
    const row = document.createElement('li'); row.className = item.checked ? 'item checked' : 'item';
    const check = document.createElement('button'); check.className = 'check'; check.textContent = item.checked ? '✓' : ''; check.setAttribute('aria-label', `${item.checked ? 'Uncheck' : 'Check off'} ${item.name}`); check.setAttribute('aria-pressed', String(Boolean(item.checked)));
    check.onclick = () => change(() => api('/' + item.id, 'PATCH', {checked: !item.checked}));
    const name = document.createElement('button'); name.className = 'item-name'; name.textContent = item.name; name.setAttribute('aria-label', `Edit ${item.name}`);
    name.onclick = () => { editing = item.id; $('edit-name').value = item.name; $('edit-quantity').value = item.quantity; $('edit-dialog').showModal(); };
    const qty = document.createElement('span'); qty.className = 'quantity'; qty.textContent = item.quantity;
    const remove = document.createElement('button'); remove.className = 'remove'; remove.textContent = '×'; remove.setAttribute('aria-label', `Delete ${item.name}`); remove.onclick = () => change(() => api('/' + item.id, 'DELETE', {}));
    row.append(check, name, qty, remove); $(item.checked ? 'done' : 'pending').append(row);
  }
}
$('add-form').onsubmit = event => { event.preventDefault(); const name = $('name').value.trim(); if (!name) return; change(async () => { await api('', 'POST', {name, quantity: $('quantity').value.trim()}); $('add-form').reset(); $('name').focus(); }); };
$('edit-form').onsubmit = event => { event.preventDefault(); change(async () => { await api('/' + editing, 'PATCH', {name: $('edit-name').value.trim(), quantity: $('edit-quantity').value.trim()}); $('edit-dialog').close(); }); };
$('cancel-edit').onclick = () => $('edit-dialog').close();
$('refresh').onclick = () => change(async () => {});
refresh().catch(error => { $('loading').textContent = 'Your list could not be loaded. Try Refresh list.'; showError(error); });
setInterval(() => { if (!busy && !document.hidden && !$('edit-dialog').open) change(async () => {}); }, 15000);
