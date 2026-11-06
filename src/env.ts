import { envsafe, str, bool } from "envsafe";
import { MongoClient } from "mongodb";

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
    desc: 'The hostname or IP address of the database server.',
    default: '',
    allowEmpty: true,
  }),
  BACKUP_DATABASE_PORT: str({
    desc: 'The port number on which the database server is listening.',
    default: '',
    allowEmpty: true,
  }),
  BACKUP_DATABASE_USER: str({
    desc: 'The username to connect to the database server.',
    default: '',
    allowEmpty: true,
  }),
  BACKUP_DATABASE_PASSWORD: str({
    desc: 'The password to connect to the database server.',
    default: '',
    allowEmpty: true,
  }),
  MYSQL_ENABLED: bool({
    desc: 'Enable MySQL backup.',
    default: true,
  }),
  MYSQL_BACKUP_DB_NAME: str({
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
    desc: 'MongoDB connection string for a single cluster. If the URI contains a database name it will be backed up; otherwise all non-system databases are backed up.',
    default: '',
    allowEmpty: true,
  }),
  MONGODB_TARGETS: str({
    desc: 'JSON array of MongoDB clusters to back up, each with org, project and uri. Use instead of MONGODB_URI.',
    default: '',
    allowEmpty: true,
  }),
});

export type MongoTarget = { name: string, keyPrefix: string, uri: string };

const assertValidUri = (uri: string, label: string) => {
  try {
    new MongoClient(uri);
  } catch {
    throw new Error(`${label} is not a valid MongoDB connection string.`);
  }
};

// Error messages must never include the raw values, because they contain credentials
export const getMongoTargets = (): MongoTarget[] => {
  if (env.MONGODB_URI && env.MONGODB_TARGETS) {
    throw new Error('Set either MONGODB_URI or MONGODB_TARGETS, not both.');
  }

  if (env.MONGODB_URI) {
    assertValidUri(env.MONGODB_URI, 'MONGODB_URI');
    return [{ name: 'default', keyPrefix: '', uri: env.MONGODB_URI }];
  }

  if (!env.MONGODB_TARGETS) {
    throw new Error('MONGODB_ENABLED is true but both MONGODB_URI and MONGODB_TARGETS are missing.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(env.MONGODB_TARGETS);
  } catch {
    throw new Error('MONGODB_TARGETS is not valid JSON.');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('MONGODB_TARGETS must be a non-empty JSON array.');
  }

  const names = new Set<string>();

  return parsed.map((item, index) => {
    const label = `MONGODB_TARGETS[${index}]`;

    // These values become part of the S3 key
    for (const field of ['org', 'project']) {
      if (typeof item?.[field] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item[field])) {
        throw new Error(`${label}.${field} is required and may only contain letters, digits, dots, dashes and underscores.`);
      }
    }

    if (typeof item.uri !== 'string') {
      throw new Error(`${label}.uri is required.`);
    }
    assertValidUri(item.uri, `${label}.uri`);

    const name = `${item.org}/${item.project}`;
    if (names.has(name)) {
      throw new Error(`${label} duplicates ${name}.`);
    }
    names.add(name);

    return { name, keyPrefix: `mongodb/${name}/`, uri: item.uri };
  });
};
