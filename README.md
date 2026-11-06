# mysql-mongodb-backup-to-s3
Quick Backup your MySQL and MongoDB to any S3 Service 

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/H41sm5?referralCode=poziomus&utm_medium=integration&utm_source=template&utm_campaign=generic)

# MySQL & MongoDB Backup to S3

A lightweight Node.js service that creates compressed backups of MySQL and MongoDB databases and uploads them to any S3-compatible object storage.

The service connects directly to MySQL/MongoDB, generates dumps, compresses them using gzip, and stores the backups as `.sql.gz` or `.gz` files in an S3 bucket. It is designed to run on Railway but can be deployed anywhere.

## Features

- Supports MySQL and MariaDB
- Supports MongoDB
- Uploads backups to any S3-compatible storage
- Creates compressed `.sql.gz` (MySQL) and `.gz` (MongoDB) backups
- Can back up a single database or all databases
- Stateless and easy to deploy
- Works well with cron-based scheduling (e.g. Railway cron jobs)

## How It Works

### MySQL

1. Connects to a MySQL database
2. Generates SQL dump(s) for one or more databases
3. Compresses the dump using gzip
4. Uploads the backup file to an S3 bucket
5. Cleans up temporary files

### MongoDB

1. Connects to MongoDB using a connection URI
2. Generates a dump for the specified database (or all non-system databases)
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

### MySQL Configuration

- `MYSQL_ENABLED`  
  Enable MySQL backup (`true` to enable, default: `true`)

- `BACKUP_DATABASE_HOST`  
  Database host

- `BACKUP_DATABASE_PORT`  
  Database port

- `BACKUP_DATABASE_USER`  
  Database user

- `BACKUP_DATABASE_PASSWORD`  
  Database password

- `MYSQL_BACKUP_DB_NAME` *(optional)*  
  Database name to back up  
  Leave empty to back up all databases (excluding system databases)

### MongoDB Configuration

- `MONGODB_ENABLED`  
  Enable MongoDB backup (`true` to enable, default: `false`)

Set exactly one of the following when MongoDB is enabled. The service exits at startup if both are set.

- `MONGODB_URI`  
  Connection string for a single cluster  
  If the URI includes a database name it will be backed up; otherwise all non-system databases are backed up  
  Example: `mongodb://user:password@host:27017/mydb`  
  Backups are stored in the bucket root: `backup-mongodb-<timestamp>.json.gz`

- `MONGODB_TARGETS`  
  JSON array of clusters to back up, any number of organizations and projects, with one entry per `org` and `project` pair  
  `org` and `project` may only contain letters, digits, dots, dashes and underscores  
  Each `uri` follows the same database name rule as `MONGODB_URI`, and special characters in passwords must be URL-encoded  
  Example: `[{"org":"acme","project":"shop","uri":"mongodb+srv://backup:password@prod.abc.mongodb.net"}]`  
  Backups are stored as `mongodb/<org>/<project>/backup-mongodb-<timestamp>.json.gz`

Clusters are backed up one at a time, and a failed cluster does not stop the others.

On MongoDB Atlas, network access and database users are configured per project. In every project, allow the IP of the backup service and create a user with the `readAnyDatabase` role.

### MongoDB Backup Format

After decompressing, each line of a MongoDB backup is one of the following:

- `-- {...}` starts a collection or view. The JSON after the prefix holds `db`, `collection`, `type`, `options` and `indexes`
- `{...}` is a document of the current collection, in canonical Extended JSON, which keeps types such as `ObjectId`, `Date` and `Long`

Parse the lines with `EJSON.parse` from the `bson` package, or split them per collection and load them with `mongoimport`. Indexes and collection options are not restored by `mongoimport` and must be recreated from the `-- ` lines.

### Scheduling & Debug

- `BACKUP_CRON_SCHEDULE`  
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
```
