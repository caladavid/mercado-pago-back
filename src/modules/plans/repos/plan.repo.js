const { pool } = require("../../../db/pool");

const PUBLIC_COLUMNS = `
    id, merchant_id, name, amount, currency, 
    interval_count, interval_unit, mp_preapproval_plan_id, 
    status, init_point, created_at, updated_at
`;

async function createPlan({ 
    merchant_id, 
    name, 
    amount, 
    currency, 
    interval_count, 
    interval_unit, 
    mp_preapproval_plan_id, 
    status, 
    raw_mp 
}) {
    const insertQuery = `
        INSERT INTO plans (
            merchant_id, 
            name, 
            amount, 
            currency, 
            interval_count, 
            interval_unit, 
            mp_preapproval_plan_id, 
            status, 
            raw_mp, 
            init_point, 
            created_at, 
            updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING ${PUBLIC_COLUMNS}
    `;
    const values = [
        merchant_id, 
        name, 
        amount, 
        currency, 
        interval_count, 
        interval_unit, 
        mp_preapproval_plan_id, 
        status, 
        raw_mp, 
        raw_mp.init_point
    ];
    
    try {
        const { rows } = await pool.query(insertQuery, values);
        return rows[0];
    } catch (error) {
        console.error("❌ Error en repo.createPlan:", error);
        throw error;
    }
}

async function getPlansByMerchant(merchant_id) {
    const query = `SELECT ${PUBLIC_COLUMNS} FROM plans WHERE merchant_id = $1 ORDER BY created_at DESC`;
    try {
        const { rows } = await pool.query(query, [merchant_id]);
        return rows;
    } catch (error) {
        console.error("❌ Error en repo.getPlansByMerchant:", error);
        throw error;
    }
}

async function getPlanByIdAndMerchant(id, merchant_id) {
    const query = `SELECT ${PUBLIC_COLUMNS} FROM plans WHERE id = $1 AND merchant_id = $2`;
    try {
        const { rows } = await pool.query(query, [id, merchant_id]);
        return rows[0]; 
    } catch (error) {
        console.error("❌ Error en repo.getPlanByIdAndMerchant:", error);
        throw error;
    }
}

async function updatePlanStatus(id, merchant_id, status) {
    const query = `
        UPDATE plans 
        SET status = $1, updated_at = NOW() 
        WHERE id = $2 AND merchant_id = $3
        RETURNING ${PUBLIC_COLUMNS}
    `;
    try {
        const { rows } = await pool.query(query, [status, id, merchant_id]);
        return rows[0];
    } catch (error) {
        console.error("❌ Error en repo.updatePlanStatus:", error);
        throw error;
    }
}

async function getSubscriptionsByPlan(planId, merchantId) {
    const query = `
        SELECT * FROM subscriptions 
        WHERE plan_id = $1 AND merchant_id = $2
        ORDER BY created_at DESC
    `;
    
    const { rows } = await pool.query(query, [planId, merchantId]);
    return rows;
}

module.exports = { 
    createPlan, 
    getPlansByMerchant, 
    getPlanByIdAndMerchant, 
    updatePlanStatus,
    getSubscriptionsByPlan,
};