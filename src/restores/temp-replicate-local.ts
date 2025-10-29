/*
replicate local db and blob to prod.

TODO: remove before content-migration

this is just convenience until content migration starts.
*/

import chalk from 'chalk';
import { DbHelper } from '@/helpers/db';
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

const dbDump = async (): Promise<void> => {
  if (!fs.existsSync(config.dbBackupTmpDir)) {
    fs.mkdirSync(config.dbBackupTmpDir);
  }

  /* eslint-disable @typescript-eslint/naming-convention */
  const __dirname = path.resolve(config.dbBackupTmpDir);
  /* eslint-enable @typescript-eslint/naming-convention */
  const dumpPath = path.resolve(__dirname, config.dbBackupName);
  const command = `mongodump --uri '${process.env.DATABASE_URI_LOCAL}' --gzip --archive=${dumpPath}`;

  await exec(command);
};

const replicateDb = async (): Promise<void> => {
  const prodUrl = process.env.DATABASE_URI;
  const prodDbName = process.env.DATABASE_NAME;
  const currentUrl = process.env.DATABASE_URI_LOCAL;
  const currentDbName = process.env.DATABASE_NAME_LOCAL;

  if (!prodUrl || !prodDbName || !currentUrl || !currentDbName) {
    return;
  }

  const dbHelperTarget = new DbHelper(prodUrl);

  try {
    /* eslint-disable @typescript-eslint/naming-convention */
    const __dirname = path.resolve(config.dbBackupTmpDir);
    /* eslint-enable @typescript-eslint/naming-convention */
    const dumpPath = path.resolve(__dirname, config.dbBackupName);

    await dbHelperTarget.deleteAllCollections(prodDbName);

    const command = `mongorestore --uri '${prodUrl}' --gzip --archive=${dumpPath} --nsFrom='${currentDbName}.*' --nsTo='${prodDbName}.*' --nsInclude='${currentDbName}.*'`;

    await exec(command);

    console.log(chalk.bgGreen(`-->> Successfully restored collections from local to ${prodDbName}`));

  } catch (err) {
    console.log(chalk.bgRed('Error in DB replication.'));
    throw new Error(getErrorMessage(err));
  } finally {
    await dbHelperTarget?.getClient()
      ?.close();
  }
};

const replicateBlob = async (): Promise<void> => {
  try {
    const localEnvToken = process.env.BLOB_READ_WRITE_TOKEN_LOCAL;
    const prodToken = process.env.BLOB_READ_WRITE_TOKEN;

    if (!localEnvToken) {
      return;
    }

    // switch blob env to local
    dotenv.populate(
      process.env as Record<string, string>,
      {
        BLOB_READ_WRITE_TOKEN: localEnvToken,
      },
      {
        debug: false,
        override: true,
      },
    );

    const blobsLocal = await getAllBlobs();

    if (!prodToken) {
      return;
    }

    // switch blob env to prod
    dotenv.populate(
      process.env as Record<string, string>,
      {
        BLOB_READ_WRITE_TOKEN: prodToken,
      },
      {
        debug: false,
        override: true,
      },
    );

    await deleteAllBlobs();

    let blobCounter = 0;

    await Promise.all(blobsLocal.map(async (blob) => {
      if (blob) {
        const res = await fetch(blob.url);

        if (res.body) {
          await addBlob(blob.pathname, res.body);

          blobCounter++;
        }
      }
    }));

    console.log(chalk.bgGreen(`-->> Successfully restored ${blobCounter} blobs from Local to Prod`));

  } catch (err) {
    console.log(chalk.bgRed('Error in Blob replication.'));
    throw new Error(getErrorMessage(err));
  }

};

const main = async (): Promise<void> => {
  let dbHelperSource;

  try {
    dbHelperSource = new DbHelper();

    // create db dump to local system
    await dbDump();

    // replicate
    await replicateDb();
    await replicateBlob();

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

