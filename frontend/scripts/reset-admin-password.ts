import { resetLocalAdminPassword, resetLocalAdminPasswordFromMysql } from "@/server/auth/admin-reset";
import { createDatabase } from "@/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

async function resetAdminPassword() {
  const input = {
    email: process.env.LOCAL_ADMIN_EMAIL,
    password: process.env.LOCAL_ADMIN_PASSWORD,
  };

  if (isMysqlDatabaseUrlConfigured()) {
    return resetLocalAdminPasswordFromMysql(resolveMysqlPool(), input);
  }

  const sqlite = createDatabase();
  try {
    return await resetLocalAdminPassword(sqlite, input);
  } finally {
    sqlite.$client.close();
  }
}

async function main() {
  const result = await resetAdminPassword();

  console.log("Local admin account reset.");
  console.log(`Email: ${result.email}`);
  console.log(`Password: ${result.password}`);
  console.log("Use this credential only for local development. Production admin passwords must use the production reset flow.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeResolvedMysqlPool();
  });
