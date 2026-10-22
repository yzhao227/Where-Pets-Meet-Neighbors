const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mini = path.join(root, 'miniprogram');
const port = Number(process.env.PET_PREVIEW_PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function isPackaged(file) {
  const relative = path.relative(mini, file).split(path.sep).join('/');
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  return !(project.packOptions && project.packOptions.ignore || []).some(entry => {
    const name = String(entry.value || '').replace(/^\/+|\/+$/g, '');
    return entry.type === 'file' ? relative === name : entry.type === 'folder' && (relative === name || relative.startsWith(name + '/'));
  });
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
function bundle() {
  const entries = walk(mini).filter(file => file.endsWith('.js') && isPackaged(file)).map(file => {
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
function handleRequest(req, res) {
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
    if (relative.startsWith('/assets/')) relative = '/miniprogram' + relative;
    if (!relative.startsWith('/preview/') && !relative.startsWith('/miniprogram/assets/')) return send(404, 'Not found');
    const file = path.resolve(root, '.' + relative);
    const allowed = [path.join(root, 'preview') + path.sep, path.join(mini, 'assets') + path.sep];
    if (!allowed.some(prefix => file.startsWith(prefix)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'Not found');
    const realFile = fs.realpathSync(file);
    if (!allowed.some(prefix => realFile.startsWith(prefix)) || !isPackaged(file) || !isPackaged(realFile)) return send(404, 'Not found');
    if (/\.(?:mp4|webm|mov|m4v)$/i.test(realFile)) return send(404, 'Not found');
    send(200, fs.readFileSync(file), mime[path.extname(file)] || 'application/octet-stream');
  } catch (error) { send(500, 'Preview error: ' + error.message); }
}
if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(port, '127.0.0.1', () => console.log('有宠有邻本机预览：http://127.0.0.1:' + port));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { handleRequest };
