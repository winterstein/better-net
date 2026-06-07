import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataDir = path.join(__dirname, '..', 'test-data');
const PORT = Number(process.env.FIXTURE_PORT || 8765);

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/' || urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  const fileName = urlPath.replace(/^\//, '');
  const filePath = path.join(testDataDir, fileName);

  if (!filePath.startsWith(testDataDir) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  const type = ext === '.html' ? 'text/html' : ext === '.json' ? 'application/json' : 'text/plain';
  res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(fs.readFileSync(filePath));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Fixture server listening on http://127.0.0.1:${PORT}`);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
