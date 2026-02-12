const { pool } = require("../../../db/pool");

async function insertWebhookEvent(
  {
    provider,
    topic,
    action,
    dataId,
    mpEventId,
    receivedAt,
    payload,
    processingStatus = "pending",
  },
  client = pool
) {
  const q = `
    INSERT INTO webhook_events
      (provider, topic, action, data_id, mp_event_id, received_at, processing_status, payload)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    ON CONFLICT (mp_event_id) DO NOTHING
    RETURNING id
  `;
  const { rows } = await client.query(q, [
    provider || null,
    topic || null,
    action || null,
    dataId || null,
    mpEventId || null,
    receivedAt || new Date().toISOString(),
    processingStatus,
    payload || {},
  ]);
  return rows[0];
}

async function updateOrderStatusByPaymentId(externalReference, mpStatus, paymentId) {
  const nextOrderStatus = (() => {
      if (mpStatus === "approved") return "paid";
      if (mpStatus === "rejected") return "failed";
      if (mpStatus === "refunded") return "refunded";
      if (mpStatus === "charged_back") return "disputed";
      if (mpStatus === "cancelled") return "cancelled";
      return "pending";
    })();

  const q = `  
    UPDATE orders   
    SET 
      status = $1, 
      mp_payment_id = COALESCE(mp_payment_id, $3),
      updated_at = NOW()  
    WHERE external_reference = $2  
    AND (
      status != 'paid'
      OR ($1 IN ('refunded', 'disputed'))
    )
    RETURNING id, external_reference, user_id, total_amount, currency  
  `;

  try {
    const { rows } = await pool.query(q, [
      nextOrderStatus, 
      externalReference,
      paymentId ? String(paymentId) : null
  ]); 

    return rows[0];
  } catch (error) {
    throw error;
  }
}

async function syncSubscription(mpSubscription) {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

    let localPlan = null;
    let localPlanId = null; 

    // -----------------------------------------------------------
    // 🔍 PASO 1: RECUPERAR EL PLAN (Prioridad Metadata)
    // -----------------------------------------------------------
    
    // 1. Intentamos leer el ID del plan desde Metadata (Ideal para Links)
    if (mpSubscription.metadata && mpSubscription.metadata.plan_id) {
        const planQuery = `SELECT * FROM plans WHERE id = $1`;
        const { rows } = await client.query(planQuery, [mpSubscription.metadata.plan_id]);
        localPlan = rows[0];
    }

    // 2. Si no, intentamos el ID nativo de MP (Ideal para Pagos con Tarjeta directa)
    if (!localPlan && mpSubscription.preapproval_plan_id) {
        const planQuery = `SELECT * FROM plans WHERE mp_preapproval_plan_id = $1`;
        const { rows } = await client.query(planQuery, [mpSubscription.preapproval_plan_id]);
        localPlan = rows[0];
    }

    // 3. Fallback: Por nombre
    if (!localPlan && mpSubscription.reason) {
        const planQueryName = `SELECT * FROM plans WHERE name = $1 LIMIT 1`;
        const { rows } = await client.query(planQueryName, [mpSubscription.reason]);
        localPlan = rows[0];
    }

    if (localPlan) {
        localPlanId = localPlan.id;
        console.log(`🔗 Plan vinculado: ${localPlan.name} (ID: ${localPlanId})`);
    } else {
        console.warn(`⚠️ Suscripción Custom (Sin Plan Local). Reason: ${mpSubscription.reason}`);
    }

    // -----------------------------------------------------------
    // 👤 PASO 2: RECUPERAR EL USUARIO
    // -----------------------------------------------------------
    let userId = mpSubscription.external_reference;

    // Si external_reference falló, miramos metadata
    if (!userId && mpSubscription.metadata && mpSubscription.metadata.user_id) {
        userId = mpSubscription.metadata.user_id;
    }

    // Si todo falla, miramos email
    if (!userId && mpSubscription.payer_email) {
         const userQuery = `SELECT id FROM users WHERE email = $1 LIMIT 1`;
         const { rows: users } = await client.query(userQuery, [mpSubscription.payer_email]);
         if (users.length > 0) userId = users[0].id;
    }

    if (!userId) {
        console.error(`❌ ERROR: Imposible identificar usuario para suscripción ${mpSubscription.id}`);
        return false;
    }

    // -----------------------------------------------------------
    // 💾 PASO 3: GUARDAR (Columnas corregidas según tu imagen)
    // -----------------------------------------------------------
    const upsertQuery = `
      INSERT INTO subscriptions (
        user_id,
        plan_id,
        mp_preapproval_id,
        status,
        reason,
        transaction_amount,
        currency,
        frequency,
        frequency_type,
        start_date,
        next_billing_at,
        created_at,
        updated_at,
        raw_mp
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), $12)
      ON CONFLICT (mp_preapproval_id) 
      DO UPDATE SET
        plan_id = EXCLUDED.plan_id,
        status = EXCLUDED.status,
        next_billing_at = EXCLUDED.next_billing_at,
        updated_at = NOW(),
        raw_mp = EXCLUDED.raw_mp;
    `;

    const values = [
      userId,
      localPlanId,
      mpSubscription.id,
      mpSubscription.status,
      mpSubscription.reason,
      mpSubscription.auto_recurring.transaction_amount,
      mpSubscription.auto_recurring.currency_id,
      mpSubscription.auto_recurring.frequency,
      mpSubscription.auto_recurring.frequency_type,
      mpSubscription.date_created,
      mpSubscription.next_payment_date,
      mpSubscription
    ];

    await client.query(upsertQuery, values);
    await client.query('COMMIT');
    
    return true;

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error syncSubscription:", error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { 
  insertWebhookEvent,
  updateOrderStatusByPaymentId,
  syncSubscription
};
