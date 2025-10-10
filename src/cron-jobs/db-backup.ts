/**
 * Requires the following env-variables:
 * - DATABASE_NAME
 * - DATABASE_URI
 * - OVH_OS_ACCESS_PUBLIC_KEY
 * - OVH_OS_ACCESS_PRIVATE_KEY
 * - OVH_OS_IMAGES_BACKUP_CONTAINER_ENDPOINT
 */

import dotenv from 'dotenv';
import { EJSON } from 'bson';
import { S3Helper } from '@/helpers/s3';
import { DbHelper } from '@/helpers/db';
import { dateString } from '@/helpers/date';
import config from '@/config';
import { getErrorMessage } from '@/helpers/try-catch-error';
import sendSlackMessage from '@/helpers/slack';

dotenv.config({
  quiet: true,
});

const main = async (): Promise<void> => {

  const dbHelper = new DbHelper();

  try {
    const s3Helper = new S3Helper();

    const bucketName = `${dateString()}-${config.dbBackupBucketPrefix}`;

    await s3Helper.createBucket(bucketName);

    if (!process.env.DATABASE_NAME) {
      throw new Error('Aborting. DATABASE_NAME is not defined in env.');
    }

    const collections = await dbHelper.getCollections(process.env.DATABASE_NAME);
    let collectionBackupCount = 0;

    if (!collections) {
      throw new Error('Aborting. No collections found in db.');
    }

    for await (const collection of collections) {
      const {
        collectionName,
      } = collection;

      if (!collectionName.startsWith('system.')) {
        const results = await dbHelper.getContentOfCollection(collection);

        if (results.length > 0) {
          collectionBackupCount++;

          const params = {
            Body: EJSON.stringify(results),
            Bucket: bucketName,
            Key: `${collectionName}.json`,
          };

          await s3Helper.addObject(params);
        }
      }
    }

    const mailMessage = `Successfully backed up ${collectionBackupCount} collections from MongoDb to OVH S3`;

    await sendSlackMessage([
      ':large_green_circle: *DB Backup done*',
      mailMessage,
      `Backup name: ${bucketName}`,
    ], false);

    console.log(`db-backup: ${mailMessage}`);

  } catch (error) {
    await sendSlackMessage([':warning: *Backup failure!* MongoDB to OVH S3'], true);

    throw new Error(getErrorMessage(error));
  } finally {
    await dbHelper.getClient()
      ?.close();
  }
};

// export default main;

/* eslint-disable @typescript-eslint/no-floating-promises */
main();
/* eslint-enable @typescript-eslint/no-floating-promises */
