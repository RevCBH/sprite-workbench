export async function encodeGifFromState({
  state,
  activeIndices,
  applyChromaKey,
  maxSize,
  ditherMode,
  onProgress = () => {},
}) {
  const scale = state.exportScale;

  let outWidth = state.width * scale;
  let outHeight = state.height * scale;

  if (outWidth > maxSize || outHeight > maxSize) {
    const ratio = Math.min(maxSize / outWidth, maxSize / outHeight);
    outWidth = Math.max(1, Math.round(outWidth * ratio));
    outHeight = Math.max(1, Math.round(outHeight * ratio));
  }

  const delay = Math.max(1, Math.round((1000 / Math.max(1, state.fps)) / 10));

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = outWidth;
  tempCanvas.height = outHeight;
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

  const framesData = [];
  for (let i = 0; i < activeIndices.length; i++) {
    tempCtx.clearRect(0, 0, outWidth, outHeight);

    if (state.bgMode !== 'transparent') {
      const color = state.bgMode === 'custom' ? state.bgColor : state.bgMode;
      tempCtx.fillStyle = color;
      tempCtx.fillRect(0, 0, outWidth, outHeight);
    } else if (!state.keyEnabled) {
      tempCtx.fillStyle = '#ffffff';
      tempCtx.fillRect(0, 0, outWidth, outHeight);
    }

    tempCtx.imageSmoothingEnabled = false;
    tempCtx.drawImage(applyChromaKey(state.frameCanvases[activeIndices[i]]), 0, 0, outWidth, outHeight);

    framesData.push(tempCtx.getImageData(0, 0, outWidth, outHeight));

    onProgress({
      stage: 'rasterize',
      progress: ((i + 1) / activeIndices.length) * 0.3,
      message: `Rasterizing ${i + 1}/${activeIndices.length}`,
    });

    if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
  }

  const gif = new GifEncoder(outWidth, outHeight);

  for (let i = 0; i < framesData.length; i++) {
    const pixels = framesData[i].data;
    let hasTransparency = false;

    if (state.keyEnabled) {
      for (let p = 3; p < pixels.length; p += 4) {
        if (pixels[p] < 128) {
          hasTransparency = true;
          break;
        }
      }
    }

    const { palette, indexed } = quantize(pixels, outWidth, outHeight, ditherMode, hasTransparency);
    gif.addFrame(indexed, palette, delay, hasTransparency ? 0 : -1);

    onProgress({
      stage: 'encode',
      progress: 0.3 + ((i + 1) / framesData.length) * 0.65,
      message: `Encoding ${i + 1}/${framesData.length}`,
    });

    if (i % 2 === 0) await new Promise(r => setTimeout(r, 0));
  }

  onProgress({ stage: 'finalize', progress: 1, message: 'Finalizing GIF' });
  const blob = gif.finish();
  return { blob, width: outWidth, height: outHeight, frameCount: activeIndices.length };
}

