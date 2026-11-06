import { createWriteStream, createReadStream } from "fs";
import { rm } from "fs/promises";
import { pipeline } from "stream/promises";
import zlib from "zlib";
import mysql from "mysql2/promise";
import { BSON, MongoClient } from "mongodb";
import { S3Client, PutObjectCommand, S3ClientConfig } from "@aws-sdk/client-s3";
import { env, MongoTarget } from "./env";

const isDebug = () => env.DEBUG === '1';

// Canonical EJSON keeps BSON types such as ObjectId, Date and Long
const toEJSON = (value: any) => BSON.EJSON.stringify(value, { relaxed: false });

// Upload to S3
const uploadToS3 = async (file: { name: string, path: string }) => {
  const bucket = env.AWS_S3_BUCKET;
  const clientOptions: S3ClientConfig = { region: env.AWS_S3_REGION };
  if (env.AWS_S3_ENDPOINT) clientOptions.endpoint = env.AWS_S3_ENDPOINT;

  const client = new S3Client(clientOptions);

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
