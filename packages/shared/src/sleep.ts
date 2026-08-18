/**
 * Resolves after the given number of milliseconds have elapsed.
 *
 * @param ms - Number of milliseconds to wait before resolving.
 * @returns A promise that resolves with no value once the delay has passed.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
