import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
import server


class GroceryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = server.DB
        server.DB = Path(self.temp.name) / 'shopping.db'
        server.initialize()
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.http.server_port}'

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        server.DB = self.old_db
        self.temp.cleanup()

    def request(self, method='GET', path='/api/items', body=None, origin=None):
        headers = {'Content-Type': 'application/json'}
        if origin:
            headers['Origin'] = origin
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
        try:
            response = urllib.request.urlopen(req)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            return response.status, json.loads(response.read())

    def test_full_lifecycle_and_persistence(self):
        self.assertEqual(self.request()[1], [])
        self.assertEqual(self.request('POST', body={'name': ' Milk ', 'quantity': '2 litres'})[0], 200)
        item = self.request()[1][0]
        self.assertEqual(item['name'], 'Milk')
        path = '/api/items/' + str(item['id'])
        self.assertEqual(self.request('PATCH', path, {'checked': True})[0], 200)
        self.assertEqual(self.request('PATCH', path, {'name': 'Oat milk', 'quantity': '1 carton'})[0], 200)
        server.initialize()
        saved = self.request()[1][0]
        self.assertEqual((saved['name'], saved['checked']), ('Oat milk', 1))
        self.assertEqual(self.request('DELETE', path, {})[0], 200)
        self.assertEqual(self.request()[1], [])

    def test_meal_plan(self):
        self.request('POST', body={'name': 'Milk'})
        meals = self.request(path='/api/meals')[1]
        self.assertEqual([m['day'] for m in meals], list(server.DAYS))
        self.assertTrue(all(m['meal'] == '' for m in meals))
        self.assertEqual(self.request('PATCH', '/api/meals/monday', {'meal': ' Spagbol '})[0], 200)
        self.request('PATCH', '/api/meals/tuesday', {'meal': 'Curry'})
        server.initialize()
        self.assertEqual(self.request(path='/api/meals')[1][0]['meal'], 'Spagbol')
        self.assertEqual(self.request(path='/api/meals')[1][1]['meal'], 'Curry')
        self.assertEqual(self.request()[1][0]['name'], 'Milk')
        self.assertEqual(self.request('PATCH', '/api/meals/monday', {'meal': ''})[0], 200)
        self.assertEqual(self.request(path='/api/meals')[1][0]['meal'], '')
        for value in [None, 42, 'a' * 201]:
            self.assertEqual(self.request('PATCH', '/api/meals/monday', {'meal': value})[0], 400)
        self.assertEqual(self.request('PATCH', '/api/meals/funday', {'meal': 'Soup'})[0], 404)
        self.assertEqual(self.request('PATCH', '/api/meals/monday', {'meal': 'Soup'}, origin='https://elsewhere.example')[0], 403)

    def make_recipe(self):
        recipe = {'name': 'Spagbol', 'ingredients': [
            {'name': 'Mince', 'quantity': '500 g', 'staple': False},
            {'name': 'Tomatoes', 'quantity': '2 tins', 'staple': True}],
            'instructions': 'Brown the mince. Simmer.'}
        self.assertEqual(self.request('POST', '/api/recipes', recipe)[0], 200)
        return self.request(path='/api/recipes')[1][0]

    def test_recipe_lifecycle_and_migration(self):
        self.request('POST', body={'name': 'Milk'})
        self.request('PATCH', '/api/meals/sunday', {'meal': 'Roast'})
        recipe = self.make_recipe()
        server.initialize()
        saved = self.request(path='/api/recipes')[1][0]
        self.assertEqual(saved, recipe)
        self.assertEqual(self.request()[1][0]['name'], 'Milk')
        self.assertEqual(self.request(path='/api/meals')[1][-1]['meal'], 'Roast')
        recipe['name'] = 'Pasta'
        path = '/api/recipes/' + str(recipe['id'])
        self.assertEqual(self.request('PATCH', path, recipe)[0], 200)
        self.assertEqual(self.request('PATCH', path, recipe)[0], 409)
        self.assertEqual(self.request('DELETE', path, {'version': 2})[0], 200)
        self.assertEqual(self.request(path='/api/recipes')[1], [])

    def test_recipe_selection_retry_and_plan_only(self):
        recipe = self.make_recipe()
        action = {'request_id': 'one-unique-request', 'recipe_id': recipe['id'], 'version': 1,
                  'day': 'monday', 'previous_meal': '', 'selected': [0]}
        self.assertEqual(self.request('POST', '/api/recipe-actions', action)[0], 200)
        self.assertEqual(self.request('POST', '/api/recipe-actions', action)[0], 200)
        self.assertEqual([i['name'] for i in self.request()[1]], ['Mince'])
        self.assertEqual(self.request(path='/api/meals')[1][0]['meal'], 'Spagbol')
        action.update(request_id='two-unique-request', day='tuesday', selected=[])
        self.assertEqual(self.request('POST', '/api/recipe-actions', action)[0], 200)
        self.assertEqual(len(self.request()[1]), 1)
        action.update(request_id='three-unique-request', day=None, selected=[1])
        self.assertEqual(self.request('POST', '/api/recipe-actions', action)[0], 200)
        self.assertEqual(self.request()[1][-1]['name'], 'Tomatoes')
        action.update(request_id='four-unique-request', day='monday', previous_meal='', selected=[0])
        self.assertEqual(self.request('POST', '/api/recipe-actions', action)[0], 409)
        self.assertEqual(len(self.request()[1]), 2)

    def test_recipe_validation(self):
        for ingredients in [None, [], [42], [{'name': 'Salt', 'staple': 'yes'}]]:
            self.assertEqual(self.request('POST', '/api/recipes', {'name': 'Soup', 'ingredients': ingredients})[0], 400)
        recipe = self.make_recipe()
        for selected in [[-1], [2], [True], [0, 0], 'all']:
            self.assertEqual(self.request('POST', '/api/recipe-actions', {
                'request_id': 'validation-request', 'recipe_id': recipe['id'], 'version': 1, 'selected': selected})[0], 400)
        self.assertEqual(self.request()[1], [])
        self.assertEqual(self.request('POST', '/api/recipes', recipe, origin='https://elsewhere.example')[0], 403)

    def test_validation_and_origin(self):
        for body in ({'name': ' '}, {'name': 42}, {'name': 'a' * 121}, []):
            self.assertEqual(self.request('POST', body=body)[0], 400)
        self.assertEqual(self.request('POST', body={'name': 'Eggs'}, origin='https://elsewhere.example')[0], 403)
        self.assertEqual(self.request('PATCH', '/api/items/999', {'checked': True})[0], 404)
        self.assertEqual(self.request()[1], [])


if __name__ == '__main__':
    unittest.main()
