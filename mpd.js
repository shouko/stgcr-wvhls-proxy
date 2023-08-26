const ObjTree = require('objtree');
const fetch = require('./fetch');

const parser = new ObjTree();

const getPeriod = (doc) => {
  const {
    MPD: {
      Period: period
    }
  } = doc;
  if (Array.isArray(period)) {
    return period[0];
  }
  return period;
};

const ensureArray = (maybeArray) => {
  if (Array.isArray(maybeArray)) {
    return maybeArray;
  }
  if (maybeArray) {
    return [maybeArray];
  }
  return [];
}

const defaultKIDKey = '-cenc:default_KID';
const schemeKey = '-schemeIdUri';
const wvScheme = 'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed';
const audioChannelsScheme = 'urn:mpeg:dash:23003:3:audio_channel_configuration:2011';

const parseValueTyped = (value) => {
  const parsed = parseInt(value, 10);
  if (parsed.toString() === value) {
    return parsed;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

const filterParseProperties = (obj, propKeys) => Object.fromEntries(Object.entries(obj).map(([key, value]) => {
  const matchedKey = propKeys.find((pk) => `-${pk}` === key);
  if (!matchedKey) return false;
  return [matchedKey, parseValueTyped(value)];
}).filter(x => x));

const parseRepresentation = (rep) => {
  const propKeys = ['id', 'bandwidth', 'audioSamplingRate', 'codecs', 'width', 'height', 'frameRate'];
  const propsObj = filterParseProperties(rep, propKeys)

  const segTemplatePropKeys = ['timescale', 'media', 'initialization', 'startNumber'];
  const segTemplatePropsObj = filterParseProperties(rep.SegmentTemplate, segTemplatePropKeys);

  const firstSegment = ensureArray(rep.SegmentTemplate.SegmentTimeline.S).map((x) => filterParseProperties(x, ['t', 'd', 'r'])).shift()
  const segmentDuration = firstSegment.d / segTemplatePropsObj.timescale;

  const audioChannelConfiguration = ensureArray(rep.audioChannelConfiguration);
  const audioChannelsEntry = audioChannelConfiguration.find((x) => x[schemeKey] === audioChannelsScheme);
  const audioChannelsObj = audioChannelsEntry ? {
    audioChannels: parseValueTyped(audioChannelsEntry['-value'])
  } : {};

  const contentProtections = ensureArray(rep.ContentProtection);
  const defaultKIDEntry = contentProtections.find((x) => x[defaultKIDKey]);
  const wvPSSHEntry = contentProtections.find((x) => x[schemeKey] === wvScheme);

  return {
    protected: contentProtections.length > 0,
    defaultKID: defaultKIDEntry && defaultKIDEntry[defaultKIDKey],
    segmentDuration,
    wvPSSH: wvPSSHEntry && wvPSSHEntry['cenc:pssh']['#text'],
    ...audioChannelsObj,
    ...propsObj,
    ...segTemplatePropsObj,
  }
};

const getBestRepresentation = (parsedReps) => {
  if (parsedReps.length < 2) return parsedReps[0];
  const sorted = [...parsedReps].sort((a, b) => {
    const aPixels = a.width * a.height;
    const bPixels = b.width * b.height;
    if (aPixels && bPixels) {
      const diff = bPixels - aPixels;
      if (diff != 0) return diff;
    }
    const keys = ['bandwidth', 'audioSamplingRate', 'frameRate'];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (a[key] && b[key]) {
        const diff = b[key] - a[key];
        if (diff != 0) return diff;
      }
    }
    return a.id - b.id;
  });
  return sorted.shift();
};

const parseAdaptationSet = (adaptationSet) => {
  const propKeys = ['id', 'mimeType', 'segmentAlignment', 'lang', 'startWithSAP', 'subsegmentAlignment', 'subsegmentStartsWithSAP', 'bitstreamSwitching'];
  const propsObj = filterParseProperties(adaptationSet, propKeys);

  const representations = ensureArray(adaptationSet.Representation).map((rep) => parseRepresentation(rep));
  return {
    isVideo: adaptationSet['-mimeType'].startsWith('video/'),
    isAudio: adaptationSet['-mimeType'].startsWith('audio/'),
    bestRepresentation: getBestRepresentation(representations),
    representations: representations,
    ...propsObj,
  };
};

const parseManifest = (text) => {
  const doc = parser.parseXML(text);
  const mpdPropKeys = ['id', 'type', 'mediaPresentationDuration', 'minBufferTime', 'profiles'];
  const mpdPropsObj = filterParseProperties(doc.MPD, mpdPropKeys);

  const baseURLs = ensureArray(doc.MPD.BaseURL);

  const period = getPeriod(doc);
  const periodPropKeys = ['start', 'id', 'duration'];
  const periodPropsObj = filterParseProperties(period, periodPropKeys);

  const adaptationSets = ensureArray(period.AdaptationSet).filter((x) => {
    return ['video/', 'audio/'].some((prefix) => {
      return x['-mimeType']?.startsWith(prefix);
    });
  }).map((x) => parseAdaptationSet(x));
  return {
    ...mpdPropsObj,
    ...periodPropsObj,
    baseURLs,
    adaptationSets,
  };
};

const fetchManifest = async (url) => {
  const text = await fetch(url);
  return parseManifest(text);
};

module.exports = {
  fetchManifest,
  parseManifest,
};