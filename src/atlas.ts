function paddedName(index, width = 4) {
  return `frame_${String(index).padStart(width, '0')}`;
}

function makeFrameEntries({
  activeIndices,
  cols,
  frameWidth,
  frameHeight,
  fps,
  scale,
  sourceWidth,
  sourceHeight,
  trimRect,
}) {
  const ms = Math.max(1, Math.round(1000 / Math.max(1, fps)));
  const trimScaled = trimRect
    ? {
      x: trimRect.x * scale,
      y: trimRect.y * scale,
      w: trimRect.w * scale,
      h: trimRect.h * scale,
    }
    : null;
  const sourceSize = {
    w: sourceWidth * scale,
    h: sourceHeight * scale,
  };
  const isTrimmed = Boolean(
    trimRect && (
      trimRect.x !== 0
      || trimRect.y !== 0
      || trimRect.w !== sourceWidth
      || trimRect.h !== sourceHeight
    ),
  );

  return activeIndices.map((sourceIndex, i) => {
    const x = (i % cols) * frameWidth;
    const y = Math.floor(i / cols) * frameHeight;
    const filename = paddedName(i);
    return {
      i,
      sourceIndex,
      filename,
      frame: { x, y, w: frameWidth, h: frameHeight },
      rotated: false,
      trimmed: isTrimmed,
      spriteSourceSize: trimScaled
        ? { x: trimScaled.x, y: trimScaled.y, w: trimScaled.w, h: trimScaled.h }
        : { x: 0, y: 0, w: frameWidth, h: frameHeight },
      sourceSize,
      duration: ms,
    };
  });
}

function buildTexturePackerHash(entries, meta) {
  const frames = {};
  for (const entry of entries) {
    frames[entry.filename] = {
      frame: entry.frame,
      rotated: entry.rotated,
      trimmed: entry.trimmed,
      spriteSourceSize: entry.spriteSourceSize,
      sourceSize: entry.sourceSize,
      duration: entry.duration,
      sourceFrame: entry.sourceIndex,
    };
  }
  return { frames, meta };
}

function buildTexturePackerArray(entries, meta) {
  return {
    frames: entries.map(entry => ({
      filename: entry.filename,
      frame: entry.frame,
      rotated: entry.rotated,
      trimmed: entry.trimmed,
      spriteSourceSize: entry.spriteSourceSize,
      sourceSize: entry.sourceSize,
      duration: entry.duration,
      sourceFrame: entry.sourceIndex,
    })),
    meta,
  };
}

function buildGodotLike(entries, meta, fps) {
  return {
    type: 'godot_spriteframes_v1',
    meta,
    animation: {
      name: 'default',
      speed_fps: fps,
      loop: true,
      frames: entries.map(entry => ({
        name: entry.filename,
        sourceFrame: entry.sourceIndex,
        region: [entry.frame.x, entry.frame.y, entry.frame.w, entry.frame.h],
        duration_sec: Number((1 / Math.max(1, fps)).toFixed(4)),
      })),
    },
  };
}

function buildUnity(entries, meta) {
  return {
    type: 'unity_sprite_meta_v1',
    meta,
    sprites: entries.map(entry => ({
      name: entry.filename,
      sourceFrame: entry.sourceIndex,
      rect: {
        x: entry.frame.x,
        y: entry.frame.y,
        width: entry.frame.w,
        height: entry.frame.h,
      },
      pivot: { x: 0.5, y: 0.5 },
      border: { left: 0, right: 0, top: 0, bottom: 0 },
    })),
  };
}

export function buildAtlasJson({
  format,
  imageFile,
  activeIndices,
  cols,
  rows,
  frameWidth,
  frameHeight,
  fps,
  scale,
  sourceWidth,
  sourceHeight,
  trimRect = null,
}) {
  const entries = makeFrameEntries({
    activeIndices,
    cols,
    frameWidth,
    frameHeight,
    fps,
    scale,
    sourceWidth,
    sourceHeight,
    trimRect,
  });

  const meta = {
    app: 'Sprite Workbench',
    version: 1,
    image: imageFile,
    size: { w: cols * frameWidth, h: rows * frameHeight },
    frameSize: { w: frameWidth, h: frameHeight },
    sourceFrameSize: { w: sourceWidth, h: sourceHeight },
    scale,
    frameCount: entries.length,
    fps,
    format,
    trimRect,
  };

  switch (format) {
    case 'texturepacker_array':
      return buildTexturePackerArray(entries, meta);
    case 'godot':
      return buildGodotLike(entries, meta, fps);
    case 'unity':
      return buildUnity(entries, meta);
    case 'texturepacker_hash':
    default:
      return buildTexturePackerHash(entries, meta);
  }
}
