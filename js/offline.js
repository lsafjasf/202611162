(function () {
  "use strict";

  const M = window.RailModel;
  const D = window.RailDsp;
  const clamp = M.clamp;

  function hold(param, value, when) {
    param.setValueAtTime(value, when);
  }

  function ramp(param, value, when) {
    param.linearRampToValueAtTime(value, when);
  }

  function buildSourceNoise(ctx, seed) {
    return D.makeNoiseBuffer(ctx, 2.4, seed);
  }

  function addClicks(ctx, destination, params, duration, noiseBuffer) {
    const beats = M.beatTimes(params, duration);
    beats.forEach((beat, index) => {
      const time = beat.time;
      if (time < 0 || time >= duration) return;
      const a = beat.acoustics;
      const pan = clamp(a.pan * (0.82 + params.gauge * 0.1), -1, 1);
      const level = clamp(a.clickGain * 0.55, 0.02, 0.5);
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, time);
      panner.connect(destination);

      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1450 + (index % 3) * 210;
      band.Q.value = 0.85;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, time);
      envelope.gain.exponentialRampToValueAtTime(level, time + 0.004);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.085);
      noise.connect(band).connect(envelope).connect(panner);
      noise.start(time, (index * 0.037) % 2, 0.12);
      noise.stop(time + 0.13);

      const clack = ctx.createOscillator();
      clack.type = "square";
      clack.frequency.setValueAtTime(88 + (index % 2) * 11, time);
      const clackGain = ctx.createGain();
      clackGain.gain.setValueAtTime(0.0001, time);
      clackGain.gain.exponentialRampToValueAtTime(level * 0.42, time + 0.003);
      clackGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
      clack.connect(clackGain).connect(panner);
      clack.start(time);
      clack.stop(time + 0.065);
    });
    return beats.length;
  }

  function addTrain(ctx, destination, params, duration, noiseBuffer) {
    const bus = ctx.createGain();
    bus.gain.value = 0.55;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.72;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const panner = ctx.createStereoPanner();
    panner.pan.value = 0;
    bus.connect(filter).connect(gain).connect(panner).connect(destination);

    const hum = ctx.createOscillator();
    hum.type = "sine";
    const horn = ctx.createOscillator();
    horn.type = "triangle";
    const motor = ctx.createOscillator();
    motor.type = "sawtooth";
    motor.detune.value = -4;
    const rumble = ctx.createOscillator();
    rumble.type = "triangle";

    const gains = [ctx.createGain(), ctx.createGain(), ctx.createGain(), ctx.createGain()];
    gains[0].gain.value = 0.2;
    gains[1].gain.value = 0.45;
    gains[2].gain.value = 0.09;
    gains[3].gain.value = 0.16;
    hum.connect(gains[0]).connect(bus);
    horn.connect(gains[1]).connect(bus);
    motor.connect(gains[2]).connect(bus);
    rumble.connect(gains[3]).connect(bus);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseBand = ctx.createBiquadFilter();
    noiseBand.type = "bandpass";
    noiseBand.Q.value = 0.62;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.16;
    noise.connect(noiseBand).connect(noiseGain).connect(bus);

    const step = 0.025;
    const start = M.acousticsAt(params, -M.WORLD_HALF);
    hold(hum.frequency, start.engineHz, 0);
    hold(horn.frequency, start.hornHz, 0);
    hold(motor.frequency, start.motorHz, 0);
    hold(rumble.frequency, start.rumbleHz, 0);
    hold(filter.frequency, start.filterHz, 0);
    hold(noiseBand.frequency, clamp(start.filterHz * 0.27, 90, 1100), 0);
    hold(gain.gain, 0.0001, 0);
    hold(panner.pan, start.pan, 0);

    for (let t = step; t <= duration + step; t += step) {
      const time = Math.min(t, duration);
      const x = M.trainXAt(params, time);
      const a = M.acousticsAt(params, x);
      ramp(hum.frequency, a.engineHz, time);
      ramp(horn.frequency, a.hornHz, time);
      ramp(motor.frequency, a.motorHz, time);
      ramp(rumble.frequency, a.rumbleHz, time);
      ramp(filter.frequency, clamp(a.filterHz, 240, 4800), time);
      ramp(noiseBand.frequency, clamp(a.filterHz * 0.27, 90, 1100), time);
      ramp(panner.pan, a.active ? a.pan : 0, time);
      ramp(gain.gain, a.active ? clamp(a.distanceGain * 0.93, 0.0001, 0.95) : 0.0001, time);
    }

    [hum, horn, motor, rumble, noise].forEach((node) => node.start(0));
    return { bus, filter, gain, panner };
  }

  function addAmbience(ctx, destination, noiseBuffer, duration) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 42;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 760;
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    const panner = ctx.createStereoPanner();
    panner.pan.value = -0.13;
    source.connect(high).connect(low).connect(gain).connect(panner).connect(destination);
    source.start(0);
    source.stop(duration);
  }

  async function renderScene(paramsInput, options) {
    const params = M.normalizeParams(paramsInput);
    const config = options || {};
    const duration = config.duration || M.EXPORT_SECONDS;
    const sampleRate = config.sampleRate || M.SAMPLE_RATE;
    const stem = config.stem || "full";
    const frames = Math.floor(duration * sampleRate);
    const ctx = new OfflineAudioContext(2, frames, sampleRate);
    const master = ctx.createGain();
    master.gain.value = 0.76;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.18;
    master.connect(limiter).connect(ctx.destination);

    const noiseBuffer = buildSourceNoise(ctx, config.seed || 0x5eeda11);
    if (stem === "clicks") {
      const clickBus = ctx.createGain();
      clickBus.gain.value = 0.9;
      clickBus.connect(master);
      addClicks(ctx, clickBus, params, duration, noiseBuffer);
    } else {
      addTrain(ctx, master, params, duration, noiseBuffer);
      addClicks(ctx, master, params, duration, noiseBuffer);
      addAmbience(ctx, master, noiseBuffer, duration);
    }
    return ctx.startRendering();
  }

  function audioBufferToWav(buffer) {
    const channels = Math.min(2, buffer.numberOfChannels);
    const sampleRate = buffer.sampleRate;
    const frames = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = frames * blockAlign;
    const array = new ArrayBuffer(44 + dataSize);
    const view = new DataView(array);
    const writeText = (offset, text) => {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    };

    writeText(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, dataSize, true);

    const left = buffer.getChannelData(0);
    const right = channels > 1 ? buffer.getChannelData(1) : left;
    let offset = 44;
    for (let i = 0; i < frames; i += 1) {
      const l = Math.round(clamp(left[i], -1, 1) * 32767);
      const r = Math.round(clamp(right[i], -1, 1) * 32767);
      view.setInt16(offset, l, true);
      view.setInt16(offset + 2, r, true);
      offset += 4;
    }
    return { buffer: array, channels, frames, sampleRate, duration: frames / sampleRate };
  }

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const angle = -2 * Math.PI / size;
      const wReal = Math.cos(angle);
      const wImag = Math.sin(angle);
      for (let start = 0; start < n; start += size) {
        let curReal = 1;
        let curImag = 0;
        for (let k = 0; k < size / 2; k += 1) {
          const even = start + k;
          const odd = even + size / 2;
          const oddReal = re[odd] * curReal - im[odd] * curImag;
          const oddImag = re[odd] * curImag + im[odd] * curReal;
          re[odd] = re[even] - oddReal;
          im[odd] = im[even] - oddImag;
          re[even] += oddReal;
          im[even] += oddImag;
          const nextReal = curReal * wReal - curImag * wImag;
          curImag = curReal * wImag + curImag * wReal;
          curReal = nextReal;
        }
      }
    }
  }

  function keyTime(params) {
    const p = M.normalizeParams(params);
    const x = p.listener - 10;
    return clamp((x + M.WORLD_HALF) / (p.speedKmh / 3.6), 0, M.EXPORT_SECONDS - 0.3);
  }

  function spectralPitch(buffer, params, windowSeconds) {
    const sampleRate = buffer.sampleRate;
    const size = 8192;
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const center = Math.floor(keyTime(params) * sampleRate);
    const span = Math.floor((windowSeconds || 0.18) * sampleRate);
    const start = clamp(center - Math.floor(span * 0.25), 0, Math.max(0, buffer.length - size));
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i += 1) {
      const index = start + i;
      const sample = index < buffer.length ? (left[index] + right[index]) * 0.5 : 0;
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
      re[i] = sample * window;
    }
    fft(re, im);
    const binHz = sampleRate / size;
    const minBin = Math.max(2, Math.floor(35 / binHz));
    const maxBin = Math.min(size / 2 - 2, Math.floor(1400 / binHz));
    let best = minBin;
    let bestMagnitude = -1;
    for (let i = minBin; i <= maxBin; i += 1) {
      const magnitude = re[i] * re[i] + im[i] * im[i];
      if (magnitude > bestMagnitude) {
        bestMagnitude = magnitude;
        best = i;
      }
    }
    const leftMag = Math.hypot(re[best - 1], im[best - 1]);
    const centerMag = Math.hypot(re[best], im[best]);
    const rightMag = Math.hypot(re[best + 1], im[best + 1]);
    const denominator = leftMag - 2 * centerMag + rightMag;
    const offset = denominator !== 0 ? 0.5 * (leftMag - rightMag) / denominator : 0;
    return {
      hz: (best + clamp(offset, -0.5, 0.5)) * binHz,
      db: M.gainToDb(Math.sqrt(bestMagnitude) / size * 2)
    };
  }

  function channelStats(data) {
    let peak = 0;
    let sum = 0;
    let clipSamples = 0;
    for (let i = 0; i < data.length; i += 1) {
      const abs = Math.abs(data[i]);
      peak = Math.max(peak, abs);
      sum += data[i] * data[i];
      if (abs >= 0.999) clipSamples += 1;
    }
    return { peak, rms: Math.sqrt(sum / Math.max(1, data.length)), clipSamples };
  }

  function stereoWidth(buffer, params) {
    const sampleRate = buffer.sampleRate;
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const key = keyTime(params);
    const from = Math.floor(Math.max(0, key - 0.35) * sampleRate);
    const to = Math.min(buffer.length, Math.floor((key + 0.35) * sampleRate));
    let difference = 0;
    let total = 0;
    for (let i = from; i < to; i += 1) {
      const mid = (left[i] + right[i]) * 0.5;
      const side = (left[i] - right[i]) * 0.5;
      difference += side * side;
      total += mid * mid + side * side;
    }
    return M.gainToDb(Math.sqrt(difference / Math.max(1, to - from)) + 1e-8);
  }

  function analyzeBuffer(buffer, params) {
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const l = channelStats(left);
    const r = channelStats(right);
    const pitch = spectralPitch(buffer, params);
    const sampleSpan = Math.max(1, Math.floor(buffer.sampleRate * 0.5));
    const segmentPeaks = [];
    for (let start = 0; start < buffer.length; start += sampleSpan) {
      let peak = 0;
      const end = Math.min(buffer.length, start + sampleSpan);
      for (let i = start; i < end; i += 1) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      segmentPeaks.push(M.gainToDb(peak));
    }
    const peak = Math.max(l.peak, r.peak);
    const rms = Math.sqrt((l.rms * l.rms + r.rms * r.rms) * 0.5);
    const silence = M.gainToDb(rms) < -55;
    const missingChannel = M.gainToDb(l.rms) < -58 || M.gainToDb(r.rms) < -58;
    const clipping = l.clipSamples > 0 || r.clipSamples > 0 || peak >= 0.999;
    return {
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      peak,
      peakDb: M.gainToDb(peak),
      peakLDb: M.gainToDb(l.peak),
      peakRDb: M.gainToDb(r.peak),
      rmsDb: M.gainToDb(rms),
      rmsLDb: M.gainToDb(l.rms),
      rmsRDb: M.gainToDb(r.rms),
      keyPitchHz: pitch.hz,
      keyPitchDb: pitch.db,
      stereoWidthDb: stereoWidth(buffer, params),
      segmentPeaks,
      clipSamples: l.clipSamples + r.clipSamples,
      checks: {
        silence: !silence,
        clip: !clipping,
        channel: !missingChannel && buffer.numberOfChannels === 2,
        duration: Math.abs(buffer.duration - M.EXPORT_SECONDS) < 0.002
      }
    };
  }

  function analyzeOnsets(buffer) {
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const block = 64;
    const frames = Math.floor(buffer.length / block);
    const envelope = new Float32Array(frames);
    let max = 0;
    for (let f = 0; f < frames; f += 1) {
      let peak = 0;
      for (let i = f * block; i < (f + 1) * block; i += 1) {
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      }
      envelope[f] = peak;
      max = Math.max(max, peak);
    }
    const threshold = Math.max(0.006, max * 0.24);
    const times = [];
    let armed = true;
    const minGap = Math.floor(buffer.sampleRate * 0.12);
    for (let f = 1; f < frames; f += 1) {
      if (armed && envelope[f] > threshold && envelope[f] > envelope[f - 1] * 1.2) {
        const sample = f * block;
        if (!times.length || sample - times[times.length - 1] > minGap) times.push(sample);
        armed = false;
      } else if (!armed && envelope[f] < threshold * 0.35) {
        armed = true;
      }
    }
    const intervals = [];
    for (let i = 1; i < times.length; i += 1) intervals.push((times[i] - times[i - 1]) / buffer.sampleRate);
    intervals.sort((a, b) => a - b);
    const median = intervals.length ? intervals[Math.floor(intervals.length / 2)] : 0;
    return { onsets: times.length, intervals, bpm: median > 0 ? 60 / median : 0 };
  }

  async function runAcousticProbes(baseParams) {
    const base = M.normalizeParams(baseParams);
    const stereoBase = { ...base, speedKmh: 60, listener: 0 };
    const stereoLow = await renderScene({ ...stereoBase, gauge: 1 }, { duration: 3.8 });
    const stereoHigh = await renderScene({ ...stereoBase, gauge: 2.4 }, { duration: 3.8 });
    const stereoLowDb = stereoWidth(stereoLow, { ...stereoBase, gauge: 1 });
    const stereoHighDb = stereoWidth(stereoHigh, { ...stereoBase, gauge: 2.4 });

    const spectralBase = { ...base, listener: -30, gauge: 1.435 };
    const slowBuffer = await renderScene({ ...spectralBase, speedKmh: 50 }, { duration: 2.2 });
    const fastBuffer = await renderScene({ ...spectralBase, speedKmh: 140 }, { duration: 2.2 });
    const slowPitch = spectralPitch(slowBuffer, { ...spectralBase, speedKmh: 50 }).hz;
    const fastPitch = spectralPitch(fastBuffer, { ...spectralBase, speedKmh: 140 }).hz;

    const beatBase = { ...base, listener: 0, gauge: 1.435 };
    const slowClicks = await renderScene(
      { ...beatBase, speedKmh: 50 },
      { duration: 5.2, stem: "clicks" }
    );
    const fastClicks = await renderScene(
      { ...beatBase, speedKmh: 140 },
      { duration: 5.2, stem: "clicks" }
    );
    const slowBeat = analyzeOnsets(slowClicks);
    const fastBeat = analyzeOnsets(fastClicks);

    const stereoPass = stereoLowDb < stereoHighDb - 1.5;
    const spectralPass = fastPitch > slowPitch * 1.05 + 2;
    const beatPass = slowBeat.bpm > 0 && fastBeat.bpm > slowBeat.bpm * 1.6;
    return {
      stereo: {
        pass: stereoPass,
        lowDb: stereoLowDb,
        highDb: stereoHighDb,
        detail: `${stereoLowDb.toFixed(1)} → ${stereoHighDb.toFixed(1)} dB 侧向能量`
      },
      spectrum: {
        pass: spectralPass,
        lowHz: slowPitch,
        highHz: fastPitch,
        detail: `${slowPitch.toFixed(0)} → ${fastPitch.toFixed(0)} Hz 实测主频`
      },
      beat: {
        pass: beatPass,
        lowBpm: slowBeat.bpm,
        highBpm: fastBeat.bpm,
        detail: `${slowBeat.bpm.toFixed(0)} → ${fastBeat.bpm.toFixed(0)} BPM 实测脉冲`
      }
    };
  }

  function compareFingerprints(first, second) {
    const durationDelta = Math.abs(first.duration - second.duration);
    const pitchDelta = Math.abs(first.keyPitchHz - second.keyPitchHz);
    const peakDelta = Math.abs(first.peakDb - second.peakDb);
    const leftDelta = Math.abs(first.peakLDb - second.peakLDb);
    const rightDelta = Math.abs(first.peakRDb - second.peakRDb);
    const latencyDelta = Math.abs((first.latencyMs || 0) - (second.latencyMs || 0));
    const rows = [
      {
        label: "时长",
        first: `${first.duration.toFixed(3)} s`,
        second: `${second.duration.toFixed(3)} s`,
        pass: durationDelta < 0.002
      },
      {
        label: "关键音高",
        first: `${first.keyPitchHz.toFixed(1)} Hz`,
        second: `${second.keyPitchHz.toFixed(1)} Hz`,
        pass: pitchDelta < 0.25
      },
      {
        label: "总峰值",
        first: `${first.peakDb.toFixed(2)} dBFS`,
        second: `${second.peakDb.toFixed(2)} dBFS`,
        pass: peakDelta < 0.05
      },
      {
        label: "左右峰值",
        first: `${first.peakLDb.toFixed(1)} / ${first.peakRDb.toFixed(1)}`,
        second: `${second.peakLDb.toFixed(1)} / ${second.peakRDb.toFixed(1)}`,
        pass: leftDelta < 0.05 && rightDelta < 0.05
      },
      {
        label: "监听延迟",
        first: `${(first.latencyMs || 0).toFixed(2)} ms`,
        second: `${(second.latencyMs || 0).toFixed(2)} ms`,
        pass: latencyDelta < 0.6
      }
    ];
    return { rows, consistent: rows.every((row) => row.pass) };
  }

  window.RailOffline = Object.freeze({
    renderScene,
    audioBufferToWav,
    analyzeBuffer,
    analyzeOnsets,
    spectralPitch,
    stereoWidth,
    keyTime,
    runAcousticProbes,
    compareFingerprints
  });
})();
