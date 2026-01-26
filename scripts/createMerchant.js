require("dotenv").config();
const { pool } = require("../src/db/pool");
const { generateMerchantToken, hashToken, makePrefix } = require("../src/utils/merchantKeys");

/**
 * Uso:
 *  node scripts/createMerchant.js "Runa" comerciante-runa
 *  node scripts/createMerchant.js "Runa" comerciante-runa "prod-key" live
 *  node scripts/createMerchant.js "Runa" comerciante-runa "prod-key" test
 *
 * Args:
 *  1) name (obligatorio)
 *  2) slug (obligatorio)
 *  3) keyName (opcional)   -> si lo pasas, crea API key (por defecto "prod-key")
 *  4) env (opcional)       -> live|test (por defecto live)
 */

async function main() {
  const name = process.argv[2];
  const slug = process.argv[3];
  const keyName = process.argv[4];     // si viene, creamos key
  const env = process.argv[5] || "live";

  if (!name || !slug) {
    console.log(
      'Usage:\n  node scripts/createMerchant.js "Name" slug [keyName] [live|test]\n\n' +
      'Examples:\n  node scripts/createMerchant.js "Runa" comerciante-runa\n' +
      '  node scripts/createMerchant.js "Runa" comerciante-runa "prod-key" live'
    );
    process.exit(1);
  }

  if (!["live", "test"].includes(env)) {
    console.log('env must be "live" or "test"');
    process.exit(1);
  }

  // 1) Crear / upsert merchant
  const mRes = await pool.query(
    `
    INSERT INTO admin_portal.merchants (name, slug, status, metadata, created_at, updated_at)
    VALUES ($1, $2, 'active', '{}'::jsonb, now(), now())
    ON CONFLICT (slug) DO UPDATE
      SET name = EXCLUDED.name,
          updated_at = now()
    RETURNING id, name, slug, status, created_at, updated_at
    `,
    [name, slug]
  );

  const merchant = mRes.rows[0];

  console.log("✅ Merchant upserted:");
  console.log(merchant);

  // 2) (Opcional) crear API key
  if (keyName) {
    const token = generateMerchantToken({ env });  // mpw_live_<uuid> o mpw_test_<uuid>
    const keyPrefix = makePrefix(token);
    const keyHash = hashToken(token);

    await pool.query(
      `
      INSERT INTO admin_portal.merchant_api_keys
        (merchant_id, name, key_prefix, key_hash, scopes, is_active, created_at)
      VALUES
        ($1, $2, $3, $4, '{}'::jsonb, true, now())
      `,
      [merchant.id, keyName, keyPrefix, keyHash]
    );

    console.log("\n🔑 API Key creada (SE MUESTRA SOLO UNA VEZ):");
    console.log({
      merchant_id: merchant.id,
      slug: merchant.slug,
      key_name: keyName,
      token,
      key_prefix: keyPrefix,
    });
  } else {
    console.log("\nℹ️ No se creó API key (no pasaste keyName).");
    console.log('   Para crear una: node scripts/createMerchant.js "Name" slug "prod-key" live');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
