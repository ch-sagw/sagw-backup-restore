import chalk from 'chalk';
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
import dotenv from 'dotenv';

type InterfaceReplicationEnvs = 'local' | 'test';

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

const replicateDb = async (replicateTo: InterfaceReplicationEnvs): Promise<void> => {
  const prodUrl = process.env.DATABASE_URI;
  const prodDbName = process.env.DATABASE_NAME;

  let currentUrl = process.env.DATABASE_URI_TEST;
  let currentDbName = process.env.DATABASE_NAME_TEST;

  if (replicateTo === 'local') {
    currentUrl = process.env.DATABASE_URI_LOCAL;
    currentDbName = process.env.DATABASE_NAME_LOCAL;
  }

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

const replicateBlob = async (replicateTo: InterfaceReplicationEnvs): Promise<void> => {
  try {

    const prodToken = process.env.BLOB_READ_WRITE_TOKEN;

    const blobsProd = await getAllBlobs();

    let otherEnvToken = process.env.BLOB_READ_WRITE_TOKEN_TEST;

    if (replicateTo === 'local') {
      otherEnvToken = process.env.BLOB_READ_WRITE_TOKEN_LOCAL;
    }

    if (prodToken === otherEnvToken) {
      throw new Error('Env-Var mismatch for BLOB_READ_WRITE_TOKEN. Aborting.');
    }

    if (!otherEnvToken) {
      throw new Error('BLOB_READ_WRITE_TOKEN for Target env missing. Aborting.');
    }

    // switch blob env to other env
    dotenv.populate(
      process.env as Record<string, string>,
      {
        BLOB_READ_WRITE_TOKEN: otherEnvToken,
      },
      {
        debug: false,
        override: true,
      },
    );

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
    // make some configuration checks upfront.

    const localDBUri = process.env.DATABASE_URI_LOCAL;
    const localBlobToken = process.env.BLOB_READ_WRITE_TOKEN_LOCAL;

    const testDBUri = process.env.DATABASE_URI_TEST;
    const testBlobToken = process.env.BLOB_READ_WRITE_TOKEN_TEST;

    const prodDBUri = process.env.DATABASE_URI;
    const prodBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
    const prodDbName = process.env.DATABASE_NAME;

    // Security checks. Make sure that local, test and prod have
    // different values for the env-vars.

    if (!prodDbName) {
      throw new Error('Env-Var DATABASE_NAME missing in prod environment.');
    }

    if (process.env.CI) {
      if (!testDBUri || !prodDBUri) {
        throw new Error('Env-Var DATABASE_URI missing in one or more environments.');
      }

      if (!testBlobToken || !prodBlobToken) {
        throw new Error('Env-Var BLOB_READ_WRITE_TOKEN missing in one or more environments.');
      }

      if (testDBUri === prodDBUri) {
        throw new Error('Env-Var mismatch for for DATABASE_URI. Aborting.');
      }

      if (testBlobToken === prodBlobToken) {
        throw new Error('Env-Var mismatch for for BLOB_READ_WRITE_TOKEN. Aborting.');
      }

    } else {
      if (!localDBUri || !prodDBUri) {
        throw new Error('Env-Var DATABASE_URI missing in one or more environments.');
      }

      if (!localBlobToken || !prodBlobToken) {
        throw new Error('Env-Var BLOB_READ_WRITE_TOKEN missing in one or more environments.');
      }

      if (localDBUri === prodDBUri) {
        throw new Error('Env-Var mismatch for for DATABASE_URI. Aborting.');
      }

      if (localBlobToken === prodBlobToken) {
        throw new Error('Env-Var mismatch for for BLOB_READ_WRITE_TOKEN. Aborting.');
      }
    }

    dbHelperSource = new DbHelper();

    if (!process.env.CI) {
      const askForProceed = await inquirerAskForProceed('I will erase all collections in the local DB, and replicate the collections from Prod to the Local DB. Are you sure you want to continue?');

      if (!askForProceed) {
        throw new Error('Aborting.');
      }

      const askForProceed2 = await inquirerAskForProceed('I will delete all Blob data on Local and replicate all Blobs from Prod to Local. Are you sure you want to continue?');

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

