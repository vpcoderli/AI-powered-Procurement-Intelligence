import { db } from "@/server/db/client";
import { resetLocalAdminPassword } from "@/server/auth/admin-reset";

async function main() {
  const result = await resetLocalAdminPassword(db, {
    email: process.env.LOCAL_ADMIN_EMAIL,
    password: process.env.LOCAL_ADMIN_PASSWORD,
  });

  console.log("Local admin account reset.");
  console.log(`Email: ${result.email}`);
  console.log(`Password: ${result.password}`);
  console.log("Use this credential only for local development. Production admin passwords must use the production reset flow.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
