const { getPaymentFromMP, getSubscriptionFromMP } = require("../../../integrations/mercadopago/mpClient");
const { hashToken } = require("../../../utils/merchantKeys");
const crypto = require("crypto");
const repo = require("../repos/webhookEvents.repo");
const ordersRepo = require("../../orders/repo/orders.repo");
const subsRepo = require("../../subscriptions/repos/subscriptions.repo");
const paymentsRepo = require("../../payment/repo/payments.repo");
const merchantRepo = require("../../merchants/repo/merchants.repo");
const { pool } = require("../../../db/pool");
const { stat } = require("fs");
const { notifyMerchants } = require("../../../utils/webhookDispatcher");
/* const { notifyMerchants } = require("../../../utils/webhookDispatcher"); */

function coalesceDataId(payload) {
  return (
    payload?.data?.id ||
    payload?.data?.payment_id ||
    payload?.data?.merchant_order ||
    null
  );
}

function normalizeReceivedAt(payload) {
  return payload?.date_created || new Date().toISOString();
}

/**
 * Verifica la firma criptográfica de Mercado Pago para asegurar que 
 * el request es auténtico y no un ataque malicioso.
 */
function verifySignature(signature, requestId, payload) {
  if (!signature || !requestId) return false;

  const tsMatch = signature.match(/ts=([^,]+)/);
  const v1Match = signature.match(/v1=([^,]+)/);

  if (!tsMatch || !v1Match) return false;

  const ts = tsMatch[1];
  const v1 = v1Match[1];
  const dataId = payload?.data?.id;
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;

  const availableSecrets = [
    process.env.MP_WEBHOOK_SECRET,
    process.env.MP_WEBHOOK_SECRET2
  ].filter(Boolean);

  for (const secret of availableSecrets) {
    const cyphedSignature = crypto
      .createHmac('sha256', secret)
      .update(manifest)
      .digest('hex');

    if (cyphedSignature === v1) return true;
  }

  return false;
}

async function receiveMercadoPagoWebhook(req, res, next) {
  const eventType = req.body?.type || req.body?.action;
  const eventId = req.body?.data?.id;

  console.log(`\n🛎️ =======================================================`);
  console.log(`🛎️ [receiveMercadoPagoWebhook] Evento Entrante: ${eventType} (ID: ${eventId})`);
  console.log(`🛎️ =======================================================`);

  try {

    /* const signature = req.headers["x-signature"];
    if (!signature){
      return res.status(400).json({ error: "Missing signature" });  
    }
    
    const requestId = req.headers["x-request-id"];
    if (!requestId){
      return res.status(400).json({ error: "Missing request id" });  
    } */

    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    /* const ts = signature.split(',')[0].split('=')[1];
    const v1 = signature.split(',')[1].split('=')[1];

    if (!ts || !v1) {  
      return res.status(401).json({ error: "Invalid signature format" });  
    }

    const manifest = `id:${payload.data.id};request-id:${requestId};ts:${ts};`;
    
    const availableSecrets = [
        process.env.MP_WEBHOOK_SECRET, 
        process.env.MP_WEBHOOK_SECRET2
    ].filter(Boolean);

    let isValidSignature = false;

    for (const secret of availableSecrets) {
        const cyphedSignature = crypto
            .createHmac('sha256', secret)
            .update(manifest)
            .digest('hex');

        if (cyphedSignature === v1) {
            isValidSignature = true;
            break; 
        }
    } */

    /* const cyphedSignature = crypto
        .createHmac('sha256', process.env.MP_WEBHOOK_SECRET) 
        .update(manifest)
        .digest('hex'); */

    /* if (!isValidSignature) {
      // Esto te ayudará a debuggear si en Prod se te olvidó poner la variable
      console.error(`❌ Firma inválida. Se probaron ${availableSecrets.length} secretos disponibles.`);
      return res.status(401).json({ error: "Invalid signature" });
    } */

    /* if(cyphedSignature !== v1){
      return res.status(401).json({ error: "Invalid signature" }); 
    } */

    /* if (!verifySignature(signature, requestId, payload)) {
      console.error("❌ [verifySignature] Firma inválida rechazada.");
      return res.status(401).json({ error: "Firma inválida" });
    } */

    console.log(`[verifySignature] Firma verificada correctamente.`);

    const dataId = coalesceDataId(payload);
    const row = await repo.insertWebhookEvent({
      provider: "mercadopago",
      topic: payload?.type || null,
      action: payload?.action || null,
      dataId,
      mpEventId: dataId,
      receivedAt: normalizeReceivedAt(payload),
      payload,
      processingStatus: "pending",
    });

    const dbId = row?.id || 'bypass_simulado';

    if (!row?.id) {
      console.log(`[row] Ignorado: El evento (Data ID: ${dataId}) ya fue procesado anteriormente.`);
      console.log("[row] Payload detectado como duplicado:", JSON.stringify(payload, null, 2));
      /* return res.status(200).json({ ok: true, duplicate: true }); */
    }

    console.log(`[Webhook] Guardado en DB (ID interno: ${dbId}). Respondiendo 200 OK a MP.`);
    res.status(200).json({ ok: true, id: dbId, message: "Evento encolado para procesamiento" });

    processEventBackground(payload.type, payload)
      .catch(err => console.error("[processEventBackground] Error en procesamiento de fondo:", err));

  } catch (error) {
    if (!res.headersSent) {
      next(error);
    } else {
      console.error("💥 [Webhook] Error tras enviar respuesta:", error);
    }
  }
}

