import chalk from 'chalk';
import dotenv from 'dotenv';
import { DbHelper } from '@/helpers/db';
import { inquirerAskForProceed } from '@/helpers/inquirer';
import { getErrorMessage } from '@/helpers/try-catch-error';
import {
  addBlob,
  deleteAllBlobs,
  getAllBlobs,
} from '@/helpers/blob';
import { exec } from '@/helpers/promisifyExec';
import fs from 'fs';
import path from 'path';
import config from '@/config';

const dbDump = async (): Promise<void> => {
  if (!fs.existsSync(config.dbBackupTmpDir)) {
    fs.mkdirSync(config.dbBackupTmpDir);
  }

  /* eslint-disable @typescript-eslint/naming-convention */
  const __dirname = path.resolve(config.dbBackupTmpDir);
  /* eslint-enable @typescript-eslint/naming-convention */
  const dumpPath = path.resolve(__dirname, config.dbBackupName);
  const command = `mongodump --uri '${process.env.DATABASE_URI}' --gzip --archive=${dumpPath}`;

  await exec(command);
};

const replicateDb = async (replicateTo: string): Promise<void> => {

  // ensure we start with prod env
  dotenv.config({
    override: true,
    path: '.env/.env.prod',
    quiet: true,
  });

  const prodUrl = process.env.DATABASE_URI;
  const prodDbName = process.env.DATABASE_NAME;

  // switch to other env
  dotenv.config({
    override: true,
    path: `.env/.env.${replicateTo}`,
    quiet: true,
  });

  const currentUrl = process.env.DATABASE_URI;
  const currentDbName = process.env.DATABASE_NAME;

  if (prodUrl === currentUrl) {
    throw new Error('Env-Var mismatch for DATABASE_URI. Aborting.');
  }

  if (!currentDbName) {
    throw new Error('Target DB Name is not defined in Env. Aborting.');
  }

  const dbHelperTarget = new DbHelper();

  try {
    /* eslint-disable @typescript-eslint/naming-convention */
    const __dirname = path.resolve(config.dbBackupTmpDir);
    /* eslint-enable @typescript-eslint/naming-convention */
    const dumpPath = path.resolve(__dirname, config.dbBackupName);

    await dbHelperTarget.deleteAllCollections(currentDbName);

    const command = `mongorestore --uri '${currentUrl}' --gzip --archive=${dumpPath} --nsFrom='${prodDbName}.*' --nsTo='${currentDbName}.*' --nsInclude='${prodDbName}.*'`;

    await exec(command);

    console.log(chalk.bgGreen(`-->> Successfully restored collections from Prod to ${replicateTo}`));

  } catch (err) {
    console.log(chalk.bgRed('Error in DB replication.'));
    throw new Error(getErrorMessage(err));
  } finally {
    await dbHelperTarget?.getClient()
      ?.close();
  }
};

const replicateBlob = async (replicateTo: string): Promise<void> => {
  try {

    // ensure we start with prod env
    dotenv.config({
      override: true,
      path: '.env/.env.prod',
      quiet: true,
    });

    const prodToken = process.env.BLOB_READ_WRITE_TOKEN;

    const blobsProd = await getAllBlobs();

    // switch to other env
    dotenv.config({
      override: true,
      path: `.env/.env.${replicateTo}`,
      quiet: true,
    });

    const otherEnvToken = process.env.BLOB_READ_WRITE_TOKEN;

    if (prodToken === otherEnvToken) {
      throw new Error('Env-Var mismatch for BLOB_READ_WRITE_TOKEN. Aborting.');
    }

    await deleteAllBlobs();

    let blobCounter = 0;

    await Promise.all(blobsProd.map(async (blob) => {
      if (blob) {
        const res = await fetch(blob.url);

        if (res.body) {
          await addBlob(blob.pathname, res.body);

          blobCounter++;
        }
      }
    }));

    console.log(chalk.bgGreen(`-->> Successfully restored ${blobCounter} blobs from Prod to ${replicateTo}`));

  } catch (err) {
    console.log(chalk.bgRed('Error in Blob replication.'));
    throw new Error(getErrorMessage(err));
  }

};

const main = async (): Promise<void> => {
  let dbHelperSource;

  try {
    // Grab DATABASE_URI and BLOB_READ_WRITE_TOKEN from all environments
    // to make some configuration checks upfront.
    dotenv.config({
      override: true,
      path: '.env/.env.local',
      quiet: true,
    });

    const localDBUri = process.env.DATABASE_URI;
    const localBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

    dotenv.config({
      override: true,
      path: '.env/.env.test',
      quiet: true,
    });

    const testDBUri = process.env.DATABASE_URI;
    const testBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

    dotenv.config({
      override: true,
      path: '.env/.env.prod',
      quiet: true,
    });

    const prodDBUri = process.env.DATABASE_URI;
    const prodBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
    const prodDbName = process.env.DATABASE_NAME;

    // Security checks. Make sure that local, test and prod have
    // different values for the env-vars.

    if (!prodDbName) {
      throw new Error('Env-Var DATABASE_NAME missing in prod environment.');
    }

    if (!localDBUri || !testDBUri || !prodDBUri) {
      throw new Error('Env-Var DATABASE_URI missing in one or more environments.');
    }

    if (!testBlobToken || !localBlobToken || !prodBlobToken) {
      throw new Error('Env-Var BLOB_READ_WRITE_TOKEN missing in one or more environments.');
    }

    if (
      localDBUri === testDBUri ||
      testDBUri === prodDBUri ||
      localDBUri === prodDBUri
    ) {
      throw new Error('Env-Var mismatch for for DATABASE_URI. Aborting.');
    }

    if (
      testBlobToken === prodBlobToken ||
      localBlobToken === prodBlobToken
    ) {
      throw new Error('Env-Var mismatch for for BLOB_READ_WRITE_TOKEN. Aborting.');
    }

    dbHelperSource = new DbHelper();

    if (!process.env.CI) {
      const askForProceed = await inquirerAskForProceed('I will erase all collections in the local DB, and replicate the collections from Prod to the Local  DB. Are you sure you want to continue?');

      if (!askForProceed) {
        throw new Error('Aborting.');
      }

      const askForProceed2 = await inquirerAskForProceed('I will delete all Blob data on Local and replicate all Blobs from Prod to Test. Are you sure you want to continue?');

      if (!askForProceed2) {
        throw new Error('Aborting.');
      }
    }

    // create db dump to local system
    await dbDump();

    // replicate
    if (process.env.CI) {
      await replicateDb('test');
    } else {
      await replicateDb('local');
    }

    if (process.env.CI) {
      await replicateBlob('test');
    } else {
      await replicateBlob('local');
    }

  } catch (err) {
    console.log(chalk.bgRed(err));
  } finally {
    await dbHelperSource?.getClient()
      ?.close();
  }
};

/* eslint-disable @typescript-eslint/no-floating-promises */
main();
/* eslint-enable @typescript-eslint/no-floating-promises */

