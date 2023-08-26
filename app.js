require('dotenv').config()

const http = require('http');
const fetch = require('./fetch');
const { getSegment } = require('./segment');

const addr = '0.0.0.0';
const port = process.env.PORT || 3000;

const upstream = process.env.UPSTREAM || '';
const allowedElUpstreams = (process.env.ALLOWED_EL_UPSTREAMS || '').split(',');

const playlistMime = 'application/x-mpegURL';
const segmentMime = 'video/mp2t';
const keyRgx = /^[0-9a-f]{32}$/;

const extractExt = (s) => s.substr(s.lastIndexOf('.')).toLowerCase();

const stgcrHandler = async (url, key, res) => {
  if (!key.match(keyRgx)) throw new Error();

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

  throw new Error();
};


const elHandler = async (url, akey, vkey, res) => {
  const burl = new URL(url.searchParams.get('url'));
  if (!allowedElUpstreams.includes(burl.host)) throw new Error();

  const bext = extractExt(burl.pathname);
  if (bext == '.mpd') {
    // generate m3u8 playlist base on mpd content
    res.statusCode = 200;
    res.setHeader('content-type', playlistMime);
  }

  const [
    ainiturl,
    abodyurl,
    viniturl,
    vbodyurl,
  ] = ['ainit', 'apath', 'vinit', 'vpath'].map((qkey) => {
    const u = new URL(url.searchParams.get(qkey), burl);
    if (u.hostname !== burl.hostname) {
      throw new Error(`Hostname ${u.hostname} for key ${qkey} invalid`);
    }
    const ext = extractExt(u.pathname);
    if (['.mp4', '.m4s'].indexOf(ext) == -1) {
      throw new Error(`Extension ${ext} for key ${qkey} invalid`);
    }
    return u;
  })
};


const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const key = url.searchParams.get('key') || "";
    const akey = url.searchParams.get('akey') || key;
    const vkey = url.searchParams.get('vkey') || key;
    res.setHeader('access-control-allow-origin', '*');

    if (url.pathname == '/el') {
      await elHandler(url, akey, vkey, res);
      return;
    }

    await stgcrHandler(key, url, res);
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
