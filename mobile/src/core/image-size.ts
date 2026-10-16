// Images have no bitrate to aim for, so find the best quality that fits under a
// target size by encoding a few times (binary search over quality 1-100).
// Same approach as the desktop app's src/core/image-size.js.

export const IMAGE_SEARCH_STEPS = 7; // binary search over 1-100 settles within 7 tries

/**
 * encode(q, step) encodes at quality q and resolves to the file size in bytes.
 * Resolves to the best quality whose size is <= limitBytes.
 */
export async function bestImageQuality(
  limitBytes: number,
  encode: (quality: number, step: number) => Promise<number>
): Promise<number> {
  if (!(limitBytes > 0)) throw new Error('Enter a target size greater than 0 MB.');
  const tried = new Map<number, number>();
  const tryQ = async (q: number, step: number) => {
    const size = await encode(q, step);
    tried.set(q, size);
    return size;
  };
  let lo = 1;
  let hi = 100;
  let best: number | null = null;
  for (let step = 0; step < IMAGE_SEARCH_STEPS && lo <= hi; step++) {
    const q = Math.floor((lo + hi) / 2);
    if ((await tryQ(q, step)) <= limitBytes) {
      best = q;
      lo = q + 1;
    } else {
      hi = q - 1;
    }
  }
  if (best === null && (tried.get(1) ?? (await tryQ(1, IMAGE_SEARCH_STEPS - 1))) <= limitBytes) best = 1;
  if (best === null) {
    throw new Error(
      `Even the lowest quality is ${((tried.get(1) || 0) / 1024 / 1024).toFixed(2)} MB. ` +
        'Make the image smaller with Resolution, or pick a larger target.'
    );
  }
  return best;
}
