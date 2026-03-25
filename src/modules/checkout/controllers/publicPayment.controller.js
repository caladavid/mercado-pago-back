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
  searchSubscriptionCustomerByEmail, 
  createSubscriptionCustomer
} = require("../../../integrations/mercadopago/mpClient");
const mpCustomersRepo = require("../repos/mpCustomers.repo");
const { createSubscriptionFromPlan, processSubscriptionLogic } = require("../../subscriptions/controllers/subscriptions.controller");
const { upsertUser } = require("../repos/checkout.repo");
const { insertCardInstrument } = require("../repos/paymentInstruments.repo");
const config = require("../../../config/env");

const PayBodySchema = z.object({
  mp_card_token: z.string().min(10).optional(),
  mp_registration_token: z.string().optional(),
  back_url: z.string().url().optional(),
  success_url: z.string().url().optional(),
  error_url: z.string().url().optional(),
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
        o.merchant_id,
        o.status as order_status,
        o.total_amount,
        o.currency,
        o.external_reference,
        o.type,
        o.back_url,
        o.success_url, 
        o.error_url,
        u.id as user_id,
        p.mp_preapproval_plan_id,
        u.email,
        u.full_name,
        u.doc_type,
        u.doc_number,

        pr.description,
        pr.name as title
      FROM orders o
      JOIN users u ON u.id = o.user_id
      LEFT JOIN plans p ON o.plan_id = p.id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products pr ON pr.id = oi.product_id
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
  const payerEmail = payerData.email || rowData.email;
  let mpCustomerRow = await mpCustomersRepo.findByUserId(userId, tx || null);

  if (!mpCustomerRow && payerEmail) {
    console.log(`🔎 Buscando localmente por email: ${payerEmail}`);
    mpCustomerRow = await mpCustomersRepo.findByEmail(payerEmail, tx || null);
  }

  if (mpCustomerRow) {
    if (!mpCustomerRow.user_id && userId) {
      console.log(`🔗 Vinculando User ID ${userId} al Customer ${mpCustomerRow.mp_customer_id}`);

      await mpCustomersRepo.insertMpCustomer({
        user_id: userId,
        mp_customer_id: mpCustomerRow.mp_customer_id,
        email: payerEmail,
        raw_mp: mpCustomerRow.raw_mp
      }, tx || null)
    }

    return mpCustomerRow.mp_customer_id;
  }

  let customerId = null;
  let customerRaw = {};


  const isSubscription = rowData.type === 'subscription' || !!rowData.mp_preapproval_plan_id;
  console.log(`🔎 Buscando Customer para: ${payerEmail} (Modo: ${isSubscription ? 'Suscripción/Token2' : 'Pago/Token1'})`);

  try {
    let search;

    // 2. BÚSQUEDA CONDICIONAL SEGÚN EL MODO
    if (isSubscription) {
        // Usamos la función que conecta con APP_USR-55...
        search = await searchSubscriptionCustomerByEmail(payerEmail);
    } else {
        // Usamos la función normal (TEST-84...)
        search = await searchCustomerByEmail(payerEmail);
    }

    const first = search?.results?.[0];
    
    if (first?.id) {
      customerId = first.id;
      customerRaw = first;
      console.log("✅ Customer encontrado en MP:", customerId);
    }
  } catch (e) {
    console.warn("[MP] Falló la búsqueda de customer:", e.message);
  }

  // 3. SI NO EXISTE, LO CREAMOS (CON CUIDADO)
if (!customerId) {
  const { first: dbFirst, last: dbLast } = splitName(rowData.full_name || "");

  let cleanFirst = (payerData.first_name || dbFirst || "Cliente").trim().replace(/[^a-zA-ZñÑáéíóúÁÉÍÓÚ\s]/g, "");
  let cleanLast = (payerData.last_name || dbLast || "Genérico").trim().replace(/[^a-zA-ZñÑáéíóúÁÉÍÓÚ\s]/g, "");

  // Si cleanLast quedó muy corto o vacío, usamos un apellido por defecto.
  if (cleanFirst.length < 2) cleanFirst = "Cliente";
  if (!cleanLast || cleanLast.length < 2) cleanLast = "Usuario";

  /* const first_name = (payerData.first_name || dbFirst || "Nombre").trim(); */

  // 🔥🔥🔥 EL BYPASS 🔥🔥🔥
  if (payerEmail.includes("@testuser.com")) {
      console.log(`⚠️ MODO TEST: Saltando creación de Customer para ${payerEmail}`);
      
      // Inventamos un ID falso para que tu Base de Datos local no de error
      customerId = "bypass_test_user_" + Date.now(); 
      customerRaw = { id: customerId, description: "Usuario de Prueba Bypass" };

      // ¡NO LLAMAMOS A createCustomer! Pasamos directo al return.
  } else {
      // --- LÓGICA NORMAL PARA USUARIOS REALES (GMAIL, ETC) ---
      console.log("✨ Creando nuevo Customer Real en MP...");
      try {
          const payload = { 
            email: payerEmail, 
            first_name: cleanFirst, 
            last_name: cleanLast
          };

          let newCustomer;
          if (isSubscription) {
             newCustomer = await createSubscriptionCustomer(payload, { idempotencyKey });
          } else {
             newCustomer = await createCustomer(payload, { idempotencyKey });
          }
          customerId = newCustomer.id;
          customerRaw = newCustomer;
      } catch (error) {
          throw error;
      }
  }
}

  // 4. Guardar en DB Local
  await mpCustomersRepo.insertMpCustomer(
    {
      user_id: userId || null,
      mp_customer_id: customerId,
      email: customerRaw.email || payerEmail,
      raw_mp: customerRaw,
    },
    tx || null
  );

  return customerId;
}

/**
 * Obtiene un token fresco (re-tokenización) si hay CVV.
 */
async function getFreshToken(cardToken, cvv, opts = {}) {
  if (!cardToken || !cvv) return cardToken;

  try {
    const tokenResponse = await createTokenFromCardId(cardToken, cvv, opts);
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
  const { planId, token, amount, email, customerId, ref, methodId, installments, description, idempotencyKey, backUrl, userId, merchantId } = data;

  console.log(`\n================= [MP PRE-FLIGHT CHECK] =================`);
  console.log(`🌍 Estrategia: ${strategy}`);
  console.log(`💲 Monto: ${amount} (Moneda configurada: ${config.isDev ? "UYU" : "CLP"})`);
  console.log(`👤 Email: ${email}`);
  console.log(`💳 Método detectado: ${methodId}`);
  console.log(`🔑 Token de cuenta usado (Primeros 14 chars): ${config.mpAccessToken ? config.mpAccessToken.substring(0, 14) + '...' : 'MISSING_TOKEN'}`);
  console.log(`=========================================================\n`);

  // CASO A: SUSCRIPCIÓN
  if (strategy === 'subscription') {
    if (!planId) throw new Error("Falta el preapproval_plan_id para la suscripción.");

    const subPayload = {
      preapproval_plan_id: planId,
      card_token_id: token,
      email: email,
      external_reference: ref,
      user_id: userId,
      back_url: backUrl,
      merchant_id: merchantId

    };

    console.log("📦 PAYLOAD SUSCRIPCIÓN:", JSON.stringify(subPayload, null, 2));
    
    // Llamamos a tu lógica de suscripciones
    const result = await processSubscriptionLogic(subPayload);
    
    // Adaptamos la respuesta para que parezca un "payment" y no rompa persistTransactionResult
    const sub = result.mpSubscription || result; 
    
    return {
      id: sub.id,
      status: sub.status, 
      status_detail: "subscription_created",
      transaction_amount: sub.auto_recurring?.transaction_amount || amount,
      currency_id: sub.auto_recurring?.currency_id || (config.isDev ? "UYU" : "CLP"),
      payment_type_id: "subscription",
      payment_method_id: methodId,
      raw: sub
    };
  }

  // CASO B: PAGO ÚNICO (Sin cambios, solo aseguramos el return correcto)
  const payPayload = {
    token,
    transaction_amount: Number(amount),
    description,
    installments: installments || 1,
    external_reference: ref,
    payer: { 
      email 
    } 
  };

  if (customerId && !customerId.startsWith('bypass_')) {
      payPayload.payer.id = customerId;
      payPayload.payer.type = "customer"; 
  }

    if (methodId) {
      payPayload.payment_method_id = methodId;
    }

  console.log("📦 PAYLOAD PAGO:", JSON.stringify(payPayload, null, 2));
  
  const payment = await createPayment(payPayload, { 
      idempotencyKey, 
      forceSubToken: data.forceSubToken || false 
  });
  
  return {
    id: payment.id,
    status: payment.status,
    status_detail: payment.status_detail,
    payment_type_id: payment.payment_type_id,
    payment_method_id: payment.payment_method_id,
    transaction_amount: payment.transaction_amount || Number(amount),
    currency_id: payment.currency_id || (config.isDev ? "UYU" : "CLP"),
    raw: payment
  };
}


/**
 * Guarda el resultado en Base de Datos (Orders y Payments).
 */
async function persistTransactionResult(tx, row, payment, payloadSent, idempotencyKey) {
  /* const nextOrderStatus = (() => {
    if (payment.status === "approved") return "paid";
    if (payment.status === "rejected") return "failed";
    if (payment.status === "refunded") return "refunded";
    return "pending";
  })(); */

  const nextOrderStatus = "pending"

  await tx.query(
    `UPDATE orders
    SET 
      status = CASE 
      WHEN status IN ('paid', 'failed') THEN status 
      ELSE $1 
    END,
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
  /* if (!methodId) return methodId; */
  if (methodId && methodId !== 'undefined' && methodId !== '') {
    return methodId; 
  }

  if (!bin) return null;

  const pm = await searchPaymentMethodsByBin(bin);
  const results = pm?.results || [];

  const candidates = results.filter(r => r.status === "active");

  return candidates[0]?.id || null;
}

async function payCheckout(req, res, next) {
  console.log(`[payCheckout] Iniciando cobro para ref: ${req.params.external_reference}`);
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
      save_card,
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
      console.log("🔍 [TRACK 1] Metodo detectado:", finalMethodId, "| BIN:", bin);

      const mpCustomerId = await ensureMpCustomer(tx, orderRow.user_id, payer, orderRow, idempotencyKey);
      console.log("🔍 [TRACK 2] MP Customer ID:", mpCustomerId);

      const { rows: customerRows } = await tx.query(
          `SELECT id FROM mp_customers WHERE mp_customer_id = $1 LIMIT 1`,
          [mpCustomerId]
      );

      const mpCustomerRow = customerRows[0]; 

      if (!mpCustomerRow) {
          console.warn("⚠️ No se encontró la fila local para el customer:", mpCustomerId);
      }

  /* if (req.body.action === 'save_only') {
      console.log("⚠️ [MODO DEBUG] Iniciando guardado directo con NULL...");
      // 🔥 Aquí aplicamos el fix también para tus pruebas
      try {
          // Intentamos guardar. Si es la tarjeta conflictiva (421301), esto fallará.
          await createCustomerCards(mpCustomerId, initialCardToken);
          console.log("✅ Tarjeta vinculada (Bypass).");
      } catch (e) {
          // Atrapamos el error para ver qué pasó, pero NO detenemos el flujo de prueba
          console.error("❌ [Save Only Error]: No se pudo guardar en MP:", e.message);
          // Opcional: Si quieres ver el error completo de MP descomenta esto:
          // console.error(JSON.stringify(e, null, 2));
      }
      
      return { 
          transactionResult: { id: "test_" + Date.now(), status: "approved", status_detail: "card_linked_only" }, 
          backUrl: orderRow.back_url 
      };
  } */


      const isSavedCard = !!card_id;
      let tokenForPayment = null;
      
      if (isSavedCard) {
          // Pagando con Tarjeta Guardada: Necesitamos CVV fresco
          console.log("💳 [TOKEN] Generando token fresco desde Card ID...");
          tokenForPayment = await getFreshToken(card_id, security_code);
          if (!tokenForPayment) {
              const err = new Error("No se pudo generar el token de seguridad (CVV) para la tarjeta guardada.");
              err.status = 400;
              throw err;
          }
      } else {
          // Pagando con Tarjeta Nueva: Usamos el token directo
          console.log("💳 [TOKEN] Usando token de nueva tarjeta.");
          tokenForPayment = mp_card_token || token;
      }

      const isSubscription = (orderRow.type === 'subscription' || !!preapproval_plan_id || !!orderRow.mp_preapproval_plan_id);
      const shouldSaveCard = save_card || isSubscription;
      const planIdToUse = preapproval_plan_id || orderRow.mp_preapproval_plan_id;
      const strategy = isSubscription ? 'subscription' : 'one_time';
      /* console.log("🚀 [TRACK 5] Enviando a Pago. Token/CardID final:", freshToken ? freshToken.substring(0, 10) + "..." : "NULL"); */

      console.log("🔍 [DEBUG PRE-TRANSACCION]:", {
          strategy,
          amount: orderRow.total_amount,
          token: tokenForPayment ? tokenForPayment.substring(0, 10) + "..." : "MISSING",
          methodId: finalMethodId,
          hasPayer: !!payer,
          payerEmail: payer?.email
      });

      // --- 2. 🔥 PRIMERO COBRAMOS 🔥 ---
      console.log(`[transactionResult] Enviando transacción (Estrategia: ${strategy}) con método: ${finalMethodId}...`);
      const transactionResult = await executeMpTransaction(strategy, {
          planId: planIdToUse,
          token: tokenForPayment,
          amount: Number(orderRow.total_amount),
          email: payer.email,
          customerId: isSavedCard ? mpCustomerId : null,
          userId: user.id,
          merchantId: orderRow.merchant_id,
          ref: orderRow.external_reference,
          methodId: finalMethodId,
          installments,
          issuerId: issuer_id,
          description: description || `Checkout ${orderRow.external_reference}`,
          idempotencyKey: idempotency_key || req.headers["x-idempotency-key"],
          backUrl: orderRow.back_url,
          order_id: orderRow.order_id,
        });

      /* let tokenForPayment = initialCardToken; */
      const txStatus = transactionResult.status;
      console.log(`[txStatus Respuesta síncrona: ${txStatus} (MP ID: ${transactionResult.id})`);
      const isRejected = txStatus === 'rejected' || txStatus === 'cancelled';

      if (!isRejected && shouldSaveCard && mpCustomerId && !mpCustomerId.startsWith('bypass_') && !isSavedCard) {
          try {
            console.log("mp_registration_token", mp_registration_token);
              const vaultToken = mp_registration_token || initialCardToken;
              console.log("[vaultToken] Cobro exitoso. Guardando la tarjeta...");

              const savedCard = await createCustomerCards(mpCustomerId, vaultToken);
              console.log("savedCard", savedCard);

              const realCardId = (savedCard && savedCard.id) ? savedCard.id : savedCard;
              
              if (realCardId) {
                  console.log(`✅ [Vault] Éxito. Nuevo Card ID: ${realCardId}`);
                  try {
                      console.log("💾 Registrando instrumento en DB local...");
                      // Asegúrate de tener acceso a 'orderRow' (de donde sacas el user_id)
                      // y a 'mpCustomerRow' (de donde sacas el UUID de la tabla local)
                      await insertCardInstrument({
                          user_id: orderRow.user_id,
                          mp_customer_row_id: mpCustomerRow.id, // El ID UUID de tu tabla mp_customers
                          mp_card_id: realCardId,
                          brand: savedCard.payment_method?.id || savedCard.payment_method?.name || 'card',
                          last4: savedCard.last_four_digits,
                          exp_month: savedCard.expiration_month,
                          exp_year: savedCard.expiration_year,
                          raw_mp: savedCard
                      }, tx);

                      console.log("💳 [DB SUCCESS] Tarjeta persistida en payment_instruments");
                  } catch (dbErr) {
                      // Logueamos pero no bloqueamos el pago si falla el guardado local
                      console.error("⚠️ Error guardando referencia local de tarjeta:", dbErr);
                  }
              }
          } catch (e) {
              /* console.error("❌ [Vault Error]:", e.message); */
              console.error("⚠️ Error guardando tarjeta (pero el cobro fue exitoso):", e.response?.data || e.message);
              /* if (isSubscription) throw e; */ 
          }
      }
      
        // PASO G: Guardar en Base de Datos
        const payloadLog = preapproval_plan_id 
            ? { plan_id: preapproval_plan_id, card: tokenForPayment } 
            : { token: tokenForPayment, method: finalMethodId };

        await persistTransactionResult(tx, orderRow, transactionResult, payloadLog, idempotencyKey);
        console.log(`[persistTransactionResult] Orden guardada en PENDING esperando Webhook asíncrono.`);


        const finalBackUrl = back_url || orderRow.back_url;
        const successRedirect = orderRow.success_url || orderRow.back_url || null;
        const errorRedirect = orderRow.error_url || orderRow.back_url || null;

        return {
          transactionResult,
          isRejected,
          backUrl: finalBackUrl,
          order_id: orderRow.order_id,
          successRedirect, 
          errorRedirect    
      };
    });

    console.log("result.transactionResult", result.transactionResult);

    const txStatus = result.transactionResult.status;
    const isRejected = result.isRejected;

    const successRedirect = result.successRedirect;
    const errorRedirect = result.errorRedirect;

    // Si es rechazado, devolvemos HTTP 400 y ok: false
    if (isRejected) {
      return res.status(400).json({
        ok: false,
        error: "Pago rechazado",
        code: result.transactionResult.status_detail, 
        payment: {
          id: result.transactionResult.id,
          status: txStatus,
          status_detail: result.transactionResult.status_detail,
          type: result.transactionResult.payment_type_id
        },
        redirect_url: errorRedirect
      });
    }

    return res.status(201).json({
      ok: true,
      payment: {
        id: result.transactionResult.id,
        status: result.transactionResult.status,
        status_detail: result.transactionResult.status_detail,
        type: result.transactionResult.payment_type_id,
        external_reference: externalReference
      },
      redirect_url: successRedirect
    });
  } catch (e) {
    console.error("=========================================");
    console.error("🔥 ERROR FATAL EN PRODUCCIÓN DETECTADO:");
    console.error("❌ [PAY_CHECKOUT_ERROR]:", e.response?.data || e.message);
    console.error(e); // Imprime el objeto de error completo
    console.error("Mensaje:", e.message);
    console.error("Stack:", e.stack);
    console.error("=========================================");

    let statusCode = 500;
    let errorCode = "server_error";
    let errorMessage = "Ocurrió un error interno en el servidor.";

    if (e.response?.data || e.payload) {
        const mpError = e.response?.data || e.payload;
        const cause = mpError.cause?.[0]; // MP suele enviar los detalles en un array 'cause'

        statusCode = e.response?.status || e.status || 400;
        errorCode = cause?.code || mpError.status_detail || mpError.error || mpError.status || "mp_api_error";
        errorMessage = cause?.description || mpError.message || "Error al comunicarse con Mercado Pago.";

    } else if (e.status && e.status !== 500) {
        statusCode = e.status;
        errorCode = "internal_validation";
        errorMessage = e.message;

    } else if (e.name === 'ZodError') {
        statusCode = 400;
        errorCode = "invalid_payload";
        errorMessage = "Los datos enviados no tienen el formato correcto.";
    }

    return res.status(statusCode).json({ 
        ok: false, 
        error: "Error en la transacción",
        code: String(errorCode), 
        details: errorMessage
    });
  }
}

module.exports = { payCheckout, ensureMpCustomer };
function splitName(fullName) {
  const name = (fullName || "").trim();
  if (!name) return { first: undefined, last: undefined };
  const parts = name.split(/\s+/);
  return {
    first: parts[0] || undefined,
    last: parts.slice(1).join(" ") || undefined,
  };
}
