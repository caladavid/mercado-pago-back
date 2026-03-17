const path = require('path');
// Buscamos el .env subiendo dos niveles: de src/config/ a la raíz
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
/* require('dotenv').config(); */
const { z } = require('zod');

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production']).default('production'),
    PORT: z.string().optional(),
    MP_ACCESS_TOKEN_PROD: z.string().min(1, "Falta el token de producción"),
    MP_WEBHOOK_SECRET_PROD: z.string().min(1, "Falta el key del Webhook de producción"),
    MP_WEBHOOK_SECRET: z.string().optional(),
    MP_WEBHOOK_SECRET2: z.string().optional(),
});

console.log("-----------------------------------------");
console.log("📍 Buscando .env en:", path.resolve(__dirname, '../../.env'));
console.log("Current NODE_ENV:", process.env.NODE_ENV);
console.log("-----------------------------------------");

// 🔍 2. Evaluamos el process.env real contra nuestro contrato
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error("❌ ERROR FATAL: Tus variables de entorno (.env) están mal configuradas o tienen errores tipográficos:");
    console.error(JSON.stringify(parsedEnv.error.format(), null, 2));
    process.exit(1); // Mata la aplicación
}

// 🎯 3. Ahora usamos las variables validadas y tipadas por Zod
const envVars = parsedEnv.data;
const isDev = envVars.NODE_ENV === 'development';

module.exports = {
    isDev,
    
    mpAccessToken: isDev
        ? process.env.MP_ACCESS_TOKEN_DEV 
        : process.env.MP_ACCESS_TOKEN_PROD,

    mpSubscriptionAccessToken: isDev
        ? process.env.MP_ACCESS_TOKEN_SUB_DEV 
        : process.env.MP_ACCESS_TOKEN_PROD,

    mpPublicKey: isDev 
        ? process.env.MP_PUBLIC_KEY 
        : process.env.MP_PUBLIC_KEY_PROD,

    webhookSecrets: isDev
        ? [process.env.MP_WEBHOOK_SECRET, process.env.MP_WEBHOOK_SECRET2].filter(Boolean)
        : [process.env.MP_WEBHOOK_SECRET_PROD].filter(Boolean),

    port: process.env.PORT || 3001,
}