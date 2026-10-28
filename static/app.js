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
  $('empty').classList.toggle('all-picked-up', items.length > 0 && remaining === 0);
  $('empty').querySelector('h3').textContent = items.length ? 'All picked up.' : 'A fresh start.';
  $('empty').querySelector('p').textContent = items.length ? 'Everything on your list is in the basket.' : 'Add the first thing you need above.';
  $('done-section').hidden = remaining === items.length;
  $('done-count').textContent = items.length - remaining;
  for (const item of items) {
    const row = document.createElement('li'); row.className = item.checked ? 'item checked' : 'item';
    const check = document.createElement('button'); check.className = 'check'; check.textContent = item.checked ? '✓' : ''; check.setAttribute('aria-label', `${item.checked ? 'Uncheck' : 'Check off'} ${item.name}`); check.setAttribute('aria-pressed', String(Boolean(item.checked)));
    check.onclick = () => change(() => api('/' + item.id, 'PATCH', {checked: !item.checked}));
    const name = document.createElement('button'); name.className = 'item-name'; name.textContent = ''; name.setAttribute('aria-label', `Edit ${item.name}`);
    name.onclick = () => { editing = item.id; $('edit-name').value = item.name; $('edit-quantity').value = item.quantity; $('edit-dialog').showModal(); };
    const qty = document.createElement('span'); qty.className = 'quantity'; qty.textContent = item.quantity.trim() ? (/^[0-9]+([.,][0-9]+)?$/.test(item.quantity.trim()) ? '×' : '· ') + item.quantity.trim() : '';
    const remove = document.createElement('button'); remove.className = 'remove'; remove.textContent = '×'; remove.setAttribute('aria-label', `Delete ${item.name}`); remove.onclick = () => change(() => api('/' + item.id, 'DELETE', {}));
    const itemLabel = document.createElement('span'); itemLabel.className = 'item-label'; itemLabel.textContent = item.name;
    name.append(itemLabel, qty);
    row.append(check, name, remove); $(item.checked ? 'done' : 'pending').append(row);
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
  const card = document.createElement('article'); card.className = 'meal-card';
  const heading = document.createElement('div'); heading.className = 'meal-card-heading';
  const title = document.createElement('h2'); title.textContent = label;
  const edit = document.createElement('button'); edit.className = 'meal-edit'; edit.textContent = 'Edit'; edit.disabled = true; edit.setAttribute('aria-label', 'Edit ' + label + ' meal');
  const display = document.createElement('p'); display.className = 'meal-display'; display.textContent = 'Loading…';
  const form = document.createElement('form'); form.className = 'meal-editor'; form.hidden = true;
  const inputLabel = document.createElement('label'); inputLabel.htmlFor = 'meal-' + day; inputLabel.textContent = 'Meal for ' + label;
  const input = document.createElement('input'); input.id = inputLabel.htmlFor; input.maxLength = 200; input.placeholder = 'e.g. Spagbol';
  const actions = document.createElement('div'); actions.className = 'meal-actions';
  const save = document.createElement('button'); save.className = 'primary'; save.type = 'submit'; save.textContent = 'Save meal';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  const status = document.createElement('span'); status.className = 'meal-status'; status.setAttribute('role', 'status');
  const row = {input, edit, display, editing: false, saving: false, meal: ''}; mealRows.set(day, row);
  const paint = () => { display.textContent = row.meal || 'Nothing planned yet'; display.classList.toggle('unplanned', !row.meal); edit.textContent = row.meal ? 'Edit' : '+ Add meal'; };
  const close = () => { row.editing = false; form.hidden = true; display.hidden = false; edit.hidden = false; status.textContent = ''; paint(); edit.focus(); };
  edit.onclick = () => { row.editing = true; input.value = row.meal; form.hidden = false; display.hidden = true; edit.hidden = true; input.focus(); };
  cancel.onclick = close;
  form.onkeydown = event => { if (event.key === 'Escape' && !row.saving) { event.preventDefault(); close(); } };
  form.onsubmit = async event => {
    event.preventDefault(); if (row.saving) return;
    row.saving = true; input.disabled = true; save.disabled = true; cancel.disabled = true; status.textContent = 'Saving…';
    try { await mealApi(day, input.value); row.meal = input.value.trim(); close(); }
    catch (error) { status.textContent = error.message + ' Your changes are still here; try saving again.'; }
    finally { row.saving = false; input.disabled = false; save.disabled = false; cancel.disabled = false; }
  };
  actions.append(cancel, save); form.append(inputLabel, input, actions, status);
  heading.append(title, edit); card.append(heading, display, form); $('meal-days').append(card);
}
async function refreshMeals() {
  try {
    const meals = await mealApi();
    for (const {day, meal} of meals) {
      const row = mealRows.get(day);
      if (row && !row.editing && !row.saving) {
        row.meal = meal; row.display.textContent = meal || 'Nothing planned yet';
        row.display.classList.toggle('unplanned', !meal); row.edit.disabled = false;
        row.edit.textContent = meal ? 'Edit' : '+ Add meal';
      }
    }
    $('meal-error').hidden = true;
  } catch (error) { $('meal-error').textContent = 'Could not load the meal plan. Retrying shortly.'; $('meal-error').hidden = false; }
}
const tabs = [$('grocery-tab'), $('meals-tab'), $('recipes-tab')];
function selectTab(tab) {
  for (const item of tabs) {
    const active = item === tab; item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
    $(item.getAttribute('aria-controls')).hidden = !active;
  }
  if (tab === $('meals-tab')) refreshMeals();
  if (tab === $('recipes-tab')) refreshRecipes();
}
for (const tab of tabs) {
  tab.onclick = () => selectTab(tab);
  tab.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus(); selectTab(next);
  };
}
setInterval(() => { if (!document.hidden && !$('meals-panel').hidden) refreshMeals(); }, 15000);
