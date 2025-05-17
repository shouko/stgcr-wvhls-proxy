require('dotenv').config()


const parseOptionalList = (s) => String(s || '').split(',').map((h) => h.trim()).filter((h) => h.length)

module.exports = {
    maxCacheEntries: parseInt(process.env.MAX_CACHE_ENTRIES) || 10,
    port: process.env.PORT || 3000,
    upstream: process.env.UPSTREAM || '',
    allowedElUpstreams: parseOptionalList(process.env.ALLOWED_EL_UPSTREAMS),
    happyElUpstreams: parseOptionalList(process.env.HAPPY_EL_UPSTREAMS),
}
