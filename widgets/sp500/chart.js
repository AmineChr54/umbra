// Pure chart math for the S&P 500 widget (no DOM). Documented in the README.
const Chart = (() => {
  /** Pair timestamps with closes and drop gaps (Yahoo sends null for missing candles). */
  function samples(timestamps, closes) {
    const out = [];
    for (let i = 0; i < closes.length; i++) {
      const v = closes[i];
      if (typeof v === "number" && isFinite(v)) out.push({ t: timestamps[i], v });
    }
    return out;
  }

  /** 3-point moving average on interior points; first and last stay exact. */
  function denoise(values) {
    return values.map((v, i, a) => (i === 0 || i === a.length - 1 ? v : (a[i - 1] + v + a[i + 1]) / 3));
  }

  /**
   * Map values to pixel points. The vertical range always includes the reference
   * (previous close) so its line stays inside the chart, plus a little headroom.
   */
  function project(values, ref, w, h, padTop = 6, padBottom = 4) {
    let lo = Math.min(ref, ...values), hi = Math.max(ref, ...values);
    if (hi === lo) { hi += 1; lo -= 1; }
    const span = hi - lo;
    const y = (v) => padTop + (1 - (v - lo) / span) * (h - padTop - padBottom);
    const n = values.length;
    return {
      points: values.map((v, i) => ({ x: n === 1 ? w : (i / (n - 1)) * w, y: y(v) })),
      refY: y(ref),
    };
  }

  /**
   * Catmull-Rom spline through every point, emitted as cubic Bezier segments.
   * For segment P1->P2 with neighbours P0 and P3 the control points are
   *   C1 = P1 + (P2 - P0) / 6,   C2 = P2 - (P3 - P1) / 6
   * Indices are clamped at the ends, so the curve starts and ends on real samples.
   */
  function smoothPath(pts) {
    if (pts.length < 2) return "";
    const p = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
    let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
    }
    return d;
  }

  /** Close the line down to the baseline to get the gradient area. */
  function areaPath(linePath, pts, h) {
    if (!linePath) return "";
    const last = pts[pts.length - 1], first = pts[0];
    return `${linePath} L${last.x.toFixed(2)},${h} L${first.x.toFixed(2)},${h} Z`;
  }

  /** Binary search for the sample whose x is closest to px (points are sorted by x). */
  function nearest(pts, px) {
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].x < px) lo = mid; else hi = mid;
    }
    return Math.abs(pts[lo].x - px) <= Math.abs(pts[hi].x - px) ? lo : hi;
  }

  return { samples, denoise, project, smoothPath, areaPath, nearest };
})();
