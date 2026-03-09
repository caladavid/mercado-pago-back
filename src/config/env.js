require('dotenv').config();
const { z } = require('zod');

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production']),
    PORT: z.string().optional(),
});

// 🔍 2. Evaluamos el process.env real contra nuestro contrato
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error("❌ ERROR FATAL: Tus variables de entorno (.env) están mal configuradas o tienen errores tipográficos:");
    console.error(parsedEnv.error.format());
    process.exit(1); // Mata la aplicación
}

// 🎯 3. Ahora usamos las variables validadas y tipadas por Zod
const envVars = parsedEnv.data;
const isDev = process.env.NODE_ENV === 'development';

module.exports = {
    isDev,
    
    mpAccessToken: isDev
        ? process.env.MP_ACCESS_TOKEN_DEV 
        : process.env.MP_ACCESS_TOKEN_PROD,

    mpSubscriptionAccessToken: isDev
        ? process.env.MP_ACCESS_TOKEN_SUB_DEV 
        : process.env.MP_ACCESS_TOKEN_PROD,

    mpPublicKey: isDev 
        ? process.env.MP_PUBLIC_KEY_DEV 
        : process.env.MP_PUBLIC_KEY_PROD,

    port: process.env.PORT || 3001,
}