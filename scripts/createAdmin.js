require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool } = require("../src/db/pool");

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  const fullName = process.argv[4] || null;

  if (!email || !password) {
    console.log("Usage: node scripts/createAdmin.js <email> <password> [full_name]");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  await pool.query(
    `
    INSERT INTO admin_portal.admin_users (email, password_hash, full_name, is_active)
    VALUES ($1, $2, $3, true)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `,
    [email, hash, fullName]
  );

  // luego del INSERT del admin...
  await pool.query(
    `
    INSERT INTO admin_portal.admin_user_roles (admin_user_id, role_id)
    SELECT au.id, r.id
    FROM admin_portal.admin_users au
    JOIN admin_portal.roles r ON r.name = 'super_admin'
    WHERE au.email = $1
    ON CONFLICT DO NOTHING
    `,
    [email]
  );

  console.log("Admin user created/updated:", email);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
