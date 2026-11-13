const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'pwa');
const PORT = process.env.PORT || 4731;
const TYPES = { '.html':'text/html', '.webmanifest':'application/manifest+json', '.js':'text/javascript', '.png':'image/png', '.json':'application/json' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const full = path.join(ROOT, p);
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(full);
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log('Finsy PWA preview on http://localhost:' + PORT));
