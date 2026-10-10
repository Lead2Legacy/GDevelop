#!/usr/bin/env node
// Short Family fork: tiny static server for the GDevelop web-app build.
// No dependencies (Node built-ins only). Handles SPA fallback, correct MIME
// types (.wasm!), ETag/304, Range requests and cached brotli/gzip compression.
//
// Usage: node scripts/serve.js [--dir <path>] [--port 3800] [--host 127.0.0.1] [--no-spa]
// Defaults: --dir newIDE/app/build (relative to the repo root), PORT env also honoured.

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

const repoRoot = path.resolve(__dirname, '..');
const rootDir = path.resolve(
  getArg('dir', path.join(repoRoot, 'newIDE', 'app', 'build'))
);
const port = parseInt(getArg('port', process.env.PORT || '3800'), 10);
const host = getArg('host', '127.0.0.1');
const spaFallback = !args.includes('--no-spa');

if (!fs.existsSync(path.join(rootDir, 'index.html'))) {
  console.error(`No index.html in ${rootDir} - did you build first?`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.zip': 'application/zip',
};
const COMPRESSIBLE = /^(text\/|application\/(json|wasm|xml|manifest\+json)|image\/svg\+xml|font\/(ttf|otf)|model\/gltf)/;

const compressionCache = new Map(); // key -> Buffer
const compressionCacheMaxBytes = 256 * 1024 * 1024;
let compressionCacheBytes = 0;

const compress = (filePath, stat, encoding) =>
  new Promise((resolve, reject) => {
    const key = `${filePath}|${stat.mtimeMs}|${stat.size}|${encoding}`;
    const cached = compressionCache.get(key);
    if (cached) return resolve(cached);
    fs.readFile(filePath, (readError, data) => {
      if (readError) return reject(readError);
      const done = (error, result) => {
        if (error) return reject(error);
        if (compressionCacheBytes + result.length <= compressionCacheMaxBytes) {
          compressionCache.set(key, result);
          compressionCacheBytes += result.length;
        }
        resolve(result);
      };
      if (encoding === 'br') {
        zlib.brotliCompress(
          data,
          {
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
              [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
            },
          },
          done
        );
      } else {
        zlib.gzip(data, { level: 6 }, done);
      }
    });
  });

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, headers);
  res.end(body);
};

const resolveFile = urlPathname => {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch (e) {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const candidate = path.normalize(path.join(rootDir, decoded));
  if (candidate !== rootDir && !candidate.startsWith(rootDir + path.sep))
    return null;
  return candidate;
};

const statOrNull = filePath => {
  try {
    return fs.statSync(filePath);
  } catch (e) {
    return null;
  }
};

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
  }

  const { pathname } = new URL(req.url, 'http://localhost');
  let filePath = resolveFile(pathname);
  if (!filePath) return send(res, 400, 'Bad Request');

  let stat = statOrNull(filePath);
  if (stat && stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    stat = statOrNull(filePath);
  }
  if (!stat || !stat.isFile()) {
    const looksLikeAsset = path.extname(pathname) !== '';
    if (spaFallback && !looksLikeAsset) {
      filePath = path.join(rootDir, 'index.html');
      stat = statOrNull(filePath);
    }
    if (!stat || !stat.isFile()) return send(res, 404, 'Not Found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const relative = path.relative(rootDir, filePath).split(path.sep).join('/');
  const immutable = /^static\/(js|css|media)\//.test(relative);
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

  const headers = {
    'Content-Type': contentType,
    'Last-Modified': stat.mtime.toUTCString(),
    ETag: etag,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Accept-Ranges': 'bytes',
    Vary: 'Accept-Encoding',
    'X-Content-Type-Options': 'nosniff',
  };

  if (req.headers['if-none-match'] === etag) {
    return send(res, 304, null, headers);
  }

  // Range requests (media playback on Safari needs them). Never compressed.
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      let start = match[1] === '' ? stat.size - parseInt(match[2], 10) : parseInt(match[1], 10);
      let end = match[1] === '' || match[2] === '' ? stat.size - 1 : parseInt(match[2], 10);
      end = Math.min(end, stat.size - 1);
      if (start < 0 || start > end) {
        return send(res, 416, null, { 'Content-Range': `bytes */${stat.size}` });
      }
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
  }

  const acceptEncoding = req.headers['accept-encoding'] || '';
  const encoding =
    stat.size > 1024 && COMPRESSIBLE.test(contentType)
      ? /\bbr\b/.test(acceptEncoding)
        ? 'br'
        : /\bgzip\b/.test(acceptEncoding)
        ? 'gzip'
        : null
      : null;

  if (encoding) {
    try {
      const body = await compress(filePath, stat, encoding);
      res.writeHead(200, {
        ...headers,
        'Content-Encoding': encoding,
        'Content-Length': body.length,
      });
      return res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      console.error(`Compression failed for ${filePath}:`, error);
      // Fall through to uncompressed.
    }
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(
    `[game-maker] serving ${rootDir} on http://${host}:${port} (spa=${spaFallback})`
  );
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
