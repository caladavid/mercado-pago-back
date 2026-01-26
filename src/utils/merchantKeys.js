const crypto = require("crypto");

function makePrefix(token, len = 12) {
  return token.slice(0, len);
}

function hashToken(token) {
  const pepper = process.env.API_KEY_PEPPER;
  if (!pepper) throw new Error("Missing API_KEY_PEPPER");
  return crypto.createHmac("sha256", pepper).update(token).digest("hex");
}

function generateMerchantToken({ env = "live" } = {}) {
  // formato como el ejemplo del usuario:
  // mpw_live_<uuid>
  const id = crypto.randomUUID();
  return `mpw_${env}_${id}`;
}

module.exports = { makePrefix, hashToken, generateMerchantToken };
