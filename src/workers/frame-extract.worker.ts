let width = 0;
let height = 0;
let canvas = null;
let ctx = null;

function ensureCanvas(w, h) {
  if (!canvas || width !== w || height !== h) {
    width = w;
    height = h;
    canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
}

function computeAverageHash(data, w, h) {
  // 8x8 average hash packed as 16-char hex string.
  const grid = 8;
  const values = new Array(grid * grid);
  let sum = 0;

  for (let gy = 0; gy < grid; gy++) {
    const y = Math.min(h - 1, Math.floor(((gy + 0.5) / grid) * h));
    for (let gx = 0; gx < grid; gx++) {
      const x = Math.min(w - 1, Math.floor(((gx + 0.5) / grid) * w));
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = (r * 0.299) + (g * 0.587) + (b * 0.114);
      const idx = gy * grid + gx;
      values[idx] = gray;
      sum += gray;
    }
  }

  const avg = sum / values.length;
  const bits = values.map(v => (v >= avg ? 1 : 0));

  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }

  return hex;
}

self.onmessage = (event) => {
  const msg = event.data;

  if (msg.type === 'init') {
    ensureCanvas(msg.width, msg.height);
    return;
  }

  if (msg.type !== 'process-frame') {
    return;
  }

  const { id, index, bitmap } = msg;
  try {
    ensureCanvas(bitmap.width, bitmap.height);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (typeof bitmap.close === 'function') bitmap.close();

    const imageData = ctx.getImageData(0, 0, width, height);
    const hash = computeAverageHash(imageData.data, width, height);

    self.postMessage(
      {
        type: 'frame-processed',
        id,
        index,
        width,
        height,
        hash,
        buffer: imageData.data.buffer,
      },
      [imageData.data.buffer],
    );
  } catch (error) {
    self.postMessage({
      type: 'frame-error',
      id,
      index,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
