import chalk from 'chalk';
import { DbHelper } from '@/helpers/db';
import { getErrorMessage } from '@/helpers/try-catch-error';
import {
  DEFAULT_CONCURRENCY, mapWithConcurrency,
} from '@/helpers/concurrency';
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
  const command = `mongodump --uri '${process.env.DATABASE_URI_READONLY}' --gzip --archive=${dumpPath}`;

  await exec(command);
};

const getTargetUrlAndDbNameForReplicationTarget = (replicateTo: InterfaceReplicationEnvs): {
  dbUrl?: string;
  dbName?: string;
} => {
  let currentUrl = process.env.DATABASE_URI_TEST;
  let currentDbName = process.env.DATABASE_NAME_TEST;

  if (replicateTo === 'local') {
    currentUrl = process.env.DATABASE_URI_LOCAL;
    currentDbName = process.env.DATABASE_NAME_LOCAL;
  }

  return {
    dbName: currentDbName,
    dbUrl: currentUrl,
  };
};

const replicateDb = async (replicateTo: InterfaceReplicationEnvs): Promise<void> => {
  // from prod to current

  const prodUrl = process.env.DATABASE_URI_READONLY;
  const prodDbName = process.env.DATABASE_NAME;

  const {
    dbName: currentDbName,
    dbUrl: currentUrl,
  } = getTargetUrlAndDbNameForReplicationTarget(replicateTo);

  if (prodUrl === currentUrl) {
    throw new Error('Env-Var mismatch for DATABASE_URI_READONLY. Aborting.');
  }

  if (!currentDbName) {
    throw new Error('Target DB Name is not defined in Env. Aborting.');
  }

  if (!currentUrl) {
    throw new Error('Could not figure out currentUrl. Aborting.');
  }

  const dbHelperTarget = new DbHelper(currentUrl);

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
    throw new Error(getErrorMessage(err), {
      cause: err,
    });
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

    await mapWithConcurrency(blobsProd, DEFAULT_CONCURRENCY, async (blob) => {
      if (blob) {
        const res = await fetch(blob.url);

        if (res.body) {
          await addBlob(blob.pathname, res.body);

          blobCounter++;
        }
      }
    });

    console.log(chalk.bgGreen(`-->> Successfully restored ${blobCounter} blobs from Prod to ${replicateTo}`));

  } catch (err) {
    console.log(chalk.bgRed('Error in Blob replication.'));
    throw new Error(getErrorMessage(err), {
      cause: err,
    });
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

    const prodDBUri = process.env.DATABASE_URI_READONLY;
    const prodBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
    const prodDbName = process.env.DATABASE_NAME;

    // Security checks. Make sure that local, test and prod have
    // different values for the env-vars.

    if (!prodDbName) {
      throw new Error('Env-Var DATABASE_NAME missing in prod environment.');
    }

    if (process.env.CI) {
      if (!testDBUri || !prodDBUri) {
        throw new Error('Env-Var DATABASE_URI_READONLY missing in one or more environments.');
      }

      if (!testBlobToken || !prodBlobToken) {
        throw new Error('Env-Var BLOB_READ_WRITE_TOKEN missing in one or more environments.');
      }

      if (testDBUri === prodDBUri) {
        throw new Error('Env-Var mismatch for for DATABASE_URI_READONLY. Aborting.');
      }

      if (testBlobToken === prodBlobToken) {
        throw new Error('Env-Var mismatch for for BLOB_READ_WRITE_TOKEN. Aborting.');
      }

    } else {
      if (!localDBUri || !prodDBUri) {
        throw new Error('Env-Var DATABASE_URI_READONLY missing in one or more environments.');
      }

      if (!localBlobToken || !prodBlobToken) {
        throw new Error('Env-Var BLOB_READ_WRITE_TOKEN missing in one or more environments.');
      }

      if (localDBUri === prodDBUri) {
        throw new Error('Env-Var mismatch for for DATABASE_URI_READONLY. Aborting.');
      }

      if (localBlobToken === prodBlobToken) {
        throw new Error('Env-Var mismatch for for BLOB_READ_WRITE_TOKEN. Aborting.');
      }
    }

    let replicateTo: InterfaceReplicationEnvs;

    if (process.env.CI) {
      replicateTo = 'test';
    } else {
      replicateTo = 'local';
    }

    const {
      dbUrl,
    } = getTargetUrlAndDbNameForReplicationTarget(replicateTo);

    if (!dbUrl) {
      throw new Error('Could not figure out dbUrl. Aborting.');
    }

    dbHelperSource = new DbHelper(dbUrl);

    // create db dump to local system
    console.log(chalk.bgGrey('1. Dumping local DB...'));
    await dbDump();
    console.log(chalk.bgGreen('--> Local DB dumbed ...'));

    // replicate
    console.log(chalk.bgGrey('2. Replicate Prod DB to local ...'));

    await replicateDb(replicateTo);

    console.log(chalk.bgGrey('3. Replicate Prod Blob to local ...'));

    await replicateBlob(replicateTo);

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

