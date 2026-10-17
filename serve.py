"""Local preview server for KO 2027 — like `python3 -m http.server`, but tells the
browser never to cache, so a reload always picks up the latest code.

Run:   python3 serve.py        then open http://localhost:8027/
"""
import http.server
import socket

PORT = 8027


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


class DualStackServer(http.server.ThreadingHTTPServer):
    # Listen on IPv6 and IPv4, so http://localhost works whichever one the Mac picks.
    address_family = socket.AF_INET6
    allow_reuse_address = True

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


with DualStackServer(("::", PORT), NoCacheHandler) as httpd:
    print(f"KO 2027 preview: http://localhost:{PORT}/  (admin: /admin.html, TVs: /tv.html) — Ctrl-C to stop")
    httpd.serve_forever()
