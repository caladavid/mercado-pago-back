const { z } = require("zod");
const crypto = require("crypto");
const { withTransaction } = require("../../../shared/db/withTransaction");
const {
  createPayment,
  searchPaymentMethodsByBin,
  createCustomer,
  searchCustomerByEmail,
  createTokenFromCardId,
  createCustomerCards,
} = require("../../../integrations/mercadopago/mpClient");
const mpCustomersRepo = require("../repos/mpCustomers.repo");
const { createSubscriptionFromPlan, processSubscriptionLogic } = require("../../subscriptions/controllers/subscriptions.controller");
const { upsertUser } = require("../repos/checkout.repo");

const PayBodySchema = z.object({
  mp_card_token: z.string().min(10).optional(),
  mp_registration_token: z.string().optional(),
  back_url: z.string().url().optional(),
  token: z.string().min(10).optional(),
  card_id: z.string().optional(),
  save_card: z.boolean().optional(),
  security_code: z.string().min(3).max(4).optional(),
  preapproval_plan_id: z.string().optional(),
  payment_method_id: z.string().min(2).optional(),
  issuer_id: z.number().int().optional(),
  bin: z.string().min(6).optional(),
  transaction_amount: z.number().positive().optional(),
  installments: z.number().int().positive().optional(),
  description: z.string().min(3).optional(),
  idempotency_key: z.string().min(6).optional(),
  payer: z.object({
    email: z.string().email(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    doc_type: z.string().optional(),
    doc_number: z.string().optional(),
  }),
});

/**
 * Busca la orden y valida que esté pendiente y pertenezca al usuario correcto.
 */
async function fetchAndValidateOrder(tx, externalReference, payerData){
  const payerEmail = payerData.email;

  const { rows } = await tx.query(
    `SELECT
        o.id as order_id,
        o.status as order_status,
        o.total_amount,
        o.currency,
        o.external_reference,
        o.type,
        o.back_url,
        u.id as user_id,
        p.mp_preapproval_plan_id,
        u.email,
        u.full_name,
        u.doc_type,
        u.doc_number
      FROM orders o
      JOIN users u ON u.id = o.user_id
      LEFT JOIN plans p ON o.plan_id = p.id
      WHERE o.external_reference = $1
      LIMIT 1`,
    [externalReference]
  );

  if (!rows.length) {
    const err = new Error("Checkout not found");
    err.status = 404;
    throw err;
  }

  const row = rows[0];
  if (row.order_status !== "pending" && row.order_status !== "failed" && row.order_status !== "rejected") {
    const err = new Error(`Checkout is not pending (Estado actual: ${row.order_status})`);
    err.status = 409;
    throw err;
  }
  
  if (payerEmail && payerEmail !== row.email) {
    await tx.query(`UPDATE users SET email = $1 WHERE id = $2`, [payerEmail, row.user_id]);
  }

  return row;
}

/**
 * Garantiza que exista un Customer en MP y en nuestra DB.
 */
async function ensureMpCustomer(tx, userId, payerData, rowData, idempotencyKey) {
  let mpCustomerRow = await mpCustomersRepo.findByUserId(rowData.user_id, tx);

  if (mpCustomerRow) {
    return mpCustomerRow.mp_customer_id;
  }

  const payerEmail = payerData.email || rowData.email;
  let customer = null;
  let customerId = null;

  try {
    const search = await mpClient.searchCustomerByEmail(payerEmail);
    const first = search?.results?.[0];
    if (first?.id) {
      customer = first;
      customerId = first.id;
      console.log("🔍 Customer encontrado en MP por email:", customerId);
    }
  } catch (e) {
    console.warn("[MP] searchCustomerByEmail failed:", e.status);
  }

  if (!customerId) {
    const { first: dbFirst, last: dbLast } = splitName(rowData.full_name || "");
    const first_name = (payerData.first_name || dbFirst || "Nombre").trim();
    const last_name = (payerData.last_name || dbLast || "Apellido").trim();
    const identification =
      payerData.doc_type && payerData.doc_number
        ? { type: payerData.doc_type, number: payerData.doc_number }
        : rowData.doc_type && rowData.doc_number
          ? { type: rowData.doc_type, number: rowData.doc_number }
          : undefined;

    try {
      customer = await createCustomer(
        {
          email: payerEmail,
          first_name,
          last_name,
          identification,
          metadata: { 
            source: "mp_billing",
            local_user_id: userId.toString() 
          },
        },
        { idempotencyKey }
      );
      customerId = customer.id;
      console.log("✨ Nuevo Customer creado en MP:", customerId);
    } catch (error) {
        console.error("❌ Error creando customer en MP:", error.payload || error);
      throw error;
    }
  }

  mpCustomerRow = await mpCustomersRepo.insertMpCustomer(
    {
      user_id: userId,
      mp_customer_id: customerId,
      email: customer.email || payerEmail,
      raw_mp: customer,
    },
    tx
  );

  return customerId;
}

/**
 * Obtiene un token fresco (re-tokenización) si hay CVV.
 */
async function getFreshToken(cardToken, cvv) {
  if (!cardToken || !cvv) return cardToken;

  try {
    const tokenResponse = await createTokenFromCardId(cardToken, cvv);
    if (tokenResponse && tokenResponse.id){
      console.log(`[Checkout] ✅ Nuevo Token Generado: ${tokenResponse.id}`);
      return tokenResponse.id;
    }
  } catch (error) {
    console.error("❌ Error al generar token fresco:", error.message);
  }

  return cardToken;
}

/**
 * Ejecuta la transacción en MP (Suscripción o Pago Único).
 */
async function executeMpTransaction(strategy, data) {
  const { planId, token, amount, email, customerId, ref, methodId, installments, description, idempotencyKey } = data;

  // CASO A: SUSCRIPCIÓN
  if (strategy === 'subscription') {
    const subPayload = {
      preapproval_plan_id: planId || data.preapproval_plan_id,
      card_token_id: token,
      payer_email: email,
      status: "pending",
      external_reference: ref,
      user_id: data.userId,
      back_url: "https://tudominio.com/callback"
    };
    console.log("📦 PAYLOAD SUSCRIPCIÓN:", JSON.stringify(subPayload, null, 2));
    
    const result = await processSubscriptionLogic(subPayload);
    
    const sub = result.mpSubscription;
    
    // Normalizamos respuesta
    return {
      id: sub.id,
      status: sub.status,
      status_detail: "subscription_created",
      transaction_amount: sub.auto_recurring?.transaction_amount || 0,
      currency_id: "UYU",
      payment_type_id: "subscription",
      payment_method_id: methodId,
      raw: sub
    };
  }

  // CASO B: PAGO ÚNICO
  const payPayload = {
    token,
    transaction_amount: Number(amount),
    description,
    installments: installments || 1,
    external_reference: ref,
    payment_method_id: methodId,
    payer: { 
      id: customerId, 
      email,
      /* first_name: payer.first_name,
      last_name: payer.last_name, */
    }
  };
  console.log("📦 PAYLOAD PAGO:", JSON.stringify(payPayload, null, 2));
  
  const payment = await createPayment(payPayload, { idempotencyKey });
  
  return {
    ...payment, // Ya tiene id, status, etc.
    raw: payment
  };
}

/**
 * Guarda el resultado en Base de Datos (Orders y Payments).
 */
async function persistTransactionResult(tx, row, payment, payloadSent, idempotencyKey) {
  const nextOrderStatus = (() => {
    if (payment.status === "approved") return "paid";
    if (payment.status === "rejected") return "failed";
    if (payment.status === "refunded") return "refunded";
    return "pending";
  })();

  await tx.query(
    `UPDATE orders
    SET 
      status = $1, 
      mp_merchant_order_id = COALESCE($2, mp_merchant_order_id),
      mp_payment_id = $3
    WHERE id = $4`,
    [
      nextOrderStatus, 
      payment.order?.id || null, 
      String(payment.id),
      row.order_id
    ]
  );

  await tx.query(
    `INSERT INTO payments
      (user_id, order_id, mp_payment_id, status, status_detail, amount, net_received_amount, currency,
        payment_method_id, payment_type_id, external_reference, instrument_id, idempotency_key,
        request_payload, response_payload)
      VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14::jsonb, $15::jsonb)`,
    [
      row.user_id,
      row.order_id,
      String(payment.id),
      payment.status || null,
      payment.status_detail || null,
      payment.transaction_amount || null,
      payment.transaction_details?.net_received_amount || null,
      payment.currency_id || row.currency || null,
      payment.payment_method_id || null,
      payment.payment_type_id || null,
      payment.external_reference || row.external_reference || null,
      null,
      idempotencyKey,
      payloadSent,
      payment.raw,
    ]
  );
}

async function resolvePaymentMethod(methodId, bin) {
  if (!methodId) return methodId;
  if (!bin) return null;

  const pm = await searchPaymentMethodsByBin(bin);
  const results = pm?.results || [];
  console.log("[PAY] payment_methods/search response:", {
    bin,
    count: results.length,
    ids: results.map((r) => r.id),
  });

  const preferredOrder = new Set(["visa", "master", "amex", "diners", "oca", "lider"]);
  const candidates = results.filter(
    (r) => r.payment_type_id === "credit_card" && r.status === "active"
  );
  candidates.sort((a, b) => {
    const aScore = preferredOrder.has(a.id) ? 0 : 1;
    const bScore = preferredOrder.has(b.id) ? 0 : 1;
    return aScore - bScore;
  });

  return candidates[0]?.id || null;
}

async function payCheckout(req, res, next) {
  try {
    const externalReference = decodeURIComponent(req.params.external_reference);
    const parsed = PayBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }

    const {
      mp_card_token,
      mp_registration_token,
      token,
      card_id,
      payment_method_id,
      issuer_id,
      bin,
      installments,
      description,
      idempotency_key,
      payer,
      preapproval_plan_id,
      security_code,
      back_url
    } = parsed.data;

    const initialCardToken = card_id || mp_card_token || token;
    if (!initialCardToken) return res.status(400).json({ error: "Token or Card ID required" });

    const result = await withTransaction(async (tx) => {

    const headerKey = req.headers["x-idempotency-key"];
    const idempotencyKey = headerKey || idempotency_key;
    if (!idempotencyKey) {
      const err = new Error("X-Idempotency-Key is required");
      err.status = 400;
      throw err;
    }
      
    const orderRow = await fetchAndValidateOrder(tx, externalReference, payer.email);

    if (back_url) {
      await tx.query(`UPDATE orders SET back_url = $1 WHERE id = $2`, [back_url, orderRow.order_id])
      orderRow.back_url = back_url;
    }

    const user = await upsertUser(tx, {
      email: payer.email,
      fullName: `${payer.first_name || ''} ${payer.last_name || ''}`.trim() || orderRow.full_name,
      docType: payer.doc_type || orderRow.doc_type,
      docNumber: payer.doc_number || orderRow.doc_number
    });

    const finalMethodId = await resolvePaymentMethod(payment_method_id, bin);
    const mpCustomerId = await ensureMpCustomer(tx, orderRow.user_id, payer, orderRow, idempotencyKey);
    const freshToken = await getFreshToken(initialCardToken, security_code);
    
    const planIdToUse = preapproval_plan_id || orderRow.mp_preapproval_plan_id;

    console.log("🔍 DEBUG PLAN ID:", { 
        fromBody: preapproval_plan_id, 
        fromDb: orderRow.mp_preapproval_plan_id,
        final: planIdToUse 
    });
    
    const strategy = (orderRow.type === 'subscription' || !!planIdToUse) 
                 ? 'subscription' 
                 : 'one_time';

    const transactionResult = await executeMpTransaction(strategy, {
        planId: planIdToUse,
        token: freshToken,
        amount: Number(orderRow.total_amount),
        email: payer.email,
        customerId: mpCustomerId,
        userId: user.id,
        ref: orderRow.external_reference,
        methodId: finalMethodId,
        installments,
        issuerId: issuer_id,
        description: description || `Checkout ${orderRow.external_reference}`,
        idempotencyKey: idempotency_key || req.headers["x-idempotency-key"]
      });

      // PASO G: Guardar en Base de Datos
      const payloadLog = preapproval_plan_id 
          ? { plan_id: preapproval_plan_id, card: freshToken } 
          : { token: freshToken, method: finalMethodId };

      await persistTransactionResult(tx, orderRow, transactionResult, payloadLog, idempotencyKey);

      const isApproved = transactionResult.status === "approved" || transactionResult.status === "authorized";

      if (isApproved && parsed.data.save_card && mpCustomerId) {
        try {
          await createCustomerCards(mpCustomerId, freshToken, finalMethodId);
          console.log("[Card] ✅ Tarjeta vinculada exitosamente");
        } catch (cardError) {
          console.error("[Card] ⚠️ No se pudo vincular la tarjeta:", cardError.payload || cardError.message);
        }
      }

      return {
        transactionResult,
        backUrl: orderRow.back_url // 👈 Sacamos la URL del scope de la transacción
    };
    });

    return res.status(201).json({
      ok: true,
      payment: {
        id: result.id,
        status: result.status,
        status_detail: result.status_detail,
        type: result.payment_type_id
      },
      back_url: result.back_url
    });
  } catch (e) {
    next(e);
  }
}

