const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const fetch = require('./fetch');

const extractPath = (s) => s.substr(0, s.lastIndexOf('/'));

const createFfmpeg = (inputArgs, cb) => {
  const output = [];
  const ff = spawn(ffmpegPath, [
    '-loglevel', 'error',
    ...inputArgs,
    '-c', 'copy',
    '-copyts', '-f', 'mpegts',
    'pipe:1'
  ]);

  ff.stdout.on('data', (data) => {
    output.push(data);
  });
  ff.stderr.on('data', (data) => {
    console.error(data.toString());
  });

  ff.on('close', (code) => {
    if (code !== 0) {
      console.error(`FFmpeg exited with ${code}`);
      return cb(code, null);
    }
    return cb(null, Buffer.concat(output));
  });

  return ff;
};

const getSegment = (url, key, initUrl) => new Promise(async (resolve, reject) => {
  const [ segInit, segBody ] = await Promise.all([
    fetch(initUrl || `${extractPath(url)}/init.mp4`),
    fetch(url),
  ]);

  const inputArgs = [
    '-f', 'mp4',
    '-decryption_key', key,
    '-i', 'pipe:0',
  ];

  const ff = createFfmpeg(inputArgs, (err, data) => {
    if (err) return reject(err);
    return resolve(data);
  });

  ff.stdin.write(segInit);
  ff.stdin.write(segBody);
  ff.stdin.end();
});

const getCombinedSegment = async (ainiturl, abodyurl, akey, viniturl, vbodyurl, vkey) => {
  const [
    aseg,
    vseg,
  ] = await Promise.all([
    getSegment(abodyurl, akey, ainiturl),
    getSegment(vbodyurl, vkey, viniturl),
  ]);

  const inputArgs = [
    '-f', 'mpegts',
    '-i', 'pipe:0',
  ];

  const ff = createFfmpeg(inputArgs, (err, data) => {
    if (err) return reject(err);
    return resolve(data);
  });

  ff.stdin.write(aseg);
  ff.stdin.write(vseg);
  ff.stdin.end();
}

module.exports = {
  getSegment,
  getCombinedSegment,
};
