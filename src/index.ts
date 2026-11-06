import { CronJob } from "cron";
import { backup, backupAllMongoDB } from "./backup";
import { env, getMongoTargets, MongoTarget } from "./env";

if (env.MYSQL_ENABLED) {
  const missing = ['BACKUP_DATABASE_HOST', 'BACKUP_DATABASE_PORT', 'BACKUP_DATABASE_USER', 'BACKUP_DATABASE_PASSWORD']
    .filter(key => !env[key as keyof typeof env]);
  if (missing.length > 0) {
    console.error(`MYSQL_ENABLED is true but the following variables are missing: ${missing.join(', ')}`);
    process.exit(1);
  }
}

let mongoTargets: MongoTarget[] = [];

if (env.MONGODB_ENABLED) {
  try {
    mongoTargets = getMongoTargets();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

const job = new CronJob(env.BACKUP_CRON_SCHEDULE, async () => {
  if (env.MYSQL_ENABLED) {
    try {
      await backup();
    } catch (error) {
      console.error("Error while creating MySQL backup: ", error);
    }
  }

  await backupAllMongoDB(mongoTargets);
});

job.start();

console.log("Backup cron scheduler started.");
