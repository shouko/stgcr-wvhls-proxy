require('dotenv').config()

const http = require('http');
const fetch = require('./fetch');
const { getSegment, getCombinedSegment } = require('./segment');
const { fetchManifest } = require('./mpd');

const addr = '0.0.0.0';
const port = process.env.PORT || 3000;

const upstream = process.env.UPSTREAM || '';
const allowedElUpstreams = (process.env.ALLOWED_EL_UPSTREAMS || '').split(',').map((h) => h.trim()).filter((h) => h.length);

const playlistMime = 'application/x-mpegURL';
const segmentMime = 'video/mp2t';
const jsonMime = 'application/json';
const keyRgx = /^[0-9a-f]{32}$/;

const cacheHeaderByMime = new Map([
  [segmentMime, 'public, max-age=86400'],
  [playlistMime, 'public, max-age=1'],
  [jsonMime, 'no-cache'],
]);

const extractExt = (s) => s.substr(s.lastIndexOf('.')).toLowerCase();

const servePayload = (res, mime, payload, statusCode) => {
  res.statusCode = statusCode || 200;
  res.setHeader('content-type', mime);
  if (cacheHeaderByMime.has(mime) && payload.length > 0) {
    res.setHeader('cache-control', cacheHeaderByMime.get(mime));
  } else {
    res.setHeader('cache-control', 'no-cache');
  }
  return res.end(payload);
};

const serveJson = (res, body, statusCode) => servePayload(
  res,
  jsonMime,
  JSON.stringify(body, null, 2),
  statusCode,
);

const stgcrHandler = async (url, key, res) => {
  if (!key.match(keyRgx)) throw new Error();

  const ext = extractExt(url.pathname);
  if (ext == '.m3u8') {
    const resp = await fetch(`${upstream}${url.pathname}`);
    const filtered = resp.split("\n").filter((l) => !l.startsWith('#EXT-X-KEY') && !l.startsWith('#EXT-X-MAP:URI'));
    const transformed = filtered.map((l) => (l.startsWith('#') || !l.length) ? l : `${l}${l.endsWith('.m4s') ? '.ts' : ''}?key=${key}`).join("\n");
    return servePayload(res, playlistMime, transformed);
  } else if (ext == '.ts') {
    const decrypted = await getSegment(`${upstream}${url.pathname.substr(0, url.pathname.lastIndexOf('.'))}`, key);
    return servePayload(res, segmentMime, decrypted);
  }

  throw new Error();
};

const isAllowedDomain = (url) => allowedElUpstreams.some((h) => url.host.endsWith(h));

const assertAllowedDomain = (url) => {
  if (!isAllowedDomain(url)) throw new Error('Requested domain not in allowed list');
};

const elHandler = async (url, res) => {
  const parseArrSearchParam = (qkey) => {
    const param = url.searchParams.get(qkey);
    if (!param) return [];
    try {
      const parsed = JSON.parse(param);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return parsed;
      }
    } catch(e) {
      // console.error(e);
    }
    return [param];
  };

  const keys = [
    ...parseArrSearchParam('keys'),
    ...parseArrSearchParam('key'),
  ]
  if (!keys.length) throw new Error('Missing key');
  if (keys.some((maybeKey) => !maybeKey.match(keyRgx))) {
    throw new Error('Invalid key format');
  }

  const urlParam = url.searchParams.get('url');
  if (urlParam) {
    const manifestUrl = new URL(url.searchParams.get('url'));
    assertAllowedDomain(manifestUrl);
    const { adaptationSets } = await fetchManifest(manifestUrl.toString());
    const { bestRepresentation: mainRep } = adaptationSets.find(({isVideo}) => isVideo) || adaptationSets.find(({isAudio}) => isAudio);
    const { segmentDuration } = mainRep;
    const endNumber = Math.min(parseInt(url.searchParams.get('endNumber'), 10) || mainRep.startNumber, mainRep.startNumber);
    const startNumber = Math.max(parseInt(url.searchParams.get('startNumber'), 10) || (endNumber - 4), 1);
    const isVod = Boolean(url.searchParams.get('vod'));
    const length = endNumber - startNumber + 1;
    const baseUrl = manifestUrl.href.substring(0, manifestUrl.href.lastIndexOf('/') + 1);
    const text = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      ...(isVod ? ['#EXT-X-PLAYLIST-TYPE:VOD'] : []),
      '#EXT-X-VERSION:4',
      `#EXT-X-MEDIA-SEQUENCE:${startNumber}`,
      ...new Array(length).fill().flatMap((_, i) => {
        const num = startNumber + i;
        const inits = adaptationSets.map(({bestRepresentation}) => bestRepresentation.initialization.split('?').shift());
        const bodies = adaptationSets.map(({bestRepresentation}) => bestRepresentation.media.replace('$Number$', num).split('?').shift());
        const query = [
          ['burl', baseUrl],
          ['inits', inits],
          ['bodies', bodies],
          ['keys', keys],
        ].map(([k, v]) => `${k}=${encodeURIComponent(Array.isArray(v) ? JSON.stringify(v) : v)}`).join('&');
        return [
          `#EXTINF:${segmentDuration}`,
          `el?${query}`,
        ]
      }),
      ...(isVod ? ['#EXT-X-ENDLIST'] : []),
      '',
    ].join('\n');
    return servePayload(res, playlistMime, text);
  }

  const [
    inits,
    bodies,
  ] = ['inits', 'bodies'].map((qkey) => parseArrSearchParam(qkey));

  const burl = new URL(url.searchParams.get('burl'));
  assertAllowedDomain(burl);
  const buildUrls = (qkey, paths) => paths.map((path) => {
    const u = new URL(path, burl);
    if (u.hostname !== burl.hostname) {
      throw new Error(`Hostname ${u.hostname} for key ${qkey} invalid`);
    }
    const ext = extractExt(u.pathname);
    if (['.mp4', '.m4s'].indexOf(ext) == -1) {
      throw new Error(`Extension ${ext} for key ${qkey} invalid`);
    }
    return u.href;
  });

  const initUrls = buildUrls('inits', inits);
  const bodyUrls = buildUrls('bodies', bodies);
  const length = Math.min(initUrls.length, bodyUrls.length);

  const segmentParams = new Array(length).fill().map((_, i) => ({
    initUrl: initUrls[i],
    bodyUrl: bodyUrls[i],
    key: i < keys.length ? keys[i] : keys[0],
  }));

  const decryptedCombined = await getCombinedSegment(segmentParams);

  return servePayload(res, segmentMime, decryptedCombined);
};


const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const key = url.searchParams.get('key') || "";
    res.setHeader('access-control-allow-origin', '*');

    if (url.pathname == '/') {
      return serveJson(res, {
        message: 'hello world!',
      })
    } else if (url.pathname == '/_stats') {
      return serveJson(res, {
        memoryUsage: process.memoryUsage(),
      });
    } else if (url.pathname == '/el') {
      await elHandler(url, res);
      return;
    }

    await stgcrHandler(key, url, res);
  } catch(e) {
    console.error(e);
    return serveJson(res, {
      success: false,
    }, 404);
  }
});

server.listen(port, addr, () => {
  console.log(`Server running at http://${addr}:${port}/`);
});
