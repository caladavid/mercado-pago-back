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
      -- 1. Traemos los pagos únicos (One Time) desde tu tabla 'payments'
      SELECT 
        p.id::text, 
        p.amount::text as total_amount, 
        p.currency,
        p.status, 
        'one_time' as type, 
        p.external_reference,
        p.created_at,
        NULL as plan_id, 
        p.mp_payment_id
      FROM public.payments p
      JOIN public.users u ON p.user_id = u.id
      WHERE p.merchant_id = $1 
        AND p.subscription_id IS NULL
        AND LOWER(u.email) = LOWER($2)

      UNION ALL

      -- 2. Traemos el estado ACTUAL de cada suscripción desde tu tabla 'subscriptions'
      SELECT 
        s.id::text, 
        s.transaction_amount::text as total_amount, 
        s.currency,
        s.status, 
        'subscription' as type, 
        s.mp_preapproval_id as external_reference,
        s.created_at,
        s.plan_id::text,
        NULL as mp_payment_id -- Las suscripciones en esta tabla no tienen un payment_id fijo
      FROM public.subscriptions s
      JOIN public.users u ON s.user_id = u.id
      WHERE s.merchant_id = $1 
        AND LOWER(u.email) = LOWER($2)

      ORDER BY created_at DESC;
    `;
    
    const { rows } = await pool.query(sql, [merchantId, email]);
    return rows;
  }
};