// Encode a stereo AudioBuffer to a 16-bit PCM WAV Blob.
export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}

// Inspect a rendered buffer for silence, clipping and missing channels.
export function inspectBuffer(buffer) {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  let peakL = 0;
  let peakR = 0;
  let clipL = 0;
  let clipR = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = Math.abs(left[i]);
    if (a > peakL) peakL = a;
    if (a >= 0.999) clipL += 1;
    if (right) {
      const b = Math.abs(right[i]);
      if (b > peakR) peakR = b;
      if (b >= 0.999) clipR += 1;
    }
  }
  const clipping = clipL + clipR > 0;
  const silent = Math.max(peakL, peakR) < 0.01;
  const missingChannel =
    !silent && (peakL < 0.02 || peakR < 0.02) && Math.max(peakL, peakR) > 0.05;
  return {
    ok: !silent && !clipping && !missingChannel,
    silent,
    clipping,
    missingChannel,
    peakL,
    peakR,
    clipSamplesL: clipL,
    clipSamplesR: clipR,
    duration: buffer.duration,
  };
}
