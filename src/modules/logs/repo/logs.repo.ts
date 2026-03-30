import { pool } from "../../../db/pool";
import { ISaveLog } from "../logs.types";



export const saveLog = async (logData: ISaveLog): Promise<{ id: string } | void> => {
    const { 
        level = 'error', 
        source, 
        context, 
        message, 
        metadata = {} 
    } = logData;

    const query = `
        INSERT INTO system_logs (level, source, context, message, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id;
    `;
    const values = [level, source, context, message, JSON.stringify(metadata)];

    try {
        const { rows } = await pool.query(query, values);
        return rows[0];
    } catch (error: any) {
        // En logs, si falla la DB, solo hacemos console.error para no romper el flujo principal
        console.error("💥 [Repo Logs] Error fatal guardando log:", error.message);
    }
};