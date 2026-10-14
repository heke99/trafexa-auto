/**
 * Ported from DocuSeal validate_signature.js, commit
 * 3c65b0e4ba872fe71d5566c0d09c3ace59a7fb8a, blob
 * bcdb2891c67c04a4bff7903dae6d8a7295b44458:
 * https://github.com/docusealco/docuseal/blob/3c65b0e4ba872fe71d5566c0d09c3ace59a7fb8a/app/javascript/submission_form/validate_signature.js
 * Keeps its deviation threshold and first-two-straight-strokes rule. Intentional
 * hardening bounds untrusted samples, rejects non-finite/identical points and
 * uses radial deviation for closed loops instead of accepting upstream NaN.
 * This is a local drawing check, never evidence of signing or identity.
 */
export type SignaturePoint = { x: number; y: number };
export type SignatureStroke = { points: SignaturePoint[] };
export const MAX_SIGNATURE_STROKES = 256;
export const MAX_SIGNATURE_POINTS_PER_STROKE = 4096;
export const MAX_SIGNATURE_POINTS = 16384;
export const MAX_SIGNATURE_COORDINATE = 1000000;

function coordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_SIGNATURE_COORDINATE;
}

/** Accepts signature-pad stroke data; unrelated color/time/pressure fields are not interpreted. */
export function isValidSignatureCanvas(data: unknown): boolean {
  try {
    if (!Array.isArray(data)) return false;
    const strokeCount = data.length;
    if (!Number.isInteger(strokeCount) || strokeCount < 1 || strokeCount > MAX_SIGNATURE_STROKES) return false;
    const strokes: SignatureStroke[] = []; let totalPoints = 0;
    for (let strokeIndex = 0; strokeIndex < strokeCount; strokeIndex++) {
      const stroke = data[strokeIndex];
      if (!stroke || typeof stroke !== 'object' || !Array.isArray(stroke.points)) return false;
      const count = stroke.points.length;
      if (!Number.isInteger(count) || count < 0 || count > MAX_SIGNATURE_POINTS_PER_STROKE || (totalPoints += count) > MAX_SIGNATURE_POINTS) return false;
      const points: SignaturePoint[] = [];
      for (let index = 0; index < count; index++) {
        const point = stroke.points[index];
        if (!point || typeof point !== 'object') return false;
        const x: unknown = point.x, y: unknown = point.y;
        if (!coordinate(x) || !coordinate(y)) return false;
        points.push({ x, y });
      }
      if (count > 2) strokes.push({ points });
    }
    if (strokes.length === 0) return false;
    let skippedStraightLine = 0, valid = false;
    for (const { points } of strokes) {
      const first = points[0], last = points[points.length - 1];
      const A = last.y - first.y, B = first.x - last.x;
      const C = last.x * first.y - first.x * last.y;
      const lineLength = Math.hypot(A, B);
      if (lineLength === 0) {
        // A repeated click has zero radial spread. An actual loop has meaningful
        // displacement even though its first and last points are identical.
        const radialDeviation = points.reduce((sum, point) => sum + Math.hypot(point.x - first.x, point.y - first.y), 0) / points.length;
        if (radialDeviation >= 3) valid = true;
        continue;
      }
      const totalDeviation = points.reduce((sum, point) => sum + Math.abs(A * point.x + B * point.y + C) / lineLength, 0);
      const avgDeviation = totalDeviation / points.length;
      if (avgDeviation < 3 && skippedStraightLine < 2) { skippedStraightLine++; continue; }
      valid = true;
    }
    return valid;
  } catch { return false; }
}

/** Client-safe probe: document is accessed only when called, so SSR imports are safe. */
export function isCanvasBlocked(documentRef?: Pick<Document, 'createElement'>): boolean {
  try {
    const source = documentRef ?? (typeof document === 'undefined' ? null : document);
    if (!source) return true;
    const testCanvas = source.createElement('canvas');
    testCanvas.width = 2; testCanvas.height = 2;
    const ctx = testCanvas.getContext('2d');
    if (!ctx) return true;
    ctx.fillStyle = 'rgb(255, 0, 0)'; ctx.fillRect(0, 0, 2, 2);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    return pixel[0] !== 255 || pixel[1] !== 0 || pixel[2] !== 0 || pixel[3] !== 255;
  } catch { return true; }
}
