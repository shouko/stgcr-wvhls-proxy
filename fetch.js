const https = require('https');
const LRU = require('lru-cache');
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

  const cachable = url.endsWith('.mp4') || url.endsWith('.m4s');
  const isText = url.endsWith('.m3u8') || url.endsWith('.mpd');

  return fetch(rewriteRequestUrl(url), {
    agent: httpsAgent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
    },
    ...options
  }).then((r) => {
    if (isText) return r.text()
    return r.arrayBuffer().then((ab) => Buffer.from(ab));
  }).then((r) => {
    if (cachable) cache.set(url, r);
    return r;
  });
};
