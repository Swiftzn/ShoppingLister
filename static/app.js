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
  document.querySelectorAll('#grocery-panel button, #edit-dialog button').forEach(b => b.disabled = true);
  try { await action(); await refresh(); } catch (error) { showError(error); }
  finally { busy = false; document.querySelectorAll('#grocery-panel button, #edit-dialog button').forEach(b => b.disabled = false); }
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
    row.append(check, qty, name, remove); $(item.checked ? 'done' : 'pending').append(row);
  }
}
$('add-form').onsubmit = event => { event.preventDefault(); const name = $('name').value.trim(); if (!name) return; change(async () => { await api('', 'POST', {name, quantity: $('quantity').value.trim()}); $('add-form').reset(); $('name').focus(); }); };
$('edit-form').onsubmit = event => { event.preventDefault(); change(async () => { await api('/' + editing, 'PATCH', {name: $('edit-name').value.trim(), quantity: $('edit-quantity').value.trim()}); $('edit-dialog').close(); }); };
$('cancel-edit').onclick = () => $('edit-dialog').close();
$('refresh').onclick = () => change(async () => {});
refresh().catch(error => { $('loading').textContent = 'Your list could not be loaded. Try Refresh list.'; showError(error); });
setInterval(() => { if (!busy && !document.hidden && !$('edit-dialog').open) change(async () => {}); }, 15000);

// Each day saves separately; refreshing never overwrites an unsaved draft.
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const mealRows = new Map();
async function mealApi(day, meal) {
  const response = await fetch('/api/meals' + (day ? '/' + day : ''), day ? {
    method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({meal})
  } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not save the meal plan.');
  return data;
}
for (const label of days) {
  const day = label.toLowerCase();
  const form = document.createElement('form'); form.className = 'meal-row';
  const title = document.createElement('label'); title.htmlFor = 'meal-' + day; title.textContent = label;
  const input = document.createElement('input'); input.id = title.htmlFor; input.maxLength = 200;
  input.placeholder = label === 'Monday' ? 'e.g. Spagbol' : 'What’s for dinner?'; input.disabled = true;
  const save = document.createElement('button'); save.className = 'primary'; save.type = 'submit'; save.textContent = 'Save'; save.disabled = true;
  const status = document.createElement('span'); status.className = 'meal-status'; status.setAttribute('role', 'status');
  const row = {input, save, status, dirty: false, saving: false}; mealRows.set(day, row);
  input.oninput = () => { row.dirty = true; save.disabled = false; status.textContent = 'Unsaved'; };
  form.onsubmit = async event => {
    event.preventDefault(); if (row.saving) return;
    row.saving = true; input.disabled = true; save.disabled = true; status.textContent = 'Saving…';
    try {
      await mealApi(day, input.value); input.value = input.value.trim(); row.dirty = false;
      status.textContent = 'Saved'; $('meal-error').hidden = true;
    } catch (error) { status.textContent = 'Not saved — try again'; $('meal-error').textContent = error.message; $('meal-error').hidden = false; }
    finally { row.saving = false; input.disabled = false; save.disabled = !row.dirty; }
  };
  form.append(title, input, save, status); $('meal-days').append(form);
}
async function refreshMeals() {
  try {
    const meals = await mealApi();
    for (const {day, meal} of meals) {
      const row = mealRows.get(day);
      if (row && !row.dirty && !row.saving && document.activeElement !== row.input) {
        row.input.value = meal; row.input.disabled = false;
      }
    }
    $('meal-error').hidden = false;
    $('meal-error').textContent = [...mealRows.values()].some(row => row.dirty) ? 'You have unsaved changes. Use Save beside each day.' : '';
    $('meal-error').hidden = !$('meal-error').textContent;
  } catch (error) { $('meal-error').textContent = 'Could not load the meal plan. Retrying shortly.'; $('meal-error').hidden = false; }
}
const tabs = [$('grocery-tab'), $('meals-tab')];
function selectTab(tab) {
  for (const item of tabs) {
    const active = item === tab; item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
    $(item.getAttribute('aria-controls')).hidden = !active;
  }
  if (tab === $('meals-tab')) refreshMeals();
}
for (const tab of tabs) {
  tab.onclick = () => selectTab(tab);
  tab.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] : tabs[1 - tabs.indexOf(tab)];
    next.focus(); selectTab(next);
  };
}
setInterval(() => { if (!document.hidden && !$('meals-panel').hidden) refreshMeals(); }, 15000);
