(function () {
  "use strict";

  const EPSILON = 1e-12;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function dbToGain(db) {
    return Math.pow(10, db / 20);
  }

  function gainToDb(gain) {
    return 20 * Math.log10(Math.max(EPSILON, gain));
  }

  function mulberry32(seed) {
    let state = seed >>> 0;
    return function random() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fft(real, imaginary) {
    const length = real.length;
    let j = 0;
    for (let i = 1; i < length; i += 1) {
      let bit = length >> 1;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
      if (i < j) {
        const realSwap = real[i];
        real[i] = real[j];
        real[j] = realSwap;
        const imaginarySwap = imaginary[i];
        imaginary[i] = imaginary[j];
        imaginary[j] = imaginarySwap;
      }
    }

    for (let size = 2; size <= length; size <<= 1) {
      const angle = (-2 * Math.PI) / size;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      for (let offset = 0; offset < length; offset += size) {
        let wr = 1;
        let wi = 0;
        for (let index = 0; index < size / 2; index += 1) {
          const even = offset + index;
          const odd = even + size / 2;
          const tr = wr * real[odd] - wi * imaginary[odd];
          const ti = wr * imaginary[odd] + wi * real[odd];
          real[odd] = real[even] - tr;
          imaginary[odd] = imaginary[even] - ti;
          real[even] += tr;
          imaginary[even] += ti;
          const nextWr = wr * cosine - wi * sine;
          wi = wr * sine + wi * cosine;
          wr = nextWr;
        }
      }
    }
  }

  function monoFromBuffer(buffer, start, length) {
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const output = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      output[index] = (left[start + index] + right[start + index]) * 0.5;
    }
    return output;
  }

  function averageSpectrum(samples, sampleRate, fftSize, frameCount) {
    const size = Math.min(fftSize, 2 ** Math.floor(Math.log2(samples.length)));
    const bins = size / 2;
    const accumulated = new Float64Array(bins);
    const frames = Math.max(1, Math.min(frameCount, Math.floor(samples.length / size)));
    const usable = Math.max(1, samples.length - size);
    const hann = new Float32Array(size);
    for (let index = 0; index < size; index += 1) {
      hann[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
    }

    for (let frame = 0; frame < frames; frame += 1) {
      const start = frames === 1 ? 0 : Math.floor((frame * usable) / (frames - 1));
      const real = new Float64Array(size);
      const imaginary = new Float64Array(size);
      for (let index = 0; index < size; index += 1) {
        real[index] = samples[start + index] * hann[index];
      }
      fft(real, imaginary);
      for (let bin = 0; bin < bins; bin += 1) {
        accumulated[bin] += (real[bin] * real[bin] + imaginary[bin] * imaginary[bin]) / frames;
      }
    }

    const magnitudes = new Float32Array(bins);
    const frequencies = new Float32Array(bins);
    const normalization = 4 / (size * Math.max(1, frames));
    for (let bin = 0; bin < bins; bin += 1) {
      frequencies[bin] = (bin * sampleRate) / size;
      magnitudes[bin] = Math.sqrt(accumulated[bin]) * normalization;
    }
    return { frequencies, magnitudes, fftSize: size, sampleRate };
  }

  function dominantFrequency(samples, sampleRate) {
    const size = 16384;
    if (samples.length < 1024) return 0;
    const fftSize = Math.min(size, 2 ** Math.floor(Math.log2(samples.length)));
    const starts = [0.08, 0.28, 0.48].map((position) =>
      Math.floor(clamp(position * samples.length, 0, samples.length - fftSize))
    );
    const powers = new Float64Array(fftSize / 2);
    const hann = new Float32Array(fftSize);
    for (let index = 0; index < fftSize; index += 1) {
      hann[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (fftSize - 1));
    }

    for (const start of starts) {
      const real = new Float64Array(fftSize);
      const imaginary = new Float64Array(fftSize);
      for (let index = 0; index < fftSize; index += 1) {
        real[index] = samples[start + index] * hann[index];
      }
      fft(real, imaginary);
      for (let bin = 1; bin < fftSize / 2; bin += 1) {
        powers[bin] += real[bin] * real[bin] + imaginary[bin] * imaginary[bin];
      }
    }

    const minBin = Math.max(1, Math.floor((70 * fftSize) / sampleRate));
    const maxBin = Math.min(fftSize / 2 - 1, Math.ceil((900 * fftSize) / sampleRate));
    let bestBin = 0;
    let bestPower = 0;
    for (let bin = minBin; bin <= maxBin; bin += 1) {
      const left = bin > 0 ? powers[bin - 1] : 0;
      const center = powers[bin];
      const right = bin < powers.length - 1 ? powers[bin + 1] : 0;
      const weighted = center + (left + right) * 0.5;
      if (weighted > bestPower) {
        bestPower = weighted;
        bestBin = bin;
      }
    }
    return bestBin ? (bestBin * sampleRate) / fftSize : 0;
  }

  function channelPeak(data) {
    let peak = 0;
    for (let index = 0; index < data.length; index += 1) {
      const magnitude = Math.abs(data[index]);
      if (magnitude > peak) peak = magnitude;
    }
    return peak;
  }

  function channelRms(data) {
    let sum = 0;
    for (let index = 0; index < data.length; index += 1) {
      sum += data[index] * data[index];
    }
    return Math.sqrt(sum / Math.max(1, data.length));
  }

  function countClipped(buffer, threshold) {
    let count = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        if (Math.abs(data[index]) >= threshold) count += 1;
      }
    }
    return count;
  }

  function bandEnergy(spectrum, low, high) {
    let energy = 0;
    for (let index = 0; index < spectrum.frequencies.length; index += 1) {
      const frequency = spectrum.frequencies[index];
      if (frequency >= low && frequency <= high) {
        energy += spectrum.magnitudes[index] * spectrum.magnitudes[index];
      }
    }
    return energy;
  }

  function beatContrast(buffer) {
    const mono = monoFromBuffer(buffer, 0, buffer.length);
    const sampleRate = buffer.sampleRate;
    const windowSize = Math.floor(sampleRate * 0.1);
    const windows = Math.floor(mono.length / windowSize);
    if (windows < 8) return 1;
    const levels = [];
    for (let index = 0; index < windows; index += 1) {
      const start = index * windowSize;
      let sum = 0;
      for (let sample = 0; sample < windowSize; sample += 1) {
        sum += mono[start + sample] * mono[start + sample];
      }
      levels.push(Math.sqrt(sum / windowSize));
    }

    const onBeat = [];
    const offBeat = [];
    for (let index = 1; index < levels.length - 1; index += 1) {
      const center = index * 0.1;
      const phase = ((center % 0.5) + 0.5) % 0.5;
      if (phase < 0.14 || phase > 0.36) onBeat.push(levels[index]);
      else offBeat.push(levels[index]);
    }
    const average = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const on = average(onBeat);
    const off = average(offBeat);
    return off > EPSILON ? on / off : 1;
  }

  function analyzeBuffer(buffer) {
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const leftPeak = channelPeak(left);
    const rightPeak = channelPeak(right);
    const leftRms = channelRms(left);
    const rightRms = channelRms(right);
    const peak = Math.max(leftPeak, rightPeak);
    const mono = monoFromBuffer(buffer, 0, buffer.length);
    const spectrum = averageSpectrum(mono, buffer.sampleRate, 4096, 8);
    return {
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      leftPeak,
      rightPeak,
      peak,
      peakDb: gainToDb(peak),
      leftRms,
      rightRms,
      leftRmsDb: gainToDb(leftRms),
      rightRmsDb: gainToDb(rightRms),
      clippedSamples: countClipped(buffer, 0.999),
      pitch: dominantFrequency(mono, buffer.sampleRate),
      spectrum,
      beatContrast: beatContrast(buffer),
    };
  }

  window.SignalDSP = {
    clamp,
    dbToGain,
    gainToDb,
    mulberry32,
    fft,
    monoFromBuffer,
    averageSpectrum,
    dominantFrequency,
    channelPeak,
    channelRms,
    countClipped,
    bandEnergy,
    beatContrast,
    analyzeBuffer,
  };
})();
