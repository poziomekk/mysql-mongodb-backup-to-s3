import { createWriteStream, createReadStream } from "fs";
import { rm } from "fs/promises";
import { pipeline } from "stream/promises";
import zlib from "zlib";
import mysql from "mysql2/promise";
import { BSON, MongoClient } from "mongodb";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, ListBucketsCommand, ListObjectsV2Command, S3ClientConfig } from "@aws-sdk/client-s3";
import { env, MongoTarget } from "./env";

const R2_COPY_CONCURRENCY = 5;
const R2_COPY_ATTEMPTS = 3;

const isDebug = () => env.DEBUG === '1';

const createBackupS3Client = () => {
  const clientOptions: S3ClientConfig = { region: env.AWS_S3_REGION };
  if (env.AWS_S3_ENDPOINT) clientOptions.endpoint = env.AWS_S3_ENDPOINT;

  return new S3Client(clientOptions);
};

// Canonical EJSON keeps BSON types such as ObjectId, Date and Long
const toEJSON = (value: any) => BSON.EJSON.stringify(value, { relaxed: false });

// Upload to S3
const uploadToS3 = async (file: { name: string, path: string }) => {
  const bucket = env.AWS_S3_BUCKET;
  const client = createBackupS3Client();

  console.log(`Uploading backup to S3 at ${bucket}/${file.name}...`);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: file.name,
    Body: createReadStream(file.path),
  }));
  console.log("Upload complete.");
};

// Create SQL dump using mysql2
const dumpToFile = async (path: string) => {
  console.log(`Creating dump at ${path}...`);

  const connection = await mysql.createConnection({
    host: env.BACKUP_DATABASE_HOST,
    port: Number(env.BACKUP_DATABASE_PORT),
    user: env.BACKUP_DATABASE_USER,
    password: env.BACKUP_DATABASE_PASSWORD,
    database: env.MYSQL_BACKUP_DB_NAME || undefined,
  });

  try {
    // Gzip stream
    const gzip = zlib.createGzip();
    const output = createWriteStream(path);

    await pipeline(
      (async function* () {
        let databases: string[] = [];

        if (env.MYSQL_BACKUP_DB_NAME) {
          databases = [env.MYSQL_BACKUP_DB_NAME];
        } else {
          const [rows] = await connection.query(`SHOW DATABASES`);
          const excluded = ['mysql', 'sys', 'performance_schema', 'information_schema', 'innodb'];
          databases = (rows as any[])
            .map(r => Object.values(r)[0] as string)
            .filter(db => !excluded.includes(db));
        }

        for (const db of databases) {
          if (isDebug()) console.log(`Dumping database: ${db}`);
          yield `-- Dumping database: ${db}\n`;

          await connection.changeUser({ database: db });

          const [tables] = await connection.query(`SHOW TABLES`);
          const tableKey = `Tables_in_${db}`;
          for (const tableRow of tables as any[]) {
            const tableName = tableRow[tableKey];
            if (isDebug()) console.log(`Dumping table: ${tableName}`);

            // Table structure
            const [createStmt] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``) as any;
            yield `${createStmt[0]['Create Table']};\n\n`;

            // Table data
            const [rows] = await connection.query(`SELECT * FROM \`${tableName}\``) as any[];
            for (const row of rows) {
              const values = Object.values(row).map(v => {
                if (v === null || v === undefined) return 'NULL';
                return `'${v.toString().replace(/'/g, "''")}'`;
              });

              yield `INSERT INTO \`${tableName}\` VALUES (${values.join(', ')});\n`;
            }
            yield `\n`;
          }
        }
      })(),
      gzip,
      output
    );
  } finally {
    await connection.end();
  }
};

// Create MongoDB dump
const dumpMongoToFile = async (path: string, uri: string) => {
  console.log(`Creating MongoDB dump at ${path}...`);

  const client = new MongoClient(uri);

  try {
    await client.connect();

    const gzip = zlib.createGzip();
    const output = createWriteStream(path);

    await pipeline(
      (async function* () {
        // Determine which databases to dump
        let databases: string[];
        const uriDb = client.db().databaseName;
        const systemDbs = ['admin', 'local', 'config'];

        if (uriDb && uriDb !== 'test') {
          databases = [uriDb];
        } else {
          const adminDb = client.db('admin');
          const { databases: dbList } = await adminDb.admin().listDatabases();
          databases = dbList
            .map((d: { name: string }) => d.name)
            .filter((name: string) => !systemDbs.includes(name));
        }

        for (const dbName of databases) {
          if (isDebug()) console.log(`Dumping MongoDB database: ${dbName}`);
          const db = client.db(dbName);
          const collections = await db.listCollections({}, { nameOnly: false }).toArray();

          for (const colInfo of collections) {
            const colName = colInfo.name;
            if (colName.startsWith('system.')) continue;
            if (isDebug()) console.log(`Dumping collection: ${colName}`);

            // Views have no documents or indexes of their own, their definition is in the options
            const isView = colInfo.type === 'view';
            const collection = db.collection(colName);
            const indexes = isView ? [] : await collection.listIndexes().toArray();

            yield `-- ${toEJSON({ db: dbName, collection: colName, type: colInfo.type, options: colInfo.options, indexes })}\n`;

            if (isView) continue;

            // promoteValues: false keeps Int32, Long and Double distinct instead of a JS number
            const cursor = collection.find({}, { promoteValues: false });
            for await (const doc of cursor) {
              yield toEJSON(doc) + '\n';
            }
          }
        }
      })(),
      gzip,
      output
    );
  } finally {
    await client.close();
  }
};

// Delete local file, which may not exist if the dump failed early
const deleteFile = async (path: string) => {
  await rm(path, { force: true });
};

