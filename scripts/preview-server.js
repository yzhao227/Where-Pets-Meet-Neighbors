const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mini = path.join(root, 'miniprogram');
const port = Number(process.env.PET_PREVIEW_PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4' };
const { mediaRange } = require('./lib/preview-media');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
function bundle() {
  const entries = walk(mini).filter(file => file.endsWith('.js')).map(file => {
    const id = path.relative(mini, file).split(path.sep).join('/');
    return JSON.stringify(id) + ': function(require,module,exports){\n' + fs.readFileSync(file, 'utf8') + '\n}';
  });
  return 'window.__miniModules={' + entries.join(',\n') + '};';
}
function manifest() {
  const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
  const pages = {};
  const routes = app.pages.concat((app.subPackages || []).flatMap(pkg => pkg.pages.map(page => pkg.root + '/' + page)));
  routes.forEach(route => {
    const base = path.join(mini, route);
    const read = ext => fs.existsSync(base + ext) ? fs.readFileSync(base + ext, 'utf8') : '';
    pages[route] = { template: read('.wxml'), style: read('.wxss'), config: JSON.parse(read('.json') || '{}') };
  });
  return JSON.stringify({ app, pages, style: fs.readFileSync(path.join(mini, 'app.wxss'), 'utf8') });
}
const server = http.createServer((req, res) => {
  const send = (code, content, type = 'text/plain; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(req.method === 'HEAD' ? undefined : content);
  };
  if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__bundle.js') return send(200, bundle(), mime['.js']);
    if (url.pathname === '/__manifest.json') return send(200, manifest(), mime['.json']);
    let relative = decodeURIComponent(url.pathname);
    if (relative === '/') relative = '/preview/index.html';
    if (relative.startsWith('/assets/') || /^\/media[2-9]?\/clips\/\d+\.mp4$/.test(relative)) relative = '/miniprogram' + relative;
    if (!relative.startsWith('/preview/') && !relative.startsWith('/miniprogram/assets/') && !/^\/miniprogram\/media[2-9]?\/clips\/\d+\.mp4$/.test(relative)) return send(404, 'Not found');
    const file = path.resolve(root, '.' + relative);
    const allowed = [path.join(root, 'preview') + path.sep, path.join(mini, 'assets') + path.sep, ...['media', ...Array.from({ length: 8 }, (_, i) => 'media' + (i + 2))].map(name => path.join(mini, name, 'clips') + path.sep)];
    if (!allowed.some(prefix => file.startsWith(prefix)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'Not found');
    if (!allowed.some(prefix => fs.realpathSync(file).startsWith(prefix))) return send(404, 'Not found');
    if (path.extname(file) === '.mp4') {
      const bytes = fs.statSync(file).size, range = mediaRange(req.headers.range, bytes);
      if (!range) { res.writeHead(416, { 'Content-Range': 'bytes */' + bytes }); return res.end(); }
      const { start, end, partial } = range;
      res.writeHead(partial ? 206 : 200, { 'Content-Type': mime['.mp4'], 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...(partial ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + bytes } : {}) });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
    }
    send(200, fs.readFileSync(file), mime[path.extname(file)] || 'application/octet-stream');
  } catch (error) { send(500, 'Preview error: ' + error.message); }
});
server.listen(port, '127.0.0.1', () => console.log('有宠有邻本机预览：http://127.0.0.1:' + port));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
