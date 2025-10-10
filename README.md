# sagw-backup-restore

Helpers for various tasks concerning backup and restore of Vercel blob data and MongoDB to S3.

## Scripts

- blob-backup, db-backup und backups-cleanup are run as cron jobs on a regular basis.
- blob-restore and db-restore are meant to be executed on demand and triggered locally.

## Config

In `config.ts` you can define to send mails on success and/or error for the cron jobs. For this, `RESEND_KEY` and `MAIL_RECIPIENT_BACKUP_RESTORE` environment variables need to be defined.

With `keepAmountOfBackups` you can define how many backups the cleanup cron job should keep. e.g. if you set it to 4, then the job will keep 4 db-backups and 4 blob-backups.

With `blobBackupBucketPrefix` and `blobBackupBucketPrefix` you define the prefix for the name of the blob-backup/db-backup on S3.