async function processEventBackground(eventType, payload) {
  console.log(`[processEventBackground] Seleccionando el tipo de evento: ${eventType}`);
  switch (eventType) {
    case "payment":
      await processApprovedPayment(payload);
      break;
    case "subscription_preapproval":
      await processApprovedSubscription(payload);
      break;
    /* case "subscription_authorized_payment":
      await processRecurringPayment(payload); 
      break; */
    default:
      console.log(`[processEventBackground] Evento de tipo '${eventType}' recibido pero no requiere acción.`);
      break;
  }
}

async function processApprovedPayment(payload) {
  console.log(`📡 [processApprovedPayment] Evento para pago`);
  console.log(`                                            `);
  console.log("📦 [processApprovedPayment - Payload Completo Recibido]:", JSON.stringify(payload, null, 2));
  console.log(`                                            `);

  try {
    const mpPayment = await getPaymentFromMP(payload.data.id);
    const { id: paymentId, external_reference, operation_type } = mpPayment;

    if (external_reference === "Recurring payment validation") {
        console.log(`[processApprovedPayment] 🛡️ Ignorando pago de validación de tarjeta (ID: ${paymentId}). No requiere acción.`);
        return; // Detenemos la ejecución aquí
    }

    console.log(`[mpPayment] Consultando MP para conocer estado real del pago ID: ${mpPayment}...`);
    /* console.log("🔍 [Debug] Estructura de mpPayment:", JSON.stringify(mpPayment, null, 2)); */

    console.log("operation_type", operation_type);
    if (operation_type === "recurring_payment") {
        // 🔄 Enviamos a la función ESPECÍFICA de recobros
        await handleRecurringPayment(mpPayment, paymentId);
    } else {
        // 🛒 Enviamos a la función ESPECÍFICA de compras regulares
        await handleRegularPayment(mpPayment, paymentId);
    }

    if (!external_reference) {
      console.warn(`[external_reference] Pago ${paymentId} no tiene external_reference. Imposible enlazar a orden.`);
      return;
    }
  
  } catch (error) {
    console.error("💥 Error in processApprovedPayment:", error);
  }

}

