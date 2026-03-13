import { pool } from "../../../db/pool";

interface WebhookRetry {
    id: string;
    merchant_id: string;
    target_url: string;
    payload: Record<string, any>;
    attempts: number;
    status: 'pending' | 'completed' | 'failed';
    last_error: string | null;
    next_retry_at: Date;
    created_at: Date;
    updated_at: Date;
}


export async function saveRetry(
    merchantId: string, 
    targetUrl: string, 
    payload: Record<string, any>, 
    errorMsg: string
): Promise<string | null> {
    const query = `
        INSERT INTO webhook_retries (merchant_id, target_url, payload, last_error, status)
        VALUES ($1, $2, $3, $4, 'pending')
        RETURNING id;
    `;
    try {
        const { rows } = await pool.query(query, [merchantId, targetUrl, payload, errorMsg]);
        return rows[0].id;
    } catch (error) {
        console.error("[saveRetry] Error guardando el reintento:", error);
        return null;
    }
}

export async function getPendingRetries(): Promise<WebhookRetry[]> {
    const query = `
        SELECT * FROM webhook_retries 
        WHERE status = 'pending' AND next_retry_at <= NOW()
        LIMIT 50; 
    `;
    try {
        const { rows } = await pool.query(query);
        return rows;
    } catch (error) {
        console.error("[getPendingRetries] Error obteniendo reintentos pendientes:", error);
        return [];
    }
}

export async function updateRetryStatus(
    id: string, 
    success: boolean, 
    errorMsg: string | null, 
    attempts: number
): Promise<void> {
    let status = success ? "completed" : "pending";

    // Si ya falló 5 veces, nos rendimos
    if (!success && attempts >= 5) {
        status = "failed";
    }
    
    const query = `
        UPDATE webhook_retries 
        SET 
            status = $1, 
            last_error = $2, 
            attempts = attempts + 1,
            next_retry_at = NOW() + (interval '5 minutes' * power(2, attempts)),
            updated_at = NOW()
        WHERE id = $3
    `;

    await pool.query(query, [status, errorMsg, id]);
}

module.exports = { saveRetry, getPendingRetries, updateRetryStatus };