export const backup = async () => {
  const timestamp = new Date().toISOString().replace(/[:.]+/g, '-');
  const filename = `backup-${timestamp}.sql.gz`;
  const filepath = `/tmp/${filename}`;

  try {
    await dumpToFile(filepath);
    await uploadToS3({ name: filename, path: filepath });
  } finally {
    await deleteFile(filepath);
  }

  console.log("MySQL backup successfully created.");
};

const backupMongoDB = async (target: MongoTarget) => {
  const timestamp = new Date().toISOString().replace(/[:.]+/g, '-');
  const filename = `backup-mongodb-${timestamp}.json.gz`;
  const filepath = `/tmp/${filename}`;

  try {
    await dumpMongoToFile(filepath, target.uri);
    await uploadToS3({ name: `${target.keyPrefix}${filename}`, path: filepath });
  } finally {
    await deleteFile(filepath);
  }

  console.log(`MongoDB backup of ${target.name} successfully created.`);
};

// Back up clusters one at a time, a failed cluster must not stop the others
export const backupAllMongoDB = async (targets: MongoTarget[]) => {
  const failed: string[] = [];

  for (const target of targets) {
    try {
      await backupMongoDB(target);
    } catch (error) {
      console.error(`Error while creating MongoDB backup of ${target.name}: `, error);
      failed.push(target.name);
    }
  }

  if (failed.length > 0) {
    console.error(`Failed MongoDB backups: ${failed.join(', ')}`);
  }
};

// List every object under a prefix, as a map of key to size
const listObjectSizes = async (client: S3Client, bucket: string, prefix?: string) => {
  const sizes = new Map<string, number>();
  let continuationToken: string | undefined;

  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const object of page.Contents ?? []) {
      if (object.Key) sizes.set(object.Key, object.Size ?? 0);
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);

  return sizes;
};

// Download to a temporary file first. Piping the download straight into PutObject is unsafe,
// because a connection cut during the download becomes an unhandled rejection in the SDK and kills the process.
const copyObject = async (client: S3Client, bucket: string, key: string, targetKey: string) => {
  const filepath = `/tmp/backup-r2-${randomUUID()}`;

  try {
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    await pipeline(object.Body as Readable, createWriteStream(filepath));

    await client.send(new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: targetKey,
      Body: createReadStream(filepath),
      ContentLength: object.ContentLength,
      ContentType: object.ContentType,
      CacheControl: object.CacheControl,
      ContentDisposition: object.ContentDisposition,
      ContentEncoding: object.ContentEncoding,
      Metadata: object.Metadata,
    }));
  } finally {
    await deleteFile(filepath);
  }
};

// The SDK cannot replay a file stream, so a failed copy starts again from the download
const copyObjectWithRetry = async (...args: Parameters<typeof copyObject>) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await copyObject(...args);
    } catch (error) {
      if (attempt >= R2_COPY_ATTEMPTS) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
};

// Copy only new objects and objects whose size changed, and never delete anything from the backup
const backupR2Bucket = async (client: S3Client, bucket: string) => {
  const keyPrefix = `r2/${bucket}/`;

  console.log(`Listing R2 bucket ${bucket}...`);
  const sourceSizes = await listObjectSizes(client, bucket);
  const targetSizes = await listObjectSizes(client, env.AWS_S3_BUCKET, keyPrefix);

  const pending: string[] = [];
  sourceSizes.forEach((size, key) => {
    // Keys ending with a slash are empty folder markers
    if (!key.endsWith('/') && targetSizes.get(keyPrefix + key) !== size) pending.push(key);
  });

  console.log(`R2 bucket ${bucket}: ${sourceSizes.size} objects, ${pending.length} to copy.`);

  let nextIndex = 0;
  let failedCount = 0;

  const worker = async () => {
    while (nextIndex < pending.length) {
      const key = pending[nextIndex++];
      if (isDebug()) console.log(`Copying R2 object: ${key}`);

      try {
        await copyObjectWithRetry(client, bucket, key, keyPrefix + key);
      } catch (error) {
        console.error(`Error while copying R2 object ${bucket}/${key}: `, error);
        failedCount++;
      }
    }
  };

  await Promise.all(Array.from({ length: R2_COPY_CONCURRENCY }, () => worker()));

  if (failedCount > 0) {
    throw new Error(`${failedCount} of ${pending.length} objects failed to copy.`);
  }

  console.log(`R2 backup of ${bucket} successfully created.`);
};

// List every bucket except the one that stores the backups
const listR2SourceBuckets = async (client: S3Client) => {
  const buckets: string[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await client.send(new ListBucketsCommand({ ContinuationToken: continuationToken }));
    for (const bucket of page.Buckets ?? []) {
      if (bucket.Name && bucket.Name !== env.AWS_S3_BUCKET) buckets.push(bucket.Name);
    }
    continuationToken = page.ContinuationToken;
  } while (continuationToken);

  return buckets;
};

// Back up buckets one at a time, a failed bucket must not stop the others
export const backupAllR2 = async () => {
  const client = createBackupS3Client();
  const failed: string[] = [];

  try {
    const buckets = await listR2SourceBuckets(client);
    console.log(`Found ${buckets.length} R2 buckets to back up.`);

    for (const bucket of buckets) {
      try {
        await backupR2Bucket(client, bucket);
      } catch (error) {
        console.error(`Error while creating R2 backup of ${bucket}: `, error);
        failed.push(bucket);
      }
    }
  } catch (error) {
    console.error("Error while listing R2 buckets, the S3 credentials need permission to list all buckets: ", error);
  } finally {
    client.destroy();
  }

  if (failed.length > 0) {
    console.error(`Failed R2 backups: ${failed.join(', ')}`);
  }
};
