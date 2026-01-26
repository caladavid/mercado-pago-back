// scripts/test-mp-token.js
require("dotenv").config(); // si usas .env

const { getMe } = require("../src/integrations/mercadopago/mpClient");

(async () => {
  try {
    const me = await getMe();
    console.log("OK /users/me:", me);
    process.exit(0);
  } catch (e) {
    console.error("ERROR status:", e.status);
    console.error("ERROR payload:", e.payload);
    console.error("ERROR www-authenticate:", e.wwwAuthenticate);
    process.exit(1);
  }
})();