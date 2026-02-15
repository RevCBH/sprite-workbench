function seekTo(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Failed while seeking video'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.0001)));
  });
}

function loadVideoMetadata(video, url) {
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Failed to load video'));
    };

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.src = url;
    video.load();
  });
}

class FrameProcessor {
  constructor(width, height) {
    this.worker = new Worker(new URL('./workers/frame-extract.worker.ts', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.nextId = 1;

    this.worker.onmessage = (event) => {
      const msg = event.data;
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);

      if (msg.type === 'frame-error') {
        pending.reject(new Error(msg.error || 'Worker frame processing failed'));
      } else {
        pending.resolve(msg);
      }
    };

    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Worker crashed during extraction');
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
    };

    this.worker.postMessage({ type: 'init', width, height });
  }

  process(bitmap, index) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'process-frame', id, index, bitmap }, [bitmap]);
    });
  }

  terminate() {
    this.worker.terminate();
    this.pending.clear();
  }
}

async function extractFramesFallback(file, video, sampleFps, onProgress) {
  const url = URL.createObjectURL(file);
  try {
    await loadVideoMetadata(video, url);

    const width = video.videoWidth;
    const height = video.videoHeight;
    const duration = video.duration;

    const times = [];
    for (let t = 0; t < duration; t += 1 / sampleFps) times.push(t);

    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

    const frames = [];
    const hashes = [];

    for (let i = 0; i < times.length; i++) {
      await seekTo(video, times[i]);
      offCtx.drawImage(video, 0, 0, width, height);

      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = width;
      frameCanvas.height = height;
      frameCanvas.getContext('2d').drawImage(offscreen, 0, 0);
      frames.push(frameCanvas);

      const imageData = offCtx.getImageData(0, 0, width, height).data;
      // Fallback hash (simple checksum-like downsample) for loop detection.
      let hashAcc = 0;
      for (let p = 0; p < imageData.length; p += 16) {
        hashAcc = (hashAcc * 33 + imageData[p]) >>> 0;
      }
      hashes.push(hashAcc.toString(16).padStart(16, '0').slice(0, 16));

      onProgress({ current: i + 1, total: times.length, phase: 'extract' });
      if (i % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }

    return { frames, hashes, width, height, duration, estimatedFps: sampleFps, extractionMode: 'main-thread-fallback' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function extractFramesInWorker({ file, video, sampleFps = 30, onProgress = () => {} }) {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return extractFramesFallback(file, video, sampleFps, onProgress);
  }

  const url = URL.createObjectURL(file);
  let processor = null;

  try {
    await loadVideoMetadata(video, url);

    const width = video.videoWidth;
    const height = video.videoHeight;
    const duration = video.duration;

    const times = [];
    for (let t = 0; t < duration; t += 1 / sampleFps) times.push(t);

    processor = new FrameProcessor(width, height);

    const frames = [];
    const hashes = [];

    for (let i = 0; i < times.length; i++) {
      await seekTo(video, times[i]);
      const bitmap = await createImageBitmap(video);
      const processed = await processor.process(bitmap, i);

      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = width;
      frameCanvas.height = height;

      const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true });
      const data = new Uint8ClampedArray(processed.buffer);
      const imageData = new ImageData(data, width, height);
      frameCtx.putImageData(imageData, 0, 0);

      frames.push(frameCanvas);
      hashes.push(processed.hash);

      onProgress({ current: i + 1, total: times.length, phase: 'extract-worker' });
      if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
    }

    return { frames, hashes, width, height, duration, estimatedFps: sampleFps, extractionMode: 'worker' };
  } catch (error) {
    if (processor) processor.terminate();
    // Graceful fallback when worker path fails or browser blocks worker usage.
    return extractFramesFallback(file, video, sampleFps, onProgress);
  } finally {
    if (processor) processor.terminate();
    URL.revokeObjectURL(url);
  }
}
