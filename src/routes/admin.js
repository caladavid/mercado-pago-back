const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { pool } = require("../db/pool");
const { adminAuth } = require("../middlewares/adminAuth");
const { generateMerchantToken, hashToken, makePrefix } = require("../utils/merchantKeys");

const router = express.Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// POST /admin/login
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { email, password } = parsed.data;

  const { rows } = await pool.query(
    `SELECT id, email, password_hash, is_active FROM admin_portal.admin_users WHERE email = $1 LIMIT 1`,
    [email]
  );

  if (rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });
  const user = rows[0];
  if (!user.is_active) return res.status(403).json({ error: "Admin disabled" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { admin_user_id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );

  return res.json({ token });
});

const merchantCreateSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
});

// POST /admin/merchants (crear merchant)
router.post("/merchants", adminAuth, async (req, res) => {
  const parsed = merchantCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, slug } = parsed.data;

  const { rows } = await pool.query(
    `
    INSERT INTO admin_portal.merchants (name, slug, status, metadata)
    VALUES ($1, $2, 'active', '{}'::jsonb)
    RETURNING id, name, slug, status, created_at
    `,
    [name, slug]
  );

  return res.status(201).json(rows[0]);
});

const apiKeyCreateSchema = z.object({
  name: z.string().min(2).default("prod-key"),
  scopes: z.record(z.any()).optional(), // o define formato estricto
  env: z.enum(["live", "test"]).default("live"),
});

// POST /admin/merchants/:merchantId/api-keys (emitir token)
router.post("/merchants/:merchantId/api-keys", adminAuth, async (req, res) => {
  const parsed = apiKeyCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { merchantId } = req.params;
  const { name, scopes, env } = parsed.data;

  // Verificar merchant existe
  const m = await pool.query(
    `SELECT id, slug, status FROM admin_portal.merchants WHERE id = $1 LIMIT 1`,
    [merchantId]
  );
  if (m.rows.length === 0) return res.status(404).json({ error: "Merchant not found" });

  const token = generateMerchantToken({ env });
  const keyPrefix = makePrefix(token);
  const keyHash = hashToken(token);

  await pool.query(
    `
    INSERT INTO admin_portal.merchant_api_keys
      (merchant_id, name, key_prefix, key_hash, scopes, is_active)
    VALUES
      ($1, $2, $3, $4, $5::jsonb, true)
    `,
    [merchantId, name, keyPrefix, keyHash, JSON.stringify(scopes || {})]
  );

  // IMPORTANTE: este es el ÚNICO momento donde devuelves el token en claro.
  return res.status(201).json({
    merchant_id: merchantId,
    token,       // guardar en el sistema del merchant
    key_prefix: keyPrefix
  });
});

module.exports = router;
