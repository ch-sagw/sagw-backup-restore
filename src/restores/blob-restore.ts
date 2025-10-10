/**
 * Requires the following env-variables:
 * - OVH_OS_ACCESS_PUBLIC_KEY
 * - OVH_OS_ACCESS_PRIVATE_KEY
 * - OVH_OS_IMAGES_BACKUP_CONTAINER_ENDPOINT
 * - BLOB_READ_WRITE_TOKEN
 */

import chalk from 'chalk';
import * as blobHelpers from '@/helpers/blob';
import { S3Helper } from '@/helpers/s3';
import config from '@/config';
import {
  inquirerAskBucketToRestore,
  inquirerAskForProceed,
} from '@/helpers/inquirer';

const main = async (): Promise<void> => {
  try {

    if (process.env.CI) {
      if (!process.env.DB_RESTORE_BUCKET_SELECTION_FROM_GITHUB) {
        throw new Error('env var DB_RESTORE_BUCKET_SELECTION_FROM_GITHUB not defined. Aborting.');
      }
    }

    if (!process.env.CI) {
      const proceedMessage = `Restore blob storage from S3 to Vercel. ${chalk.red('This is a destructive process. All data from Vercel Blob will be deleted in order to restore the data from the S3 Backup')}`;
      const proceed = await inquirerAskForProceed(proceedMessage);

      if (!proceed) {
        throw new Error('User aborted.');
      }
    }

    const s3Helper = new S3Helper();
    const sortedBlockBuckets = await s3Helper.getBucketsWithPrefixSorted(config.blobBackupBucketPrefix);

    if (!sortedBlockBuckets || sortedBlockBuckets.length < 1) {
      throw new Error('no backups found to restore');
    }

    let selectedBucket;

    if (process.env.CI) {
      selectedBucket = process.env.DB_RESTORE_BUCKET_SELECTION_FROM_GITHUB;
    } else {
      selectedBucket = await inquirerAskBucketToRestore(sortedBlockBuckets);
    }

    if (!selectedBucket) {
      throw new Error('No bucket selection. Aborting.');
    }

    const allObjectsInBucket = await s3Helper.listObjectsOfBucket(selectedBucket);
    const allBlobs = await blobHelpers.getAllBlobs();

    if (!process.env.CI) {
      const finalConfirmationMessage = `I am about to delete ${chalk.red(allBlobs.length)} objects in Vercel Blob and restore ${chalk.green(allObjectsInBucket.length)} objects from S3 Bucket named ${chalk.green(selectedBucket)} to Vercel blob. Are you sure you want to continue?`;
      const finalConfirmation = await inquirerAskForProceed(finalConfirmationMessage);

      if (!finalConfirmation) {
        console.log('aborting');

        return;
      }
    }

    await blobHelpers.deleteAllBlobs();

    await Promise.all(allObjectsInBucket.map(async (object) => {
      if (object) {
        const objectData = await s3Helper.getObject(selectedBucket, object, true);

        if (!objectData) {
          throw new Error(`Fatal: was not able to get object with the specified name: ${object}`);
        }

        const buf = Buffer.from(objectData, 'base64');

        await blobHelpers.addBlob(object, buf);
      }
    }));

    // integrity check: check if all data was restored
    const newBlobs = await blobHelpers.getAllBlobs();

    if (newBlobs.length !== allObjectsInBucket.length) {
      throw new Error('Integrity fail: it seems that not all objects from S3 were restored to Vercel blob.');
    }

    console.log(chalk.bgGreen('-->> Restore done: OVH S3 to Vercel blob data'));

  } catch (error) {
    console.log(chalk.bgRed(error));
  }
};

/* eslint-disable @typescript-eslint/no-floating-promises */
main();
/* eslint-enable @typescript-eslint/no-floating-promises */
