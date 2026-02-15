function sanitizeString(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatNumber(n) {
  if (Number.isInteger(n)) return `${n}`;
  return Number(n.toFixed(4)).toString();
}

export function buildGodotSpriteFramesTres({
  atlasResourcePath,
  frameRects,
  fps,
  animationName = 'default',
  loop = true,
}) {
  const extId = '1';
  const safeAtlasPath = sanitizeString(atlasResourcePath);
  const safeAnimName = sanitizeString(animationName);
  const speed = Math.max(1, fps);

  const lines = [];
  lines.push(`[gd_resource type="SpriteFrames" load_steps=${frameRects.length + 1} format=3]`);
  lines.push('');
  lines.push(`[ext_resource type="Texture2D" path="${safeAtlasPath}" id="${extId}"]`);
  lines.push('');

  for (let i = 0; i < frameRects.length; i++) {
    const rect = frameRects[i];
    const subId = `AtlasTexture_${String(i).padStart(4, '0')}`;
    lines.push(`[sub_resource type="AtlasTexture" id="${subId}"]`);
    lines.push(`atlas = ExtResource("${extId}")`);
    lines.push(
      `region = Rect2(${formatNumber(rect.x)}, ${formatNumber(rect.y)}, ${formatNumber(rect.w)}, ${formatNumber(rect.h)})`,
    );
    lines.push('');
  }

  lines.push('[resource]');
  lines.push('animations = [{');
  lines.push('"frames": [');

  for (let i = 0; i < frameRects.length; i++) {
    const subId = `AtlasTexture_${String(i).padStart(4, '0')}`;
    const comma = i < frameRects.length - 1 ? ',' : '';
    lines.push(`{"duration": 1.0, "texture": SubResource("${subId}")}${comma}`);
  }

  lines.push('],');
  lines.push(`"loop": ${loop ? 'true' : 'false'},`);
  lines.push(`"name": &"${safeAnimName}",`);
  lines.push(`"speed": ${formatNumber(speed)}`);
  lines.push('}]');

  return `${lines.join('\n')}\n`;
}
