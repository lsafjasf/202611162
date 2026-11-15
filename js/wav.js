(function () {
  "use strict";

  function writeAscii(view, offset, text) {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  }

  function encodeWav24(buffer) {
    const channels = Math.min(2, buffer.numberOfChannels);
    const frames = buffer.length;
    const bytesPerSample = 3;
    const dataSize = frames * channels * bytesPerSample;
    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, 24, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);

    const channelData = [];
    for (let channel = 0; channel < channels; channel += 1) {
      channelData.push(buffer.getChannelData(channel));
    }
    let offset = 44;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
        const integer = sample < 0 ? Math.round(sample * 0x800000) : Math.round(sample * 0x7fffff);
        view.setUint8(offset, integer & 0xff);
        view.setUint8(offset + 1, (integer >> 8) & 0xff);
        view.setUint8(offset + 2, (integer >> 16) & 0xff);
        offset += 3;
      }
    }
    return arrayBuffer;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  window.PhaseWav = { encodeWav24, formatBytes };
})();
