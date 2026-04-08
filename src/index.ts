import { CronJob } from "cron";
import { backup, backupMongoDB } from "./backup";
import { env } from "./env";

const job = new CronJob(env.BACKUP_CRON_SCHEDULE, async () => {
  if (env.MYSQL_ENABLED) {
    try {
      await backup();
    } catch (error) {
      console.error("Error while creating MySQL backup: ", error);
    }
  }

  if (env.MONGODB_ENABLED) {
    try {
      await backupMongoDB();
    } catch (error) {
      console.error("Error while creating MongoDB backup: ", error);
    }
  }
});

job.start();

console.log("Backup cron scheduler started.");