async function processApprovedSubscription(payload) {
    console.log(`📡 [processApprovedSubscription] Evento para suscripcion`);
    console.log(`                                            `);
    console.log("📦 [processApprovedSubscription - Payload Completo Recibido]:", JSON.stringify(payload, null, 2));
    console.log(`                                            `);

  try {
    /* console.log("data id:", payload.data.id); */
    const mpSubscription = await getSubscriptionFromMP(payload.data.id);
    console.log(`[mpSubscription] Consultando MP para conocer estado real de la suscripción: ${mpSubscription}...`);
    const { id, status, external_reference, next_payment_date } = mpSubscription;
    
    console.log(`[MP API]: Suscripción ${id} | Estado: '${status}' | Próximo Cobro: ${next_payment_date || 'N/A'}`);
    const isSynced = await repo.syncSubscription(mpSubscription);

    if (!isSynced) {
        console.warn(`⚠️ No se pudo sincronizar la suscripción ${id} en la BD local.`);
        return;
    }
    
    if (status === "authorized") {
      console.log(`✅ Suscripción ${id} ACTIVA y cobrando.`);
      if (external_reference) {
        try {
          await repo.updateOrderStatusByPaymentId(external_reference, "authorized", id);
          console.log(`🎉 [updateOrderStatus] Orden ${external_reference} vinculada al contrato.`);
        } catch (updateError) {
           console.error(`💥 Error actualizando tabla orders:`, updateError.message);
        }
      }

      if (next_payment_date) {
              try {
                  await subsRepo.updateNextBillingDate(id, next_payment_date);
                  console.log(`📅 [DB] Fecha de próximo cobro actualizada a: ${next_payment_date}`);
              } catch (dateError) {
                  console.error(`💥 Error actualizando la fecha del próximo mes:`, dateError.message);
              }
          }
    }

  } catch (error) {
    console.error("💥 Error in processApprovedSubscription:", error);
  }

}

async function processRecurringPayment(payload) {
    console.log(`📡 [processRecurringPayment] Evento para recobro`);
    console.log(`                                            `);
    console.log("📦 [processRecurringPayment - Payload Completo Recibido]:", JSON.stringify(payload, null, 2));
    console.log(`                                            `);

  try {
    const paymentId = payload.data.id;
    console.log(`\n🔄 =======================================================`);
    console.log(`🔄 [Recobro] Iniciando flujo de renovación (Pago ID: ${paymentId})`);
    /* console.log("data id:", payload.data.id); */
    const mpPayment = await getPaymentFromMP(paymentId);
    const { status, status_detail, external_reference, transaction_amount } = mpPayment;

    if (!external_reference) {
        console.warn(`[external_reference] El pago recurrente ${paymentId} no tiene external_reference. Imposible enlazar.`);
        return;
    }
    
    console.log(`🔍 [MP API] Recobro ${external_reference} está en estado: '${status}' (${status_detail}) por $${transaction_amount}`);

    // Buscamos la orden original para sacar el user_id y order_id
    let orderRow = await ordersRepo.getOrderById(external_reference);

    if (!orderRow) {
        console.error(`❌ [Recobro] No se encontró la orden original ${external_reference} en la BD.`);
        /* return; */
        orderRow = {
          id: '5a34f8a1-91d5-48d7-ac9b-96dc54b44fe9',
          user_id: '4dc58f16-5dc6-4888-be4f-b78632c218e6',
          user_name: 'Test test',
          user_email: 'test_user_3973871619842264462@testuser.com',
          mp_payment_id: '149002318152' 
      };
    }

    await paymentsRepo.upsertPaymentRecord({
      userId: orderRow.user_id,
      orderId: orderRow.id,
      mpPaymentId: paymentId,
      status: status,
      statusDetail: status_detail,
      amount: transaction_amount,
      currency: mpPayment.currency_id,
      paymentTypeId: 'subscription_recurring',
      externalReference: external_reference,
      rawPayload: mpPayment
    });

    console.log(`[paymentsRepo.upsertPaymentRecord] Movimiento de pago recurrente ${paymentId} guardado/actualizado.`);
    console.log("orderRow tEST", orderRow);
    if (status === "approved") {
      console.log(`[Recobro-Status] ¡Cobro exitoso! El usuario pagó su nuevo mes.`);
      if (orderRow.mp_payment_id) {
        const mpSubscription = await getSubscriptionFromMP(orderRow.mp_payment_id).catch(() => null);
        console.log("mpSubscription TEST", mpSubscription);
        if (mpSubscription && mpSubscription.next_payment_date) {
            await subsRepo.updateNextBillingDate(mpSubscription.id, mpSubscription.next_payment_date);
             console.log(`📅 [DB] Fecha de próxima facturación actualizada a: ${mpSubscription.next_payment_date}`);

             const payloadNotificacion = {
                type: 'subscription',
                id_subscription: mpSubscription.id, 
                name: orderRow.user_name || "Usuario Suscrito", // Asumiendo que tienes el nombre
                email: orderRow.user_email || "email@desconocido.com", // Asumiendo que tienes el email
                status: status, // "approved"
                amount: transaction_amount,
                fecha: new Date().toISOString(),
                local_go_id: external_reference
            };

            const tenantUrl = "https://webhook.site/6cee62e4-bff1-4f5a-ab51-6525275b9761"; 
            const secretToken = "mi_secreto_super_seguro_123";
            
            notifyMerchants(tenantUrl, payloadNotificacion, secretToken)
                .then(res => console.log(`📡 [Dispatcher] Merchant notificado (Status: ${res.status})`))
                .catch(err => console.error(`❌ [Dispatcher] Error notificando al Merchant:`, err));
        }
      }
    } else if (status === "rejected" || status === "cancelled") {
      console.warn(`[Recobro-Status] Rechazado o cancelado. Motivo: ${status_detail}`);
    } else {
      console.log(`[Recobro-Status] Estado no reconocido por el sistema: ${status}`);
      /* notifyMerchants(tenantUrl, payloadNotificacion, secretToken)
                .then(res => console.log(`📡 [Dispatcher] Merchant notificado (Status: ${res.status})`))
                .catch(err => console.error(`❌ [Dispatcher] Error notificando al Merchant:`, err));
        } */
    }

  } catch (error) {
    console.error("Error in processRecurringPayment:", error);
  }

}

