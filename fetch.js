const https = require('https');
const LRU = require('lru-cache');
const userAgents = require('top-user-agents/desktop');
const { maxCacheEntries, happyElUpstreams } = require('./config')

const httpsAgent = new https.Agent({ keepAlive: true });
const cache = new LRU({
  max: maxCacheEntries,
  maxAge: 60 * 60 * 1000,
});

const rewriteRequestUrl = (u) => {
  const parsed = new URL(u);
  const isHappyUpstream = happyElUpstreams.some(suffix => parsed.hostname.endsWith(suffix));
  if (!isHappyUpstream) return u;
  return u.replace(/(manifest_video_.+init\.mp4)$/, 'manifest_video/%2E%2E%2F$1');
};

module.exports = async (url, options = {}) => {
  if (cache.has(url)) {
    console.info(`CACHE HIT: ${url}`);
    return cache.get(url);
  }

  console.info(`CACHE MISS: ${url}`);

  const path = (new URL(url)).pathname;
  const mediaTypes = [
    "video/mp4",
    //"application/octet-stream", // init.mp4 and others ...?
  ];
  const manifestTypes = [
    "application/vnd.apple.mpegurl", // m3u8
    "application/dash+xml", // mpd
  ];
  const cachable = contentType => path.endsWith('.mp4') || path.endsWith('.m4s') || mediaTypes.includes(contentType);
  const isText = contentType => path.endsWith('.m3u8') || path.endsWith('.mpd') || manifestTypes.includes(contentType);

  return fetch(rewriteRequestUrl(url), {
    agent: httpsAgent,
    headers: {
      'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)]
    },
    ...options
  }).then((r) => {
    const contentType = r.headers.get("Content-Type");
    if (!mediaTypes.includes(contentType) && !manifestTypes.includes(contentType)) console.warn(`Unknown content-type ${contentType} for ${path}`);
    if (isText(contentType)) return r.text();
    return r.arrayBuffer().then((ab) => Buffer.from(ab))
      .then((r) => {
        if (cachable(contentType)) cache.set(url, r);
        return r;
      })
  });
};
