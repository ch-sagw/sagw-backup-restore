# Environment Variables

For convenience, env-vars are split between base and local/test/prod.

## Base
|variable name|description|Creation|Usage|
|-|-|-|-|
|`OVH_OS_ACCESS_PUBLIC_KEY`|OVH object storage public key.|OVH|Vercel & Local Dev|
|`OVH_OS_ACCESS_PRIVATE_KEY`|OVH object storage private key.|OVH| Vercel & Local Dev|
|`OVH_OS_IMAGES_BACKUP_CONTAINER_ENDPOINT`|URL-Endpoint of the OVH object storage.|OVH|Vercel & Local Dev|
|`SLACK_WEBHOOK_URL`|Used to post Slack messages from CronJobs.|Slack|Vercel & Local Dev|

## Local/Test/Prod
|variable name|description|Creation|Usage|
|-|-|-|-|
|`DATABASE_NAME`|Name of the database that payload is using.|MongoDB|Vercel & Local Dev|
|`DATABASE_URI`|Connection string to the MongoDB.|OVH|Vercel & Local Dev|
|`BLOB_READ_WRITE_TOKEN`|Read/write token (automatically provided by vercel).|Vercel|Vercel & Local Dev|
|`BACKUP_RESTORE_PREFIX`|Environment-Dependant prefix to use for backup bucket names|-|Vercel & Local Dev|