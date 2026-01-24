# mysql-backup-to-s3
Quick Backup your mysql to any S3 Service 

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/H41sm5?referralCode=poziomus&utm_medium=integration&utm_source=template&utm_campaign=generic)

# MySQL Backup to S3

A lightweight Node.js service that creates compressed backups of MySQL databases and uploads them to any S3-compatible object storage.

The service connects directly to MySQL, generates SQL dumps, compresses them using gzip, and stores the backups as `.sql.gz` files in an S3 bucket. It is designed to run on Railway but can be deployed anywhere.

## Features

- Supports MySQL and MariaDB
- Uploads backups to any S3-compatible storage
- Creates compressed `.sql.gz` backups
- Can back up a single database or all databases
- Stateless and easy to deploy
- Works well with cron-based scheduling (e.g. Railway cron jobs)

## How It Works

1. Connects to a MySQL database
2. Generates SQL dump(s) for one or more databases
3. Compresses the dump using gzip
4. Uploads the backup file to an S3 bucket
5. Cleans up temporary files

Each backup is stored with a timestamped filename.

## Environment Variables

### S3 Configuration

- `AWS_ACCESS_KEY_ID`  
  S3 access key ID

- `AWS_SECRET_ACCESS_KEY`  
  S3 secret access key

- `AWS_S3_BUCKET`  
  Target S3 bucket name

- `AWS_S3_REGION`  
  S3 bucket region

- `AWS_S3_ENDPOINT` *(optional)*  
  Custom endpoint for S3-compatible providers (MinIO, Backblaze, etc.)

### Database Configuration

- `BACKUP_DATABASE_HOST`  
  Database host

- `BACKUP_DATABASE_PORT`  
  Database port

- `BACKUP_DATABASE_USER`  
  Database user

- `BACKUP_DATABASE_PASSWORD`  
  Database password

- `BACKUP_DATABASE_NAME` *(optional)*  
  Database name to back up  
  Leave empty to back up all databases (excluding system databases)

### Scheduling & Debug

- `BACKUP_CRON_SCHEDULE` *(optional)*  
  Cron schedule for automatic backups  
  Default: `0 5 * * *`

- `DEBUG` *(optional)*  
  Enable verbose logging (`1` to enable)

## Deployment

### Railway (Recommended)

1. Create a new Railway project
2. Deploy this repository
3. Add the required environment variables
4. (Optional) Configure a Railway cron job using `BACKUP_CRON_SCHEDULE`

### Manual

```bash
npm install
npm run build
node dist/index.js