/* 
async function payCheckout(req, res, next) {
  try {
    const externalReference = decodeURIComponent(req.params.external_reference);

    const parsed = PayBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }

    const {
      mp_card_token,
      token,
      card_id,
      payment_method_id,
      issuer_id,
      bin,
      transaction_amount,
      installments,
      description,
      idempotency_key,
      payer,
      preapproval_plan_id,
      security_code
    } = parsed.data;

    const result = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT
            o.id as order_id,
            o.status as order_status,
            o.total_amount,
            o.currency,
            o.external_reference,
            u.id as user_id,
            u.email,
            u.full_name,
            u.doc_type,
            u.doc_number
         FROM orders o
         JOIN users u ON u.id = o.user_id
         WHERE o.external_reference = $1
         LIMIT 1`,
        [externalReference]
      );

      if (!rows.length) {
        const err = new Error("Checkout not found");
        err.status = 404;
        throw err;
      }

      const row = rows[0];
      if (row.order_status !== "pending") {
        const err = new Error("Checkout is not pending");
        err.status = 409;
        throw err;
      }

      const payerEmail = payer.email;
      if (payerEmail && payerEmail !== row.email) {
        await tx.query(`UPDATE users SET email = $1 WHERE id = $2`, [payerEmail, row.user_id]);
      }

      const identification =
        payer.doc_type && payer.doc_number
          ? { type: payer.doc_type, number: payer.doc_number }
          : row.doc_type && row.doc_number
            ? { type: row.doc_type, number: row.doc_number }
            : undefined;

      // Asegurar mp_customer (aunque no se guarde tarjeta)
      let mpCustomerRow = await mpCustomersRepo.findByUserId(row.user_id, tx);

      if (!mpCustomerRow) {
        let customerId = null;
        let customer;
        try {
          const search = await searchCustomerByEmail(payerEmail);
          const first = search?.results?.[0];
          if (first?.id) {
            customer = first;
            customerId = first.id;
          }
        } catch (e) {
          console.warn("[MP] searchCustomerByEmail failed:", e.status);
        }

        if (!customerId) {
          const { first: dbFirst, last: dbLast } = splitName(row.full_name || "");
          const first_name = payer.first_name || dbFirst || "Usuario";
          const last_name = payer.last_name || dbLast || "Cliente";
          const idempotencyKey = crypto.randomUUID();
          customer = await createCustomer(
            {
              email: payerEmail,
              first_name,
              last_name,
              identification,
              metadata: { source: "mp_billing" },
            },
            { idempotencyKey }
          );
        }

        mpCustomerRow = await mpCustomersRepo.insertMpCustomer(
          {
            user_id: row.user_id,
            mp_customer_id: customer.id,
            email: customer.email || payerEmail,
            raw_mp: customer,
          },
          tx
        );
      }

      let resolvedPaymentMethodId = payment_method_id;
      if (!resolvedPaymentMethodId && bin) {
        const pm = await searchPaymentMethodsByBin(bin);
        const results = pm?.results || [];
        console.log("[PAY] payment_methods/search response:", {
          bin,
          count: results.length,
          ids: results.map((r) => r.id),
        });

        // Prioriza tarjetas de credito activas y marcas comunes para evitar medios no soportados.
        const preferredOrder = new Set(["visa", "master", "amex", "diners", "oca", "lider"]);
        const candidates = results.filter(
          (r) => r.payment_type_id === "credit_card" && r.status === "active"
        );
        candidates.sort((a, b) => {
          const aScore = preferredOrder.has(a.id) ? 0 : 1;
          const bScore = preferredOrder.has(b.id) ? 0 : 1;
          return aScore - bScore;
        });
        resolvedPaymentMethodId = candidates[0]?.id || null;
      }
      
      let cardToken = card_id || mp_card_token || token;
      if (!cardToken) {
        const err = new Error("Se requiere un token o card_id para procesar el pago");
        err.status = 400;
        throw err;
      }

      let tokenToPay = cardToken
      const cvv = security_code

      if (cardToken && cvv){
        try {
          const tokenResponse = await createTokenFromCardId(cardToken, cvv);
          if (tokenResponse && tokenResponse.id){
            tokenToPay = tokenResponse.id
            console.log(`✅ Token generado exitosamente: ${tokenParaPagar}`);
          }
        } catch (error) {
          console.error("❌ Error al generar token fresco:", e.message);
        }
      }

      let resultPayment;

      if (preapproval_plan_id) {
        const subscriptionPayload = {
            preapproval_plan_id: preapproval_plan_id,
            card_token_id: tokenParaPagar, 
            payer_email: payerEmail,
            status: "pending", 
            external_reference: row.external_reference
        };

        console.log("📦 PAYLOAD SUSCRIPCIÓN:", JSON.stringify(subscriptionPayload, null, 2));

        
      }


      console.log("tokenParaPagar", tokenResponse);

      const mpPayload = {
        token: tokenParaPagar,
        transaction_amount: Number(transaction_amount || row.total_amount),
        description: description || `Checkout ${row.external_reference}`,
        installments: installments || 1,
        external_reference: row.external_reference,
        payment_method_id: resolvedPaymentMethodId,
        payer: {
          id: mpCustomerRow?.mp_customer_id,
          type: "customer",
          email: payerEmail,
          first_name: payer.first_name,
          last_name: payer.last_name,
          ...(identification ? { identification } : {}),
        },
      };

      console.log("📦 PAYLOAD FINAL A MP:", JSON.stringify(mpPayload, null, 2));

      if (resolvedPaymentMethodId) {
        mpPayload.payment_method_id = resolvedPaymentMethodId;
      }

      if (issuer_id) {
        mpPayload.issuer_id = issuer_id;
      }

      const headerKey = req.headers["x-idempotency-key"];
      const idempotencyKey = headerKey || idempotency_key;
      if (!idempotencyKey) {
        const err = new Error("X-Idempotency-Key is required");
        err.status = 400;
        throw err;
      }

      const payment = await createPayment(mpPayload, {
        idempotencyKey,
      });

      const nextOrderStatus = (() => {
        if (payment.status === "approved") return "paid";
        if (payment.status === "rejected") return "failed";
        if (payment.status === "refunded") return "refunded";
        return "pending";
      })();

      await tx.query(
        `UPDATE orders
        SET 
          status = $1, 
          mp_merchant_order_id = COALESCE($2, mp_merchant_order_id),
          mp_payment_id = $3
        WHERE id = $4`,
        [
          nextOrderStatus, 
          payment.order?.id || null, 
          String(payment.id),
          row.order_id
        ]
      );

      await tx.query(
        `INSERT INTO payments
          (user_id, order_id, mp_payment_id, status, status_detail, amount, net_received_amount, currency,
           payment_method_id, payment_type_id, external_reference, instrument_id, idempotency_key,
           request_payload, response_payload)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10, $11, $12, $13,
           $14::jsonb, $15::jsonb)`,
        [
          row.user_id,
          row.order_id,
          String(payment.id),
          payment.status || null,
          payment.status_detail || null,
          payment.transaction_amount || null,
          payment.transaction_details?.net_received_amount || null,
          payment.currency_id || row.currency || null,
          payment.payment_method_id || null,
          payment.payment_type_id || null,
          payment.external_reference || row.external_reference || null,
          null,
          idempotencyKey,
          mpPayload,
          payment,
        ]
      );

      return payment;
    });

    return res.status(201).json({
      ok: true,
      payment: {
        id: result.id,
        status: result.status,
        status_detail: result.status_detail,
      },
    });
  } catch (e) {
    next(e);
  }
} */


module.exports = { payCheckout };
function splitName(fullName) {
  const name = (fullName || "").trim();
  if (!name) return { first: undefined, last: undefined };
  const parts = name.split(/\s+/);
  return {
    first: parts[0] || undefined,
    last: parts.slice(1).join(" ") || undefined,
  };
}
