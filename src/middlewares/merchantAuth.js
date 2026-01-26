const { pool } = require("../db/pool");
const { hashToken, makePrefix } = require("../utils/merchantKeys");

async function merchantAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }

    const token = auth.slice("Bearer ".length).trim();
    if (!token) return res.status(401).json({ error: "Empty token" });

    const keyHash = hashToken(token);
    const keyPrefix = makePrefix(token);

    // Buscar key por hash (rápido). El prefix lo dejamos por debug/log o futura optimización.
    const { rows } = await pool.query(
      `
      SELECT
        k.id            AS api_key_id,
        k.is_active     AS api_key_active,
        k.scopes        AS scopes,
        m.id            AS merchant_id,
        m.slug          AS merchant_slug,
        m.status        AS merchant_status
      FROM admin_portal.merchant_api_keys k
      JOIN admin_portal.merchants m ON m.id = k.merchant_id
      WHERE k.key_hash = $1
      LIMIT 1
      `,
      [keyHash]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const row = rows[0];

    if (!row.api_key_active) {
      return res.status(401).json({ error: "Token disabled" });
    }

    if (row.merchant_status !== "active") {
      return res.status(403).json({ error: "Merchant suspended" });
    }

    // Anti-suplantación: si el request trae slug, debe coincidir con el merchant del token
    const slugFromBody = req.body?.slug;
    if (slugFromBody && slugFromBody !== row.merchant_slug) {
      return res.status(403).json({ error: "Slug mismatch" });
    }

    // Dejar contexto listo
    req.merchant = {
      id: row.merchant_id,
      slug: row.merchant_slug,
      apiKeyId: row.api_key_id,
      scopes: row.scopes || {},
      tokenPrefix: keyPrefix,
    };

    // Actualizar last_used_at (opcional)
    await pool.query(
      `UPDATE admin_portal.merchant_api_keys SET last_used_at = now() WHERE id = $1`,
      [row.api_key_id]
    );

    return next();
  } catch (err) {
    console.error("merchantAuth error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

module.exports = { merchantAuth };
