import { createInitialState } from './state';
import { extractFramesInWorker } from './frame-extractor';
import { detectLoopRange, formatLoopDetection } from './loop-detection';
import { buildAtlasJson } from './atlas';
import { buildGodotSpriteFramesTres } from './godot-tres';
import { encodeGifFromState } from './gif';
import { buildZip } from './zip';

const SETTINGS_KEY = 'sprite-workbench-settings-v4';
const WORKFLOW_TIER = 'tier1';
const WORKFLOW_DISABLED_MESSAGE = 'Workflow adapters are not available in M1.';

function workflowDisabled(): never {
  throw new Error(WORKFLOW_DISABLED_MESSAGE);
}

async function fetchArtifactText() {
  workflowDisabled();
}

async function fetchSourceClip() {
  workflowDisabled();
}

async function getSequenceList() {
  workflowDisabled();
}

async function getSequenceNext() {
  workflowDisabled();
}

async function preflightSequence() {
  workflowDisabled();
}

async function saveSequence() {
  workflowDisabled();
}

async function validateWorkflow() {
  workflowDisabled();
}

export function initWorkbench() {
  const state: any = createInitialState();
  state.currentSequence = null;

  const $ = (id: string): any => document.getElementById(id);
  const videoInput = $('videoInput') as HTMLInputElement;
  const uploadZone = $('uploadZone');
  const previewPanel = $('previewPanel');
  const canvasWrap = $('canvasWrap');
  const previewCanvas = $('previewCanvas') as HTMLCanvasElement;
  const ctx = previewCanvas.getContext('2d', { willReadFrequently: true })!;
  const sourceVideo = $('sourceVideo') as HTMLVideoElement;
  const processingOverlay = $('processingOverlay');
  const progressFill = $('progressFill');
  const processingText = $('processingText');
  const timelineScroll = $('timelineScroll');
  const toast = $('toast');
  const validationStatus = $('seqValidationStatus');
  let timelineWheelAccum = 0;
  let sequenceItems: any[] = [];
  let loadedSourceVideoFile: File | null = null;
  let loadedSourceVideoPath = '';
  let playbackPending = false;
  let playbackStartToken = 0;

  type KeyedCacheEntry = { signature: string; canvas: HTMLCanvasElement };
  const keyedRenderCache: {
    signature: string;
    frames: WeakMap<HTMLCanvasElement, KeyedCacheEntry>;
    token: number;
    warming: boolean;
    done: number;
    total: number;
  } = {
    signature: '',
    frames: new WeakMap(),
    token: 0,
    warming: false,
    done: 0,
    total: 0,
  };

  function showToast(msg: string) {
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2800);
  }

  function setProcessing(active: boolean, message = '', progress = 0) {
    processingOverlay.classList.toggle('hidden', !active);
    if (message) processingText.textContent = message;
    progressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }

  function setValidationStatus(message: string, tone: 'dim' | 'ok' | 'bad' = 'dim') {
    if (!validationStatus) return;
    validationStatus.textContent = message;
    validationStatus.dataset.tone = tone;
  }

  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function saveSettings() {
    const settings = {
      fps: state.fps,
      loopMode: state.loopMode,
      sheetCols: state.sheetCols,
      exportScale: state.exportScale,
      trimAlphaBounds: state.trimAlphaBounds,
      trimPadding: state.trimPadding,
      bgMode: state.bgMode,
      bgColor: state.bgColor,
      keyTolerance: state.keyTolerance,
      keySoftness: state.keySoftness,
      keyDespill: state.keyDespill,
      apiBaseUrl: state.apiBaseUrl,
      batchId: state.batchId,
      takeId: state.takeId,
      revision: state.revision,
      sourceClipPath: state.sourceClipPath,
    };

    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage errors.
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;

      if (Number.isFinite(saved.fps)) state.fps = saved.fps;
      if (typeof saved.loopMode === 'string') state.loopMode = saved.loopMode;
      if (Number.isFinite(saved.sheetCols)) state.sheetCols = saved.sheetCols;
      if (Number.isFinite(saved.exportScale)) state.exportScale = saved.exportScale;
      if (typeof saved.trimAlphaBounds === 'boolean') state.trimAlphaBounds = saved.trimAlphaBounds;
      if (Number.isFinite(saved.trimPadding)) state.trimPadding = saved.trimPadding;
      if (typeof saved.bgMode === 'string') state.bgMode = saved.bgMode;
      if (typeof saved.bgColor === 'string') state.bgColor = saved.bgColor;
      if (Number.isFinite(saved.keyTolerance)) state.keyTolerance = saved.keyTolerance;
      if (Number.isFinite(saved.keySoftness)) state.keySoftness = saved.keySoftness;
      if (Number.isFinite(saved.keyDespill)) state.keyDespill = saved.keyDespill;
      if (typeof saved.apiBaseUrl === 'string' && saved.apiBaseUrl.trim()) state.apiBaseUrl = saved.apiBaseUrl.trim();
      if (typeof saved.batchId === 'string') state.batchId = saved.batchId;
      if (typeof saved.takeId === 'string') state.takeId = saved.takeId;
      if (Number.isFinite(saved.revision)) state.revision = Math.max(1, saved.revision | 0);
      if (typeof saved.sourceClipPath === 'string') state.sourceClipPath = saved.sourceClipPath;
    } catch {
      // Ignore invalid settings.
    }
  }

  function applySettingsToControls() {
    $('fpsInput').value = state.fps;
    $('fpsSlider').value = state.fps;
    $('loopMode').value = state.loopMode;

    $('sheetCols').value = state.sheetCols;
    $('exportScale').value = state.exportScale;
    $('trimAlphaBounds').checked = state.trimAlphaBounds;
    $('trimPadding').value = state.trimPadding;

    $('customBgColor').value = state.bgColor;
    $('customBgColor').parentElement.style.background = state.bgColor;

    $('keyTolerance').value = state.keyTolerance;
    $('keyToleranceSlider').value = state.keyTolerance;
    $('keySoftness').value = state.keySoftness;
    $('keySoftnessSlider').value = state.keySoftness;
    $('keyDespill').value = state.keyDespill;
    $('keyDespillSlider').value = state.keyDespill;

    $('apiBaseUrl').value = state.apiBaseUrl;
    $('wfBatchId').value = state.batchId;
    $('wfTakeId').value = state.takeId;
    $('wfRevision').value = state.revision;
    $('wfSourceClipPath').value = state.sourceClipPath;
  }

  function defaultBatchId() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}_${WORKFLOW_TIER}_b01`;
  }

  function normalizeApiBaseUrl(value: string) {
    const input = String(value || '').trim();
    if (!input) return 'http://localhost:8787';
    return input.replace(/\/$/, '');
  }

  function readWorkflowControls() {
    state.apiBaseUrl = normalizeApiBaseUrl($('apiBaseUrl').value);
    state.batchId = $('wfBatchId').value.trim();
    state.takeId = $('wfTakeId').value.trim();
    state.revision = Math.max(1, parseInt($('wfRevision').value, 10) || 1);
    state.sourceClipPath = $('wfSourceClipPath').value.trim();
  }

  function writeWorkflowControls() {
    $('apiBaseUrl').value = state.apiBaseUrl;
    $('wfBatchId').value = state.batchId;
    $('wfTakeId').value = state.takeId;
    $('wfRevision').value = state.revision;
    $('wfSourceClipPath').value = state.sourceClipPath;
  }

  function parseOptionalInteger(value: any) {
    if (value === undefined || value === null || value === '') return null;
    const n = parseInt(String(value), 10);
    return Number.isFinite(n) ? n : null;
  }

  function parseOptionalBoolean(value: any) {
    if (value === undefined || value === null || value === '') return null;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    return null;
  }

  function applySequenceMetadataToControls(sequence: any, options: any = {}) {
    if (!sequence) return;
    const clampToFrames = Boolean(options.clampToFrames);
    const frameCount = state.frameCanvases.length;
    const maxFrame = Math.max(0, frameCount - 1);

    const timing = sequence.timing && typeof sequence.timing === 'object' ? sequence.timing : {};
    const sourceIn = parseOptionalInteger(timing.source_in);
    const sourceOut = parseOptionalInteger(timing.source_out);
    const sourceStride = parseOptionalInteger(timing.source_stride);
    const playbackFps = parseOptionalInteger(timing.playback_fps);
    const cycleLength = parseOptionalInteger(timing.cycle_length);

    if (playbackFps !== null && playbackFps > 0) {
      state.fps = playbackFps;
      $('fpsInput').value = state.fps;
      $('fpsSlider').value = state.fps;
    }

    if (sourceIn !== null && sourceIn >= 0) {
      state.startFrame = clampToFrames ? Math.max(0, Math.min(maxFrame, sourceIn)) : Math.max(0, sourceIn);
      $('startFrame').value = state.startFrame;
    }

    if (sourceOut !== null && sourceOut >= 0) {
      state.endFrame = clampToFrames ? Math.max(state.startFrame, Math.min(maxFrame, sourceOut)) : Math.max(state.startFrame, sourceOut);
      $('endFrame').value = state.endFrame;
    }

    if (sourceStride !== null && sourceStride > 0) {
      state.skipFrames = Math.max(0, sourceStride - 1);
      $('skipFrames').value = state.skipFrames;
    }

    if (cycleLength !== null && cycleLength > 0) {
      state.cycleLength = cycleLength;
    }
    if (timing.timing_profile !== undefined && timing.timing_profile !== null) {
      state.timingProfile = String(timing.timing_profile || '').trim();
    }

    const metadata = sequence.metadata && typeof sequence.metadata === 'object' ? sequence.metadata : {};
    if (String(metadata.batch_id || '').trim()) state.batchId = String(metadata.batch_id).trim();
    if (String(metadata.take_id || '').trim()) state.takeId = String(metadata.take_id).trim();
    if (String(metadata.source_clip_path || '').trim()) state.sourceClipPath = String(metadata.source_clip_path).trim();
    const revision = parseOptionalInteger(metadata.revision);
    if (revision !== null && revision > 0) state.revision = revision;
    writeWorkflowControls();

    const keying = sequence.keying && typeof sequence.keying === 'object' ? sequence.keying : {};
    let keyingChanged = false;
    const keyEnabled = parseOptionalBoolean(keying.key_enabled);
    if (keyEnabled !== null) {
      state.keyEnabled = keyEnabled;
      keyingChanged = true;
    }
    const keyColor = String(keying.key_color || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(keyColor)) {
      state.keyColor = hexToRgb(keyColor);
      $('keyColor').value = keyColor.toLowerCase();
      $('keyColorPreview').style.background = keyColor.toLowerCase();
      keyingChanged = true;
    }
    const keyTolerance = parseOptionalInteger(keying.key_tolerance);
    if (keyTolerance !== null) {
      state.keyTolerance = Math.max(0, keyTolerance);
      $('keyTolerance').value = state.keyTolerance;
      $('keyToleranceSlider').value = state.keyTolerance;
      keyingChanged = true;
    }
    const keySoftness = parseOptionalInteger(keying.key_softness);
    if (keySoftness !== null) {
      state.keySoftness = Math.max(0, keySoftness);
      $('keySoftness').value = state.keySoftness;
      $('keySoftnessSlider').value = state.keySoftness;
      keyingChanged = true;
    }
    const keyDespill = parseOptionalInteger(keying.key_despill);
    if (keyDespill !== null) {
      state.keyDespill = Math.max(0, keyDespill);
      $('keyDespill').value = state.keyDespill;
      $('keyDespillSlider').value = state.keyDespill;
      keyingChanged = true;
    }

    $('keyTrack').classList.toggle('active', state.keyEnabled);
    if (keyingChanged) refreshKeyedRenderCache();

    updateStats();
    if (state.frameCanvases.length) renderFrame(state.currentFrame);
    saveSettings();
  }

  async function autoLoadSequenceSourceClip(sequence: any) {
    const clipPath = String(sequence?.metadata?.source_clip_path || state.sourceClipPath || '').trim();
    if (!clipPath || !isRepoSourceClipPath(clipPath)) return false;
    if (state.frameCanvases.length && loadedSourceVideoPath === clipPath) return true;

    try {
      const clipBlob = await fetchSourceClip(state.apiBaseUrl, clipPath);
      const fileName = fileNameFromPath(clipPath);
      const fileType = clipBlob.type || 'video/mp4';
      const sourceFile = new File([clipBlob], fileName, { type: fileType });
      await loadVideo(sourceFile, { sourceClipPath: clipPath, fromRepo: true });
      showToast(`Loaded source clip for ${sequence.sequence_key}`);
      return true;
    } catch (error: any) {
      showToast(`Could not auto-load source clip: ${error?.message || String(error)}`);
      return false;
    }
  }

  function getWorkflowMetadata() {
    readWorkflowControls();
    if (!state.batchId) state.batchId = defaultBatchId();
    writeWorkflowControls();
    saveSettings();
    return {
      batch_id: state.batchId,
      take_id: state.takeId,
      revision: state.revision,
      source_clip_path: state.sourceClipPath,
      tool: 'sprite-workbench',
    };
  }

  function getSequenceFilterValue() {
    return String($('seqFilter')?.value || '').trim().toLowerCase();
  }

  function renderSequencePicker(selectedKey = '') {
    const picker = $('seqPicker') as HTMLSelectElement;
    if (!picker) return;

    const previous = String(selectedKey || picker.value || state.currentSequence?.sequence_key || '');
    const filter = getSequenceFilterValue();
    const filtered = sequenceItems.filter((sequence) => {
      if (!filter) return true;
      const haystack = [
        sequence.sequence_key,
        sequence.entity,
        sequence.animation,
        sequence.direction,
        sequence.state,
      ].join(' ').toLowerCase();
      return haystack.includes(filter);
    });

    picker.innerHTML = '';
    for (const sequence of filtered) {
      const option = document.createElement('option');
      option.value = sequence.sequence_key;
      option.textContent = `${sequence.entity} / ${sequence.animation} / ${sequence.direction} (${sequence.state})`;
      picker.appendChild(option);
    }

    $('seqShown').textContent = String(filtered.length);
    if (!filtered.length) return;

    if (previous && filtered.some((item) => item.sequence_key === previous)) {
      picker.value = previous;
      return;
    }
    picker.selectedIndex = 0;
  }

  function setCurrentSequence(sequence: any, total = null, options: any = {}) {
    state.currentSequence = sequence || null;

    $('seqKey').textContent = sequence?.sequence_key || '—';
    $('seqEntity').textContent = sequence?.entity || '—';
    $('seqAnimation').textContent = sequence?.animation || '—';
    $('seqDirection').textContent = sequence?.direction || '—';
    $('seqPlanned').textContent = sequence ? String(sequence.planned_frames ?? 0) : '—';
    $('seqDone').textContent = sequence ? String(sequence.done_frames ?? 0) : '—';
    $('seqState').textContent = sequence?.state || '—';

    if (total !== null && total !== undefined) {
      $('seqTotal').textContent = String(total);
    }

    renderSequencePicker(sequence?.sequence_key || '');
    if (options.hydrateControls) {
      applySequenceMetadataToControls(sequence, { clampToFrames: state.frameCanvases.length > 0 });
    }
    saveSettings();
  }

  async function fetchSequenceSnapshot() {
    const response = await getSequenceList(state.apiBaseUrl, { tier: WORKFLOW_TIER });
    return {
      total: Number(response?.total || 0),
      items: Array.isArray(response?.items) ? response.items : [],
    };
  }

  async function refreshSequences(showFeedback = true) {
    readWorkflowControls();
    saveSettings();

    const response = await fetchSequenceSnapshot();
    sequenceItems = response.items;
    $('seqTotal').textContent = String(response.total || 0);
    renderSequencePicker();

    if (state.currentSequence) {
      const latest = response.items.find((item: any) => item.sequence_key === state.currentSequence.sequence_key);
      if (latest) setCurrentSequence(latest, response.total);
    }

    if (showFeedback) {
      showToast(`Queue: ${response.total} sequences`);
    }

    return response;
  }

  async function loadNextSequence() {
    readWorkflowControls();
    saveSettings();

    const [next, list] = await Promise.all([
      getSequenceNext(state.apiBaseUrl, { tier: WORKFLOW_TIER }),
      fetchSequenceSnapshot(),
    ]);

    sequenceItems = list.items;
    renderSequencePicker(next?.sequence?.sequence_key || '');

    if (!next.sequence) {
      setCurrentSequence(null, list.total || 0);
      showToast('No pending sequences in queue');
      return null;
    }

    setCurrentSequence(next.sequence, list.total || 0, { hydrateControls: true });
    void autoLoadSequenceSourceClip(next.sequence);
    showToast(`Loaded ${next.sequence.entity}/${next.sequence.animation}/${next.sequence.direction}`);
    return next.sequence;
  }

  function loadSelectedSequenceFromPicker() {
    const sequenceKey = String(($('seqPicker') as HTMLSelectElement)?.value || '').trim();
    if (!sequenceKey) {
      showToast('Select a sequence first');
      return;
    }

    const sequence = sequenceItems.find((item) => item.sequence_key === sequenceKey);
    if (!sequence) {
      showToast(`Sequence not found: ${sequenceKey}`);
      return;
    }

    setCurrentSequence(sequence, sequenceItems.length, { hydrateControls: true });
    void autoLoadSequenceSourceClip(sequence);
    showToast(`Loaded ${sequence.entity}/${sequence.animation}/${sequence.direction}`);
  }

  function ensureSequenceLoaded() {
    if (!state.currentSequence) {
      showToast('Load a sequence first');
      return false;
    }
    return true;
  }

  function ensureFramesLoaded() {
    if (!state.frameCanvases.length) {
      showToast('Load source video first');
      return false;
    }
    return true;
  }

  function canvasToBlob(canvas: HTMLCanvasElement, mimeType = 'image/png') {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to encode image'));
          return;
        }
        resolve(blob);
      }, mimeType);
    });
  }

  function blobToBase64(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to encode artifact'));
      reader.readAsDataURL(blob);
    });
  }

  async function canvasToBase64Png(canvas: HTMLCanvasElement) {
    const blob = await canvasToBlob(canvas, 'image/png');
    return blobToBase64(blob);
  }

  function toRevisionTag(revision: number) {
    const rev = Math.max(1, parseInt(String(revision), 10) || 1);
    return `v${String(rev).padStart(2, '0')}`;
  }

  function replaceExtension(pathValue: string, newSuffix: string) {
    const trimmed = String(pathValue || '').trim();
    if (!trimmed) return '';
    if (trimmed.includes('.')) return trimmed.replace(/\.[^./]+$/, newSuffix);
    return `${trimmed}${newSuffix}`;
  }

  function makeResPath(pathValue: string) {
    const normalized = String(pathValue || '').replace(/^\/+/, '');
    return normalized.startsWith('res://') ? normalized : `res://${normalized}`;
  }

  function sequenceShotKeyPad(sequence: any) {
    const first = sequence?.shot_keys?.[0] || '';
    const match = String(first).match(/_f(\d+)$/);
    return Math.max(2, match?.[1]?.length || 2);
  }

  function buildShotKey(sequenceKey: string, frameIndex: number, pad: number) {
    return `${sequenceKey}_f${String(frameIndex).padStart(pad, '0')}`;
  }

  function frameTag(frameIndex: number, pad = 2) {
    return `f${String(Math.max(1, frameIndex)).padStart(pad, '0')}`;
  }

  function defaultShotPaths(sequence: any, shotKey: string, frameIndex: number, revision: number) {
    const entity = String(sequence.entity || '').trim();
    const animation = String(sequence.animation || '').trim();
    const direction = String(sequence.direction || '').trim();
    const tag = frameTag(frameIndex, 2);

    return {
      raw_path: `resources/sprites/raw/sprite-workbench/unassigned/${shotKey}/candidate_01.png`,
      selected_path: `resources/sprites/selected/${entity}/${animation}/${direction}/${tag}.png`,
      processed_path: `resources/sprites/processed/${entity}/${animation}/${direction}/${tag}_${toRevisionTag(revision)}.png`,
    };
  }

  function defaultSheetPath(sequence: any) {
    const entity = String(sequence.entity || '').trim();
    const animation = String(sequence.animation || '').trim();
    const direction = String(sequence.direction || '').trim();
    return `resources/sprites/sheets/${entity}/${entity}_${animation}_${direction}_f01.png`;
  }

  function isRepoSourceClipPath(value: string) {
    const normalized = String(value || '').trim().replace(/\\/g, '/');
    return normalized.startsWith('resources/sprites/raw/');
  }

  function sanitizeFileName(name: string) {
    const trimmed = String(name || '').trim();
    const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
    return safe || 'source.mp4';
  }

  function fileNameFromPath(pathValue: string) {
    const normalized = String(pathValue || '').trim().replace(/\\/g, '/');
    const parts = normalized.split('/');
    return sanitizeFileName(parts[parts.length - 1] || 'source.mp4');
  }

  function deriveManagedSourceClipPath(sequence: any, preferredName = '') {
    const sequenceKey = String(sequence?.sequence_key || '').trim() || 'unassigned_sequence';
    const name = sanitizeFileName(preferredName || 'source.mp4');
    return `resources/sprites/raw/sprite-workbench/source-clips/${sequenceKey}/${name}`;
  }

  function clampTrimRect(rect: any) {
    if (!rect || typeof rect !== 'object') return null;
    const sourceW = Math.max(1, Number(state.width || 0));
    const sourceH = Math.max(1, Number(state.height || 0));
    const rawX = parseInt(String(rect.x ?? ''), 10);
    const rawY = parseInt(String(rect.y ?? ''), 10);
    const rawW = parseInt(String(rect.w ?? ''), 10);
    const rawH = parseInt(String(rect.h ?? ''), 10);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY) || !Number.isFinite(rawW) || !Number.isFinite(rawH)) {
      return null;
    }

    const x = Math.max(0, Math.min(sourceW - 1, rawX));
    const y = Math.max(0, Math.min(sourceH - 1, rawY));
    const maxW = Math.max(1, sourceW - x);
    const maxH = Math.max(1, sourceH - y);
    const w = Math.max(1, Math.min(maxW, rawW));
    const h = Math.max(1, Math.min(maxH, rawH));
    return {
      x,
      y,
      w,
      h,
      trimmed: x !== 0 || y !== 0 || (x + w) !== sourceW || (y + h) !== sourceH,
    };
  }

  function layoutProfilePath(sequence: any) {
    const entity = String(sequence?.entity || '').trim();
    const animation = String(sequence?.animation || '').trim();
    if (!entity || !animation) return '';
    return `resources/sprites/sheets/${entity}/${entity}_${animation}_layout_profile.json`;
  }

  function profileNumber(value: any, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function buildLayoutProfile(sequence: any, trimRect: any, scale: number, frameWidth: number, frameHeight: number) {
    const nowIso = new Date().toISOString();
    return {
      version: 1,
      entity: String(sequence?.entity || '').trim(),
      animation: String(sequence?.animation || '').trim(),
      sequence_key_hint: String(sequence?.sequence_key || '').trim(),
      source_size: { w: state.width, h: state.height },
      trim_rect: { x: trimRect.x, y: trimRect.y, w: trimRect.w, h: trimRect.h },
      frame_size: { w: frameWidth, h: frameHeight },
      scale: Number(scale.toFixed(6)),
      pivot: { x: 0.5, y: 1.0 },
      created_at: nowIso,
      updated_at: nowIso,
    };
  }

  function normalizeLoadedLayoutProfile(profile: any) {
    if (!profile || typeof profile !== 'object') return null;
    const trimRect = clampTrimRect(profile.trim_rect);
    if (!trimRect) return null;

    const frameWidth = Math.max(1, Math.round(profileNumber(profile?.frame_size?.w, trimRect.w)));
    const frameHeight = Math.max(1, Math.round(profileNumber(profile?.frame_size?.h, trimRect.h)));
    const scale = profileNumber(profile.scale, frameHeight / Math.max(1, trimRect.h));
    const sourceW = Math.max(1, Math.round(profileNumber(profile?.source_size?.w, state.width)));
    const sourceH = Math.max(1, Math.round(profileNumber(profile?.source_size?.h, state.height)));
    return {
      ...profile,
      source_size: { w: sourceW, h: sourceH },
      trim_rect: trimRect,
      frame_size: { w: frameWidth, h: frameHeight },
      scale: Number(Math.max(0.01, scale).toFixed(6)),
    };
  }

  async function loadLayoutProfile(sequence: any) {
    const profilePath = layoutProfilePath(sequence);
    if (!profilePath) return null;
    try {
      const raw = await fetchArtifactText(state.apiBaseUrl, profilePath);
      const parsed = JSON.parse(raw);
      return normalizeLoadedLayoutProfile(parsed);
    } catch (error: any) {
      const message = String(error?.message || '');
      const isMissing = /404/.test(message) || /not found/i.test(message);
      if (!isMissing) {
        console.warn('Could not load layout profile', profilePath, error);
      }
      return null;
    }
  }

  async function resolveCanonicalLayout(sequence: any, activeIndices: number[]) {
    const baseTrimRect = computeSharedTrimRect(activeIndices);
    const baseScale = Math.max(0.01, Number(state.exportScale) || 1);
    const profilePath = layoutProfilePath(sequence);
    const existingProfile = await loadLayoutProfile(sequence);

    let trimRect = baseTrimRect;
    let scale = baseScale;
    let source = 'local';

    if (existingProfile) {
      const sameSourceSize = existingProfile.source_size.w === state.width && existingProfile.source_size.h === state.height;
      if (sameSourceSize && existingProfile.trim_rect) {
        trimRect = existingProfile.trim_rect;
      }
      if (existingProfile.frame_size?.h > 0 && trimRect.h > 0) {
        scale = existingProfile.frame_size.h / trimRect.h;
      } else if (existingProfile.scale > 0) {
        scale = existingProfile.scale;
      }
      source = 'profile';
    }

    scale = Math.max(0.05, Math.min(16, scale));
    const frameWidth = Math.max(1, Math.round(trimRect.w * scale));
    const frameHeight = Math.max(1, Math.round(trimRect.h * scale));
    const profile = existingProfile
      ? {
        ...existingProfile,
        entity: String(sequence?.entity || '').trim(),
        animation: String(sequence?.animation || '').trim(),
        source_size: { w: state.width, h: state.height },
        trim_rect: { x: trimRect.x, y: trimRect.y, w: trimRect.w, h: trimRect.h },
        frame_size: { w: frameWidth, h: frameHeight },
        scale: Number(scale.toFixed(6)),
        pivot: { x: 0.5, y: 1.0 },
        updated_at: new Date().toISOString(),
      }
      : buildLayoutProfile(sequence, trimRect, scale, frameWidth, frameHeight);

    return {
      source,
      trimRect,
      scale,
      frameWidth,
      frameHeight,
      profilePath,
      profile,
    };
  }

  function createSingleFrameCanvas(frameIndex: number, options: any = {}) {
    const {
      applyKey = true,
      scale = 1,
      trim = false,
      trimRect = null,
      includeBackground = false,
    } = options;

    const safeIndex = Math.max(0, Math.min(frameIndex, state.frameCanvases.length - 1));
    const source = applyKey ? applyChromaKey(state.frameCanvases[safeIndex]) : state.frameCanvases[safeIndex];

    let rect = { x: 0, y: 0, w: state.width, h: state.height, trimmed: false };
    if (trim) rect = clampTrimRect(trimRect) || computeSharedTrimRect([safeIndex]);
    const outputScale = Math.max(0.01, Number(scale) || 1);
    const outWidth = Math.max(1, Math.round(rect.w * outputScale));
    const outHeight = Math.max(1, Math.round(rect.h * outputScale));

    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const c = canvas.getContext('2d', { willReadFrequently: true })!;
    c.imageSmoothingEnabled = false;

    if (includeBackground && state.bgMode !== 'transparent') {
      const color = state.bgMode === 'custom' ? state.bgColor : state.bgMode;
      c.fillStyle = color;
      c.fillRect(0, 0, canvas.width, canvas.height);
    }

    c.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
    return { canvas, rect };
  }

  function getActiveFrameIndices() {
    if (!state.frameCanvases.length) return [];

    const start = Math.max(0, Math.min(state.startFrame, state.frameCanvases.length - 1));
    const end = Math.max(start, Math.min(state.endFrame, state.frameCanvases.length - 1));
    const stride = Math.max(1, state.skipFrames + 1);

    const indices: number[] = [];
    let seenEnabled = 0;
    for (let i = start; i <= end; i++) {
      if (!state.enabled[i]) continue;
      if (seenEnabled % stride === 0) indices.push(i);
      seenEnabled += 1;
    }

    return indices;
  }

  function currentKeyRenderSignature() {
    const [kr, kg, kb] = state.keyColor;
    return [
      state.width,
      state.height,
      state.frameCanvases.length,
      kr,
      kg,
      kb,
      state.keyTolerance,
      state.keySoftness,
      state.keyDespill,
    ].join('|');
  }

  function clearKeyedRenderCache() {
    keyedRenderCache.signature = '';
    keyedRenderCache.frames = new WeakMap();
    keyedRenderCache.token += 1;
    keyedRenderCache.warming = false;
    keyedRenderCache.done = 0;
    keyedRenderCache.total = 0;
  }

  function hasCachedKeyedFrame(frameCanvas: HTMLCanvasElement, signature: string) {
    const cached = keyedRenderCache.frames.get(frameCanvas);
    return Boolean(cached && cached.signature === signature);
  }

  function buildKeyedWarmupOrder() {
    const order: number[] = [];
    const seen = new Set<number>();
    const push = (index: number) => {
      if (index < 0 || index >= state.frameCanvases.length) return;
      if (seen.has(index)) return;
      seen.add(index);
      order.push(index);
    };

    push(state.currentFrame);
    for (const frameIndex of getActiveFrameIndices()) push(frameIndex);
    for (let i = 0; i < state.frameCanvases.length; i += 1) push(i);
    return order;
  }

  function scheduleKeyedRenderWarmup() {
    if (!state.keyEnabled || !state.frameCanvases.length) return;

    const signature = currentKeyRenderSignature();
    const order = buildKeyedWarmupOrder().filter((frameIndex) => {
      const frameCanvas = state.frameCanvases[frameIndex];
      return frameCanvas && !hasCachedKeyedFrame(frameCanvas, signature);
    });

    if (!order.length) {
      keyedRenderCache.signature = signature;
      keyedRenderCache.warming = false;
      keyedRenderCache.done = state.frameCanvases.length;
      keyedRenderCache.total = state.frameCanvases.length;
      return;
    }

    const token = ++keyedRenderCache.token;
    keyedRenderCache.signature = signature;
    keyedRenderCache.warming = true;
    keyedRenderCache.done = state.frameCanvases.length - order.length;
    keyedRenderCache.total = state.frameCanvases.length;

    let cursor = 0;
    const runSlice = () => {
      if (token !== keyedRenderCache.token) return;
      if (!state.keyEnabled || !state.frameCanvases.length) {
        keyedRenderCache.warming = false;
        return;
      }
      if (currentKeyRenderSignature() !== signature) {
        keyedRenderCache.warming = false;
        scheduleKeyedRenderWarmup();
        return;
      }

      const start = performance.now();
      while (cursor < order.length && (performance.now() - start) < 7) {
        const frameIndex = order[cursor];
        const frameCanvas = state.frameCanvases[frameIndex];
        if (frameCanvas && !hasCachedKeyedFrame(frameCanvas, signature)) {
          const keyed = renderKeyedFrame(frameCanvas);
          keyedRenderCache.frames.set(frameCanvas, { signature, canvas: keyed });
        }
        cursor += 1;
        keyedRenderCache.done = keyedRenderCache.total - (order.length - cursor);
      }

      if (cursor >= order.length) {
        keyedRenderCache.warming = false;
        return;
      }

      const idleCallback = (window as any).requestIdleCallback;
      if (typeof idleCallback === 'function') {
        idleCallback(runSlice, { timeout: 16 });
      } else {
        window.setTimeout(runSlice, 0);
      }
    };

    runSlice();
  }

  function refreshKeyedRenderCache() {
    clearKeyedRenderCache();
    if (state.keyEnabled && state.frameCanvases.length) {
      scheduleKeyedRenderWarmup();
    }
  }

  async function waitForKeyedFrames(indices: number[], timeoutMs = 1200) {
    if (!state.keyEnabled || !indices.length) return true;
    const signature = currentKeyRenderSignature();
    const started = performance.now();

    while ((performance.now() - started) < timeoutMs) {
      let missing = 0;
      for (const index of indices) {
        const frameCanvas = state.frameCanvases[index];
        if (!frameCanvas || !hasCachedKeyedFrame(frameCanvas, signature)) {
          missing += 1;
        }
      }
      if (missing === 0) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 16));
    }

    return false;
  }

  function updateLoopOverlay() {
    const base = state.loopMode;
    if (!state.loopDetection) {
      $('overlayLoop').textContent = base;
      return;
    }
    $('overlayLoop').textContent = `${base} • ${formatLoopDetection(state.loopDetection)}`;
  }

  function updateStats() {
    const active = getActiveFrameIndices();
    $('statActiveFrames').textContent = active.length;
    $('tlEnabled').textContent = active.length;
    const duration = active.length > 0 ? (active.length / Math.max(1, state.fps)).toFixed(2) : '0';
    $('tlDuration').textContent = `${duration}s`;
    updateLoopOverlay();
  }

  function advanceFromDisabled(frameIndex: number) {
    let next = frameIndex + 1;
    while (next < state.frameCanvases.length && !state.enabled[next]) next += 1;
    if (next >= state.frameCanvases.length) {
      next = frameIndex - 1;
      while (next >= 0 && !state.enabled[next]) next -= 1;
    }
    if (next >= 0 && next < state.frameCanvases.length) renderFrame(next);
  }

  async function loadVideo(file: File, options: any = {}) {
    const sourceClipPath = String(options.sourceClipPath || '').trim();
    const fromRepo = Boolean(options.fromRepo);
    stopPlayback();
    setProcessing(true, 'Preparing extraction…', 0);

    try {
      const result = await extractFramesInWorker({
        file,
        video: sourceVideo,
        sampleFps: 30,
        onProgress: ({ current, total, phase }) => {
          const pct = total > 0 ? ((current / total) * 100) : 0;
          const label = phase === 'extract-worker' ? 'Extracting (worker)' : 'Extracting';
          setProcessing(true, `${label} ${current}/${total}`, pct);
        },
      });

      state.frameCanvases = result.frames;
      state.frameHashes = result.hashes;
      state.enabled = new Array(result.frames.length).fill(true);
      state.width = result.width;
      state.height = result.height;
      state.currentFrame = 0;
      state.fps = Math.min(result.estimatedFps, 40);
      state.startFrame = 0;
      state.endFrame = result.frames.length - 1;
      refreshKeyedRenderCache();

      const detected = detectLoopRange(result.hashes);
      state.loopDetection = detected || null;

      $('fpsInput').value = state.fps;
      $('fpsSlider').value = state.fps;
      $('startFrame').value = state.startFrame;
      $('startFrame').max = result.frames.length - 1;
      $('endFrame').value = state.endFrame;
      $('endFrame').max = result.frames.length - 1;

      $('statTotalFrames').textContent = result.frames.length;
      $('statSourceFps').textContent = result.estimatedFps;
      $('statDimensions').textContent = `${result.width}×${result.height}`;

      previewPanel.classList.remove('empty-state');
      uploadZone.style.display = 'none';
      canvasWrap.style.display = 'flex';
      $('btnReset').style.display = '';
      $('headerRight').style.display = '';
      $('statsSection').style.display = '';
      $('timingSection').style.display = '';
      $('frameRangeSection').style.display = '';
      $('displaySection').style.display = '';
      $('chromaKeySection').style.display = '';
      $('exportSection').style.display = '';
      $('emptyInfo').style.display = 'none';
      $('timelineInfo').style.display = '';
      $('timelineActions').style.display = 'flex';

      previewCanvas.width = result.width;
      previewCanvas.height = result.height;

      buildTimeline();
      updateTimelinePadding();
      if (state.currentSequence) {
        applySequenceMetadataToControls(state.currentSequence, { clampToFrames: true });
      }
      renderFrame(0);
      updateStats();

      if (!state.sourceClipPath) {
        state.sourceClipPath = sourceClipPath || file.name || '';
      } else if (sourceClipPath) {
        state.sourceClipPath = sourceClipPath;
      }
      $('wfSourceClipPath').value = state.sourceClipPath;
      loadedSourceVideoFile = file;
      loadedSourceVideoPath = fromRepo ? sourceClipPath : '';

      saveSettings();

      if (state.loopDetection) {
        showToast(`Extracted ${result.frames.length} frames, detected loop ${state.loopDetection.start}-${state.loopDetection.end}`);
      } else {
        showToast(`Extracted ${result.frames.length} frames`);
      }
    } catch (error: any) {
      showToast(`Error: ${error?.message || String(error)}`);
    } finally {
      setProcessing(false, '', 0);
    }
  }

  function buildTimeline() {
    timelineScroll.innerHTML = '';

    state.frameCanvases.forEach((frameCanvas: HTMLCanvasElement, i: number) => {
      const div = document.createElement('div');
      div.className = 'frame-thumb';
      div.dataset.index = String(i);
      div.classList.toggle('disabled', !state.enabled[i]);
      if (i === state.currentFrame) div.classList.add('current');

      const thumbCanvas = document.createElement('canvas');
      const aspect = frameCanvas.height / frameCanvas.width;
      thumbCanvas.width = 72;
      thumbCanvas.height = Math.max(1, Math.round(72 * aspect));
      const thumbCtx = thumbCanvas.getContext('2d')!;
      thumbCtx.imageSmoothingEnabled = false;
      thumbCtx.drawImage(frameCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      div.appendChild(thumbCanvas);

      const num = document.createElement('div');
      num.className = 'frame-number';
      num.textContent = String(i);
      div.appendChild(num);

      div.addEventListener('click', (event: MouseEvent) => {
        if (event.shiftKey) {
          state.enabled[i] = !state.enabled[i];
          div.classList.toggle('disabled', !state.enabled[i]);
          updateStats();
          if (!state.enabled[i] && i === state.currentFrame) advanceFromDisabled(i);
        } else {
          renderFrame(i);
        }
      });

      div.addEventListener('dblclick', () => {
        state.enabled[i] = !state.enabled[i];
        div.classList.toggle('disabled', !state.enabled[i]);
        updateStats();
        if (!state.enabled[i] && i === state.currentFrame) advanceFromDisabled(i);
      });

      timelineScroll.appendChild(div);
    });
  }

  function updateTimelinePadding() {
    const containerWidth = timelineScroll.clientWidth;
    const frameWidth = 72 + 3 + 4;
    const pad = Math.max(0, (containerWidth / 2) - (frameWidth / 2));
    timelineScroll.style.paddingLeft = `${pad}px`;
    timelineScroll.style.paddingRight = `${pad}px`;
  }

  function updateCurrentHighlight() {
    timelineScroll.querySelectorAll('.frame-thumb').forEach((el: any, i: number) => {
      el.classList.toggle('current', i === state.currentFrame);
    });

    $('overlayFrame').textContent = `${state.currentFrame}/${state.frameCanvases.length - 1}`;

    const el = timelineScroll.children[state.currentFrame] as HTMLElement;
    if (el) {
      const containerWidth = timelineScroll.clientWidth;
      timelineScroll.scrollLeft = el.offsetLeft - (containerWidth / 2) + (el.offsetWidth / 2);
    }
  }

  function renderKeyedFrame(sourceCanvas: HTMLCanvasElement) {
    if (!state.keyEnabled) return sourceCanvas;

    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const keyedCanvas = document.createElement('canvas');
    keyedCanvas.width = w;
    keyedCanvas.height = h;
    const kCtx = keyedCanvas.getContext('2d', { willReadFrequently: true })!;
    kCtx.drawImage(sourceCanvas, 0, 0);

    const imageData = kCtx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const alphaMap = new Uint8ClampedArray(w * h);
    const distMap = new Float32Array(w * h);

    const [kr, kg, kb] = state.keyColor;
    const tolerance = state.keyTolerance;
    const softness = state.keySoftness;
    const despill = state.keyDespill / 100;
    const keyIndex = kg >= kr && kg >= kb ? 1 : (kb >= kr && kb >= kg ? 2 : 0);
    const keyIsNeutral = Math.abs(kr - kg) <= 8 && Math.abs(kg - kb) <= 8 && Math.abs(kr - kb) <= 8;
    const spillRange = Math.max(1, tolerance + softness + 48);
    const nx = [-1, 0, 1, -1, 1, -1, 0, 1];
    const ny = [-1, -1, -1, 0, 0, 1, 1, 1];

    function findDarkNeighbor(x: number, y: number, minAlpha: number) {
      let found = false;
      let bestLum = Infinity;
      let bestR = 0;
      let bestG = 0;
      let bestB = 0;

      for (let n = 0; n < 8; n += 1) {
        const sx = x + nx[n];
        const sy = y + ny[n];
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
        const samplePixel = (sy * w) + sx;
        if (alphaMap[samplePixel] < minAlpha) continue;

        const sampleIndex = samplePixel * 4;
        const sr = data[sampleIndex];
        const sg = data[sampleIndex + 1];
        const sb = data[sampleIndex + 2];
        const lum = (0.2126 * sr) + (0.7152 * sg) + (0.0722 * sb);
        if (lum < bestLum) {
          bestLum = lum;
          bestR = sr;
          bestG = sg;
          bestB = sb;
          found = true;
        }
      }

      return { found, r: bestR, g: bestG, b: bestB };
    }

    function hasTransparentNeighbor(x: number, y: number, alphaSource: Uint8ClampedArray) {
      for (let n = 0; n < 8; n += 1) {
        const sx = x + nx[n];
        const sy = y + ny[n];
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
        if (alphaSource[(sy * w) + sx] === 0) return true;
      }
      return false;
    }

    for (let pixel = 0; pixel < w * h; pixel += 1) {
      const i = pixel * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const dr = r - kr;
      const dg = g - kg;
      const db = b - kb;
      const dist = Math.sqrt((dr * dr) + (dg * dg) + (db * db));
      distMap[pixel] = dist;

      let alpha;
      if (dist <= tolerance) {
        alpha = 0;
      } else if (softness > 0 && dist <= tolerance + softness) {
        alpha = (dist - tolerance) / softness;
      } else {
        alpha = 1;
      }

      if (despill > 0 && !keyIsNeutral) {
        const keyInfluence = Math.max(0, 1 - (dist / spillRange));
        const edgeInfluence = 1 - alpha;
        const spillStrength = Math.max(keyInfluence, edgeInfluence);
        if (spillStrength > 0) {
          const keyChannel = i + keyIndex;
          const other1 = i + ((keyIndex + 1) % 3);
          const other2 = i + ((keyIndex + 2) % 3);
          const current = data[keyChannel];
          const target = Math.max(data[other1], data[other2]);
          if (current > target) {
            const corrected = current - ((current - target) * spillStrength * despill);
            data[keyChannel] = Math.max(0, Math.min(255, Math.round(corrected)));
          }
        }
      }

      const alpha8 = Math.round(alpha * 255);
      alphaMap[pixel] = alpha8;
      data[i + 3] = alpha8;
    }

    if (despill > 0) {
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const pixel = (y * w) + x;
          const i = pixel * 4;
          const alpha8 = alphaMap[pixel];
          const alpha = alpha8 / 255;

          if (alpha8 > 0 && alpha8 < 255) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const minRGB = Math.min(r, g, b);
            const maxRGB = Math.max(r, g, b);
            const saturation = maxRGB <= 0 ? 0 : (maxRGB - minRGB) / maxRGB;
            const whiteBias = Math.max(0, (minRGB - 96) / (255 - 96));
            const neutralBias = 1 - Math.min(1, saturation * 1.5);
            const edgeBias = 1 - alpha;
            const fringeStrength = whiteBias * neutralBias * edgeBias;

            if (fringeStrength > 0.015) {
              const neighbor = findDarkNeighbor(x, y, 180);
              if (neighbor.found) {
                const blend = Math.min(1, despill * fringeStrength * 1.35);
                data[i] = Math.round(r + ((neighbor.r - r) * blend));
                data[i + 1] = Math.round(g + ((neighbor.g - g) * blend));
                data[i + 2] = Math.round(b + ((neighbor.b - b) * blend));
              }
            }
          } else if (alpha8 === 0) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const minRGB = Math.min(r, g, b);
            if (minRGB > 72) {
              const neighbor = findDarkNeighbor(x, y, 160);
              if (neighbor.found) {
                data[i] = neighbor.r;
                data[i + 1] = neighbor.g;
                data[i + 2] = neighbor.b;
              }
            }
          }
        }
      }
    }

    // Hard-edge matte cleanup for faux-pixel workflows:
    // aggressively trims bright edge fringe and snaps boundary alpha.
    if (despill > 0) {
      const workingAlpha = new Uint8ClampedArray(w * h);
      const boundary = new Uint8ClampedArray(w * h);
      for (let pixel = 0; pixel < w * h; pixel += 1) {
        workingAlpha[pixel] = data[(pixel * 4) + 3];
      }

      const keyRange = Math.max(1, tolerance + softness + 72);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const pixel = (y * w) + x;
          const alpha8 = workingAlpha[pixel];
          if (alpha8 === 0) continue;
          if (!hasTransparentNeighbor(x, y, workingAlpha)) continue;
          boundary[pixel] = 1;

          const i = pixel * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const minRGB = Math.min(r, g, b);
          const maxRGB = Math.max(r, g, b);
          const sat = maxRGB <= 0 ? 0 : (maxRGB - minRGB) / maxRGB;
          const lum = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
          const nearKey = distMap[pixel] <= keyRange;
          const brightNeutral = minRGB > 96 && sat < 0.30;
          const fringeLike = nearKey || brightNeutral || (lum > 132 && sat < 0.22);

          if (fringeLike) {
            const trimStrength = Math.min(1, 0.45 + (despill * 0.55));
            workingAlpha[pixel] = Math.round(alpha8 * (1 - trimStrength));
          }
        }
      }

      const edgeThreshold = Math.max(96, Math.round(220 - (despill * 100)));
      for (let pixel = 0; pixel < w * h; pixel += 1) {
        if (!boundary[pixel]) continue;
        const i = pixel * 4;
        const a = workingAlpha[pixel];
        data[i + 3] = a >= edgeThreshold ? 255 : 0;
      }

      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const pixel = (y * w) + x;
          if (!boundary[pixel]) continue;
          const i = pixel * 4;
          if (data[i + 3] !== 0) continue;
          const minRGB = Math.min(data[i], data[i + 1], data[i + 2]);
          if (minRGB > 72) {
            const neighbor = findDarkNeighbor(x, y, 160);
            if (neighbor.found) {
              data[i] = neighbor.r;
              data[i + 1] = neighbor.g;
              data[i + 2] = neighbor.b;
            }
          }
        }
      }

      // Extra 1px erosion pass to kill residual key noise on hard-edged sprites.
      const alphaBinary = new Uint8ClampedArray(w * h);
      const erodeMask = new Uint8ClampedArray(w * h);
      for (let pixel = 0; pixel < w * h; pixel += 1) {
        alphaBinary[pixel] = data[(pixel * 4) + 3] > 0 ? 255 : 0;
      }

      const erosionKeyRange = Math.max(1, tolerance + softness + 96);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const pixel = (y * w) + x;
          if (alphaBinary[pixel] === 0) continue;
          if (!hasTransparentNeighbor(x, y, alphaBinary)) continue;

          const i = pixel * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const minRGB = Math.min(r, g, b);
          const maxRGB = Math.max(r, g, b);
          const sat = maxRGB <= 0 ? 0 : (maxRGB - minRGB) / maxRGB;
          const lum = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
          const nearKey = distMap[pixel] <= erosionKeyRange;
          const brightNeutral = minRGB > 72 && sat < 0.40;
          const fringeLike = nearKey || brightNeutral || (lum > 110 && sat < 0.30);
          if (!fringeLike) continue;

          let opaqueNeighbors = 0;
          for (let n = 0; n < 8; n += 1) {
            const sx = x + nx[n];
            const sy = y + ny[n];
            if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
            if (alphaBinary[(sy * w) + sx] > 0) opaqueNeighbors += 1;
          }

          if (opaqueNeighbors <= 5) {
            erodeMask[pixel] = 1;
          }
        }
      }

      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const pixel = (y * w) + x;
          if (!erodeMask[pixel]) continue;
          const i = pixel * 4;
          data[i + 3] = 0;
          const neighbor = findDarkNeighbor(x, y, 100);
          if (neighbor.found) {
            data[i] = neighbor.r;
            data[i + 1] = neighbor.g;
            data[i + 2] = neighbor.b;
          }
        }
      }
    }

    kCtx.putImageData(imageData, 0, 0);
    return keyedCanvas;
  }

  function applyChromaKey(sourceCanvas: HTMLCanvasElement, options: any = {}) {
    if (!state.keyEnabled) return sourceCanvas;

    const signature = currentKeyRenderSignature();
    const cached = keyedRenderCache.frames.get(sourceCanvas);
    if (cached && cached.signature === signature) {
      return cached.canvas;
    }

    scheduleKeyedRenderWarmup();

    const allowSync = options.allowSync !== false;
    if (!allowSync) return sourceCanvas;

    const keyed = renderKeyedFrame(sourceCanvas);
    keyedRenderCache.frames.set(sourceCanvas, { signature, canvas: keyed });
    return keyed;
  }

  function renderFrame(index: number) {
    if (!state.frameCanvases.length) return;

    const clamped = Math.max(0, Math.min(index, state.frameCanvases.length - 1));
    state.currentFrame = clamped;

    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

    if (state.bgMode !== 'transparent') {
      const color = state.bgMode === 'custom' ? state.bgColor : state.bgMode;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    }

    if (state.onionSkin && clamped > 0) {
      const active = getActiveFrameIndices();
      const activePos = active.indexOf(clamped);
      if (activePos > 0) {
        ctx.globalAlpha = 0.2;
        ctx.drawImage(
          applyChromaKey(state.frameCanvases[active[activePos - 1]], { allowSync: !state.playing }),
          0,
          0,
        );
        ctx.globalAlpha = 1;
      }
    }

    ctx.drawImage(
      applyChromaKey(state.frameCanvases[clamped], { allowSync: !state.playing }),
      0,
      0,
    );
    $('overlayFrame').textContent = `${clamped}/${state.frameCanvases.length - 1}`;
    $('overlaySize').textContent = `${state.width}×${state.height}`;
    updateCurrentHighlight();
  }

  async function startPlayback() {
    if (state.playing || playbackPending) return;
    playbackPending = true;
    const startToken = ++playbackStartToken;

    const active = getActiveFrameIndices();
    if (!active.length) {
      playbackPending = false;
      stopPlayback();
      return;
    }

    if (state.keyEnabled) {
      scheduleKeyedRenderWarmup();
      const ready = await waitForKeyedFrames(active, 1400);
      if (startToken !== playbackStartToken) {
        playbackPending = false;
        return;
      }
      if (!ready) {
        showToast('Key cache warming in background…');
      }
    }

    if (startToken !== playbackStartToken) {
      playbackPending = false;
      return;
    }

    state.playing = true;
    playbackPending = false;
    $('playIcon').innerHTML = '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>';

    let idx = active.indexOf(state.currentFrame);
    if (idx < 0) idx = 0;
    state.pingPongReverse = false;

    const tick = () => {
      if (!state.playing) return;

      const activeNow = getActiveFrameIndices();
      if (!activeNow.length) {
        stopPlayback();
        return;
      }

      idx = Math.max(0, Math.min(idx, activeNow.length - 1));
      renderFrame(activeNow[idx]);

      if (state.loopMode === 'pingpong') {
        if (activeNow.length <= 1) {
          idx = 0;
        } else if (state.pingPongReverse) {
          idx -= 1;
          if (idx < 0) {
            idx = 1;
            state.pingPongReverse = false;
          }
        } else {
          idx += 1;
          if (idx >= activeNow.length) {
            idx = activeNow.length - 2;
            state.pingPongReverse = true;
          }
        }
      } else {
        idx += 1;
        if (idx >= activeNow.length) {
          if (state.loopMode === 'once') {
            stopPlayback();
            return;
          }
          idx = 0;
        }
      }

      state.animTimer = setTimeout(tick, 1000 / Math.max(1, state.fps));
    };

    tick();
  }

  function stopPlayback() {
    playbackStartToken += 1;
    playbackPending = false;
    state.playing = false;
    clearTimeout(state.animTimer);
    $('playIcon').innerHTML = '<polygon points="5,3 19,12 5,21"/>';
  }

  function togglePlayback() {
    if (state.playing) stopPlayback();
    else void startPlayback();
  }

  function stepFrame(direction: number) {
    stopPlayback();
    const active = getActiveFrameIndices();
    if (!active.length) return;

    let idx = active.indexOf(state.currentFrame);
    if (idx < 0) idx = 0;
    else idx += direction;

    if (idx < 0) idx = active.length - 1;
    if (idx >= active.length) idx = 0;

    renderFrame(active[idx]);
  }

  function findOpaqueBounds(data: Uint8ClampedArray, width: number, height: number) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      const row = y * width * 4;
      for (let x = 0; x < width; x++) {
        if (data[row + (x * 4) + 3] === 0) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < 0 || maxY < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function computeSharedTrimRect(activeIndices: number[]) {
    const full = { x: 0, y: 0, w: state.width, h: state.height, trimmed: false };
    if (!state.trimAlphaBounds || !activeIndices.length || state.width <= 0 || state.height <= 0) return full;
    if (!state.keyEnabled) return full;

    let minX = state.width;
    let minY = state.height;
    let maxX = -1;
    let maxY = -1;

    for (const frameIndex of activeIndices) {
      const keyed = applyChromaKey(state.frameCanvases[frameIndex]);
      const kCtx = keyed.getContext('2d', { willReadFrequently: true });
      if (!kCtx) continue;
      const img = kCtx.getImageData(0, 0, keyed.width, keyed.height);
      const bounds = findOpaqueBounds(img.data, keyed.width, keyed.height);
      if (!bounds) continue;

      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.w - 1);
      maxY = Math.max(maxY, bounds.y + bounds.h - 1);
    }

    if (maxX < 0 || maxY < 0) return full;

    const padding = Math.max(0, Math.min(32, state.trimPadding | 0));
    const x = Math.max(0, minX - padding);
    const y = Math.max(0, minY - padding);
    const x2 = Math.min(state.width - 1, maxX + padding);
    const y2 = Math.min(state.height - 1, maxY + padding);

    return {
      x,
      y,
      w: Math.max(1, x2 - x + 1),
      h: Math.max(1, y2 - y + 1),
      trimmed: x !== 0 || y !== 0 || x2 !== state.width - 1 || y2 !== state.height - 1,
    };
  }

  function createSheetCanvas(activeIndices: number[], options: any = {}) {
    const trimRect = clampTrimRect(options.trimRect) || computeSharedTrimRect(activeIndices);
    const scale = Math.max(0.01, Number(options.scale) || Number(state.exportScale) || 1);
    const cols = Math.min(state.sheetCols, Math.max(1, activeIndices.length));
    const rows = Math.ceil(activeIndices.length / cols);
    const frameWidth = Math.max(1, Math.round(trimRect.w * scale));
    const frameHeight = Math.max(1, Math.round(trimRect.h * scale));

    const sheet = document.createElement('canvas');
    sheet.width = cols * frameWidth;
    sheet.height = rows * frameHeight;
    const sCtx = sheet.getContext('2d', { willReadFrequently: true })!;
    const frameRects: any[] = [];

    if (state.bgMode !== 'transparent') {
      const color = state.bgMode === 'custom' ? state.bgColor : state.bgMode;
      sCtx.fillStyle = color;
      sCtx.fillRect(0, 0, sheet.width, sheet.height);
    }

    sCtx.imageSmoothingEnabled = false;

    activeIndices.forEach((frameIdx, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const dx = col * frameWidth;
      const dy = row * frameHeight;
      sCtx.drawImage(
        applyChromaKey(state.frameCanvases[frameIdx]),
        trimRect.x,
        trimRect.y,
        trimRect.w,
        trimRect.h,
        dx,
        dy,
        frameWidth,
        frameHeight,
      );

      frameRects.push({
        sourceIndex: frameIdx,
        x: dx,
        y: dy,
        w: frameWidth,
        h: frameHeight,
      });
    });

    return {
      sheet,
      cols,
      rows,
      scale,
      frameWidth,
      frameHeight,
      trimRect,
      frameRects,
    };
  }

  function buildAtlasMetadata(bundle: any, imageRef: string, activeIndices: number[]) {
    return buildAtlasJson({
      format: 'texturepacker_hash',
      imageFile: imageRef,
      activeIndices,
      cols: bundle.cols,
      rows: bundle.rows,
      frameWidth: bundle.frameWidth,
      frameHeight: bundle.frameHeight,
      fps: state.fps,
      scale: bundle.scale || state.exportScale,
      sourceWidth: state.width,
      sourceHeight: state.height,
      trimRect: bundle.trimRect,
    });
  }

  function buildGodotMetadata(bundle: any, imageRef: string) {
    return buildGodotSpriteFramesTres({
      atlasResourcePath: makeResPath(imageRef),
      frameRects: bundle.frameRects,
      fps: state.fps,
      animationName: 'default',
      loop: state.loopMode !== 'once',
    });
  }

  function showPreflightErrors(preflight: any) {
    const errors = Array.isArray(preflight?.errors) ? preflight.errors : [];
    const warnings = Array.isArray(preflight?.warnings) ? preflight.warnings : [];

    if (errors.length) {
      const first = String(errors[0]);
      showToast(`Preflight failed: ${first}`);
      setValidationStatus(`Preflight failed (${errors.length} issue${errors.length === 1 ? '' : 's'})`, 'bad');
    } else if (warnings.length) {
      showToast(`Preflight warnings: ${warnings[0]}`);
      setValidationStatus(`Preflight warnings (${warnings.length})`, 'dim');
    }
  }

  async function runPostSaveValidation() {
    setValidationStatus('Validating manifest + LFS…', 'dim');
    validateWorkflow(state.apiBaseUrl)
      .then((response: any) => {
        const manifestCode = response?.result?.checks?.manifest?.code;
        const lfsCode = response?.result?.checks?.lfs?.code;
        if (response?.ok) {
          setValidationStatus(`Validation passed (manifest=${manifestCode}, lfs=${lfsCode})`, 'ok');
        } else {
          setValidationStatus(`Validation failed (manifest=${manifestCode}, lfs=${lfsCode})`, 'bad');
        }
      })
      .catch((error: any) => {
        setValidationStatus(`Validation error: ${error?.message || String(error)}`, 'bad');
      });
  }

  async function saveSequenceFromUi() {
    if (!ensureFramesLoaded()) return;

    const active = getActiveFrameIndices();
    if (!active.length) {
      showToast('No active frames to export');
      return;
    }

    const sourceName = sanitizeFileName(loadedSourceVideoFile?.name || 'sprite_source.mp4');
    const baseName = sourceName.replace(/\.[a-z0-9]+$/i, '') || 'sprite_sheet';
    const sheetPath = `${baseName}.png`;
    const atlasJsonPath = replaceExtension(sheetPath, '.atlas.json');
    const tresPath = replaceExtension(sheetPath, '.sprite_frames.tres');

    setProcessing(true, 'Preparing bundle…', 10);
    try {
      const sheetBundle = createSheetCanvas(active, {
        scale: Math.max(0.01, Number(state.exportScale) || 1),
      });
      const sheetBlob = await canvasToBlob(sheetBundle.sheet, 'image/png');
      const atlasData = buildAtlasMetadata(sheetBundle, sheetPath, active);
      const tresText = buildGodotMetadata(sheetBundle, sheetPath);

      const manifest = {
        app: 'Sprite Workbench',
        version: 1,
        exported_at: new Date().toISOString(),
        source_file: loadedSourceVideoFile?.name || '',
        frame_count: active.length,
        fps: state.fps,
        sheet: sheetPath,
        atlas: atlasJsonPath,
        godot_tres: tresPath,
      };

      const bundleBlob = await buildZip([
        { name: sheetPath, blob: sheetBlob },
        { name: atlasJsonPath, blob: new Blob([`${JSON.stringify(atlasData, null, 2)}\n`], { type: 'application/json' }) },
        { name: tresPath, blob: new Blob([tresText], { type: 'text/plain' }) },
        { name: 'manifest.json', blob: new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: 'application/json' }) },
      ]);

      setProcessing(true, 'Downloading bundle…', 90);
      downloadBlob(bundleBlob, `${baseName}_bundle.zip`);
      setValidationStatus('Export complete (M1 client-only mode)', 'ok');
      showToast(`Exported ${active.length} frames to ${baseName}_bundle.zip`);
    } finally {
      setProcessing(false, '', 0);
    }
  }

  async function exportGif() {
    const active = getActiveFrameIndices();
    if (!active.length) {
      showToast('No active frames to export');
      return;
    }

    const maxSize = parseInt($('gifMaxSize').value, 10) || 512;
    const ditherMode = $('gifDither').value;

    setProcessing(true, 'Generating GIF…', 0);

    try {
      const { blob, width, height, frameCount } = await encodeGifFromState({
        state,
        activeIndices: active,
        applyChromaKey,
        maxSize,
        ditherMode,
        onProgress: ({ progress, message }: any) => {
          setProcessing(true, message, progress * 100);
        },
      });

      downloadBlob(blob, `animation_${frameCount}f_${state.fps}fps.gif`);
      showToast(`Exported ${frameCount}-frame GIF (${width}×${height})`);
    } finally {
      setProcessing(false, '', 0);
    }
  }

  function resetWorkbench() {
    stopPlayback();

    state.frameCanvases = [];
    state.frameHashes = [];
    state.enabled = [];
    state.frames = [];
    state.currentFrame = 0;
    state.loopDetection = null;
    loadedSourceVideoFile = null;
    loadedSourceVideoPath = '';
    clearKeyedRenderCache();

    state.keyEnabled = false;
    state.eyedropperActive = false;
    $('keyTrack').classList.remove('active');
    previewCanvas.style.cursor = '';

    previewPanel.classList.add('empty-state');
    uploadZone.style.display = '';
    canvasWrap.style.display = 'none';
    $('btnReset').style.display = 'none';
    $('headerRight').style.display = 'none';
    $('statsSection').style.display = 'none';
    $('timingSection').style.display = 'none';
    $('frameRangeSection').style.display = 'none';
    $('displaySection').style.display = 'none';
    $('chromaKeySection').style.display = 'none';
    $('exportSection').style.display = 'none';
    $('emptyInfo').style.display = '';
    $('timelineInfo').style.display = 'none';
    $('timelineActions').style.display = 'none';
    timelineScroll.innerHTML = '<div class="empty-timeline">Upload a video to see frames here</div>';
  }

  async function runAction(message: string, action: () => Promise<any> | any) {
    setProcessing(true, message, 12);
    try {
      await action();
    } catch (error: any) {
      showToast(`Error: ${error?.message || String(error)}`);
    } finally {
      setProcessing(false, '', 0);
    }
  }

  // Event wiring
  $('apiBaseUrl').addEventListener('change', (event: any) => {
    state.apiBaseUrl = normalizeApiBaseUrl(event.target.value);
    event.target.value = state.apiBaseUrl;
    saveSettings();
  });

  $('wfBatchId').addEventListener('input', (event: any) => {
    state.batchId = event.target.value.trim();
    saveSettings();
  });

  $('wfTakeId').addEventListener('input', (event: any) => {
    state.takeId = event.target.value.trim();
    saveSettings();
  });

  $('wfRevision').addEventListener('input', (event: any) => {
    state.revision = Math.max(1, parseInt(event.target.value, 10) || 1);
    event.target.value = state.revision;
    saveSettings();
  });

  $('wfSourceClipPath').addEventListener('input', (event: any) => {
    state.sourceClipPath = event.target.value.trim();
    saveSettings();
  });

  $('btnSequenceRefresh').addEventListener('click', () => {
    runAction('Refreshing queue…', () => refreshSequences(true));
  });

  $('btnSequenceNext').addEventListener('click', () => {
    runAction('Loading next sequence…', () => loadNextSequence());
  });

  $('btnSequenceLoad').addEventListener('click', () => {
    loadSelectedSequenceFromPicker();
  });

  $('seqFilter').addEventListener('input', () => {
    renderSequencePicker();
  });

  $('seqPicker').addEventListener('dblclick', () => {
    loadSelectedSequenceFromPicker();
  });

  $('seqPicker').addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.code === 'Enter') {
      event.preventDefault();
      loadSelectedSequenceFromPicker();
    }
  });

  $('btnSaveSequence').addEventListener('click', () => {
    runAction('Exporting bundle…', () => saveSequenceFromUi());
  });

  $('btnSaveSequenceHeader').addEventListener('click', () => {
    runAction('Exporting bundle…', () => saveSequenceFromUi());
  });

  $('btnUpload').addEventListener('click', () => videoInput.click());
  uploadZone.addEventListener('click', () => videoInput.click());

  videoInput.addEventListener('change', (event: any) => {
    if (event.target.files[0]) loadVideo(event.target.files[0]);
  });

  uploadZone.addEventListener('dragover', (event: DragEvent) => {
    event.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));

  uploadZone.addEventListener('drop', (event: DragEvent) => {
    event.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('video/')) loadVideo(file);
  });

  previewPanel.addEventListener('dragover', (event: DragEvent) => event.preventDefault());
  previewPanel.addEventListener('drop', (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('video/')) loadVideo(file);
  });

  $('btnReset').addEventListener('click', resetWorkbench);

  timelineScroll.addEventListener('wheel', (event: WheelEvent) => {
    if (!state.frameCanvases.length) return;

    const horizontalDelta = event.deltaX;
    const shiftDelta = event.shiftKey ? event.deltaY : 0;
    const motion = Math.abs(horizontalDelta) >= Math.abs(shiftDelta) ? horizontalDelta : shiftDelta;
    if (Math.abs(motion) < 0.5) return;

    event.preventDefault();
    timelineWheelAccum += motion;

    const threshold = 36;
    while (Math.abs(timelineWheelAccum) >= threshold) {
      const direction = timelineWheelAccum > 0 ? 1 : -1;
      stepFrame(direction);
      timelineWheelAccum -= direction * threshold;
    }
  }, { passive: false });

  timelineScroll.addEventListener('mouseleave', () => {
    timelineWheelAccum = 0;
  });

  $('fpsInput').addEventListener('input', (event: any) => {
    state.fps = Math.max(1, parseInt(event.target.value, 10) || 12);
    $('fpsSlider').value = state.fps;
    updateStats();
    saveSettings();
  });

  $('fpsSlider').addEventListener('input', (event: any) => {
    state.fps = Math.max(1, parseInt(event.target.value, 10) || 12);
    $('fpsInput').value = state.fps;
    updateStats();
    saveSettings();
  });

  $('loopMode').addEventListener('change', (event: any) => {
    state.loopMode = event.target.value;
    updateStats();
    saveSettings();
  });

  $('btnPlay').addEventListener('click', togglePlayback);
  $('btnPrev').addEventListener('click', () => stepFrame(-1));
  $('btnNext').addEventListener('click', () => stepFrame(1));

  $('startFrame').addEventListener('input', (event: any) => {
    state.startFrame = Math.max(0, parseInt(event.target.value, 10) || 0);
    if (state.startFrame > state.endFrame) {
      state.endFrame = state.startFrame;
      $('endFrame').value = state.endFrame;
    }
    updateStats();
  });

  $('endFrame').addEventListener('input', (event: any) => {
    state.endFrame = Math.max(0, parseInt(event.target.value, 10) || 0);
    if (state.endFrame < state.startFrame) {
      state.startFrame = state.endFrame;
      $('startFrame').value = state.startFrame;
    }
    updateStats();
  });

  $('skipFrames').addEventListener('input', (event: any) => {
    state.skipFrames = Math.max(0, parseInt(event.target.value, 10) || 0);
    updateStats();
  });

  $('onionToggle').addEventListener('click', () => {
    state.onionSkin = !state.onionSkin;
    $('onionTrack').classList.toggle('active', state.onionSkin);
    renderFrame(state.currentFrame);
  });

  $('keyToggle').addEventListener('click', () => {
    state.keyEnabled = !state.keyEnabled;
    $('keyTrack').classList.toggle('active', state.keyEnabled);
    refreshKeyedRenderCache();
    renderFrame(state.currentFrame);
  });

  function hexToRgb(hex: string) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  }

  function rgbToHex(r: number, g: number, b: number) {
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  }

  $('keyColor').addEventListener('input', (event: any) => {
    const hex = event.target.value;
    state.keyColor = hexToRgb(hex);
    $('keyColorPreview').style.background = hex;
    refreshKeyedRenderCache();
    if (state.keyEnabled) renderFrame(state.currentFrame);
  });

  $('keyTolerance').addEventListener('input', (event: any) => {
    state.keyTolerance = parseInt(event.target.value, 10) || 0;
    $('keyToleranceSlider').value = state.keyTolerance;
    refreshKeyedRenderCache();
    if (state.keyEnabled) renderFrame(state.currentFrame);
    saveSettings();
  });

  $('keyToleranceSlider').addEventListener('input', (event: any) => {
    state.keyTolerance = parseInt(event.target.value, 10) || 0;
    $('keyTolerance').value = state.keyTolerance;
    refreshKeyedRenderCache();
    if (state.keyEnabled) renderFrame(state.currentFrame);
    saveSettings();
  });

  $('keySoftness').addEventListener('input', (event: any) => {
    state.keySoftness = parseInt(event.target.value, 10) || 0;
    $('keySoftnessSlider').value = state.keySoftness;
    refreshKeyedRenderCache();
    if (state.keyEnabled) renderFrame(state.currentFrame);
    saveSettings();
  });

  $('keySoftnessSlider').addEventListener('input', (event: any) => {
    state.keySoftness = parseInt(event.target.value, 10) || 0;
    $('keySoftness').value = state.keySoftness;
    refreshKeyedRenderCache();
    if (state.keyEnabled) renderFrame(state.currentFrame);
    saveSettings();
  });

  $('keyDespill').addEventListener('input', (event: any) => {
    state.keyDespill = parseInt(event.target.value, 10) || 0;
    $('keyDespillSlider').value = state.keyDespill;
    refreshKeyedRenderCache();
    if (state.keyEnabled) renderFrame(state.currentFrame);
    saveSettings();
  });

  $('keyDespillSlider').addEventListener('input', (event: any) => {
    state.keyDespill = parseInt(event.target.value, 10) || 0;
    $('keyDespill').value = state.keyDespill;
    refreshKeyedRenderCache();
    if (state.keyEnabled) renderFrame(state.currentFrame);
    saveSettings();
  });

  $('btnEyedropper').addEventListener('click', () => {
    state.eyedropperActive = !state.eyedropperActive;
    $('btnEyedropper').classList.toggle('btn-accent', state.eyedropperActive);
    previewCanvas.style.cursor = state.eyedropperActive ? 'crosshair' : '';
  });

  previewCanvas.addEventListener('click', (event: MouseEvent) => {
    if (!state.eyedropperActive || !state.frameCanvases.length) return;

    const rect = previewCanvas.getBoundingClientRect();
    const scaleX = previewCanvas.width / rect.width;
    const scaleY = previewCanvas.height / rect.height;

    const x = Math.floor((event.clientX - rect.left) * scaleX);
    const y = Math.floor((event.clientY - rect.top) * scaleY);

    const src = state.frameCanvases[state.currentFrame];
    const srcCtx = src.getContext('2d', { willReadFrequently: true })!;
    const pixel = srcCtx.getImageData(x, y, 1, 1).data;

    state.keyColor = [pixel[0], pixel[1], pixel[2]];
    const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
    $('keyColor').value = hex;
    $('keyColorPreview').style.background = hex;

    state.eyedropperActive = false;
    $('btnEyedropper').classList.remove('btn-accent');
    previewCanvas.style.cursor = '';

    if (!state.keyEnabled) {
      state.keyEnabled = true;
      $('keyTrack').classList.add('active');
    }

    refreshKeyedRenderCache();
    renderFrame(state.currentFrame);
    showToast(`Key color: rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`);
  });

  document.querySelectorAll('.bg-color-swatch').forEach((swatch: any) => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.bg-color-swatch').forEach((node: any) => node.classList.remove('active'));
      swatch.classList.add('active');

      const bg = swatch.dataset.bg;
      state.bgMode = bg === 'custom' ? 'custom' : bg;
      saveSettings();
      renderFrame(state.currentFrame);
    });
  });

  $('customBgColor').addEventListener('input', (event: any) => {
    state.bgColor = event.target.value;
    event.target.parentElement.style.background = event.target.value;
    saveSettings();
    if (state.bgMode === 'custom') renderFrame(state.currentFrame);
  });

  $('sheetCols').addEventListener('input', (event: any) => {
    state.sheetCols = Math.max(1, parseInt(event.target.value, 10) || 8);
    saveSettings();
  });

  $('exportScale').addEventListener('input', (event: any) => {
    state.exportScale = Math.max(1, parseInt(event.target.value, 10) || 1);
    saveSettings();
  });

  $('trimAlphaBounds').addEventListener('change', (event: any) => {
    state.trimAlphaBounds = event.target.checked;
    saveSettings();
  });

  $('trimPadding').addEventListener('input', (event: any) => {
    state.trimPadding = Math.max(0, Math.min(32, parseInt(event.target.value, 10) || 0));
    event.target.value = state.trimPadding;
    saveSettings();
  });

  $('btnExportGif').addEventListener('click', exportGif);

  $('btnSelectAll').addEventListener('click', () => {
    state.enabled.fill(true);
    timelineScroll.querySelectorAll('.frame-thumb').forEach((el: any) => el.classList.remove('disabled'));
    updateStats();
    showToast('All frames enabled');
  });

  $('btnTrimToRange').addEventListener('click', () => {
    for (let i = 0; i < state.enabled.length; i++) {
      if (i < state.startFrame || i > state.endFrame) state.enabled[i] = false;
    }

    timelineScroll.querySelectorAll('.frame-thumb').forEach((el: any, i: number) => {
      el.classList.toggle('disabled', !state.enabled[i]);
    });

    updateStats();
    showToast(`Trimmed to frames ${state.startFrame}-${state.endFrame}`);
  });

  window.addEventListener('resize', () => {
    if (state.frameCanvases.length) updateTimelinePadding();
  });

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if ((event.target as HTMLElement)?.tagName === 'INPUT' || (event.target as HTMLElement)?.tagName === 'SELECT') return;

    if (event.code === 'Escape') {
      if (state.eyedropperActive) {
        state.eyedropperActive = false;
        $('btnEyedropper').classList.remove('btn-accent');
        previewCanvas.style.cursor = '';
      }
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      togglePlayback();
    } else if (event.code === 'ArrowLeft') {
      event.preventDefault();
      stepFrame(-1);
    } else if (event.code === 'ArrowRight') {
      event.preventDefault();
      stepFrame(1);
    } else if (event.code === 'KeyI') {
      event.preventDefault();
      state.startFrame = state.currentFrame;
      $('startFrame').value = state.startFrame;
      if (state.startFrame > state.endFrame) {
        state.endFrame = state.startFrame;
        $('endFrame').value = state.endFrame;
      }
      updateStats();
      showToast(`In set to frame ${state.startFrame}`);
    } else if (event.code === 'KeyO') {
      event.preventDefault();
      state.endFrame = state.currentFrame;
      $('endFrame').value = state.endFrame;
      if (state.endFrame < state.startFrame) {
        state.startFrame = state.endFrame;
        $('startFrame').value = state.startFrame;
      }
      updateStats();
      showToast(`Out set to frame ${state.endFrame}`);
    } else if (event.code === 'KeyD') {
      event.preventDefault();
      const i = state.currentFrame;
      state.enabled[i] = !state.enabled[i];
      const el = timelineScroll.children[i] as HTMLElement;
      if (el) el.classList.toggle('disabled', !state.enabled[i]);
      updateStats();
      if (!state.enabled[i]) advanceFromDisabled(i);
    }
  });

  // Boot
  loadSettings();
  applySettingsToControls();
  updateStats();
  setValidationStatus('Client-only mode (M1)', 'ok');

  if (state.bgMode !== 'transparent') {
    const match = [...document.querySelectorAll('.bg-color-swatch')].find((swatch: any) => swatch.dataset.bg === state.bgMode);
    if (match) {
      document.querySelectorAll('.bg-color-swatch').forEach((swatch: any) => swatch.classList.remove('active'));
      (match as any).classList.add('active');
    }
  }

}
