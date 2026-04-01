(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  const els = {
    fileInput: $('#fileInput'),
    loadSampleBtn: $('#loadSampleBtn'),
    resetStackBtn: $('#resetStackBtn'),
    exportPngBtn: $('#exportPngBtn'),
    exportJpegBtn: $('#exportJpegBtn'),
    previewQualitySelect: $('#previewQualitySelect'),
    compareToggle: $('#compareToggle'),
    compareSlider: $('#compareSlider'),
    imageInfo: $('#imageInfo'),
    statusText: $('#statusText'),
    presetList: $('#presetList'),
    filterSelect: $('#filterSelect'),
    addFilterBtn: $('#addFilterBtn'),
    previewCanvas: $('#previewCanvas'),
    dropZone: $('#dropZone'),
    stackList: $('#stackList'),
    clearStackBtn: $('#clearStackBtn'),
    filterCountBadge: $('#filterCountBadge')
  };

  const previewCtx = els.previewCanvas.getContext('2d', { willReadFrequently: true });

  const state = {
    stack: [],
    imageName: 'sample',
    fullOriginal: null,
    previewOriginal: null,
    previewProcessed: null,
    sourceCanvas: document.createElement('canvas'),
    sourceCtx: null,
    previewOriginalCanvas: document.createElement('canvas'),
    previewOriginalCtx: null,
    previewProcessedCanvas: document.createElement('canvas'),
    previewProcessedCtx: null,
    previewQuality: 1,
    compareEnabled: false,
    compareSplit: 0.5,
    rendering: false,
    renderAgain: false,
    renderToken: 0,
    currentStatus: 'サンプル画像を読み込むか、画像をドロップしてください。'
  };

  state.sourceCtx = state.sourceCanvas.getContext('2d', { willReadFrequently: true });
  state.previewOriginalCtx = state.previewOriginalCanvas.getContext('2d', { willReadFrequently: true });
  state.previewProcessedCtx = state.previewProcessedCanvas.getContext('2d', { willReadFrequently: true });

  const clamp = (value, min = 0, max = 255) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (edge0, edge1, x) => {
    const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const fract = (value) => value - Math.floor(value);
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const uid = () => `f_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

  function setStatus(text) {
    state.currentStatus = text;
    els.statusText.textContent = text;
  }

  function formatNumber(value, digits = 2) {
    if (Number.isInteger(value)) return String(value);
    return Number(value).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  function updateImageInfo() {
    if (!state.fullOriginal) {
      els.imageInfo.textContent = '画像未読み込み';
      return;
    }
    const full = `${state.fullOriginal.width}×${state.fullOriginal.height}`;
    const preview = `${state.previewOriginal.width}×${state.previewOriginal.height}`;
    els.imageInfo.textContent = `${state.imageName} / 原寸 ${full} / プレビュー ${preview}`;
  }

  function updateFilterCountBadge() {
    els.filterCountBadge.textContent = `${state.stack.length} filters`;
  }

  function cloneImageData(imageData) {
    return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  }

  function createBlankImageData(width, height) {
    return new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
  }

  function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function parseHexColor(hex) {
    const safe = String(hex || '#000000').replace('#', '').trim();
    const normalized = safe.length === 3
      ? safe.split('').map((ch) => ch + ch).join('')
      : safe.padEnd(6, '0').slice(0, 6);
    const value = parseInt(normalized, 16);
    return [
      (value >> 16) & 255,
      (value >> 8) & 255,
      value & 255
    ];
  }

  function hash2D(x, y, seed = 0) {
    return fract(Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123);
  }

  function sampleNearest(data, width, height, x, y, options = {}) {
    const wrap = options.wrap || false;
    if (wrap) {
      const sx = ((Math.round(x) % width) + width) % width;
      const sy = ((Math.round(y) % height) + height) % height;
      const index = (sy * width + sx) * 4;
      return [data[index], data[index + 1], data[index + 2], data[index + 3]];
    }

    const sx = clamp(Math.round(x), 0, width - 1);
    const sy = clamp(Math.round(y), 0, height - 1);
    const index = (sy * width + sx) * 4;
    return [data[index], data[index + 1], data[index + 2], data[index + 3]];
  }

  function sampleBilinear(data, width, height, x, y, options = {}) {
    const wrap = options.wrap || false;
    if (wrap) {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const tx = x - x0;
      const ty = y - y0;
      const c00 = sampleNearest(data, width, height, x0, y0, { wrap: true });
      const c10 = sampleNearest(data, width, height, x1, y0, { wrap: true });
      const c01 = sampleNearest(data, width, height, x0, y1, { wrap: true });
      const c11 = sampleNearest(data, width, height, x1, y1, { wrap: true });
      return [0, 1, 2, 3].map((channel) => {
        const top = lerp(c00[channel], c10[channel], tx);
        const bottom = lerp(c01[channel], c11[channel], tx);
        return lerp(top, bottom, ty);
      });
    }

    const safeX = clamp(x, 0, width - 1);
    const safeY = clamp(y, 0, height - 1);
    const x0 = Math.floor(safeX);
    const y0 = Math.floor(safeY);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const tx = safeX - x0;
    const ty = safeY - y0;

    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;
    const out = [0, 0, 0, 0];

    for (let channel = 0; channel < 4; channel += 1) {
      const top = lerp(data[i00 + channel], data[i10 + channel], tx);
      const bottom = lerp(data[i01 + channel], data[i11 + channel], tx);
      out[channel] = lerp(top, bottom, ty);
    }

    return out;
  }

  function rgbToHsl(r, g, b) {
    const nr = r / 255;
    const ng = g / 255;
    const nb = b / 255;
    const max = Math.max(nr, ng, nb);
    const min = Math.min(nr, ng, nb);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case nr:
          h = (ng - nb) / d + (ng < nb ? 6 : 0);
          break;
        case ng:
          h = (nb - nr) / d + 2;
          break;
        default:
          h = (nr - ng) / d + 4;
          break;
      }
      h /= 6;
    }

    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    if (s === 0) {
      const value = Math.round(l * 255);
      return [value, value, value];
    }

    const hue2rgb = (p, q, t) => {
      let temp = t;
      if (temp < 0) temp += 1;
      if (temp > 1) temp -= 1;
      if (temp < 1 / 6) return p + (q - p) * 6 * temp;
      if (temp < 1 / 2) return q;
      if (temp < 2 / 3) return p + (q - p) * (2 / 3 - temp) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    return [
      Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      Math.round(hue2rgb(p, q, h) * 255),
      Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    ];
  }

  function applyPerPixel(imageData, callback) {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const result = callback(
          data[index],
          data[index + 1],
          data[index + 2],
          data[index + 3],
          x,
          y,
          width,
          height,
          index,
          data
        );
        output[index] = clamp(result[0]);
        output[index + 1] = clamp(result[1]);
        output[index + 2] = clamp(result[2]);
        output[index + 3] = result[3] === undefined ? data[index + 3] : clamp(result[3]);
      }
    }
    return new ImageData(output, width, height);
  }

  function buildLut(transform) {
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i += 1) {
      lut[i] = clamp(Math.round(transform(i)));
    }
    return lut;
  }

  function applyLut(imageData, lutR, lutG = lutR, lutB = lutR) {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      output[i] = lutR[data[i]];
      output[i + 1] = lutG[data[i + 1]];
      output[i + 2] = lutB[data[i + 2]];
      output[i + 3] = data[i + 3];
    }
    return new ImageData(output, width, height);
  }

  function convolve(imageData, kernel, size, options = {}) {
    const { width, height, data } = imageData;
    const half = Math.floor(size / 2);
    const divisor = options.divisor || kernel.reduce((sum, value) => sum + value, 0) || 1;
    const offset = options.offset || 0;
    const grayscale = options.grayscale || false;
    const output = new Uint8ClampedArray(data.length);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let k = 0;
        for (let ky = -half; ky <= half; ky += 1) {
          const sy = clamp(y + ky, 0, height - 1);
          for (let kx = -half; kx <= half; kx += 1) {
            const sx = clamp(x + kx, 0, width - 1);
            const srcIndex = (sy * width + sx) * 4;
            const weight = kernel[k];
            r += data[srcIndex] * weight;
            g += data[srcIndex + 1] * weight;
            b += data[srcIndex + 2] * weight;
            k += 1;
          }
        }
        const dstIndex = (y * width + x) * 4;
        if (grayscale) {
          const gray = clamp(Math.abs((r + g + b) / 3 / divisor + offset));
          output[dstIndex] = gray;
          output[dstIndex + 1] = gray;
          output[dstIndex + 2] = gray;
        } else {
          output[dstIndex] = clamp(r / divisor + offset);
          output[dstIndex + 1] = clamp(g / divisor + offset);
          output[dstIndex + 2] = clamp(b / divisor + offset);
        }
        output[dstIndex + 3] = data[dstIndex + 3];
      }
    }

    return new ImageData(output, width, height);
  }

  function createUniformKernel(radius) {
    const size = radius * 2 + 1;
    const kernel = new Float32Array(size);
    kernel.fill(1 / size);
    return kernel;
  }

  function createGaussianKernel(radius) {
    if (radius <= 0) return new Float32Array([1]);
    const sigma = Math.max(radius / 3, 0.8);
    const size = radius * 2 + 1;
    const kernel = new Float32Array(size);
    let sum = 0;
    for (let i = -radius; i <= radius; i += 1) {
      const value = Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel[i + radius] = value;
      sum += value;
    }
    for (let i = 0; i < size; i += 1) {
      kernel[i] /= sum;
    }
    return kernel;
  }

  function separableConvolve(imageData, kernel) {
    const { width, height, data } = imageData;
    const radius = Math.floor(kernel.length / 2);
    const temp = new Float32Array(data.length);
    const output = new Uint8ClampedArray(data.length);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const sx = clamp(x + k, 0, width - 1);
          const index = (y * width + sx) * 4;
          const weight = kernel[k + radius];
          r += data[index] * weight;
          g += data[index + 1] * weight;
          b += data[index + 2] * weight;
          a += data[index + 3] * weight;
        }
        const dstIndex = (y * width + x) * 4;
        temp[dstIndex] = r;
        temp[dstIndex + 1] = g;
        temp[dstIndex + 2] = b;
        temp[dstIndex + 3] = a;
      }
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const sy = clamp(y + k, 0, height - 1);
          const index = (sy * width + x) * 4;
          const weight = kernel[k + radius];
          r += temp[index] * weight;
          g += temp[index + 1] * weight;
          b += temp[index + 2] * weight;
          a += temp[index + 3] * weight;
        }
        const dstIndex = (y * width + x) * 4;
        output[dstIndex] = clamp(r);
        output[dstIndex + 1] = clamp(g);
        output[dstIndex + 2] = clamp(b);
        output[dstIndex + 3] = clamp(a);
      }
    }

    return new ImageData(output, width, height);
  }

  function blendImages(baseImage, topImage, mode = 'normal', opacity = 1) {
    const { width, height } = baseImage;
    const base = baseImage.data;
    const top = topImage.data;
    const output = new Uint8ClampedArray(base.length);
    for (let i = 0; i < base.length; i += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const b = base[i + channel];
        const t = top[i + channel] * opacity;
        let value = t;
        if (mode === 'screen') {
          value = 255 - ((255 - b) * (255 - t)) / 255;
        } else if (mode === 'add') {
          value = b + t;
        } else if (mode === 'multiply') {
          value = (b * t) / 255;
        } else {
          value = b * (1 - opacity) + top[i + channel] * opacity;
        }
        output[i + channel] = clamp(value);
      }
      output[i + 3] = base[i + 3];
    }
    return new ImageData(output, width, height);
  }

  function warpImage(imageData, mapper, options = {}) {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    const wrap = options.wrap || false;
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const mapped = mapper(x, y, width, height, cx, cy);
        const sample = sampleBilinear(data, width, height, mapped[0], mapped[1], { wrap });
        const index = (y * width + x) * 4;
        output[index] = clamp(sample[0]);
        output[index + 1] = clamp(sample[1]);
        output[index + 2] = clamp(sample[2]);
        output[index + 3] = clamp(sample[3]);
      }
    }

    return new ImageData(output, width, height);
  }

  function computeSobelData(imageData) {
    const { width, height, data } = imageData;
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      gray[p] = luminance(data[i], data[i + 1], data[i + 2]);
    }

    const gxKernel = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const gyKernel = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    const magnitude = new Float32Array(width * height);
    const gradX = new Float32Array(width * height);
    const gradY = new Float32Array(width * height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let gx = 0;
        let gy = 0;
        let k = 0;
        for (let ky = -1; ky <= 1; ky += 1) {
          const sy = clamp(y + ky, 0, height - 1);
          for (let kx = -1; kx <= 1; kx += 1) {
            const sx = clamp(x + kx, 0, width - 1);
            const value = gray[sy * width + sx];
            gx += value * gxKernel[k];
            gy += value * gyKernel[k];
            k += 1;
          }
        }
        const idx = y * width + x;
        gradX[idx] = gx;
        gradY[idx] = gy;
        magnitude[idx] = Math.sqrt(gx * gx + gy * gy);
      }
    }

    return { width, height, magnitude, gradX, gradY };
  }

  function sobelToImage({ width, height, magnitude }, multiplier = 1) {
    const output = new Uint8ClampedArray(width * height * 4);
    let maxMag = 0;
    for (let i = 0; i < magnitude.length; i += 1) {
      if (magnitude[i] > maxMag) maxMag = magnitude[i];
    }
    const scale = maxMag ? (255 / maxMag) * multiplier : 1;
    for (let i = 0; i < magnitude.length; i += 1) {
      const value = clamp(magnitude[i] * scale);
      const index = i * 4;
      output[index] = value;
      output[index + 1] = value;
      output[index + 2] = value;
      output[index + 3] = 255;
    }
    return new ImageData(output, width, height);
  }

  function histogramBounds(histogram, total, clipFraction) {
    const clipCount = total * clipFraction;
    let low = 0;
    let accumulated = 0;
    while (low < 255 && accumulated + histogram[low] <= clipCount) {
      accumulated += histogram[low];
      low += 1;
    }
    while (low < 255 && histogram[low] === 0) low += 1;

    let high = 255;
    accumulated = 0;
    while (high > 0 && accumulated + histogram[high] <= clipCount) {
      accumulated += histogram[high];
      high -= 1;
    }
    while (high > 0 && histogram[high] === 0) high -= 1;

    if (high <= low) return [0, 255];
    return [low, high];
  }

  function brightnessImage(imageData, amount) {
    const delta = amount * 2.55;
    const lut = buildLut((value) => value + delta);
    return applyLut(imageData, lut);
  }

  function contrastImage(imageData, amount) {
    const safe = clamp(amount, -255, 255);
    const factor = (259 * (safe + 255)) / (255 * (259 - safe || 1));
    const lut = buildLut((value) => factor * (value - 128) + 128);
    return applyLut(imageData, lut);
  }

  function exposureImage(imageData, ev) {
    const factor = 2 ** ev;
    const lut = buildLut((value) => value * factor);
    return applyLut(imageData, lut);
  }

  function gammaImage(imageData, gamma) {
    const safeGamma = Math.max(gamma, 0.01);
    const lut = buildLut((value) => 255 * ((value / 255) ** (1 / safeGamma)));
    return applyLut(imageData, lut);
  }

  function saturationImage(imageData, amount) {
    const factor = 1 + amount;
    return applyPerPixel(imageData, (r, g, b, a) => {
      const gray = luminance(r, g, b);
      return [
        gray + (r - gray) * factor,
        gray + (g - gray) * factor,
        gray + (b - gray) * factor,
        a
      ];
    });
  }

  function vibranceImage(imageData, amount) {
    return applyPerPixel(imageData, (r, g, b, a) => {
      const maxChannel = Math.max(r, g, b);
      const avg = (r + g + b) / 3;
      const saturation = maxChannel - Math.min(r, g, b);
      const boost = amount * (1 - saturation / 255);
      return [
        r + (r - avg) * boost,
        g + (g - avg) * boost,
        b + (b - avg) * boost,
        a
      ];
    });
  }

  function hueShiftImage(imageData, degrees) {
    const shift = degrees / 360;
    return applyPerPixel(imageData, (r, g, b, a) => {
      const [h, s, l] = rgbToHsl(r, g, b);
      const [nr, ng, nb] = hslToRgb((h + shift + 1) % 1, s, l);
      return [nr, ng, nb, a];
    });
  }

  function temperatureTintImage(imageData, temperature, tint) {
    return applyPerPixel(imageData, (r, g, b, a) => {
      const temp = temperature * 80;
      const tintShift = tint * 60;
      return [
        r + temp - tintShift * 0.25,
        g + tintShift,
        b - temp - tintShift * 0.25,
        a
      ];
    });
  }

  function rgbBalanceImage(imageData, redShift, greenShift, blueShift) {
    const rs = redShift * 255;
    const gs = greenShift * 255;
    const bs = blueShift * 255;
    return applyPerPixel(imageData, (r, g, b, a) => [r + rs, g + gs, b + bs, a]);
  }

  function levelsImage(imageData, blackPoint, whitePoint, gamma) {
    const safeBlack = clamp(blackPoint, 0, 254);
    const safeWhite = clamp(Math.max(whitePoint, safeBlack + 1), safeBlack + 1, 255);
    const safeGamma = Math.max(gamma, 0.01);
    const lut = buildLut((value) => {
      const normalized = clamp((value - safeBlack) / (safeWhite - safeBlack), 0, 1);
      return 255 * (normalized ** (1 / safeGamma));
    });
    return applyLut(imageData, lut);
  }

  function autoContrastImage(imageData, clipPercent) {
    const { width, height, data } = imageData;
    const histR = new Uint32Array(256);
    const histG = new Uint32Array(256);
    const histB = new Uint32Array(256);
    const total = width * height;
    for (let i = 0; i < data.length; i += 4) {
      histR[data[i]] += 1;
      histG[data[i + 1]] += 1;
      histB[data[i + 2]] += 1;
    }
    const clip = Math.max(clipPercent / 100, 0);
    const [lowR, highR] = histogramBounds(histR, total, clip);
    const [lowG, highG] = histogramBounds(histG, total, clip);
    const [lowB, highB] = histogramBounds(histB, total, clip);
    const lutR = buildLut((value) => ((value - lowR) / Math.max(1, highR - lowR)) * 255);
    const lutG = buildLut((value) => ((value - lowG) / Math.max(1, highG - lowG)) * 255);
    const lutB = buildLut((value) => ((value - lowB) / Math.max(1, highB - lowB)) * 255);
    return applyLut(imageData, lutR, lutG, lutB);
  }

  function thresholdImage(imageData, threshold) {
    return applyPerPixel(imageData, (r, g, b, a) => {
      const gray = luminance(r, g, b) >= threshold ? 255 : 0;
      return [gray, gray, gray, a];
    });
  }

  function posterizeImage(imageData, levels) {
    const safeLevels = Math.max(2, Math.round(levels));
    const scale = 255 / (safeLevels - 1);
    const lut = buildLut((value) => Math.round((value / 255) * (safeLevels - 1)) * scale);
    return applyLut(imageData, lut);
  }

  function solarizeImage(imageData, threshold) {
    const lut = buildLut((value) => (value > threshold ? 255 - value : value));
    return applyLut(imageData, lut);
  }

  function sepiaImage(imageData, amount) {
    return applyPerPixel(imageData, (r, g, b, a) => {
      const sr = clamp(r * 0.393 + g * 0.769 + b * 0.189);
      const sg = clamp(r * 0.349 + g * 0.686 + b * 0.168);
      const sb = clamp(r * 0.272 + g * 0.534 + b * 0.131);
      return [
        lerp(r, sr, amount),
        lerp(g, sg, amount),
        lerp(b, sb, amount),
        a
      ];
    });
  }

  function grayscaleImage(imageData, amount) {
    return applyPerPixel(imageData, (r, g, b, a) => {
      const gray = luminance(r, g, b);
      return [
        lerp(r, gray, amount),
        lerp(g, gray, amount),
        lerp(b, gray, amount),
        a
      ];
    });
  }

  function invertImage(imageData, amount) {
    return applyPerPixel(imageData, (r, g, b, a) => [
      lerp(r, 255 - r, amount),
      lerp(g, 255 - g, amount),
      lerp(b, 255 - b, amount),
      a
    ]);
  }

  function duotoneImage(imageData, shadowColor, highlightColor) {
    const shadow = parseHexColor(shadowColor);
    const highlight = parseHexColor(highlightColor);
    return applyPerPixel(imageData, (r, g, b, a) => {
      const t = luminance(r, g, b) / 255;
      return [
        lerp(shadow[0], highlight[0], t),
        lerp(shadow[1], highlight[1], t),
        lerp(shadow[2], highlight[2], t),
        a
      ];
    });
  }

  function colorizeImage(imageData, color, amount) {
    const target = parseHexColor(color);
    return applyPerPixel(imageData, (r, g, b, a) => {
      const lightness = luminance(r, g, b) / 255;
      const tr = target[0] * lightness;
      const tg = target[1] * lightness;
      const tb = target[2] * lightness;
      return [lerp(r, tr, amount), lerp(g, tg, amount), lerp(b, tb, amount), a];
    });
  }

  function vignetteImage(imageData, strength, size) {
    return applyPerPixel(imageData, (r, g, b, a, x, y, width, height) => {
      const cx = (width - 1) / 2;
      const cy = (height - 1) / 2;
      const dx = (x - cx) / (width / 2 || 1);
      const dy = (y - cy) / (height / 2 || 1);
      const distance = Math.sqrt(dx * dx + dy * dy);
      const start = size;
      const factor = 1 - smoothstep(start, 1.2, distance) * strength;
      return [r * factor, g * factor, b * factor, a];
    });
  }

  function boxBlurImage(imageData, radius) {
    const safeRadius = Math.max(0, Math.round(radius));
    if (safeRadius < 1) return cloneImageData(imageData);
    return separableConvolve(imageData, createUniformKernel(safeRadius));
  }

  function gaussianBlurImage(imageData, radius) {
    const safeRadius = Math.max(0, Math.round(radius));
    if (safeRadius < 1) return cloneImageData(imageData);
    return separableConvolve(imageData, createGaussianKernel(safeRadius));
  }

  function motionBlurImage(imageData, radius, angleDeg) {
    const safeRadius = Math.max(1, Math.round(radius));
    const angle = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const samples = Math.max(3, safeRadius * 2 + 1);
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let i = 0; i < samples; i += 1) {
          const t = (i / (samples - 1)) * 2 - 1;
          const sx = x + dx * safeRadius * t;
          const sy = y + dy * safeRadius * t;
          const sample = sampleBilinear(data, width, height, sx, sy);
          r += sample[0];
          g += sample[1];
          b += sample[2];
          a += sample[3];
        }
        const index = (y * width + x) * 4;
        output[index] = clamp(r / samples);
        output[index + 1] = clamp(g / samples);
        output[index + 2] = clamp(b / samples);
        output[index + 3] = clamp(a / samples);
      }
    }

    return new ImageData(output, width, height);
  }

  function zoomBlurImage(imageData, strength) {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const amount = clamp(strength, 0, 1);
    const samples = 18;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let i = 0; i < samples; i += 1) {
          const t = (i / (samples - 1)) * amount;
          const sx = lerp(x, cx, t);
          const sy = lerp(y, cy, t);
          const sample = sampleBilinear(data, width, height, sx, sy);
          r += sample[0];
          g += sample[1];
          b += sample[2];
          a += sample[3];
        }
        const index = (y * width + x) * 4;
        output[index] = clamp(r / samples);
        output[index + 1] = clamp(g / samples);
        output[index + 2] = clamp(b / samples);
        output[index + 3] = clamp(a / samples);
      }
    }

    return new ImageData(output, width, height);
  }

  function sharpenKernelImage(imageData, kernel, amount) {
    const convolved = convolve(imageData, kernel, 3);
    return blendImages(imageData, convolved, 'normal', amount);
  }

  function sharpenImage(imageData, amount) {
    return sharpenKernelImage(imageData, [0, -1, 0, -1, 5, -1, 0, -1, 0], amount);
  }

  function sharpenMoreImage(imageData, amount) {
    return sharpenKernelImage(imageData, [-1, -1, -1, -1, 9, -1, -1, -1, -1], amount);
  }

  function unsharpMaskImage(imageData, radius, amount, threshold) {
    const blurred = gaussianBlurImage(imageData, radius);
    const { width, height, data } = imageData;
    const blurData = blurred.data;
    const output = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const diff = data[i + channel] - blurData[i + channel];
        output[i + channel] = Math.abs(diff) >= threshold
          ? clamp(data[i + channel] + diff * amount)
          : data[i + channel];
      }
      output[i + 3] = data[i + 3];
    }
    return new ImageData(output, width, height);
  }

  function highPassImage(imageData, radius, amount) {
    const blurred = gaussianBlurImage(imageData, radius);
    const { width, height, data } = imageData;
    const blurData = blurred.data;
    const output = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = 128 + (data[i + channel] - blurData[i + channel]) * amount;
        output[i + channel] = clamp(value);
      }
      output[i + 3] = data[i + 3];
    }
    return new ImageData(output, width, height);
  }

  function embossImage(imageData, strength, angleDeg) {
    const angle = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    return applyPerPixel(imageData, (r, g, b, a, x, y, width, height, index, data) => {
      const forward = sampleBilinear(data, width, height, x + dx, y + dy);
      const backward = sampleBilinear(data, width, height, x - dx, y - dy);
      return [
        128 + (forward[0] - backward[0]) * strength,
        128 + (forward[1] - backward[1]) * strength,
        128 + (forward[2] - backward[2]) * strength,
        a
      ];
    });
  }

  function medianBlurImage(imageData, radius) {
    const safeRadius = Math.max(1, Math.round(radius));
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    const size = (safeRadius * 2 + 1) ** 2;
    const valuesR = new Array(size);
    const valuesG = new Array(size);
    const valuesB = new Array(size);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let count = 0;
        for (let ky = -safeRadius; ky <= safeRadius; ky += 1) {
          const sy = clamp(y + ky, 0, height - 1);
          for (let kx = -safeRadius; kx <= safeRadius; kx += 1) {
            const sx = clamp(x + kx, 0, width - 1);
            const idx = (sy * width + sx) * 4;
            valuesR[count] = data[idx];
            valuesG[count] = data[idx + 1];
            valuesB[count] = data[idx + 2];
            count += 1;
          }
        }
        valuesR.length = count;
        valuesG.length = count;
        valuesB.length = count;
        valuesR.sort((a, b) => a - b);
        valuesG.sort((a, b) => a - b);
        valuesB.sort((a, b) => a - b);
        const middle = Math.floor(count / 2);
        const dstIndex = (y * width + x) * 4;
        output[dstIndex] = valuesR[middle];
        output[dstIndex + 1] = valuesG[middle];
        output[dstIndex + 2] = valuesB[middle];
        output[dstIndex + 3] = data[dstIndex + 3];
      }
    }

    return new ImageData(output, width, height);
  }

  function dustAndScratchesImage(imageData, radius, threshold) {
    const median = medianBlurImage(imageData, radius);
    const { width, height, data } = imageData;
    const med = median.data;
    const output = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const diff = (
        Math.abs(data[i] - med[i]) +
        Math.abs(data[i + 1] - med[i + 1]) +
        Math.abs(data[i + 2] - med[i + 2])
      ) / 3;
      if (diff > threshold) {
        output[i] = med[i];
        output[i + 1] = med[i + 1];
        output[i + 2] = med[i + 2];
      } else {
        output[i] = data[i];
        output[i + 1] = data[i + 1];
        output[i + 2] = data[i + 2];
      }
      output[i + 3] = data[i + 3];
    }
    return new ImageData(output, width, height);
  }

  function edgeDetectImage(imageData, amount) {
    const sobel = computeSobelData(imageData);
    return sobelToImage(sobel, amount);
  }

  function outlineImage(imageData, threshold, invert) {
    const sobel = computeSobelData(imageData);
    const { width, height, magnitude } = sobel;
    const output = new Uint8ClampedArray(width * height * 4);
    let maxMag = 0;
    for (let i = 0; i < magnitude.length; i += 1) {
      if (magnitude[i] > maxMag) maxMag = magnitude[i];
    }
    const scale = maxMag ? 255 / maxMag : 1;
    for (let i = 0; i < magnitude.length; i += 1) {
      const edge = magnitude[i] * scale >= threshold ? 0 : 255;
      const value = invert ? 255 - edge : edge;
      const index = i * 4;
      output[index] = value;
      output[index + 1] = value;
      output[index + 2] = value;
      output[index + 3] = 255;
    }
    return new ImageData(output, width, height);
  }

  function laplacianImage(imageData, amount) {
    const lap = convolve(imageData, [-1, -1, -1, -1, 8, -1, -1, -1, -1], 3, { grayscale: true });
    return applyPerPixel(lap, (r, g, b, a) => [r * amount, g * amount, b * amount, 255]);
  }

  function pixelateImage(imageData, blockSize) {
    const size = Math.max(1, Math.round(blockSize));
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    for (let by = 0; by < height; by += size) {
      for (let bx = 0; bx < width; bx += size) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let count = 0;
        for (let y = by; y < Math.min(by + size, height); y += 1) {
          for (let x = bx; x < Math.min(bx + size, width); x += 1) {
            const index = (y * width + x) * 4;
            r += data[index];
            g += data[index + 1];
            b += data[index + 2];
            a += data[index + 3];
            count += 1;
          }
        }
        const avgR = r / count;
        const avgG = g / count;
        const avgB = b / count;
        const avgA = a / count;
        for (let y = by; y < Math.min(by + size, height); y += 1) {
          for (let x = bx; x < Math.min(bx + size, width); x += 1) {
            const index = (y * width + x) * 4;
            output[index] = avgR;
            output[index + 1] = avgG;
            output[index + 2] = avgB;
            output[index + 3] = avgA;
          }
        }
      }
    }
    return new ImageData(output, width, height);
  }

  function mosaicImage(imageData, blockSize, groutStrength) {
    const base = pixelateImage(imageData, blockSize);
    const { width, height, data } = base;
    const output = new Uint8ClampedArray(data);
    const size = Math.max(2, Math.round(blockSize));
    const lineWidth = Math.max(1, Math.round(size * groutStrength));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const inLine = x % size < lineWidth || y % size < lineWidth;
        if (!inLine) continue;
        const index = (y * width + x) * 4;
        output[index] *= 0.7;
        output[index + 1] *= 0.7;
        output[index + 2] *= 0.7;
      }
    }
    return new ImageData(output, width, height);
  }

  function noiseImage(imageData, amount, monochrome = false) {
    const scale = amount * 255;
    return applyPerPixel(imageData, (r, g, b, a, x, y) => {
      const n = (hash2D(x, y, 1) - 0.5) * 2 * scale;
      if (monochrome) {
        return [r + n, g + n, b + n, a];
      }
      return [
        r + (hash2D(x, y, 2) - 0.5) * 2 * scale,
        g + (hash2D(x, y, 3) - 0.5) * 2 * scale,
        b + (hash2D(x, y, 4) - 0.5) * 2 * scale,
        a
      ];
    });
  }

  function filmGrainImage(imageData, amount) {
    const scale = amount * 180;
    return applyPerPixel(imageData, (r, g, b, a, x, y) => {
      const gray = luminance(r, g, b) / 255;
      const weight = 1 - Math.abs(gray - 0.5) * 1.5;
      const grain = (hash2D(x, y, 9) - 0.5) * 2 * scale * weight;
      return [r + grain, g + grain, b + grain, a];
    });
  }

  function scanlinesImage(imageData, spacing, strength) {
    const safeSpacing = Math.max(2, Math.round(spacing));
    return applyPerPixel(imageData, (r, g, b, a, x, y) => {
      const phase = y % safeSpacing;
      const factor = phase === 0 ? 1 - strength : 1;
      return [r * factor, g * factor, b * factor, a];
    });
  }

  function chromaticAberrationImage(imageData, offset) {
    const amount = Math.max(0, offset);
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / distance;
        const uy = dy / distance;
        const rs = sampleBilinear(data, width, height, x + ux * amount, y + uy * amount);
        const gs = sampleBilinear(data, width, height, x, y);
        const bs = sampleBilinear(data, width, height, x - ux * amount, y - uy * amount);
        const index = (y * width + x) * 4;
        output[index] = rs[0];
        output[index + 1] = gs[1];
        output[index + 2] = bs[2];
        output[index + 3] = gs[3];
      }
    }

    return new ImageData(output, width, height);
  }

  function rgbSplitImage(imageData, offsetX, offsetY) {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const rSample = sampleBilinear(data, width, height, x + offsetX, y + offsetY);
        const gSample = sampleBilinear(data, width, height, x, y);
        const bSample = sampleBilinear(data, width, height, x - offsetX, y - offsetY);
        const index = (y * width + x) * 4;
        output[index] = rSample[0];
        output[index + 1] = gSample[1];
        output[index + 2] = bSample[2];
        output[index + 3] = gSample[3];
      }
    }
    return new ImageData(output, width, height);
  }

  function bloomImage(imageData, radius, strength, threshold) {
    const { width, height, data } = imageData;
    const bright = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const l = luminance(data[i], data[i + 1], data[i + 2]);
      if (l >= threshold) {
        bright[i] = data[i];
        bright[i + 1] = data[i + 1];
        bright[i + 2] = data[i + 2];
        bright[i + 3] = data[i + 3];
      } else {
        bright[i] = 0;
        bright[i + 1] = 0;
        bright[i + 2] = 0;
        bright[i + 3] = data[i + 3];
      }
    }
    const blurred = gaussianBlurImage(new ImageData(bright, width, height), radius);
    return blendImages(imageData, blurred, 'screen', strength);
  }

  function pencilSketchImage(imageData, radius, amount) {
    const gray = grayscaleImage(imageData, 1);
    const inverted = invertImage(gray, 1);
    const blurred = gaussianBlurImage(inverted, radius);
    const { width, height, data } = gray;
    const blurData = blurred.data;
    const output = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const dodge = (base, blend) => (blend >= 255 ? 255 : clamp((base * 255) / Math.max(1, 255 - blend)));
      const sketched = dodge(data[i], blurData[i]);
      const value = lerp(data[i], sketched, amount);
      output[i] = value;
      output[i + 1] = value;
      output[i + 2] = value;
      output[i + 3] = data[i + 3];
    }
    return new ImageData(output, width, height);
  }

  function halftoneImage(imageData, cellSize, intensity) {
    const size = Math.max(3, Math.round(cellSize));
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(width * height * 4);
    output.fill(255);
    for (let by = 0; by < height; by += size) {
      for (let bx = 0; bx < width; bx += size) {
        let graySum = 0;
        let count = 0;
        for (let y = by; y < Math.min(by + size, height); y += 1) {
          for (let x = bx; x < Math.min(bx + size, width); x += 1) {
            const index = (y * width + x) * 4;
            graySum += luminance(data[index], data[index + 1], data[index + 2]);
            count += 1;
          }
        }
        const avg = graySum / count;
        const radius = (1 - avg / 255) * (size * 0.5) * intensity;
        const cx = bx + size / 2;
        const cy = by + size / 2;
        for (let y = by; y < Math.min(by + size, height); y += 1) {
          for (let x = bx; x < Math.min(bx + size, width); x += 1) {
            const index = (y * width + x) * 4;
            const dist = Math.hypot(x - cx, y - cy);
            const value = dist <= radius ? 0 : 255;
            output[index] = value;
            output[index + 1] = value;
            output[index + 2] = value;
            output[index + 3] = 255;
          }
        }
      }
    }
    return new ImageData(output, width, height);
  }

  function ditherImage(imageData, levels) {
    const safeLevels = Math.max(2, Math.round(levels));
    const step = 255 / (safeLevels - 1);
    const gray = grayscaleImage(imageData, 1);
    const { width, height, data } = gray;
    const working = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      working[p] = data[i];
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const oldPixel = working[index];
        const newPixel = Math.round(oldPixel / step) * step;
        const error = oldPixel - newPixel;
        working[index] = newPixel;
        if (x + 1 < width) working[index + 1] += error * (7 / 16);
        if (x - 1 >= 0 && y + 1 < height) working[index + width - 1] += error * (3 / 16);
        if (y + 1 < height) working[index + width] += error * (5 / 16);
        if (x + 1 < width && y + 1 < height) working[index + width + 1] += error * (1 / 16);
      }
    }

    const output = new Uint8ClampedArray(data.length);
    for (let i = 0, p = 0; i < output.length; i += 4, p += 1) {
      const value = clamp(working[p]);
      output[i] = value;
      output[i + 1] = value;
      output[i + 2] = value;
      output[i + 3] = data[i + 3];
    }
    return new ImageData(output, width, height);
  }

  function bayerDitherImage(imageData, levels) {
    const matrix = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5]
    ];
    const safeLevels = Math.max(2, Math.round(levels));
    const step = 255 / (safeLevels - 1);
    const gray = grayscaleImage(imageData, 1);
    return applyPerPixel(gray, (r, g, b, a, x, y) => {
      const threshold = (matrix[y % 4][x % 4] + 0.5) / 16 - 0.5;
      const value = clamp(r + threshold * step);
      const quantized = Math.round(value / step) * step;
      return [quantized, quantized, quantized, a];
    });
  }

  function cartoonImage(imageData, levels, edgeThreshold) {
    const smoothed = gaussianBlurImage(imageData, 1);
    const quantized = posterizeImage(smoothed, levels);
    const sobel = computeSobelData(smoothed);
    const { width, height, magnitude } = sobel;
    const quantizedData = quantized.data;
    const output = new Uint8ClampedArray(quantizedData.length);
    let maxMag = 0;
    for (let i = 0; i < magnitude.length; i += 1) {
      if (magnitude[i] > maxMag) maxMag = magnitude[i];
    }
    const scale = maxMag ? 255 / maxMag : 1;
    for (let i = 0, p = 0; i < quantizedData.length; i += 4, p += 1) {
      const isEdge = magnitude[p] * scale >= edgeThreshold;
      if (isEdge) {
        output[i] = 0;
        output[i + 1] = 0;
        output[i + 2] = 0;
      } else {
        output[i] = quantizedData[i];
        output[i + 1] = quantizedData[i + 1];
        output[i + 2] = quantizedData[i + 2];
      }
      output[i + 3] = quantizedData[i + 3];
    }
    return new ImageData(output, width, height);
  }

  function retroFilmImage(imageData, amount) {
    const sep = sepiaImage(imageData, 0.65 * amount);
    const faded = applyPerPixel(sep, (r, g, b, a) => [
      lerp(r, 245, 0.15 * amount),
      lerp(g, 230, 0.12 * amount),
      lerp(b, 200, 0.08 * amount),
      a
    ]);
    const grain = filmGrainImage(faded, 0.35 * amount);
    const scan = scanlinesImage(grain, 3, 0.12 * amount);
    const vignette = vignetteImage(scan, 0.55 * amount, 0.35);
    return applyPerPixel(vignette, (r, g, b, a, x, y) => {
      const scratch = hash2D(Math.floor(x / 2), Math.floor(y / 80), 13) > 0.992 ? 40 : 0;
      return [r + scratch, g + scratch, b + scratch * 0.8, a];
    });
  }

  function glitchImage(imageData, amount) {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    const maxShift = Math.max(2, Math.round(width * 0.08 * amount));
    const bandHeight = Math.max(3, Math.round(height * 0.02));

    for (let y = 0; y < height; y += 1) {
      const band = Math.floor(y / bandHeight);
      const active = hash2D(band, 0, 21) > 0.55;
      const shift = active ? Math.round((hash2D(band, 0, 22) - 0.5) * 2 * maxShift) : 0;
      const colorOffset = active ? Math.round((hash2D(band, 0, 23) - 0.5) * maxShift * 0.5) : 0;
      for (let x = 0; x < width; x += 1) {
        const base = sampleBilinear(data, width, height, x + shift, y, { wrap: true });
        const r = sampleBilinear(data, width, height, x + shift + colorOffset, y, { wrap: true });
        const b = sampleBilinear(data, width, height, x + shift - colorOffset, y, { wrap: true });
        const index = (y * width + x) * 4;
        output[index] = r[0];
        output[index + 1] = base[1];
        output[index + 2] = b[2];
        output[index + 3] = base[3];
        if (hash2D(x, y, 24) > 0.998 - amount * 0.01) {
          output[index] = 255;
          output[index + 1] *= 0.2;
          output[index + 2] = 255;
        }
      }
    }
    return new ImageData(output, width, height);
  }

  function normalMapImage(imageData, strength, invertY) {
    const { width, height, data } = imageData;
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      gray[p] = luminance(data[i], data[i + 1], data[i + 2]) / 255;
    }
    const output = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const left = gray[y * width + clamp(x - 1, 0, width - 1)];
        const right = gray[y * width + clamp(x + 1, 0, width - 1)];
        const top = gray[clamp(y - 1, 0, height - 1) * width + x];
        const bottom = gray[clamp(y + 1, 0, height - 1) * width + x];
        let nx = (left - right) * strength;
        let ny = (invertY ? bottom - top : top - bottom) * strength;
        let nz = 1;
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= length;
        ny /= length;
        nz /= length;
        const index = (y * width + x) * 4;
        output[index] = clamp((nx * 0.5 + 0.5) * 255);
        output[index + 1] = clamp((ny * 0.5 + 0.5) * 255);
        output[index + 2] = clamp((nz * 0.5 + 0.5) * 255);
        output[index + 3] = 255;
      }
    }
    return new ImageData(output, width, height);
  }

  function crystallizeImage(imageData, cellSize, jitterAmount) {
    const { width, height, data } = imageData;
    const size = Math.max(4, Math.round(cellSize));
    const gridW = Math.ceil(width / size);
    const gridH = Math.ceil(height / size);
    const jitter = clamp(jitterAmount, 0, 1);
    const seeds = new Array(gridW * gridH);

    for (let gy = 0; gy < gridH; gy += 1) {
      for (let gx = 0; gx < gridW; gx += 1) {
        const baseX = gx * size + size / 2;
        const baseY = gy * size + size / 2;
        const sx = baseX + (hash2D(gx, gy, 31) - 0.5) * size * jitter;
        const sy = baseY + (hash2D(gx, gy, 32) - 0.5) * size * jitter;
        const sample = sampleNearest(data, width, height, sx, sy);
        seeds[gy * gridW + gx] = { x: sx, y: sy, color: sample };
      }
    }

    const output = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y += 1) {
      const cy = Math.floor(y / size);
      for (let x = 0; x < width; x += 1) {
        const cx = Math.floor(x / size);
        let best = null;
        let bestDist = Infinity;
        for (let gy = Math.max(0, cy - 1); gy <= Math.min(gridH - 1, cy + 1); gy += 1) {
          for (let gx = Math.max(0, cx - 1); gx <= Math.min(gridW - 1, cx + 1); gx += 1) {
            const seed = seeds[gy * gridW + gx];
            const dist = (seed.x - x) ** 2 + (seed.y - y) ** 2;
            if (dist < bestDist) {
              bestDist = dist;
              best = seed;
            }
          }
        }
        const index = (y * width + x) * 4;
        output[index] = best.color[0];
        output[index + 1] = best.color[1];
        output[index + 2] = best.color[2];
        output[index + 3] = best.color[3];
      }
    }
    return new ImageData(output, width, height);
  }

  function neonEdgesImage(imageData, color, strength, threshold) {
    const edges = computeSobelData(imageData);
    const [cr, cg, cb] = parseHexColor(color);
    const { width, height, magnitude } = edges;
    const output = new Uint8ClampedArray(width * height * 4);
    let maxMag = 0;
    for (let i = 0; i < magnitude.length; i += 1) {
      if (magnitude[i] > maxMag) maxMag = magnitude[i];
    }
    const scale = maxMag ? 255 / maxMag : 1;
    for (let i = 0; i < magnitude.length; i += 1) {
      const value = magnitude[i] * scale;
      const normalized = value < threshold ? 0 : ((value - threshold) / Math.max(1, 255 - threshold));
      const glow = normalized * strength;
      const index = i * 4;
      output[index] = clamp(cr * glow);
      output[index + 1] = clamp(cg * glow);
      output[index + 2] = clamp(cb * glow);
      output[index + 3] = 255;
    }
    return new ImageData(output, width, height);
  }

  function rippleImage(imageData, amplitude, frequency) {
    return warpImage(imageData, (x, y, width, height, cx, cy) => {
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const angle = Math.atan2(dy, dx);
      const newDistance = distance + Math.sin(distance / Math.max(1, frequency)) * amplitude;
      return [cx + Math.cos(angle) * newDistance, cy + Math.sin(angle) * newDistance];
    });
  }

  function waveImage(imageData, amplitude, wavelength, direction) {
    return warpImage(imageData, (x, y) => {
      const waveX = Math.sin((y / Math.max(1, wavelength)) * Math.PI * 2) * amplitude;
      const waveY = Math.sin((x / Math.max(1, wavelength)) * Math.PI * 2) * amplitude;
      if (direction === 'vertical') return [x, y + waveY];
      if (direction === 'both') return [x + waveX, y + waveY];
      return [x + waveX, y];
    });
  }

  function twirlImage(imageData, angleDeg, radiusPercent) {
    return warpImage(imageData, (x, y, width, height, cx, cy) => {
      const radius = (Math.min(width, height) * radiusPercent) / 2;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= radius || radius <= 0) return [x, y];
      const baseAngle = Math.atan2(dy, dx);
      const twist = ((radius - dist) / radius) * ((angleDeg * Math.PI) / 180);
      return [cx + Math.cos(baseAngle + twist) * dist, cy + Math.sin(baseAngle + twist) * dist];
    });
  }

  function pinchBulgeImage(imageData, amount, radiusPercent) {
    return warpImage(imageData, (x, y, width, height, cx, cy) => {
      const radius = (Math.min(width, height) * radiusPercent) / 2;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= radius || radius <= 0 || dist === 0) return [x, y];
      const normalized = dist / radius;
      let mapped = normalized;
      if (amount >= 0) {
        mapped = normalized ** (1 + amount * 2);
      } else {
        mapped = normalized ** (1 / (1 + Math.abs(amount) * 2));
      }
      const scale = (mapped * radius) / dist;
      return [cx + dx * scale, cy + dy * scale];
    });
  }

  function fisheyeImage(imageData, amount) {
    return warpImage(imageData, (x, y, width, height, cx, cy) => {
      const dx = (x - cx) / (width / 2 || 1);
      const dy = (y - cy) / (height / 2 || 1);
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r >= 1 || r === 0) return [x, y];
      const power = 1 - amount * 0.65;
      const mapped = r ** power;
      const scale = mapped / r;
      return [cx + dx * scale * (width / 2), cy + dy * scale * (height / 2)];
    });
  }

  function offsetImage(imageData, offsetXPercent, offsetYPercent, wrap) {
    const shiftX = imageData.width * offsetXPercent;
    const shiftY = imageData.height * offsetYPercent;
    return warpImage(
      imageData,
      (x, y) => [x - shiftX, y - shiftY],
      { wrap }
    );
  }

  function mirrorImage(imageData, mode) {
    const { width, height, data } = imageData;
    const output = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sx = x;
        let sy = y;
        if (mode === 'horizontal') {
          sx = x < width / 2 ? x : width - 1 - x;
        } else if (mode === 'vertical') {
          sy = y < height / 2 ? y : height - 1 - y;
        } else {
          sx = x < width / 2 ? x : width - 1 - x;
          sy = y < height / 2 ? y : height - 1 - y;
        }
        const srcIndex = (sy * width + sx) * 4;
        const dstIndex = (y * width + x) * 4;
        output[dstIndex] = data[srcIndex];
        output[dstIndex + 1] = data[srcIndex + 1];
        output[dstIndex + 2] = data[srcIndex + 2];
        output[dstIndex + 3] = data[srcIndex + 3];
      }
    }
    return new ImageData(output, width, height);
  }

  const FILTER_DEFS = [
    {
      key: 'brightness',
      name: 'Brightness',
      category: '補正',
      params: [{ key: 'amount', label: '明るさ', type: 'range', min: -100, max: 100, step: 1, default: 0 }],
      apply: (img, p) => brightnessImage(img, p.amount)
    },
    {
      key: 'contrast',
      name: 'Contrast',
      category: '補正',
      params: [{ key: 'amount', label: 'コントラスト', type: 'range', min: -100, max: 100, step: 1, default: 0 }],
      apply: (img, p) => contrastImage(img, p.amount)
    },
    {
      key: 'exposure',
      name: 'Exposure',
      category: '補正',
      params: [{ key: 'ev', label: '露光', type: 'range', min: -2, max: 2, step: 0.05, default: 0 }],
      apply: (img, p) => exposureImage(img, p.ev)
    },
    {
      key: 'gamma',
      name: 'Gamma',
      category: '補正',
      params: [{ key: 'gamma', label: 'ガンマ', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 }],
      apply: (img, p) => gammaImage(img, p.gamma)
    },
    {
      key: 'saturation',
      name: 'Saturation',
      category: '補正',
      params: [{ key: 'amount', label: '彩度', type: 'range', min: -1, max: 1, step: 0.01, default: 0 }],
      apply: (img, p) => saturationImage(img, p.amount)
    },
    {
      key: 'vibrance',
      name: 'Vibrance',
      category: '補正',
      params: [{ key: 'amount', label: '自然な彩度', type: 'range', min: -1, max: 1, step: 0.01, default: 0 }],
      apply: (img, p) => vibranceImage(img, p.amount)
    },
    {
      key: 'hueShift',
      name: 'Hue Shift',
      category: '補正',
      params: [{ key: 'degrees', label: '色相回転', type: 'range', min: -180, max: 180, step: 1, default: 0 }],
      apply: (img, p) => hueShiftImage(img, p.degrees)
    },
    {
      key: 'tempTint',
      name: 'Temperature & Tint',
      category: '補正',
      params: [
        { key: 'temperature', label: '温度', type: 'range', min: -1, max: 1, step: 0.01, default: 0 },
        { key: 'tint', label: '色被り', type: 'range', min: -1, max: 1, step: 0.01, default: 0 }
      ],
      apply: (img, p) => temperatureTintImage(img, p.temperature, p.tint)
    },
    {
      key: 'rgbBalance',
      name: 'RGB Balance',
      category: '補正',
      params: [
        { key: 'red', label: '赤', type: 'range', min: -1, max: 1, step: 0.01, default: 0 },
        { key: 'green', label: '緑', type: 'range', min: -1, max: 1, step: 0.01, default: 0 },
        { key: 'blue', label: '青', type: 'range', min: -1, max: 1, step: 0.01, default: 0 }
      ],
      apply: (img, p) => rgbBalanceImage(img, p.red, p.green, p.blue)
    },
    {
      key: 'levels',
      name: 'Levels',
      category: '補正',
      params: [
        { key: 'black', label: '黒レベル', type: 'range', min: 0, max: 128, step: 1, default: 0 },
        { key: 'white', label: '白レベル', type: 'range', min: 127, max: 255, step: 1, default: 255 },
        { key: 'gamma', label: '中間調', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 }
      ],
      apply: (img, p) => levelsImage(img, p.black, p.white, p.gamma)
    },
    {
      key: 'autoContrast',
      name: 'Auto Contrast',
      category: '補正',
      params: [{ key: 'clip', label: 'クリップ率%', type: 'range', min: 0, max: 5, step: 0.1, default: 0.5 }],
      apply: (img, p) => autoContrastImage(img, p.clip)
    },
    {
      key: 'threshold',
      name: 'Threshold',
      category: '補正',
      params: [{ key: 'threshold', label: 'しきい値', type: 'range', min: 0, max: 255, step: 1, default: 128 }],
      apply: (img, p) => thresholdImage(img, p.threshold)
    },
    {
      key: 'posterize',
      name: 'Posterize',
      category: '補正',
      params: [{ key: 'levels', label: '階調数', type: 'range', min: 2, max: 32, step: 1, default: 6 }],
      apply: (img, p) => posterizeImage(img, p.levels)
    },
    {
      key: 'solarize',
      name: 'Solarize',
      category: '補正',
      params: [{ key: 'threshold', label: '反転開始', type: 'range', min: 0, max: 255, step: 1, default: 128 }],
      apply: (img, p) => solarizeImage(img, p.threshold)
    },
    {
      key: 'sepia',
      name: 'Sepia',
      category: '補正',
      params: [{ key: 'amount', label: '量', type: 'range', min: 0, max: 1, step: 0.01, default: 1 }],
      apply: (img, p) => sepiaImage(img, p.amount)
    },
    {
      key: 'grayscale',
      name: 'Grayscale',
      category: '補正',
      params: [{ key: 'amount', label: '量', type: 'range', min: 0, max: 1, step: 0.01, default: 1 }],
      apply: (img, p) => grayscaleImage(img, p.amount)
    },
    {
      key: 'invert',
      name: 'Invert',
      category: '補正',
      params: [{ key: 'amount', label: '量', type: 'range', min: 0, max: 1, step: 0.01, default: 1 }],
      apply: (img, p) => invertImage(img, p.amount)
    },
    {
      key: 'duotone',
      name: 'Duotone / Gradient Map',
      category: '補正',
      params: [
        { key: 'shadow', label: '暗部色', type: 'color', default: '#1f1f1f' },
        { key: 'highlight', label: '明部色', type: 'color', default: '#f7e08b' }
      ],
      apply: (img, p) => duotoneImage(img, p.shadow, p.highlight)
    },
    {
      key: 'colorize',
      name: 'Colorize',
      category: '補正',
      params: [
        { key: 'color', label: '色', type: 'color', default: '#4fc3ff' },
        { key: 'amount', label: '量', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 }
      ],
      apply: (img, p) => colorizeImage(img, p.color, p.amount)
    },
    {
      key: 'vignette',
      name: 'Vignette',
      category: '補正',
      params: [
        { key: 'strength', label: '強さ', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
        { key: 'size', label: '中心サイズ', type: 'range', min: 0, max: 0.95, step: 0.01, default: 0.4 }
      ],
      apply: (img, p) => vignetteImage(img, p.strength, p.size)
    },
    {
      key: 'boxBlur',
      name: 'Box Blur',
      category: 'ぼかし・シャープ',
      params: [{ key: 'radius', label: '半径', type: 'range', min: 1, max: 20, step: 1, default: 3 }],
      apply: (img, p) => boxBlurImage(img, p.radius)
    },
    {
      key: 'gaussianBlur',
      name: 'Gaussian Blur',
      category: 'ぼかし・シャープ',
      params: [{ key: 'radius', label: '半径', type: 'range', min: 1, max: 20, step: 1, default: 4 }],
      apply: (img, p) => gaussianBlurImage(img, p.radius)
    },
    {
      key: 'motionBlur',
      name: 'Motion Blur',
      category: 'ぼかし・シャープ',
      params: [
        { key: 'radius', label: '長さ', type: 'range', min: 1, max: 30, step: 1, default: 8 },
        { key: 'angle', label: '角度', type: 'range', min: 0, max: 360, step: 1, default: 0 }
      ],
      apply: (img, p) => motionBlurImage(img, p.radius, p.angle)
    },
    {
      key: 'zoomBlur',
      name: 'Zoom Blur',
      category: 'ぼかし・シャープ',
      params: [{ key: 'strength', label: '強さ', type: 'range', min: 0, max: 1, step: 0.01, default: 0.25 }],
      apply: (img, p) => zoomBlurImage(img, p.strength)
    },
    {
      key: 'sharpen',
      name: 'Sharpen',
      category: 'ぼかし・シャープ',
      params: [{ key: 'amount', label: '量', type: 'range', min: 0, max: 1, step: 0.01, default: 1 }],
      apply: (img, p) => sharpenImage(img, p.amount)
    },
    {
      key: 'sharpenMore',
      name: 'Sharpen More',
      category: 'ぼかし・シャープ',
      params: [{ key: 'amount', label: '量', type: 'range', min: 0, max: 1, step: 0.01, default: 0.8 }],
      apply: (img, p) => sharpenMoreImage(img, p.amount)
    },
    {
      key: 'unsharpMask',
      name: 'Unsharp Mask',
      category: 'ぼかし・シャープ',
      params: [
        { key: 'radius', label: '半径', type: 'range', min: 1, max: 12, step: 1, default: 2 },
        { key: 'amount', label: '量', type: 'range', min: 0, max: 5, step: 0.1, default: 1.6 },
        { key: 'threshold', label: 'しきい値', type: 'range', min: 0, max: 50, step: 1, default: 3 }
      ],
      apply: (img, p) => unsharpMaskImage(img, p.radius, p.amount, p.threshold)
    },
    {
      key: 'highPass',
      name: 'High Pass',
      category: 'ぼかし・シャープ',
      params: [
        { key: 'radius', label: '半径', type: 'range', min: 1, max: 20, step: 1, default: 4 },
        { key: 'amount', label: '強さ', type: 'range', min: 0, max: 4, step: 0.05, default: 1 }
      ],
      apply: (img, p) => highPassImage(img, p.radius, p.amount)
    },
    {
      key: 'emboss',
      name: 'Emboss',
      category: 'ぼかし・シャープ',
      params: [
        { key: 'strength', label: '強さ', type: 'range', min: 0, max: 4, step: 0.05, default: 1 },
        { key: 'angle', label: '角度', type: 'range', min: 0, max: 360, step: 1, default: 135 }
      ],
      apply: (img, p) => embossImage(img, p.strength, p.angle)
    },
    {
      key: 'medianBlur',
      name: 'Median Blur',
      category: 'ぼかし・シャープ',
      params: [{ key: 'radius', label: '半径', type: 'range', min: 1, max: 3, step: 1, default: 1 }],
      apply: (img, p) => medianBlurImage(img, p.radius)
    },
    {
      key: 'dustAndScratches',
      name: 'Dust & Scratches',
      category: '補修・クリーニング',
      params: [
        { key: 'radius', label: '半径', type: 'range', min: 1, max: 3, step: 1, default: 1 },
        { key: 'threshold', label: '置換しきい値', type: 'range', min: 0, max: 80, step: 1, default: 20 }
      ],
      apply: (img, p) => dustAndScratchesImage(img, p.radius, p.threshold)
    },
    {
      key: 'edgeDetect',
      name: 'Edge Detect',
      category: '効果',
      params: [{ key: 'amount', label: '強調', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 }],
      apply: (img, p) => edgeDetectImage(img, p.amount)
    },
    {
      key: 'outline',
      name: 'Outline',
      category: '効果',
      params: [
        { key: 'threshold', label: 'しきい値', type: 'range', min: 0, max: 255, step: 1, default: 80 },
        { key: 'invert', label: '反転', type: 'checkbox', default: false }
      ],
      apply: (img, p) => outlineImage(img, p.threshold, p.invert)
    },
    {
      key: 'laplacian',
      name: 'Laplacian',
      category: '効果',
      params: [{ key: 'amount', label: '強さ', type: 'range', min: 0, max: 1, step: 0.01, default: 1 }],
      apply: (img, p) => laplacianImage(img, p.amount)
    },
    {
      key: 'pixelate',
      name: 'Pixelate',
      category: '効果',
      params: [{ key: 'size', label: 'ブロックサイズ', type: 'range', min: 2, max: 80, step: 1, default: 12 }],
      apply: (img, p) => pixelateImage(img, p.size)
    },
    {
      key: 'mosaic',
      name: 'Mosaic',
      category: '効果',
      params: [
        { key: 'size', label: 'タイルサイズ', type: 'range', min: 4, max: 80, step: 1, default: 18 },
        { key: 'grout', label: '目地', type: 'range', min: 0, max: 0.4, step: 0.01, default: 0.12 }
      ],
      apply: (img, p) => mosaicImage(img, p.size, p.grout)
    },
    {
      key: 'noise',
      name: 'Noise',
      category: '効果',
      params: [
        { key: 'amount', label: '量', type: 'range', min: 0, max: 1, step: 0.01, default: 0.12 },
        { key: 'mono', label: 'モノクロ', type: 'checkbox', default: false }
      ],
      apply: (img, p) => noiseImage(img, p.amount, p.mono)
    },
    {
      key: 'filmGrain',
      name: 'Film Grain',
      category: '効果',
      params: [{ key: 'amount', label: '量', type: 'range', min: 0, max: 1, step: 0.01, default: 0.18 }],
      apply: (img, p) => filmGrainImage(img, p.amount)
    },
    {
      key: 'scanlines',
      name: 'Scanlines',
      category: '効果',
      params: [
        { key: 'spacing', label: '間隔', type: 'range', min: 2, max: 10, step: 1, default: 3 },
        { key: 'strength', label: '強さ', type: 'range', min: 0, max: 0.8, step: 0.01, default: 0.18 }
      ],
      apply: (img, p) => scanlinesImage(img, p.spacing, p.strength)
    },
    {
      key: 'chromaticAberration',
      name: 'Chromatic Aberration',
      category: '効果',
      params: [{ key: 'offset', label: 'ずれ量', type: 'range', min: 0, max: 20, step: 0.5, default: 4 }],
      apply: (img, p) => chromaticAberrationImage(img, p.offset)
    },
    {
      key: 'rgbSplit',
      name: 'RGB Split',
      category: '効果',
      params: [
        { key: 'offsetX', label: 'X ずれ', type: 'range', min: -30, max: 30, step: 0.5, default: 6 },
        { key: 'offsetY', label: 'Y ずれ', type: 'range', min: -30, max: 30, step: 0.5, default: 0 }
      ],
      apply: (img, p) => rgbSplitImage(img, p.offsetX, p.offsetY)
    },
    {
      key: 'bloom',
      name: 'Bloom',
      category: '効果',
      params: [
        { key: 'radius', label: '半径', type: 'range', min: 1, max: 20, step: 1, default: 8 },
        { key: 'strength', label: '強さ', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
        { key: 'threshold', label: 'しきい値', type: 'range', min: 0, max: 255, step: 1, default: 180 }
      ],
      apply: (img, p) => bloomImage(img, p.radius, p.strength, p.threshold)
    },
    {
      key: 'pencilSketch',
      name: 'Pencil Sketch',
      category: '効果',
      params: [
        { key: 'radius', label: 'ぼかし半径', type: 'range', min: 1, max: 16, step: 1, default: 6 },
        { key: 'amount', label: '量', type: 'range', min: 0, max: 1, step: 0.01, default: 1 }
      ],
      apply: (img, p) => pencilSketchImage(img, p.radius, p.amount)
    },
    {
      key: 'halftone',
      name: 'Halftone',
      category: '効果',
      params: [
        { key: 'cell', label: 'セルサイズ', type: 'range', min: 4, max: 30, step: 1, default: 10 },
        { key: 'intensity', label: '濃さ', type: 'range', min: 0.2, max: 1.5, step: 0.01, default: 1 }
      ],
      apply: (img, p) => halftoneImage(img, p.cell, p.intensity)
    },
    {
      key: 'dither',
      name: 'Dither (Floyd-Steinberg)',
      category: '効果',
      params: [{ key: 'levels', label: '階調数', type: 'range', min: 2, max: 8, step: 1, default: 2 }],
      apply: (img, p) => ditherImage(img, p.levels)
    },
    {
      key: 'bayerDither',
      name: 'Dither (Bayer)',
      category: '効果',
      params: [{ key: 'levels', label: '階調数', type: 'range', min: 2, max: 8, step: 1, default: 4 }],
      apply: (img, p) => bayerDitherImage(img, p.levels)
    },
    {
      key: 'cartoon',
      name: 'Cartoon',
      category: '効果',
      params: [
        { key: 'levels', label: '色数', type: 'range', min: 2, max: 12, step: 1, default: 6 },
        { key: 'edgeThreshold', label: '線しきい値', type: 'range', min: 0, max: 255, step: 1, default: 70 }
      ],
      apply: (img, p) => cartoonImage(img, p.levels, p.edgeThreshold)
    },
    {
      key: 'retroFilm',
      name: 'Retro Film',
      category: '効果',
      params: [{ key: 'amount', label: '量', type: 'range', min: 0, max: 1, step: 0.01, default: 0.8 }],
      apply: (img, p) => retroFilmImage(img, p.amount)
    },
    {
      key: 'glitch',
      name: 'Glitch',
      category: '効果',
      params: [{ key: 'amount', label: '強さ', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 }],
      apply: (img, p) => glitchImage(img, p.amount)
    },
    {
      key: 'normalMap',
      name: 'Normal Map',
      category: '効果',
      params: [
        { key: 'strength', label: '凹凸強度', type: 'range', min: 0.2, max: 10, step: 0.1, default: 2 },
        { key: 'invertY', label: 'Y 反転', type: 'checkbox', default: false }
      ],
      apply: (img, p) => normalMapImage(img, p.strength, p.invertY)
    },
    {
      key: 'crystallize',
      name: 'Crystallize',
      category: '効果',
      params: [
        { key: 'size', label: 'セルサイズ', type: 'range', min: 4, max: 60, step: 1, default: 18 },
        { key: 'jitter', label: 'ばらつき', type: 'range', min: 0, max: 1, step: 0.01, default: 0.8 }
      ],
      apply: (img, p) => crystallizeImage(img, p.size, p.jitter)
    },
    {
      key: 'neonEdges',
      name: 'Neon Edges',
      category: '効果',
      params: [
        { key: 'color', label: '発光色', type: 'color', default: '#21f3ff' },
        { key: 'strength', label: '強さ', type: 'range', min: 0, max: 2, step: 0.01, default: 1 },
        { key: 'threshold', label: 'しきい値', type: 'range', min: 0, max: 255, step: 1, default: 60 }
      ],
      apply: (img, p) => neonEdgesImage(img, p.color, p.strength, p.threshold)
    },
    {
      key: 'ripple',
      name: 'Ripple',
      category: '変形',
      params: [
        { key: 'amplitude', label: '振幅', type: 'range', min: 0, max: 30, step: 1, default: 8 },
        { key: 'frequency', label: '周波数', type: 'range', min: 4, max: 80, step: 1, default: 18 }
      ],
      apply: (img, p) => rippleImage(img, p.amplitude, p.frequency)
    },
    {
      key: 'wave',
      name: 'Wave',
      category: '変形',
      params: [
        { key: 'amplitude', label: '振幅', type: 'range', min: 0, max: 40, step: 1, default: 10 },
        { key: 'wavelength', label: '波長', type: 'range', min: 8, max: 200, step: 1, default: 60 },
        {
          key: 'direction',
          label: '方向',
          type: 'select',
          default: 'horizontal',
          options: [
            ['horizontal', '横'],
            ['vertical', '縦'],
            ['both', '両方']
          ]
        }
      ],
      apply: (img, p) => waveImage(img, p.amplitude, p.wavelength, p.direction)
    },
    {
      key: 'twirl',
      name: 'Twirl',
      category: '変形',
      params: [
        { key: 'angle', label: 'ねじれ角', type: 'range', min: -540, max: 540, step: 1, default: 180 },
        { key: 'radius', label: '適用半径', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.7 }
      ],
      apply: (img, p) => twirlImage(img, p.angle, p.radius)
    },
    {
      key: 'pinch',
      name: 'Pinch',
      category: '変形',
      params: [
        { key: 'amount', label: '量', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
        { key: 'radius', label: '適用半径', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.9 }
      ],
      apply: (img, p) => pinchBulgeImage(img, p.amount, p.radius)
    },
    {
      key: 'bulge',
      name: 'Bulge',
      category: '変形',
      params: [
        { key: 'amount', label: '量', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
        { key: 'radius', label: '適用半径', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.9 }
      ],
      apply: (img, p) => pinchBulgeImage(img, -p.amount, p.radius)
    },
    {
      key: 'fisheye',
      name: 'Fisheye',
      category: '変形',
      params: [{ key: 'amount', label: '量', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 }],
      apply: (img, p) => fisheyeImage(img, p.amount)
    },
    {
      key: 'offset',
      name: 'Offset',
      category: '変形',
      params: [
        { key: 'x', label: 'X 移動', type: 'range', min: -0.5, max: 0.5, step: 0.01, default: 0.05 },
        { key: 'y', label: 'Y 移動', type: 'range', min: -0.5, max: 0.5, step: 0.01, default: 0 },
        { key: 'wrap', label: '折り返す', type: 'checkbox', default: true }
      ],
      apply: (img, p) => offsetImage(img, p.x, p.y, p.wrap)
    },
    {
      key: 'mirror',
      name: 'Mirror',
      category: '変形',
      params: [{
        key: 'mode',
        label: 'モード',
        type: 'select',
        default: 'horizontal',
        options: [
          ['horizontal', '左右'],
          ['vertical', '上下'],
          ['quad', '四分割']
        ]
      }],
      apply: (img, p) => mirrorImage(img, p.mode)
    }
  ];

  const FILTER_MAP = new Map(FILTER_DEFS.map((filter) => [filter.key, filter]));

  const PRESETS = [
    {
      name: 'クリーン補正',
      description: '自動補正 + 彩度 + シャープ',
      stack: [
        { key: 'autoContrast', params: { clip: 0.6 } },
        { key: 'vibrance', params: { amount: 0.22 } },
        { key: 'sharpen', params: { amount: 0.55 } },
        { key: 'vignette', params: { strength: 0.12, size: 0.55 } }
      ]
    },
    {
      name: '漫画スケッチ',
      description: '鉛筆 + 二値 + ハーフトーン',
      stack: [
        { key: 'grayscale', params: { amount: 1 } },
        { key: 'levels', params: { black: 12, white: 240, gamma: 1.18 } },
        { key: 'pencilSketch', params: { radius: 5, amount: 1 } },
        { key: 'halftone', params: { cell: 8, intensity: 1.1 } }
      ]
    },
    {
      name: 'レトロポスター',
      description: '二色化 + 粒子 + 周辺減光',
      stack: [
        { key: 'duotone', params: { shadow: '#18243d', highlight: '#f6b83f' } },
        { key: 'posterize', params: { levels: 5 } },
        { key: 'filmGrain', params: { amount: 0.16 } },
        { key: 'vignette', params: { strength: 0.28, size: 0.38 } }
      ]
    },
    {
      name: 'ドリームグロー',
      description: '柔らかい発光と色ずれ',
      stack: [
        { key: 'gaussianBlur', params: { radius: 2 } },
        { key: 'bloom', params: { radius: 10, strength: 0.45, threshold: 165 } },
        { key: 'chromaticAberration', params: { offset: 2.5 } },
        { key: 'vignette', params: { strength: 0.16, size: 0.5 } }
      ]
    },
    {
      name: 'グリッチアート',
      description: 'RGB分離 + グリッチ + 走査線',
      stack: [
        { key: 'rgbSplit', params: { offsetX: 8, offsetY: 0 } },
        { key: 'glitch', params: { amount: 0.6 } },
        { key: 'scanlines', params: { spacing: 3, strength: 0.24 } },
        { key: 'noise', params: { amount: 0.08, mono: false } }
      ]
    },
    {
      name: 'ピクセルタイル',
      description: 'ピクセル化 + モザイク + 輪郭',
      stack: [
        { key: 'pixelate', params: { size: 10 } },
        { key: 'mosaic', params: { size: 16, grout: 0.12 } },
        { key: 'edgeDetect', params: { amount: 0.8 } }
      ]
    }
  ];

  function makeFilterInstance(key, customParams = {}) {
    const def = FILTER_MAP.get(key);
    if (!def) throw new Error(`Unknown filter key: ${key}`);
    const params = {};
    def.params.forEach((param) => {
      params[param.key] = customParams[param.key] !== undefined ? customParams[param.key] : param.default;
    });
    return {
      id: uid(),
      key,
      enabled: true,
      params
    };
  }

  function populateFilterSelect() {
    const grouped = FILTER_DEFS.reduce((acc, filter) => {
      if (!acc[filter.category]) acc[filter.category] = [];
      acc[filter.category].push(filter);
      return acc;
    }, {});

    els.filterSelect.innerHTML = '';
    Object.entries(grouped).forEach(([category, filters]) => {
      const group = document.createElement('optgroup');
      group.label = category;
      filters.forEach((filter) => {
        const option = document.createElement('option');
        option.value = filter.key;
        option.textContent = filter.name;
        group.appendChild(option);
      });
      els.filterSelect.appendChild(group);
    });
  }

  function renderPresetButtons() {
    els.presetList.innerHTML = '';
    PRESETS.forEach((preset) => {
      const button = document.createElement('button');
      button.className = 'secondary wide';
      button.innerHTML = `<span>${preset.name}</span><span class="muted">${preset.description}</span>`;
      button.addEventListener('click', () => {
        state.stack = preset.stack.map((item) => makeFilterInstance(item.key, item.params));
        renderStack();
        scheduleRender();
        setStatus(`プリセット「${preset.name}」を適用しました。`);
      });
      els.presetList.appendChild(button);
    });
  }

  function addFilter(key) {
    state.stack.push(makeFilterInstance(key));
    renderStack();
    scheduleRender();
    const def = FILTER_MAP.get(key);
    setStatus(`フィルター「${def.name}」を追加しました。`);
  }

  function moveFilter(id, direction) {
    const index = state.stack.findIndex((item) => item.id === id);
    if (index < 0) return;
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= state.stack.length) return;
    const temp = state.stack[index];
    state.stack[index] = state.stack[swapIndex];
    state.stack[swapIndex] = temp;
    renderStack();
    scheduleRender();
  }

  function removeFilter(id) {
    state.stack = state.stack.filter((item) => item.id !== id);
    renderStack();
    scheduleRender();
  }

  function updateFilterParam(id, key, value) {
    const item = state.stack.find((entry) => entry.id === id);
    if (!item) return;
    item.params[key] = value;
    scheduleRender();
  }

  function toggleFilter(id, enabled) {
    const item = state.stack.find((entry) => entry.id === id);
    if (!item) return;
    item.enabled = enabled;
    renderStack();
    scheduleRender();
  }

  function createParamControl(item, def, param) {
    const row = document.createElement('div');
    row.className = 'param-row';

    const head = document.createElement('div');
    head.className = 'param-head';
    head.innerHTML = `<span>${param.label}</span><span class="param-value">${formatNumber(item.params[param.key])}</span>`;
    row.appendChild(head);

    if (param.type === 'range') {
      const wrap = document.createElement('div');
      wrap.className = 'range-pair';
      const range = document.createElement('input');
      range.type = 'range';
      range.min = param.min;
      range.max = param.max;
      range.step = param.step;
      range.value = item.params[param.key];

      const number = document.createElement('input');
      number.type = 'number';
      number.min = param.min;
      number.max = param.max;
      number.step = param.step;
      number.value = item.params[param.key];

      const syncValue = (raw) => {
        const numeric = parseFloat(raw);
        const safe = Number.isNaN(numeric) ? param.default : clamp(numeric, Number(param.min), Number(param.max));
        range.value = safe;
        number.value = safe;
        head.querySelector('.param-value').textContent = formatNumber(safe);
        updateFilterParam(item.id, param.key, safe);
      };

      range.addEventListener('input', (event) => syncValue(event.target.value));
      number.addEventListener('input', (event) => syncValue(event.target.value));
      wrap.append(range, number);
      row.appendChild(wrap);
      return row;
    }

    if (param.type === 'checkbox') {
      const label = document.createElement('label');
      label.className = 'checkbox-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(item.params[param.key]);
      checkbox.addEventListener('change', (event) => {
        head.querySelector('.param-value').textContent = event.target.checked ? 'ON' : 'OFF';
        updateFilterParam(item.id, param.key, event.target.checked);
      });
      head.querySelector('.param-value').textContent = checkbox.checked ? 'ON' : 'OFF';
      label.append(checkbox, document.createTextNode('有効'));
      row.appendChild(label);
      return row;
    }

    if (param.type === 'color') {
      const color = document.createElement('input');
      color.type = 'color';
      color.value = item.params[param.key];
      head.querySelector('.param-value').textContent = item.params[param.key];
      color.addEventListener('input', (event) => {
        head.querySelector('.param-value').textContent = event.target.value;
        updateFilterParam(item.id, param.key, event.target.value);
      });
      row.appendChild(color);
      return row;
    }

    if (param.type === 'select') {
      const select = document.createElement('select');
      param.options.forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = item.params[param.key] === value;
        select.appendChild(option);
      });
      head.querySelector('.param-value').textContent = param.options.find((opt) => opt[0] === item.params[param.key])?.[1] || item.params[param.key];
      select.addEventListener('change', (event) => {
        const label = param.options.find((opt) => opt[0] === event.target.value)?.[1] || event.target.value;
        head.querySelector('.param-value').textContent = label;
        updateFilterParam(item.id, param.key, event.target.value);
      });
      row.appendChild(select);
      return row;
    }

    return row;
  }

  function renderStack() {
    els.stackList.innerHTML = '';
    updateFilterCountBadge();

    if (!state.stack.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-stack';
      empty.textContent = 'まだフィルターがありません。左側から追加してください。';
      els.stackList.appendChild(empty);
      return;
    }

    state.stack.forEach((item, index) => {
      const def = FILTER_MAP.get(item.key);
      const card = document.createElement('div');
      card.className = `stack-item ${item.enabled ? '' : 'disabled'}`.trim();

      const header = document.createElement('div');
      header.className = 'stack-item-header';
      const title = document.createElement('div');
      title.className = 'stack-item-title';
      const checkboxLabel = document.createElement('label');
      checkboxLabel.className = 'checkbox-row';
      const enabledInput = document.createElement('input');
      enabledInput.type = 'checkbox';
      enabledInput.checked = item.enabled;
      enabledInput.addEventListener('change', (event) => toggleFilter(item.id, event.target.checked));
      checkboxLabel.append(enabledInput, document.createTextNode(def.name));
      const meta = document.createElement('span');
      meta.className = 'stack-item-meta';
      meta.textContent = `${def.category} / ${index + 1}`;
      title.append(checkboxLabel, meta);

      const actions = document.createElement('div');
      actions.className = 'stack-actions';
      const upBtn = document.createElement('button');
      upBtn.className = 'secondary small';
      upBtn.textContent = '↑';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', () => moveFilter(item.id, -1));
      const downBtn = document.createElement('button');
      downBtn.className = 'secondary small';
      downBtn.textContent = '↓';
      downBtn.disabled = index === state.stack.length - 1;
      downBtn.addEventListener('click', () => moveFilter(item.id, 1));
      const removeBtn = document.createElement('button');
      removeBtn.className = 'secondary danger small';
      removeBtn.textContent = '削除';
      removeBtn.addEventListener('click', () => removeFilter(item.id));
      actions.append(upBtn, downBtn, removeBtn);

      header.append(title, actions);
      card.appendChild(header);

      const paramGrid = document.createElement('div');
      paramGrid.className = 'param-grid';
      def.params.forEach((param) => {
        paramGrid.appendChild(createParamControl(item, def, param));
      });
      card.appendChild(paramGrid);
      els.stackList.appendChild(card);
    });
  }

  function updatePreviewCanvasSize(width, height) {
    els.previewCanvas.width = width;
    els.previewCanvas.height = height;
  }

  function putImageDataToCanvas(imageData, canvas, ctx) {
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    ctx.putImageData(imageData, 0, 0);
  }

  function rebuildPreviewFromSource() {
    if (!state.fullOriginal) return;
    const maxEdge = 1400 * state.previewQuality;
    const scale = Math.min(1, maxEdge / Math.max(state.sourceCanvas.width, state.sourceCanvas.height));
    const width = Math.max(1, Math.round(state.sourceCanvas.width * scale));
    const height = Math.max(1, Math.round(state.sourceCanvas.height * scale));
    state.previewOriginalCanvas.width = width;
    state.previewOriginalCanvas.height = height;
    state.previewOriginalCtx.clearRect(0, 0, width, height);
    state.previewOriginalCtx.drawImage(state.sourceCanvas, 0, 0, width, height);
    state.previewOriginal = state.previewOriginalCtx.getImageData(0, 0, width, height);
    updateImageInfo();
  }

  function drawVisiblePreview() {
    if (!state.previewProcessed) return;
    const width = state.previewProcessed.width;
    const height = state.previewProcessed.height;
    updatePreviewCanvasSize(width, height);
    previewCtx.clearRect(0, 0, width, height);

    if (state.compareEnabled && state.previewOriginal) {
      putImageDataToCanvas(state.previewOriginal, state.previewOriginalCanvas, state.previewOriginalCtx);
      putImageDataToCanvas(state.previewProcessed, state.previewProcessedCanvas, state.previewProcessedCtx);
      const split = Math.round(width * state.compareSplit);
      previewCtx.drawImage(state.previewOriginalCanvas, 0, 0, split, height, 0, 0, split, height);
      previewCtx.drawImage(state.previewProcessedCanvas, split, 0, width - split, height, split, 0, width - split, height);
      previewCtx.save();
      previewCtx.strokeStyle = 'rgba(255,255,255,0.85)';
      previewCtx.lineWidth = 2;
      previewCtx.beginPath();
      previewCtx.moveTo(split + 0.5, 0);
      previewCtx.lineTo(split + 0.5, height);
      previewCtx.stroke();
      previewCtx.restore();
      return;
    }

    previewCtx.putImageData(state.previewProcessed, 0, 0);
  }

  async function applyStack(imageData, options = {}) {
    let working = cloneImageData(imageData);
    const activeFilters = state.stack.filter((item) => item.enabled);
    let processed = 0;
    for (const item of activeFilters) {
      const def = FILTER_MAP.get(item.key);
      working = def.apply(working, item.params);
      processed += 1;
      if (options.onProgress) options.onProgress(processed, activeFilters.length, def.name);
      if (processed < activeFilters.length) {
        await nextFrame();
      }
    }
    return working;
  }

  function scheduleRender() {
    state.renderToken += 1;
    if (state.rendering) {
      state.renderAgain = true;
      return;
    }
    window.clearTimeout(scheduleRender._timer);
    scheduleRender._timer = window.setTimeout(() => {
      renderPreview().catch((error) => {
        console.error(error);
        setStatus(`エラー: ${error.message}`);
      });
    }, 30);
  }

  async function renderPreview() {
    if (!state.previewOriginal) return;
    state.rendering = true;
    state.renderAgain = false;
    const start = performance.now();
    setStatus('プレビューを処理中...');
    await nextFrame();

    const result = await applyStack(state.previewOriginal, {
      onProgress: (index, total, name) => setStatus(`プレビューを処理中... ${index}/${total} ${name}`)
    });

    state.previewProcessed = result;
    drawVisiblePreview();
    const elapsed = performance.now() - start;
    setStatus(`プレビュー更新完了 (${formatNumber(elapsed, 1)} ms)`);
    state.rendering = false;

    if (state.renderAgain) {
      scheduleRender();
    }
  }

  async function exportImage(type) {
    if (!state.fullOriginal) return;
    setStatus(`高解像度の ${type === 'image/png' ? 'PNG' : 'JPEG'} を書き出し中...`);
    await nextFrame();
    const start = performance.now();
    const result = await applyStack(state.fullOriginal, {
      onProgress: (index, total, name) => setStatus(`書き出し中... ${index}/${total} ${name}`)
    });

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = result.width;
    tempCanvas.height = result.height;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    tempCtx.putImageData(result, 0, 0);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = result.width;
    canvas.height = result.height;

    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.drawImage(tempCanvas, 0, 0);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.95));
    if (!blob) {
      setStatus('書き出しに失敗しました。');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ext = type === 'image/png' ? 'png' : 'jpg';
    a.href = url;
    a.download = `${state.imageName.replace(/\.[^.]+$/, '') || 'filtered'}-${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`書き出し完了 (${formatNumber(performance.now() - start, 1)} ms)`);
  }

  function loadFromCanvas(canvas, name = 'sample') {
    state.imageName = name;
    state.sourceCanvas.width = canvas.width;
    state.sourceCanvas.height = canvas.height;
    state.sourceCtx.clearRect(0, 0, canvas.width, canvas.height);
    state.sourceCtx.drawImage(canvas, 0, 0);
    state.fullOriginal = state.sourceCtx.getImageData(0, 0, canvas.width, canvas.height);
    rebuildPreviewFromSource();
    state.previewProcessed = cloneImageData(state.previewOriginal);
    drawVisiblePreview();
    updateImageInfo();
    scheduleRender();
  }

  async function loadImageFile(file) {
    if (!file) return;
    const imageUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('画像を読み込めませんでした。'));
        img.src = imageUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      loadFromCanvas(canvas, file.name);
      setStatus(`「${file.name}」を読み込みました。`);
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  function generateSampleCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 800;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#091833');
    gradient.addColorStop(0.45, '#2a4f86');
    gradient.addColorStop(1, '#f6b856');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 18; i += 1) {
      const x = 80 + i * 60;
      const y = 100 + Math.sin(i * 0.55) * 40;
      ctx.fillStyle = `hsla(${(i * 25) % 360}, 90%, 65%, 0.14)`;
      ctx.beginPath();
      ctx.arc(x, y, 65 + (i % 4) * 18, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, 540);
    ctx.quadraticCurveTo(220, 450, 410, 520);
    ctx.quadraticCurveTo(640, 590, 860, 500);
    ctx.quadraticCurveTo(1070, 430, 1280, 550);
    ctx.lineTo(1280, 800);
    ctx.lineTo(0, 800);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(9, 24, 51, 0.85)';
    ctx.fillRect(120, 260, 320, 240);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(152, 292, 260, 176);

    ctx.save();
    ctx.translate(850, 310);
    ctx.rotate(-0.2);
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillRect(-140, -88, 280, 176);
    ctx.strokeStyle = 'rgba(9,24,51,0.85)';
    ctx.lineWidth = 6;
    ctx.strokeRect(-140, -88, 280, 176);
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(470, 150);
    ctx.bezierCurveTo(600, 40, 820, 60, 1080, 180);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.font = 'bold 78px system-ui, sans-serif';
    ctx.fillText('Open Filter Studio', 140, 640);
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText('GitHub Pages / No Login / Pure Static App', 146, 690);

    ctx.fillStyle = '#ff5e7d';
    ctx.beginPath();
    ctx.arc(1040, 596, 74, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f1f1f';
    ctx.beginPath();
    ctx.arc(1010, 578, 9, 0, Math.PI * 2);
    ctx.arc(1068, 578, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#1f1f1f';
    ctx.beginPath();
    ctx.arc(1038, 615, 28, 0.1, Math.PI - 0.1);
    ctx.stroke();

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const index = (y * canvas.width + x) * 4;
        const grain = (hash2D(x, y, 57) - 0.5) * 10;
        data[index] = clamp(data[index] + grain);
        data[index + 1] = clamp(data[index + 1] + grain);
        data[index + 2] = clamp(data[index + 2] + grain);
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function handleDropEvents() {
    let dragDepth = 0;
    const showDrop = () => els.dropZone.classList.add('active');
    const hideDrop = () => els.dropZone.classList.remove('active');

    window.addEventListener('dragenter', (event) => {
      event.preventDefault();
      dragDepth += 1;
      showDrop();
    });

    window.addEventListener('dragover', (event) => {
      event.preventDefault();
      showDrop();
    });

    window.addEventListener('dragleave', (event) => {
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideDrop();
    });

    window.addEventListener('drop', (event) => {
      event.preventDefault();
      dragDepth = 0;
      hideDrop();
      const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith('image/'));
      if (file) loadImageFile(file).catch((error) => setStatus(`エラー: ${error.message}`));
    });


    window.addEventListener('paste', (event) => {
      const items = [...(event.clipboardData?.items || [])];
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (imageItem) {
        const file = imageItem.getAsFile();
        loadImageFile(file).catch((error) => setStatus(`エラー: ${error.message}`));
      }
    });
  }

  function bindEvents() {
    els.loadSampleBtn.addEventListener('click', () => {
      loadFromCanvas(generateSampleCanvas(), 'sample');
      setStatus('サンプル画像を生成しました。');
    });

    els.fileInput.addEventListener('change', (event) => {
      const [file] = event.target.files || [];
      loadImageFile(file).catch((error) => setStatus(`エラー: ${error.message}`));
      event.target.value = '';
    });

    els.addFilterBtn.addEventListener('click', () => addFilter(els.filterSelect.value));

    els.clearStackBtn.addEventListener('click', () => {
      state.stack = [];
      renderStack();
      scheduleRender();
      setStatus('フィルタースタックを空にしました。');
    });

    els.resetStackBtn.addEventListener('click', () => {
      state.stack = [];
      renderStack();
      scheduleRender();
      setStatus('フィルタースタックを空にしました。');
    });

    els.previewQualitySelect.addEventListener('change', (event) => {
      state.previewQuality = parseFloat(event.target.value) || 1;
      if (state.fullOriginal) {
        rebuildPreviewFromSource();
        state.previewProcessed = cloneImageData(state.previewOriginal);
        drawVisiblePreview();
        scheduleRender();
      }
    });

    els.compareToggle.addEventListener('change', (event) => {
      state.compareEnabled = event.target.checked;
      drawVisiblePreview();
    });

    els.compareSlider.addEventListener('input', (event) => {
      state.compareSplit = (parseFloat(event.target.value) || 50) / 100;
      drawVisiblePreview();
    });

    els.exportPngBtn.addEventListener('click', () => exportImage('image/png').catch((error) => setStatus(`エラー: ${error.message}`)));
    els.exportJpegBtn.addEventListener('click', () => exportImage('image/jpeg').catch((error) => setStatus(`エラー: ${error.message}`)));
  }

  function init() {
    populateFilterSelect();
    renderPresetButtons();
    renderStack();
    bindEvents();
    handleDropEvents();
    loadFromCanvas(generateSampleCanvas(), 'sample');
    setStatus('サンプル画像を読み込みました。画像を差し替えて使えます。');
  }

  init();
})();
