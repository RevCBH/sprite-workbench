const HASH_BITS = 64;
const DEFAULT_REPEAT_THRESHOLD = 10;
const DEFAULT_DEDUP_THRESHOLD = 2;

function nibblePopcount(v) {
  // 0..15 bit counts
  return [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4][v & 0x0f];
}

export function hammingHexHash(a, b) {
  if (!a || !b || a.length !== b.length) return HASH_BITS;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const va = parseInt(a[i], 16);
    const vb = parseInt(b[i], 16);
    if (Number.isNaN(va) || Number.isNaN(vb)) return HASH_BITS;
    dist += nibblePopcount(va ^ vb);
  }
  return dist;
}

function collapseConsecutiveNearIdentical(hashes, dedupeThreshold) {
  const runs = [];
  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i];
    const prev = runs[runs.length - 1];
    if (!prev) {
      runs.push({ hash, start: i, end: i, count: 1 });
      continue;
    }

    const dist = hammingHexHash(prev.hash, hash);
    if (dist <= dedupeThreshold) {
      prev.end = i;
      prev.count += 1;
      continue;
    }

    runs.push({ hash, start: i, end: i, count: 1 });
  }

  return {
    hashes: runs.map((run) => run.hash),
    runs,
  };
}

function mapReducedPeriodToOriginal(runs, period) {
  if (!runs.length) {
    return { start: 0, end: Math.max(0, period - 1), periodFrames: period };
  }
  const start = runs[0].start;
  const endRun = runs[Math.max(0, period - 1)] || runs[runs.length - 1];
  const end = endRun.end;
  return {
    start,
    end,
    periodFrames: Math.max(1, end - start + 1),
  };
}

function tryDirectRepeat(hashes, threshold) {
  const n = hashes.length;
  let best = null;

  const maxPeriod = Math.floor(n / 2);
  for (let period = 2; period <= maxPeriod; period++) {
    let sum = 0;
    let compareCount = 0;

    for (let i = 0; i < n - period; i++) {
      sum += hammingHexHash(hashes[i], hashes[i + period]);
      compareCount += 1;
    }

    if (compareCount < 4) continue;

    const avg = sum / compareCount;
    if (avg > threshold) continue;

    if (
      !best
      || avg < best.avg - 0.15
      || (Math.abs(avg - best.avg) <= 0.15 && compareCount > best.compareCount)
    ) {
      best = { period, avg, compareCount };
    }
  }

  return best;
}

function autocorrelationFallback(hashes) {
  const n = hashes.length;
  let bestLag = -1;
  let bestScore = Infinity;

  for (let lag = 1; lag <= Math.floor(n / 2); lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += hammingHexHash(hashes[i], hashes[i + lag]);
      count += 1;
    }
    if (count === 0) continue;

    const avg = sum / count;
    if (avg < bestScore) {
      bestScore = avg;
      bestLag = lag;
    }
  }

  if (bestLag < 2) return null;
  const confidence = Math.max(0, Math.min(1, 1 - bestScore / HASH_BITS));
  if (confidence < 0.65) return null;

  return {
    start: 0,
    end: bestLag - 1,
    period: bestLag,
    confidence,
    method: 'autocorrelation',
    score: bestScore,
  };
}

export function detectLoopRange(hashes, options = {}) {
  if (!Array.isArray(hashes) || hashes.length < 4) return null;

  const threshold = options.repeatThreshold ?? DEFAULT_REPEAT_THRESHOLD;
  const dedupeThreshold = options.dedupeThreshold ?? DEFAULT_DEDUP_THRESHOLD;
  const reduced = collapseConsecutiveNearIdentical(hashes, dedupeThreshold);
  const useReduced = reduced.hashes.length >= 4 && reduced.hashes.length < hashes.length;
  const workingHashes = useReduced ? reduced.hashes : hashes;
  const workingRuns = useReduced
    ? reduced.runs
    : hashes.map((hash, index) => ({ hash, start: index, end: index, count: 1 }));

  const direct = tryDirectRepeat(workingHashes, threshold);
  if (direct) {
    const confidence = Math.max(0, Math.min(1, 1 - direct.avg / HASH_BITS));
    const mapped = mapReducedPeriodToOriginal(workingRuns, direct.period);
    return {
      start: mapped.start,
      end: mapped.end,
      period: direct.period,
      periodFrames: mapped.periodFrames,
      confidence,
      method: useReduced ? 'direct-repeat-dedup' : 'direct-repeat',
      score: direct.avg,
    };
  }

  const fallback = autocorrelationFallback(workingHashes);
  if (!fallback) return null;
  const mapped = mapReducedPeriodToOriginal(workingRuns, fallback.period);
  return {
    ...fallback,
    start: mapped.start,
    end: mapped.end,
    periodFrames: mapped.periodFrames,
    method: useReduced ? `${fallback.method}-dedup` : fallback.method,
  };
}

export function formatLoopDetection(loopDetection) {
  if (!loopDetection) return '—';
  const pct = Math.round(loopDetection.confidence * 100);
  return `auto ${loopDetection.start}-${loopDetection.end} (${pct}%)`;
}
