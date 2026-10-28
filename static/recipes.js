let recipeEditing = null, recipeSaving = false, recipeAction = null;
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
async function recipeRequest(path = '/api/recipes', method = 'GET', body) {
  const response = await fetch(path, {method, headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not save. Please try again.');
  return data;
}
async function refreshRecipes() {
  try {
    const recipes = await recipeRequest(); $('recipe-list').replaceChildren(); $('recipe-error').hidden = true;
    if (!recipes.length) $('recipe-list').append(element('p', 'empty', 'Your favourites belong here. Add your first recipe.'));
    for (const recipe of recipes) {
      const card = element('article', 'recipe-card');
      const heading = element('div', 'meal-card-heading');
      const title = element('h2', 'recipe-title', recipe.name);
      const edit = element('button', 'meal-edit', 'Edit'); edit.setAttribute('aria-label', 'Edit ' + recipe.name); edit.onclick = () => openRecipeEditor(recipe);
      heading.append(title, edit);
      const details = element('details', 'recipe-details'); const summary = element('summary', '', `${recipe.ingredients.length} ingredients · View recipe`);
      const list = element('ul', 'recipe-ingredients');
      for (const ingredient of recipe.ingredients) {
        const li = element('li', '', ingredient.name + (ingredient.quantity ? ' · ' + ingredient.quantity : ''));
        if (ingredient.staple) li.append(element('span', 'staple-label', 'Usually have this'));
        list.append(li);
      }
      details.append(summary, list);
      if (recipe.instructions) details.append(element('h3', '', 'Instructions'), element('p', 'recipe-instructions', recipe.instructions));
      const actions = element('div', 'recipe-card-actions');
      const plan = element('button', 'primary', 'Add to meal planner'); plan.onclick = () => openRecipeUse(recipe, true);
      const shop = element('button', 'secondary', 'Choose groceries'); shop.onclick = () => openRecipeUse(recipe, false);
      const remove = element('button', 'recipe-delete', 'Delete'); remove.setAttribute('aria-label', 'Delete ' + recipe.name);
      remove.onclick = async () => {
        if (!confirm(`Delete “${recipe.name}”? Meals and groceries already added will stay.`)) return;
        remove.disabled = true;
        try { await recipeRequest('/api/recipes/' + recipe.id, 'DELETE', {version:recipe.version}); await refreshRecipes(); }
        catch (error) { $('recipe-error').textContent = error.message; $('recipe-error').hidden = false; remove.disabled = false; }
      };
      actions.append(plan, shop, remove); card.append(heading, details, actions); $('recipe-list').append(card);
    }
  } catch (error) { $('recipe-error').textContent = error.message; $('recipe-error').hidden = false; }
}
function addIngredientRow(ingredient = {}) {
  const row = element('div', 'ingredient-edit-row');
  const nameLabel = element('label', '', 'Ingredient'); const name = element('input'); name.className = 'ingredient-name'; name.required = true; name.maxLength = 120; name.placeholder = 'Tinned tomatoes'; name.value = ingredient.name || ''; nameLabel.append(name);
  const quantityLabel = element('label', '', 'Quantity'); const quantity = element('input'); quantity.className = 'ingredient-quantity'; quantity.maxLength = 40; quantity.placeholder = '2 tins'; quantity.value = ingredient.quantity || ''; quantityLabel.append(quantity);
  const stapleLabel = element('label', 'checkbox-label'); const staple = element('input'); staple.type = 'checkbox'; staple.className = 'ingredient-staple'; staple.checked = Boolean(ingredient.staple); stapleLabel.append(staple, document.createTextNode('Usually have this'));
  const remove = element('button', 'meal-edit', 'Remove'); remove.type = 'button'; remove.onclick = () => row.remove();
  row.append(nameLabel, quantityLabel, stapleLabel, remove); $('ingredient-editor').append(row);
}
function openRecipeEditor(recipe = null) {
  recipeEditing = recipe; $('recipe-editor-title').textContent = recipe ? 'Edit recipe' : 'New recipe';
  $('recipe-name').value = recipe?.name || ''; $('recipe-instructions').value = recipe?.instructions || '';
  $('ingredient-editor').replaceChildren(); (recipe?.ingredients || [{}]).forEach(addIngredientRow);
  $('recipe-save-error').textContent = ''; $('recipe-editor').showModal(); $('recipe-name').focus();
}
$('new-recipe').onclick = () => openRecipeEditor();
$('add-ingredient').onclick = () => { if ($('ingredient-editor').children.length < 100) addIngredientRow(); };
$('cancel-recipe').onclick = () => $('recipe-editor').close();
$('recipe-editor').oncancel = event => { if (recipeSaving) event.preventDefault(); };
$('recipe-form').onsubmit = async event => {
  event.preventDefault(); if (recipeSaving) return;
  const ingredients = [...$('ingredient-editor').children].map(row => ({name:row.querySelector('.ingredient-name').value.trim(), quantity:row.querySelector('.ingredient-quantity').value.trim(), staple:row.querySelector('.ingredient-staple').checked}));
  if (!ingredients.length) { $('recipe-save-error').textContent = 'Add at least one ingredient.'; return; }
  const payload = {name:$('recipe-name').value.trim(), ingredients, instructions:$('recipe-instructions').value, version:recipeEditing?.version};
  recipeSaving = true; $('recipe-form').querySelectorAll('button,input,textarea').forEach(node => node.disabled = true);
  try {
    await recipeRequest('/api/recipes' + (recipeEditing ? '/' + recipeEditing.id : ''), recipeEditing ? 'PATCH' : 'POST', payload);
    $('recipe-editor').close(); $('recipe-notice').textContent = 'Recipe saved.'; await refreshRecipes();
  } catch (error) { $('recipe-save-error').textContent = error.message; }
  finally { recipeSaving = false; $('recipe-form').querySelectorAll('button,input,textarea').forEach(node => node.disabled = false); }
};
function actionToken() { const bytes = new Uint8Array(16); crypto.getRandomValues(bytes); return Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join(''); }
async function openRecipeUse(recipe, planning) {
  $('recipe-error').hidden = true;
  try {
    const [groceries, meals] = await Promise.all([api(), mealApi()]);
    recipeAction = {recipe, planning, meals, token:actionToken(), saving:false, payload:null};
    $('recipe-use-name').textContent = recipe.name; $('recipe-use-title').textContent = planning ? 'Plan a meal' : 'Choose groceries';
    $('plan-controls').hidden = !planning; $('plan-only').hidden = !planning; $('recipe-use-error').textContent = '';
    $('recipe-day').replaceChildren();
    for (const meal of meals) { const option = element('option', '', meal.day[0].toUpperCase() + meal.day.slice(1) + (meal.meal ? ' — ' + meal.meal : '')); option.value = meal.day; $('recipe-day').append(option); }
    $('recipe-day').onchange = () => { const current = meals.find(meal => meal.day === $('recipe-day').value); $('day-replacement').textContent = current.meal ? `Saving will replace “${current.meal}”.` : 'This day has no meal planned.'; };
    $('recipe-day').onchange(); $('ingredient-checklist').replaceChildren();
    const existing = new Set(groceries.filter(item => !item.checked).map(item => item.name.trim().toLowerCase()));
    recipe.ingredients.forEach((ingredient, index) => {
      const row = element('label', 'ingredient-choice'); const check = element('input'); check.type = 'checkbox'; check.value = index;
      const already = existing.has(ingredient.name.trim().toLowerCase()); check.checked = !ingredient.staple && !already;
      const copy = element('span', 'ingredient-copy'); copy.append(element('strong', '', ingredient.name), element('span', 'muted', ingredient.quantity));
      if (already || ingredient.staple) copy.append(element('small', '', [already ? 'Already on list' : '', ingredient.staple ? 'Usually have this' : ''].filter(Boolean).join(' · ')));
      row.append(check, copy); $('ingredient-checklist').append(row);
    });
    $('apply-recipe').textContent = planning ? 'Plan & add selected' : 'Add selected';
    $('recipe-use-form').querySelectorAll('button,input,select').forEach(node => node.disabled = false);
    $('recipe-use').showModal();
  } catch (error) { $('recipe-error').textContent = error.message; $('recipe-error').hidden = false; }
}
$('cancel-use').onclick = () => $('recipe-use').close();
$('recipe-use').oncancel = event => { if (recipeAction?.saving) event.preventDefault(); };
async function applyRecipe(skipIngredients) {
  const action = recipeAction; if (action.saving) return;
  if (!action.payload) {
    const day = action.planning ? $('recipe-day').value : null;
    action.payload = {request_id:action.token, recipe_id:action.recipe.id, version:action.recipe.version, day, previous_meal:action.meals.find(meal => meal.day === day)?.meal, selected:skipIngredients ? [] : [...$('ingredient-checklist').querySelectorAll('input:checked')].map(node => Number(node.value))};
    if (!day && !action.payload.selected.length) { action.payload = null; $('recipe-use-error').textContent = 'Choose at least one ingredient, or Cancel.'; return; }
  }
  action.saving = true; $('recipe-use-form').querySelectorAll('button,input,select').forEach(node => node.disabled = true);
  try {
    await recipeRequest('/api/recipe-actions', 'POST', action.payload);
    $('recipe-use').close(); $('recipe-notice').textContent = `${action.planning ? 'Meal planned. ' : ''}${action.payload.selected.length} ingredients added to your grocery list.`;
    await Promise.all([refresh().catch(showError), refreshMeals()]);
  } catch (error) {
    $('recipe-use-error').textContent = error.message + ' Retry sends the same selection; close and reopen to change it.';
    // Keep the original payload/token on retry so a lost response cannot add duplicates.
    $('apply-recipe').disabled = false; $('cancel-use').disabled = false;
  } finally { action.saving = false; }
}
$('recipe-use-form').onsubmit = event => { event.preventDefault(); applyRecipe(false); };
$('plan-only').onclick = () => applyRecipe(true);