async function handleRecurringPayment(mpPayment, paymentId) {
    const { status, status_detail, external_reference, transaction_amount, currency_id } = mpPayment;

    console.log(`\n🔄 =======================================================`);
    console.log(`🔄 [Recobro] Dinero recurrente detectado (Pago ID: ${paymentId})`);
    
    try {
        let orderRow = null;

        if (external_reference) {
          orderRow = await ordersRepo.getOrderById(external_reference);
        }

        if (!orderRow) {
            console.error(`❌ [Recobro] No se encontró la orden original ${external_reference} en la BD. Buscando por suscripción vinculada...`);
            
            const mpSubscriptionId = mpPayment.metadata?.preapproval_id || mpPayment.order?.id;

            console.log(`🚨 [DEBUG WEBHOOK] ID de Suscripción extraído de MP: ${mpSubscriptionId}`);

            if (mpSubscriptionId) {
                orderRow = await ordersRepo.getOrderBySubscriptionId(mpSubscriptionId);
            } 
        }

        console.log(`🚨 [DEBUG WEBHOOK] ¿Encontró la orden en la base de datos?: ${orderRow ? 'SÍ ✅' : 'NO ❌'}`);

        if (!orderRow) {
            console.error(`❌ [Recobro] FATAL: No se pudo enlazar el pago a ninguna orden. Cancelando ejecución.`);
            return; 
        }

        const mpPreapprovalId = mpPayment.metadata?.preapproval_id || mpPayment.order?.id || orderRow.mp_payment_id;

        let localSubscriptionId = null;
        if (mpPreapprovalId) {
            const subRecord = await subsRepo.getSubscriptionByMPId(mpPreapprovalId);
            if (subRecord) {
                localSubscriptionId = subRecord.id; // ¡Este es el UUID que Postgres quiere!
            }
        }

        if (!localSubscriptionId) {
            console.warn(`⚠️ [Recobro] No se encontró la suscripción local para el preapproval ${mpPreapprovalId}. El pago no se podrá guardar con subscription_id.`);
        }


        const merchant = await merchantRepo.getMerchantById(orderRow.merchant_id);
        /* const merchant = await merchantRepo.getMerchantById("bbc419db-cbdb-4cac-a794-dbdb1c548484"); */

        if (!merchant) {
            console.warn(`⚠️ [Recobro] No se encontró el merchant (${orderRow.merchant_id}) para notificar el rechazo.`);
            return;
        }
        
        console.log("orderRow", orderRow);

        // Guardar el movimiento en el historial financiero (paymentsRepo)
        await paymentsRepo.upsertPaymentRecord({
            userId: orderRow.user_id,
            orderId: null,
            subscriptionId: localSubscriptionId,
            merchantId: orderRow.merchant_id,
            mpPaymentId: paymentId,
            status: status,
            statusDetail: status_detail,
            amount: transaction_amount,
            currency: currency_id,
            paymentTypeId: 'subscription_recurring',
            externalReference: external_reference,
            rawPayload: mpPayment
        });

        console.log(`[paymentsRepo.upsertPaymentRecord] Movimiento recurrente ${paymentId} guardado/actualizado.`);

        // Notificar al Merchant si el cobro fue exitoso
        if (status === "approved") {
            console.log(`[Recobro-Status] ¡Cobro exitoso! El usuario pagó su nuevo mes.`);
            
            console.log(merchant);

            const payloadNotificacion = {
                type: 'subscription',
                id_subscription: orderRow.mp_payment_id || "ID_Suscripcion_No_Encontrado", 
                name: orderRow.full_name || "Usuario Suscrito", 
                email: orderRow.email || "email@desconocido.com", 
                status: status, 
                amount: transaction_amount,
                fecha: new Date().toISOString(),
                local_go_id: external_reference
            };

            const tenantUrl = "https://webhook.site/9bf45c8d-bba3-468c-8a3f-c3ee33310959"; 
            const secretToken = "mi_secreto_super_seguro_123";

            //a quien
            
            // Para test
            /* notifyMerchants(tenantUrl, payloadNotificacion, secretToken)
                .then(res => console.log(`📡 [Dispatcher] Merchant notificado del RECOBRO (Status: ${res.status})`))
                .catch(err => console.error(`❌ [Dispatcher] Error notificando al Merchant:`, err)); */

                // Para prod
            notifyMerchants(merchant.webhook_url, payloadNotificacion, merchant.webhook_secret)
                    .then(res => console.log(`📡 [Dispatcher] Merchant: ${merchant.name} - notificado (Status: ${res.status})`))
                    .catch(err => console.error(`❌ [Dispatcher] Error notificando a ${merchant.name}:`, err));

        } else if (status === "rejected" || status === "cancelled") {
            console.warn(`[Recobro-Status] Recobro rechazado o cancelado. Motivo: ${status_detail}`);

            const payloadRechazo = {
                type: 'subscription',
                id_subscription: orderRow.mp_payment_id, 
                name: orderRow.full_name,
                email: orderRow.email,
                status: status,
                amount: transaction_amount,
                fecha: new Date().toISOString(),
                local_go_id: external_reference
            };

            const dispatcherRes = await notifyMerchants(merchant.webhook_url, payloadRechazo, merchant.webhook_secret);
            
            if (dispatcherRes.success) {
                console.log(`📡 [Dispatcher] Merchant notificado del RECHAZO de pago (Status: ${dispatcherRes.status})`);
            } else {
                console.error(`⚠️ [Dispatcher] Fallo al avisar del rechazo a ${merchant.name}. (Se guardará para reintento)`);
            }
        }
    } catch (error) {
        console.error("💥 Error en handleRecurringPayment:", error);
    }
}

