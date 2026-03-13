import { pool } from "../../../db/pool";

async function getMerchantById(merchantId: string) {
    const query = `
        SELECT 
            id, 
            name, 
            webhook_url, 
            webhook_secret
        FROM admin_portal.merchants 
        WHERE id = $1 AND status = 'active'; 
    `;

    try {
        const { rows } = await pool.query(query, [merchantId]);
        
        if (rows.length === 0) {
            console.warn(`⚠️ [merchantsRepo] Merchant no encontrado o inactivo: ${merchantId}`);
            return null;
        }
        
        return rows[0];
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`💥 [merchantsRepo] Error buscando al merchant ${merchantId}:`, errorMessage);
        throw error;
    }
}

module.exports = { getMerchantById };