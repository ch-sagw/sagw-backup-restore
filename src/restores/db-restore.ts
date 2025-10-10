/**
 * Requires the following env-variables:
 * - DATABASE_NAME
 * - DATABASE_URI
 * - OVH_OS_ACCESS_PUBLIC_KEY
 * - OVH_OS_ACCESS_PRIVATE_KEY
 * - OVH_OS_IMAGES_BACKUP_CONTAINER_ENDPOINT
 */

import chalk from 'chalk';
import dotenv from 'dotenv';
import { S3Helper } from '@/helpers/s3';
import config from '@/config';
import {
  inquirerAskBucketToRestore,
  inquirerAskForProceed,
} from '@/helpers/inquirer';
import { DbHelper } from '@/helpers/db';
import fs from 'fs';
import { exec } from '@/helpers/promisifyExec';

dotenv.config({
  quiet: true,
});

const main = async (): Promise<void> => {
  const dbHelper = new DbHelper();

  try {
    const proceedMessage = `Restore DB from S3 to OVH. ${chalk.red('This is a destructive process. Collections from the backup will overwrite the existing collections in MongoDB.')}`;
    const proceed = await inquirerAskForProceed(proceedMessage);

    if (!proceed) {
      throw new Error('User aborted.');
    }

    const s3Helper = new S3Helper();
    const sortedBuckets = await s3Helper.getBucketsWithPrefixSorted(config.dbBackupBucketPrefix);

    if (!sortedBuckets || sortedBuckets.length < 1) {
      throw new Error('no backups found to restore');
    }

    const selectedBucket = await inquirerAskBucketToRestore(sortedBuckets);
    const allObjectsInBucket = await s3Helper.listObjectsOfBucket(selectedBucket);

    const finalConfirmationMessage = `I am about to restore all collections from S3 Bucket named ${chalk.green(selectedBucket)} to MongoDB. Are you sure you want to continue?`;
    const finalConfirmation = await inquirerAskForProceed(finalConfirmationMessage);

    if (!finalConfirmation) {
      console.log('aborting');

      return;
    }

    if (!process.env.DATABASE_URI) {
      console.log('Aborting. DATABASE_URI is not defined in env.');

      return;
    }

    // we expect excatly 1 object in the bucket with the name
    // saved in config.dbBackupName
    if (allObjectsInBucket.length !== 1) {
      console.log('Aborting. There should only be 1 binary file in the backup bucket');

      return;
    }

    const [backupBinaryFileName] = allObjectsInBucket;

    if (backupBinaryFileName && backupBinaryFileName !== config.dbBackupName) {
      console.log(`Aborting. The provided backup name (${backupBinaryFileName}) should be named ${config.dbBackupName}`);

      return;
    }

    // get backup file and download to tmp dir

    const backupBinaryFile = await s3Helper.getObject(selectedBucket, backupBinaryFileName as string, true);

    if (!backupBinaryFile) {
      console.log('Aborting: was not able to get backup object');

      return;
    }

    if (!fs.existsSync(config.dbBackupTmpDir)) {
      fs.mkdirSync(config.dbBackupTmpDir);
    }

    const buf = Buffer.from(backupBinaryFile, 'base64');
    const localPath = `${config.dbBackupTmpDir}/${backupBinaryFileName}`;

    fs.writeFileSync(localPath, buf);

    // delete collections
    if (!process.env.DATABASE_NAME) {
      console.log('Aborting. DATABASE_NAME is not defined in env.');

      return;
    }

    await dbHelper.deleteAllCollections(process.env.DATABASE_NAME);

    // mongorestore

    const command = `mongorestore --uri '${process.env.DATABASE_URI}' --gzip --archive=${localPath}`;

    await exec(command);

    console.log(chalk.bgGreen('-->> Restore done: OVH S3 to MongoDB'));

  } catch (error) {
    console.log(chalk.bgRed(error));
  } finally {
    await dbHelper?.getClient()
      ?.close();
  }
};

/* eslint-disable @typescript-eslint/no-floating-promises */
main();
/* eslint-enable @typescript-eslint/no-floating-promises */