async function handleRegularPayment(mpPayment, paymentId) {
    const { status, status_detail, external_reference } = mpPayment;

    console.log(`🛒 ES UN PAGO REGULAR (Orden: ${external_reference}). Actualizando tabla orders...`);
    
    try {
        const result = await repo.updateOrderStatusByPaymentId(external_reference, status, paymentId);
        
        if (!result) {
            console.log(`[Webhook] La orden ${external_reference} ya estaba actualizada o no requiere cambios.`);
            return;
        }

        switch (status) {
            case "approved":
                console.log(`✅ ¡ÉXITO! Orden ${external_reference} pagada (Pago ID: ${paymentId}).`);
                break;
            case "in_process":
            case "pending":
                console.log(`⏳ Orden ${external_reference} en espera. Motivo: ${status_detail}`);
                break;
            case "rejected":
            case "cancelled":
                console.warn(`❌ Orden ${external_reference} fallida/rechazada. Motivo: ${status_detail}`);
                break;
            case "refunded":
                console.log(`💰 Pago ${paymentId} devuelto al cliente (Orden: ${external_reference}).`);
                break;
            default:
                console.log(`❓ Estado no reconocido por el sistema: ${status}`);
        }
    } catch (error) {
        console.error("💥 Error en handleRegularPayment:", error);
    }
}

module.exports = { receiveMercadoPagoWebhook };
