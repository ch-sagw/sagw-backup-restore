/**
 * The backup started to fail because backup:blob uploads every Vercel blob to
 * OVH S3 in parallel via Promise.all. With over 400 blobs, that saturated the
 * AWS SDK’s 50-connection pool and caused ETIMEDOUT to OVH. Therefore, we issue
 * the S3 operations in batches of DEFAULT_CONCURRENCY (10 per iteration).
 */

export const DEFAULT_CONCURRENCY = 10;

export const mapWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> => {
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const promise = fn(item)
      .finally(() => {
        executing.delete(promise);
      });

    executing.add(promise);

    if (executing.size >= concurrency) {
      /* eslint-disable no-await-in-loop */
      await Promise.race(executing);
      /* eslint-enable no-await-in-loop */
    }
  }

  await Promise.all(executing);
};
