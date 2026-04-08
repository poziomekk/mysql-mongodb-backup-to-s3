import { envsafe, str, bool } from "envsafe";

export const env = envsafe({
  AWS_ACCESS_KEY_ID: str({
    desc: 'The AWS access key ID for accessing S3.'
  }),
  AWS_SECRET_ACCESS_KEY: str({
    desc: 'The AWS secret access key associated with the access key ID.'
  }),
  AWS_S3_BUCKET: str({
    desc: 'The S3 bucket where the backups will be stored. (only name)'
  }),
  AWS_S3_REGION: str({
    desc: 'The AWS region where the S3 bucket is located. (try auto)'
  }),
  BACKUP_DATABASE_HOST: str({
    desc: 'The hostname or IP address of the database server.'
  }),
  BACKUP_DATABASE_PORT: str({
    desc: 'The port number on which the database server is listening.',
  }),
  BACKUP_DATABASE_USER: str({
    desc: 'The username to connect to the database server.'
  }),
  BACKUP_DATABASE_PASSWORD: str({
    desc: 'The password to connect to the database server.'
  }),
  MYSQL_ENABLED: bool({
    desc: 'Enable MySQL backup.',
    default: true,
  }),
  BACKUP_DATABASE_NAME: str({
    desc: 'Name of the database to backup. Leave empty to backup all databases.',
    default: '',
    allowEmpty: true
  }),
  BACKUP_CRON_SCHEDULE: str({
    desc: 'The cron schedule for automatic backups.',
    default: '0 5 * * *',
  }),
  AWS_S3_ENDPOINT: str({
    desc: 'Custom S3 endpoint URL.',
  }),
  DEBUG: str({
    desc: 'Output mysql/mysqldump commands to console.',
    default: '0',
    allowEmpty: true
  }),
  MONGODB_ENABLED: bool({
    desc: 'Enable MongoDB backup.',
    default: false,
  }),
  MONGODB_URI: str({
    desc: 'MongoDB connection string. If the URI contains a database name it will be backed up; otherwise all non-system databases are backed up.',
    default: '',
    allowEmpty: true,
  }),
});
