import { pool } from "../../../db/pool";

export interface CustomerRow {
  user_id: string;
  full_name: string;
  email: string;
  last_purchase: Date;
}

export interface CustomerFilters {
  limit?: number;
  offset?: number;
}

export const customerRepo = {

  // 👥 Listar clientes únicos de este Merchant
  getMerchantCustomers: async (merchantId: string, filters: CustomerFilters): Promise<CustomerRow[]> => {
    const { limit = 20, offset = 0 } = filters;

    // DISTINCT ON en PostgreSQL es genial para obtener la versión más reciente de un cliente
    const sql = `
      SELECT 
        u.id as user_id,
        u.full_name,
        u.email,
        u.doc_type,
        u.doc_number,
        COUNT(o.id) as total_orders,
        MAX(o.created_at) as last_purchase
      FROM public.users u
      JOIN public.orders o ON u.id = o.user_id
      WHERE o.merchant_id = $1
      GROUP BY 
        u.id, 
        u.full_name, 
        u.email, 
        u.doc_type, 
        u.doc_number
      ORDER BY last_purchase DESC
      LIMIT $2 OFFSET $3
    `;
    
    const { rows } = await pool.query(sql, [merchantId, limit, offset]);
    return rows;
  },

  // 👤 Historial específico de UN cliente (solo lo que le compró a este Merchant)
  getHistoryByUser: async (merchantId: string, userId: string): Promise<any[]> => {
    const sql = `
      SELECT 
        id, 
        total_amount, 
        currency,
        status, 
        type, 
        external_reference,
        created_at,
        o.plan_id,
        o.mp_payment_id
      FROM public.orders o
      WHERE o.merchant_id = $1 AND o.user_id = $2
      ORDER BY o.created_at DESC
      LIMIT 50
    `;
    
    const { rows } = await pool.query(sql, [merchantId, userId]);
    return rows;
  },

  getHistoryByEmail: async (merchantId: string, email: string): Promise<any[]> => {
    const sql = `
      SELECT 
        o.id, 
        o.total_amount, 
        o.currency,
        o.status, 
        o.type, 
        o.external_reference,
        o.created_at,
        o.plan_id,
        o.mp_payment_id         
      FROM public.orders o
      JOIN public.users u ON o.user_id = u.id
      WHERE o.merchant_id = $1 AND LOWER(u.email) = LOWER($2)
      ORDER BY o.created_at DESC
      LIMIT 50
    `;
    const { rows } = await pool.query(sql, [merchantId, email]);
    return rows;
  }
};