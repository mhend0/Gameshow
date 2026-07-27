#!/usr/bin/env python3
"""Local web server for Game Show Studio.

Identical to `python3 -m http.server` with one important difference: it tells the
browser never to cache. The app is plain ES modules loaded straight from disk, and
a browser that holds on to an old copy of one of them will happily run a mix of
old and new code after an update — which looks like a bug that isn't there and
can't be cleared by an ordinary refresh.

    python3 serve.py [port]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8777


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass                      # keep the launcher's terminal window quiet


if __name__ == "__main__":
    handler = partial(NoCacheHandler, directory=".")
    with ThreadingHTTPServer(("", PORT), handler) as httpd:
        print(f"Game Show Studio → http://localhost:{PORT}/home.html")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
