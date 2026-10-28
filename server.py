"""A small, dependency-free shared grocery list. Python 3.10+."""
import json
import os
import sqlite3
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DAYS = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
DB = Path(os.environ.get('DATA_DIR', ROOT / 'data')) / 'shopping.db'


@contextmanager
def connect():
    db = sqlite3.connect(DB, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0)')

        db.execute('CREATE TABLE IF NOT EXISTS meals (day TEXT PRIMARY KEY, meal TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS recipes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, ingredients TEXT NOT NULL, instructions TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)')
        db.execute('CREATE TABLE IF NOT EXISTS recipe_requests (id TEXT PRIMARY KEY)')
        db.executemany('INSERT OR IGNORE INTO meals(day, meal) VALUES (?, ?)', [(day, '') for day in DAYS])


class Handler(BaseHTTPRequestHandler):
    def send(self, status, body, content_type='application/json'):
        data = json.dumps(body).encode() if content_type == 'application/json' else body
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/recipes':
            try:
                with connect() as db:
                    recipes = [dict(row) for row in db.execute('SELECT * FROM recipes ORDER BY name COLLATE NOCASE, id')]
                for recipe in recipes:
                    recipe['ingredients'] = json.loads(recipe['ingredients'])
                self.send(200, recipes)
            except sqlite3.Error:
                self.send(500, {'error': 'Could not load recipes.'})
            return
        if path == '/api/meals':
            try:
                with connect() as db:
                    meals = dict(db.execute('SELECT day, meal FROM meals').fetchall())
                self.send(200, [{'day': day, 'meal': meals[day]} for day in DAYS])
            except sqlite3.Error:
                self.send(500, {'error': 'Could not load the meal plan.'})
            return
        if path == '/api/items':
            try:
                with connect() as db:
                    self.send(200, [dict(row) for row in db.execute('SELECT * FROM items ORDER BY id')])
            except sqlite3.Error:
                self.send(500, {'error': 'Could not load the list.'})
            return
        files = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript'), '/recipes.js': ('recipes.js', 'text/javascript'), '/style.css': ('style.css', 'text/css'), '/favicon.svg': ('favicon.svg', 'image/svg+xml')}
        if path not in files:
            self.send(404, {'error': 'Not found'})
            return
        name, mime = files[path]
        self.send(200, (ROOT / 'static' / name).read_bytes(), mime)

    def mutate(self):
        # Browser writes must originate from this site, including on a home LAN.
        origin = self.headers.get('Origin')
        if origin and urlsplit(origin).netloc != self.headers.get('Host'):
            self.send(403, {'error': 'Cross-origin writes are not allowed.'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 65536:
                raise ValueError('Invalid request size.')
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError('Expected JSON.')
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError('Expected an object.')
            path = urlsplit(self.path).path
            with connect() as db:
                if self.command == 'POST' and path == '/api/recipe-actions':
                    token = body.get('request_id')
                    if not isinstance(token, str) or not 16 <= len(token) <= 100:
                        raise ValueError('Invalid request ID.')
                    db.execute('BEGIN IMMEDIATE')
                    if db.execute('SELECT 1 FROM recipe_requests WHERE id = ?', (token,)).fetchone():
                        self.send(200, {'ok': True})
                        return
                    recipe_id = body.get('recipe_id')
                    if type(recipe_id) is not int:
                        raise ValueError('Invalid recipe ID.')
                    recipe = db.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,)).fetchone()
                    if not recipe or recipe['version'] != body.get('version'):
                        self.send(409, {'error': 'Recipe changed. Close this window and reopen the recipe.'})
                        return
                    ingredients = json.loads(recipe['ingredients'])
                    selected = body.get('selected', [])
                    if not isinstance(selected, list) or any(type(i) is not int or not 0 <= i < len(ingredients) for i in selected) or len(set(selected)) != len(selected):
                        raise ValueError('Invalid ingredient selection.')
                    day = body.get('day')
                    if day is not None:
                        if day not in DAYS:
                            raise ValueError('Choose a valid day.')
                        current = db.execute('SELECT meal FROM meals WHERE day = ?', (day,)).fetchone()['meal']
                        if current != body.get('previous_meal'):
                            self.send(409, {'error': 'That day changed. Close this window and choose the day again.'})
                            return
                        db.execute('UPDATE meals SET meal = ? WHERE day = ?', (recipe['name'], day))
                    db.executemany('INSERT INTO items(name, quantity) VALUES (?, ?)', [(ingredients[i]['name'], ingredients[i]['quantity']) for i in selected])
                    db.execute('INSERT INTO recipe_requests(id) VALUES (?)', (token,))
                elif self.command == 'POST' and path == '/api/recipes':
                    name, ingredients, instructions = self.recipe_fields(body)
                    db.execute('INSERT INTO recipes(name, ingredients, instructions) VALUES (?, ?, ?)', (name, ingredients, instructions))
                elif path.startswith('/api/recipes/') and path.removeprefix('/api/recipes/').isdigit():
                    recipe_id = int(path.rsplit('/', 1)[1])
                    if self.command == 'PATCH':
                        name, ingredients, instructions = self.recipe_fields(body)
                        result = db.execute('UPDATE recipes SET name = ?, ingredients = ?, instructions = ?, version = version + 1 WHERE id = ? AND version = ?', (name, ingredients, instructions, recipe_id, body.get('version')))
                    elif self.command == 'DELETE':
                        result = db.execute('DELETE FROM recipes WHERE id = ? AND version = ?', (recipe_id, body.get('version')))
                    else:
                        self.send(405, {'error': 'Method not allowed'})
                        return
                    if not result.rowcount:
                        self.send(409, {'error': 'Recipe changed or was deleted. Close and refresh recipes before trying again.'})
                        return
                elif self.command == 'PATCH' and path.startswith('/api/meals/'):
                    day = path.removeprefix('/api/meals/')
                    meal = body.get('meal')
                    if day not in DAYS:
                        self.send(404, {'error': 'Unknown day.'})
                        return
                    if not isinstance(meal, str) or len(meal) > 200:
                        raise ValueError('Enter a meal up to 200 characters.')
                    db.execute('UPDATE meals SET meal = ? WHERE day = ?', (meal.strip(), day))
                elif self.command == 'POST' and path == '/api/items':
                    name, quantity = self.fields(body)
                    db.execute('INSERT INTO items(name, quantity) VALUES (?, ?)', (name, quantity))
                elif path.startswith('/api/items/') and path.removeprefix('/api/items/').isdigit():
                    item_id = int(path.rsplit('/', 1)[1])
                    if self.command == 'DELETE':
                        result = db.execute('DELETE FROM items WHERE id = ?', (item_id,))
                    elif self.command == 'PATCH':
                        if set(body) == {'checked'} and type(body['checked']) is bool:
                            result = db.execute('UPDATE items SET checked = ? WHERE id = ?', (body['checked'], item_id))
                        else:
                            name, quantity = self.fields(body)
                            result = db.execute('UPDATE items SET name = ?, quantity = ? WHERE id = ?', (name, quantity, item_id))
                    else:
                        self.send(405, {'error': 'Method not allowed'})
                        return
                    if not result.rowcount:
                        self.send(404, {'error': 'Item no longer exists. Refresh the list.'})
                        return
                else:
                    self.send(404, {'error': 'Not found'})
                    return
            self.send(200, {'ok': True})
        except (ValueError, UnicodeError) as exc:
            self.send(400, {'error': str(exc)})
        except sqlite3.Error:
            self.send(500, {'error': 'Could not save the list. Please try again.'})

    @classmethod
    def recipe_fields(cls, body):
        name, _ = cls.fields(body)
        ingredients = body.get('ingredients')
        instructions = body.get('instructions', '')
        if not isinstance(instructions, str) or len(instructions) > 10000:
            raise ValueError('Instructions must be at most 10,000 characters.')
        if not isinstance(ingredients, list) or not 1 <= len(ingredients) <= 100:
            raise ValueError('Add between 1 and 100 ingredients.')
        clean = []
        for ingredient in ingredients:
            if not isinstance(ingredient, dict):
                raise ValueError('Invalid ingredient.')
            item_name, quantity = cls.fields(ingredient)
            staple = ingredient.get('staple', False)
            if type(staple) is not bool:
                raise ValueError('Invalid cupboard staple setting.')
            clean.append({'name': item_name, 'quantity': quantity, 'staple': staple})
        return name, json.dumps(clean), instructions.strip()

    @staticmethod
    def fields(body):
        name, quantity = body.get('name'), body.get('quantity', '')
        if not isinstance(name, str) or not name.strip() or len(name) > 120:
            raise ValueError('Enter an item name (up to 120 characters).')
        if not isinstance(quantity, str) or len(quantity) > 40:
            raise ValueError('Quantity must be at most 40 characters.')
        return name.strip(), quantity.strip()

    do_POST = mutate
    do_PATCH = mutate
    do_DELETE = mutate


if __name__ == '__main__':
    initialize()
    address = (os.environ.get('HOST', '0.0.0.0'), int(os.environ.get('PORT', '8080')))
    server = ThreadingHTTPServer(address, Handler)
    server.daemon_threads = True
    print(f'Grocery list listening on {address[0]}:{address[1]}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
