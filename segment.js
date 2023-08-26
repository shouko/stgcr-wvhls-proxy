const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
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

const getSegmentFile = async (url, key, initUrl) => {
  const fn = `${os.tmpdir()}/${uuidv4()}.ts`;
  const data = await getSegment(url, key, initUrl);
  await fs.promises.writeFile(fn, data);
  return fn;
};

const getCombinedSegment = async (segs) => new Promise(async (resolve, reject) => {
  const filenames = await Promise.all(segs.map(
    ({initUrl, bodyUrl, key}) => getSegmentFile(bodyUrl, key, initUrl)
  ));

  const inputArgs = filenames.map((fn) => ['-i', fn]).flat();

  createFfmpeg(inputArgs, async (err, data) => {
    await Promise.all(filenames.map(
      (fn) => fs.promises.unlink(fn)
    ));
    if (err) return reject(err);
    return resolve(data);
  });
});

module.exports = {
  getSegment,
  getCombinedSegment,
};
