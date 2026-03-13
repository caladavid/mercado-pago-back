import { pool } from "../../../db/pool";

// Definimos qué parámetros puede recibir la búsqueda
export interface HistoryFilters {
  type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

// Definimos cómo luce una fila devuelta por SQL
export interface TransactionRow {
  id: string;
  amount: string | number;
  status: string;
  type: string;
  ref: string;
  date: Date;
  customer_name: string;
}

export const transactionsRepo = {

  // 📊 Obtener historial general (mezclado)
  getMerchantHistory: async (merchantId: string, filters: HistoryFilters): Promise<TransactionRow[]> => {
    const { type, status, limit = 20, offset = 0 } = filters;
    
    let sql = `
      SELECT 
        id, 
        user_id,
        total_amount, 
        currency,
        status, 
        type, 
        external_reference,
        mp_payment_id,
        created_at,
        updated_at
      FROM orders 
      WHERE merchant_id = $1
    `;

    const params: any[] = [merchantId];

    // Filtros dinámicos
    if (type) {
      params.push(type);
      sql += ` AND type = $${params.length}`;
    }
    
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    // Paginación
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(sql, params);
    return rows;
  },

  // 🔍 Obtener detalle de 1 sola transacción (Asegurando que sea de este Merchant)
  getTransactionById: async (transactionId: string, merchantId: string): Promise<any> => {
    const sql = `
      SELECT 
        o.id, 
        o.total_amount, 
        o.currency,
        o.status, 
        o.type, 
        o.external_reference,
        o.mp_payment_id,
        o.mp_merchant_order_id,
        o.description,
        o.created_at,
        u.id as user_id,
        u.full_name,
        u.email,
        u.doc_type,
        u.doc_number
      FROM public.orders o
      LEFT JOIN public.users u ON o.user_id = u.id
      WHERE o.id = $1 AND o.merchant_id = $2
    `;
    
    const { rows } = await pool.query(sql, [transactionId, merchantId]);
    
    // Como es un detalle único, devolvemos el primer objeto o "null" si no existe
    return rows.length > 0 ? rows[0] : null; 
  }
};