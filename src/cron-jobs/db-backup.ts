/**
 * Requires the following env-variables:
 * - DATABASE_NAME
 * - DATABASE_URI
 * - OVH_OS_ACCESS_PUBLIC_KEY
 * - OVH_OS_ACCESS_PRIVATE_KEY
 * - OVH_OS_IMAGES_BACKUP_CONTAINER_ENDPOINT
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { S3Helper } from '@/helpers/s3';
import { dateString } from '@/helpers/date';
import config from '@/config';
import { getErrorMessage } from '@/helpers/try-catch-error';
import sendSlackMessage from '@/helpers/slack';
import { exec } from '@/helpers/promisifyExec';

dotenv.config({
  quiet: true,
});

const main = async (): Promise<void> => {
  try {
    if (!process.env.DATABASE_URI) {
      throw new Error('Aborting. DATABASE_URI is not defined in env.');
    }

    const s3Helper = new S3Helper();
    const bucketName = `${dateString()}-${config.dbBackupBucketPrefix}`;

    if (!fs.existsSync(config.dbBackupTmpDir)) {
      fs.mkdirSync(config.dbBackupTmpDir);
    }

    /* eslint-disable @typescript-eslint/naming-convention */
    const __dirname = path.resolve(config.dbBackupTmpDir);
    /* eslint-enable @typescript-eslint/naming-convention */
    const dumpPath = path.resolve(__dirname, bucketName);

    await s3Helper.createBucket(bucketName);

    // create mongodump (binary)
    const command = `mongodump --uri '${process.env.DATABASE_URI}' --gzip --archive=${dumpPath}`;

    await exec(command);

    // save dump to S3
    const readStream = fs.createReadStream(dumpPath);

    const params = {
      Body: readStream,
      Bucket: bucketName,
      Key: config.dbBackupName,
    };

    await s3Helper.addObject(params);

    const mailMessage = 'Successfully backed up collections from MongoDb to OVH S3';

    await sendSlackMessage([
      ':large_green_circle: *DB Backup done*',
      mailMessage,
      `Backup name: ${bucketName}`,
    ], false);

    console.log(`db-backup: ${mailMessage}`);

  } catch (error) {
    await sendSlackMessage([':warning: *Backup failure!* MongoDB to OVH S3'], true);

    throw new Error(getErrorMessage(error));
  }
};

/* eslint-disable @typescript-eslint/no-floating-promises */
main();
/* eslint-enable @typescript-eslint/no-floating-promises */
