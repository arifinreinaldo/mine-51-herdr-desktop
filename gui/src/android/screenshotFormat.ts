// Pure helpers for the screenshot panel (`ui/screenshotPanel.ts`).

const pad = (n: number): string => String(n).padStart(2, "0");

/** "screenshot-YYYYMMDD-HHMMSS.png" in local time. */
export function screenshotFileName(date: Date): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `screenshot-${day}-${time}.png`;
}

/** True when the mean of (r+g+b)/3 over all pixels is below `threshold` (0-255). Alpha is ignored. An empty array is not black. */
export function isBlackFrame(rgba: Uint8ClampedArray, threshold = 3): boolean {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return false;
  let sum = 0;
  for (let i = 0; i < pixels * 4; i += 4) sum += (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
  return sum / pixels < threshold;
}
