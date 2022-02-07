const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const fetch = require('./fetch');

const extractPath = (s) => s.substr(0, s.lastIndexOf('/'));

const getSegment = (url, key) => new Promise(async (resolve, reject) => {
  const [ segInit, segBody ] = await Promise.all([
    fetch(`${extractPath(url)}/init.mp4`),
    fetch(url),
  ]);

  const ffArgs = [
    '-loglevel', 'error',
    '-f', 'mp4',
    '-decryption_key', key,
    '-i', 'pipe:0', '-c', 'copy',
    '-copyts', '-f', 'mpegts',
    'pipe:1'
  ];

  const output = [];
  const ff = spawn(ffmpegPath, ffArgs);

  ff.stdout.on('data', (data) => {
    output.push(data);
  });
  ff.stderr.on('data', (data) => {
    console.error(data.toString());
  });

  ff.on('close', (code) => {
    if (code !== 0) {
      console.error(`FFmpeg exited with ${code}`);
      return reject(code);
    }
    return resolve(Buffer.concat(output));
  });

  ff.stdin.write(segInit);
  ff.stdin.write(segBody);
  ff.stdin.end();
});

module.exports = {
  getSegment
};