function quantize(rgba, width, height, ditherMode, hasTransparency = false) {
  const pixelCount = width * height;
  const colorMap = new Map();

  for (let i = 0; i < pixelCount; i++) {
    const off = i * 4;
    if (hasTransparency && rgba[off + 3] < 128) continue;

    const r = rgba[off] >> 3;
    const g = rgba[off + 1] >> 3;
    const b = rgba[off + 2] >> 3;
    const key = (r << 10) | (g << 5) | b;

    colorMap.set(key, (colorMap.get(key) || 0) + 1);
  }

  const colors = [];
  for (const [key, count] of colorMap) {
    colors.push({
      r: ((key >> 10) & 31) << 3,
      g: ((key >> 5) & 31) << 3,
      b: (key & 31) << 3,
      count,
    });
  }

  const maxPalette = hasTransparency ? 255 : 256;
  const palette = medianCut(colors, maxPalette);
  if (hasTransparency) palette.unshift([0, 0, 0]);

  const cache = new Map();
  const paletteStart = hasTransparency ? 1 : 0;

  function nearest(r, g, b) {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    if (cache.has(key)) return cache.get(key);

    let best = paletteStart;
    let bestDist = Infinity;
    for (let i = paletteStart; i < palette.length; i++) {
      const dr = r - palette[i][0];
      const dg = g - palette[i][1];
      const db = b - palette[i][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }

    cache.set(key, best);
    return best;
  }

  const indexed = new Uint8Array(pixelCount);

  if (ditherMode === 'floyd') {
    const errR = new Float32Array(pixelCount);
    const errG = new Float32Array(pixelCount);
    const errB = new Float32Array(pixelCount);

    for (let i = 0; i < pixelCount; i++) {
      errR[i] = rgba[i * 4];
      errG[i] = rgba[i * 4 + 1];
      errB[i] = rgba[i * 4 + 2];
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (hasTransparency && rgba[i * 4 + 3] < 128) {
          indexed[i] = 0;
          continue;
        }

        const cr = Math.max(0, Math.min(255, Math.round(errR[i])));
        const cg = Math.max(0, Math.min(255, Math.round(errG[i])));
        const cb = Math.max(0, Math.min(255, Math.round(errB[i])));

        const idx = nearest(cr, cg, cb);
        indexed[i] = idx;

        const dr = cr - palette[idx][0];
        const dg = cg - palette[idx][1];
        const db = cb - palette[idx][2];

        if (x + 1 < width) {
          errR[i + 1] += (dr * 7) / 16;
          errG[i + 1] += (dg * 7) / 16;
          errB[i + 1] += (db * 7) / 16;
        }
        if (y + 1 < height) {
          if (x > 0) {
            errR[i + width - 1] += (dr * 3) / 16;
            errG[i + width - 1] += (dg * 3) / 16;
            errB[i + width - 1] += (db * 3) / 16;
          }
          errR[i + width] += (dr * 5) / 16;
          errG[i + width] += (dg * 5) / 16;
          errB[i + width] += (db * 5) / 16;

          if (x + 1 < width) {
            errR[i + width + 1] += (dr * 1) / 16;
            errG[i + width + 1] += (dg * 1) / 16;
            errB[i + width + 1] += (db * 1) / 16;
          }
        }
      }
    }
  } else if (ditherMode === 'ordered') {
    const bayer = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (hasTransparency && rgba[i * 4 + 3] < 128) {
          indexed[i] = 0;
          continue;
        }

        const off = i * 4;
        const t = ((bayer[y % 4][x % 4] / 16) - 0.5) * 32;
        const r = Math.max(0, Math.min(255, rgba[off] + t));
        const g = Math.max(0, Math.min(255, rgba[off + 1] + t));
        const b = Math.max(0, Math.min(255, rgba[off + 2] + t));
        indexed[i] = nearest(r, g, b);
      }
    }
  } else {
    for (let i = 0; i < pixelCount; i++) {
      if (hasTransparency && rgba[i * 4 + 3] < 128) {
        indexed[i] = 0;
        continue;
      }
      indexed[i] = nearest(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    }
  }

  while (palette.length < 256) palette.push([0, 0, 0]);
  return { palette, indexed };
}

function medianCut(colors, maxColors) {
  if (colors.length === 0) return [[0, 0, 0]];

  let buckets = [colors];

  while (buckets.length < maxColors) {
    let bestIdx = 0;
    let bestRange = -1;

    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      if (bucket.length < 2) continue;

      let rMin = 255;
      let rMax = 0;
      let gMin = 255;
      let gMax = 0;
      let bMin = 255;
      let bMax = 0;

      for (const c of bucket) {
        rMin = Math.min(rMin, c.r);
        rMax = Math.max(rMax, c.r);
        gMin = Math.min(gMin, c.g);
        gMax = Math.max(gMax, c.g);
        bMin = Math.min(bMin, c.b);
        bMax = Math.max(bMax, c.b);
      }

      const range = Math.max(rMax - rMin, gMax - gMin, bMax - bMin);
      if (range > bestRange) {
        bestRange = range;
        bestIdx = i;
      }
    }

    if (bestRange <= 0) break;

    const bucket = buckets[bestIdx];
    let rMin = 255;
    let rMax = 0;
    let gMin = 255;
    let gMax = 0;
    let bMin = 255;
    let bMax = 0;

    for (const c of bucket) {
      rMin = Math.min(rMin, c.r);
      rMax = Math.max(rMax, c.r);
      gMin = Math.min(gMin, c.g);
      gMax = Math.max(gMax, c.g);
      bMin = Math.min(bMin, c.b);
      bMax = Math.max(bMax, c.b);
    }

    const rRange = rMax - rMin;
    const gRange = gMax - gMin;
    const bRange = bMax - bMin;
    const channel = rRange >= gRange && rRange >= bRange ? 'r' : (gRange >= bRange ? 'g' : 'b');

    bucket.sort((a, b) => a[channel] - b[channel]);
    const mid = Math.floor(bucket.length / 2);
    buckets.splice(bestIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
  }

  return buckets.map(bucket => {
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let total = 0;

    for (const c of bucket) {
      rSum += c.r * c.count;
      gSum += c.g * c.count;
      bSum += c.b * c.count;
      total += c.count;
    }

    if (total === 0) return [0, 0, 0];
    return [Math.round(rSum / total), Math.round(gSum / total), Math.round(bSum / total)];
  });
}

