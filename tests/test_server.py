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

    def test_validation_and_origin(self):
        for body in ({'name': ' '}, {'name': 42}, {'name': 'a' * 121}, []):
            self.assertEqual(self.request('POST', body=body)[0], 400)
        self.assertEqual(self.request('POST', body={'name': 'Eggs'}, origin='https://elsewhere.example')[0], 403)
        self.assertEqual(self.request('PATCH', '/api/items/999', {'checked': True})[0], 404)
        self.assertEqual(self.request()[1], [])


if __name__ == '__main__':
    unittest.main()
