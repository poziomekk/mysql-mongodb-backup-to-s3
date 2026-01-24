import { createWriteStream, createReadStream, unlink } from "fs";
import { pipeline } from "stream/promises";
import zlib from "zlib";
import mysql from "mysql2/promise";
import { S3Client, PutObjectCommand, S3ClientConfig } from "@aws-sdk/client-s3";
import { env } from "./env";

const isDebug = () => env.DEBUG === '1';

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
    database: env.BACKUP_DATABASE_NAME || undefined,
  });

  // Gzip stream
  const gzip = zlib.createGzip();
  const output = createWriteStream(path);

  await pipeline(
    (async function* () {
      let databases: string[] = [];

      if (env.BACKUP_DATABASE_NAME) {
        databases = [env.BACKUP_DATABASE_NAME];
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

  await connection.end();
};

// Delete local file
const deleteFile = async (path: string) => {
  await new Promise<void>((resolve, reject) => {
    unlink(path, (err) => err ? reject(err) : resolve());
  });
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

  console.log("Backup successfully created.");
};