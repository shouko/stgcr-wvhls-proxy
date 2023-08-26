require('dotenv').config()

const http = require('http');
const fetch = require('./fetch');
const { getSegment } = require('./segment');

const addr = '0.0.0.0';
const port = process.env.PORT || 3000;

const upstream = process.env.UPSTREAM || '';
const playlistMime = 'application/x-mpegURL';
const segmentMime = 'video/mp2t';

const initSegCache = new Map();
const extractExt = (s) => s.substr(s.lastIndexOf('.'));

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const key = url.searchParams.get('key') || "";

    if (!key.match(/^[0-9a-f]{32}$/)) throw new Error();

    res.setHeader('access-control-allow-origin', '*');
    const ext = extractExt(url.pathname);
    if (ext == '.m3u8') {
      const resp = await fetch(`${upstream}${url.pathname}`);
      res.statusCode = 200;
      res.setHeader('content-type', playlistMime);
      const filtered = resp.split("\n").filter((l) => !l.startsWith('#EXT-X-KEY') && !l.startsWith('#EXT-X-MAP:URI'));
      const transformed = filtered.map((l) => (l.startsWith('#') || !l.length) ? l : `${l}${l.endsWith('.m4s') ? '.ts' : ''}?key=${key}`).join("\n");
      res.end(transformed);
    } else if (ext == '.ts') {
      const decrypted = await getSegment(`${upstream}${url.pathname.substr(0, url.pathname.lastIndexOf('.'))}`, key);
      res.statusCode = 200;
      res.setHeader('cache-control', 'public, max-age=86400');
      res.setHeader('content-type', segmentMime);
      res.end(decrypted);
    }
  } catch(e) {
    console.error(e);
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain');
    res.end('');
  }
});

server.listen(port, addr, () => {
  console.log(`Server running at http://${addr}:${port}/`);
});
