const { pool } = require("../../../db/pool");

async function createPlan({ 
    name, 
    amount, 
    currency, 
    interval_count, 
    interval_unit, 
    mp_preapproval_plan_id, 
    status, 
    raw_mp, 
}) {
    const insertQuery = `
        INSERT INTO plans (
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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        RETURNING *
    `;

    const values = [
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
        console.error("Error en plan.createPlan:", error);
        throw error;
    }
}

module.exports = { createPlan };