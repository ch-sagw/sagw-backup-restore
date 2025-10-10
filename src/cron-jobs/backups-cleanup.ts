/**
 * Requires the following env-variables:
 * - OVH_OS_ACCESS_PUBLIC_KEY
 * - OVH_OS_ACCESS_PRIVATE_KEY
 * - OVH_OS_IMAGES_BACKUP_CONTAINER_ENDPOINT
 */

import type { Bucket } from '@aws-sdk/client-s3';
import { S3Helper } from '@/helpers/s3';
import config from '@/config';
import { getErrorMessage } from '@/helpers/try-catch-error';
import sendSlackMessage from '@/helpers/slack';

const cleanUpBucketsWithPrefix = async (prefix: string, s3Helper: S3Helper): Promise<[string?]> => {

  const bucketsSorted = await s3Helper.getBucketsWithPrefixSorted(prefix);
  const bucketsToDelete = JSON.parse(JSON.stringify(bucketsSorted))
    .splice(config.keepAmountOfBackups, bucketsSorted.length - config.keepAmountOfBackups);

  const promises = [];

  for (const bucketToDelete of bucketsToDelete) {
    promises.push(s3Helper.deleteBucket(bucketToDelete));
  }

  await Promise.all(promises);

  if (bucketsToDelete.length === 0) {
    return [];
  }

  return bucketsToDelete.map((bucket: Bucket) => bucket);
};

const main = async (): Promise<void> => {
  try {
    const s3Helper = new S3Helper();

    const deletedBlobBuckets = await cleanUpBucketsWithPrefix(config.blobBackupBucketPrefix, s3Helper);
    const deletedDbBuckets = await cleanUpBucketsWithPrefix(config.dbBackupBucketPrefix, s3Helper);

    const mailMessage = `Deleted ${deletedBlobBuckets.length} blob buckets and ${deletedDbBuckets.length} db buckets.\n\nDeleted blob buckets: \n- ${deletedBlobBuckets.join('\n- ')}\n\nDeleted db buckets: \n- ${deletedDbBuckets.join('\n- ')}`;

    await sendSlackMessage([
      ':large_green_circle: *Backups cleanup done*',
      'Successfully cleaned up DB & Blob Backups.',
      mailMessage,
    ], false);

    console.log(`backups-cleanup: ${mailMessage}`);

  } catch (error) {
    await sendSlackMessage([':warning: *Backups cleanup failure!*'], true);

    throw new Error(getErrorMessage(error));
  }
};

/* eslint-disable @typescript-eslint/no-floating-promises */
main();
/* eslint-enable @typescript-eslint/no-floating-promises */