class GifEncoder {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.frames = [];
    this.out = [];
  }

  addFrame(indexed, palette, delay, transparentIndex = -1) {
    this.frames.push({ indexed, palette, delay, transparentIndex });
  }

  finish() {
    const out = this.out;
    const width = this.width;
    const height = this.height;

    const globalPalette = this.frames[0].palette;

    this._writeStr('GIF89a');
    this._writeU16(width);
    this._writeU16(height);
    out.push(0xF7);
    out.push(0);
    out.push(0);

    for (let i = 0; i < 256; i++) {
      out.push(globalPalette[i][0], globalPalette[i][1], globalPalette[i][2]);
    }

    out.push(0x21, 0xFF, 0x0B);
    this._writeStr('NETSCAPE2.0');
    out.push(0x03, 0x01);
    this._writeU16(0);
    out.push(0x00);

    for (const frame of this.frames) {
      out.push(0x21, 0xF9, 0x04);
      const hasTransp = frame.transparentIndex >= 0;
      out.push(hasTransp ? 0x01 : 0x00);
      this._writeU16(frame.delay);
      out.push(hasTransp ? frame.transparentIndex : 0x00);
      out.push(0x00);

      out.push(0x2C);
      this._writeU16(0);
      this._writeU16(0);
      this._writeU16(width);
      this._writeU16(height);

      let useLocal = false;
      if (frame.palette !== globalPalette) {
        for (let i = 0; i < 256; i++) {
          if (
            frame.palette[i][0] !== globalPalette[i][0] ||
            frame.palette[i][1] !== globalPalette[i][1] ||
            frame.palette[i][2] !== globalPalette[i][2]
          ) {
            useLocal = true;
            break;
          }
        }
      }

      if (useLocal) {
        out.push(0x87);
        for (let i = 0; i < 256; i++) {
          out.push(frame.palette[i][0], frame.palette[i][1], frame.palette[i][2]);
        }
      } else {
        out.push(0x00);
      }

      this._writeLZW(frame.indexed, 8);
    }

    out.push(0x3B);
    return new Blob([new Uint8Array(out)], { type: 'image/gif' });
  }

  _writeStr(s) {
    for (let i = 0; i < s.length; i++) this.out.push(s.charCodeAt(i));
  }

  _writeU16(v) {
    this.out.push(v & 0xFF, (v >> 8) & 0xFF);
  }

  _writeLZW(indexed, minCodeSize) {
    const out = this.out;
    out.push(minCodeSize);

    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;

    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;
    const maxTableSize = 4096;

    const subBlocks = [];
    let curByte = 0;
    let curBits = 0;

    function emitCode(code) {
      curByte |= code << curBits;
      curBits += codeSize;
      while (curBits >= 8) {
        subBlocks.push(curByte & 0xFF);
        curByte >>= 8;
        curBits -= 8;
      }
    }

    const table = new Map();

    function resetTable() {
      table.clear();
      for (let i = 0; i < clearCode; i++) table.set(String(i), i);
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
    }

    resetTable();
    emitCode(clearCode);

    let prefix = String(indexed[0]);

    for (let i = 1; i < indexed.length; i++) {
      const c = String(indexed[i]);
      const combined = prefix + ',' + c;

      if (table.has(combined)) {
        prefix = combined;
      } else {
        emitCode(table.get(prefix));
        if (nextCode < maxTableSize) {
          table.set(combined, nextCode++);
          if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
        } else {
          emitCode(clearCode);
          resetTable();
        }
        prefix = c;
      }
    }

    emitCode(table.get(prefix));
    emitCode(eoiCode);

    if (curBits > 0) subBlocks.push(curByte & 0xFF);

    let pos = 0;
    while (pos < subBlocks.length) {
      const chunkSize = Math.min(255, subBlocks.length - pos);
      out.push(chunkSize);
      for (let j = 0; j < chunkSize; j++) out.push(subBlocks[pos++]);
    }

    out.push(0x00);
  }
}
