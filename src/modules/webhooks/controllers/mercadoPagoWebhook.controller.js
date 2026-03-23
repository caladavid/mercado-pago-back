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
const config = require("../../../config/env");


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
  console.log("👉 Request-ID:", requestId);
  console.log("👉 Signature Header:", signature);
  console.log("👉 Payload Data ID:", payload?.data?.id);

  const tsMatch = signature.match(/ts=([^,]+)/);
  const v1Match = signature.match(/v1=([^,]+)/);

  if (!tsMatch || !v1Match) return false;

  const ts = tsMatch[1];
  const v1 = v1Match[1];
  const dataId = payload?.data?.id;
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;

  /* const availableSecrets = [
    process.env.MP_WEBHOOK_SECRET,
    process.env.MP_WEBHOOK_SECRET2
  ].filter(Boolean); */

  const availableSecrets = config.webhookSecrets;
  
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

    const signature = req.headers["x-signature"];
    if (!signature){
      return res.status(400).json({ error: "Missing signature" });  
    }
    
    const requestId = req.headers["x-request-id"];
    if (!requestId){
      return res.status(400).json({ error: "Missing request id" });  
    }

    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    if (!verifySignature(signature, requestId, payload)) {
      console.error("❌ [verifySignature] Firma inválida rechazada.");
      return res.status(401).json({ error: "Firma inválida" });
    }

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
      return res.status(200).json({ ok: true, duplicate: true });
    }

    console.log(`[Webhook] Guardado en DB (ID interno: ${dbId}). Respondiendo 200 OK a MP.`);
    res.status(200).json({ ok: true, id: dbId, message: "Evento encolado para procesamiento" });

    processEventBackground(payload.type, payload)
      .then(async () => {
        if (dbId !== 'bypass_simulado') {
          await repo.updateWebhookStatus(dbId, "completed");
          console.log(`[Webhook DB] Evento ${dbId} marcado como 'completed'.`);
        }
      })
      .catch(async (error) => {
        console.error("[processEventBackground] Error en procesamiento de fondo:", error);
        if (dbId !== 'bypass_simulado'){
          await repo.updateWebhookStatus(dbId, "failed");
          console.error(`[Webhook DB] Evento ${dbId} marcado como 'failed'.`);
        }
      });

  } catch (error) {
    if (!res.headersSent) {
      next(error);
    } else {
      console.error("💥 [Webhook] Error tras enviar respuesta:", error);
    }
  }
}

/**
 * Enrutador principal de eventos en segundo plano de Mercado Pago.
 * Recibe el tipo de evento y el payload, y delega la ejecución al
 * manejador específico correspondiente (pagos, suscripciones, etc.).
 */
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

/**
 * Procesa los webhooks de tipo "payment".
 * Consulta la API de Mercado Pago para obtener el estado real del dinero 
 * y enruta el flujo dependiendo de si es un cobro automático (recurrente) 
 * o una compra tradicional (regular).
 */
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
        return; 
    }

    console.log(`[mpPayment] Consultando MP para conocer estado real del pago ID: ${mpPayment}...`);

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

/**
 * Maneja la creación de nuevos contratos de suscripción (Preapproval).
 * Sincroniza las fechas en la base de datos y envía el Webhook de ALTA
 * al Merchant (is_renewal: false) para que desbloquee el servicio al cliente.
 */
async function processApprovedSubscription(payload) {
    console.log(`📡 [processApprovedSubscription] Evento para suscripcion`);
    console.log(`                                            `);
    console.log("📦 [processApprovedSubscription - Payload Completo Recibido]:", JSON.stringify(payload, null, 2));
    console.log(`                                            `);

  try {
    /* console.log("data id:", payload.data.id); */
    const mpSubscription = await getSubscriptionFromMP(payload.data.id);
    console.log(`[mpSubscription] Consultando MP para conocer estado real de la suscripción: ${mpSubscription}...`);
    const { id, status, external_reference, next_payment_date, preapproval_plan_id } = mpSubscription;
    
    console.log(`[MP API]: Suscripción ${id} | Estado: '${status}' | Próximo Cobro: ${next_payment_date || 'N/A'}`);
    const isSynced = await repo.syncSubscription(mpSubscription);

    if (!isSynced) {
        console.warn(`⚠️ No se pudo sincronizar la suscripción ${id} en la BD local.`);
        return;
    }
    
    if (status === "authorized") {
      console.log(`✅ Suscripción ${id} ACTIVA y cobrando.`);
      let orderRow = null;

      if (external_reference) {
        try {
          await repo.updateOrderStatusByPaymentId(external_reference, "authorized", id);
          console.log(`🎉 [updateOrderStatus] Orden ${external_reference} vinculada al contrato.`);
          orderRow = await ordersRepo.getOrderById(external_reference);
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

      if (orderRow) {
          const merchant = await merchantRepo.getMerchantById(orderRow.merchant_id);
          
          if (merchant && merchant.webhook_url) {
              // Obtenemos el monto del objeto auto_recurring de Mercado Pago
              const amount = mpSubscription.auto_recurring?.transaction_amount;

              const payloadNotificacion = {
                  type: 'subscription',
                  is_renewal: false, 
                  id_subscription: id, 
                  plan_id: preapproval_plan_id,
                  name: orderRow.full_name || orderRow.user_name,
                  email: orderRow.email || orderRow.user_email,
                  status: status, 
                  amount: amount,
                  fecha: new Date().toISOString(),
                  local_go_id: external_reference
              };

              notifyMerchants(merchant.webhook_url, payloadNotificacion, merchant.webhook_secret)
                  .then(res => console.log(`📡 [Dispatcher] Merchant notificado del ALTA de Suscripción (Status: ${res.status})`))
                  .catch(err => console.error(`❌ [Dispatcher] Error notificando alta de suscripción al Merchant:`, err));
          } else {
              console.warn(`⚠️ No se notificó al merchant porque no se encontró o no tiene webhook_url (Merchant ID: ${orderRow.merchant_id})`);
          }
      } else {
          console.warn(`⚠️ No se pudo notificar al merchant porque no se encontró la orden original para la ref: ${external_reference}`);
      }
    }

  } catch (error) {
    console.error("💥 Error in processApprovedSubscription:", error);
  }

}

/**
 * Maneja los cobros automáticos posteriores al primer mes (Renovaciones).
 * Guarda el historial del pago en la BD y notifica al Merchant para 
 * mantener activo el servicio (is_renewal: true) o suspenderlo si falla.
 */
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
        let preapprovalPlanId = null;

        if (mpPreapprovalId) {
            const subRecord = await subsRepo.getSubscriptionByMPId(mpPreapprovalId);
            if (subRecord) {
                localSubscriptionId = subRecord.id;
            }

            try {
                const subMP = await getSubscriptionFromMP(mpPreapprovalId);
                if (subMP && subMP.preapproval_plan_id) {
                    preapprovalPlanId = subMP.preapproval_plan_id;
                    console.log(`[DEBUG] Plan ID obtenido para el recobro: ${preapprovalPlanId}`);
                }
            } catch (mpError) {
                console.warn(`⚠️ No se pudo obtener la info del plan desde MP para el recobro:`, mpError.message);
            }
        }

        if (!localSubscriptionId) {
            console.warn(`⚠️ [Recobro] No se encontró la suscripción local para el preapproval ${mpPreapprovalId}. El pago no se podrá guardar con subscription_id.`);
        }


        const merchant = await merchantRepo.getMerchantById(orderRow.merchant_id);

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
                is_renewal: true,
                id_subscription: orderRow.mp_payment_id, 
                plan_id: preapprovalPlanId,
                name: orderRow.full_name, 
                email: orderRow.email, 
                status: status, 
                amount: transaction_amount,
                fecha: new Date().toISOString(),
                local_go_id: external_reference
            };

            console.log("🚀 ENVIANDO A SUPABASE EL SIGUIENTE PAYLOAD:", JSON.stringify(payloadNotificacion, null, 2));

            notifyMerchants(merchant.webhook_url, payloadNotificacion, merchant.webhook_secret)
                    .then(res => console.log(`📡 [Dispatcher] Merchant: ${merchant.name} - notificado (Status: ${res.status})`))
                    .catch(err => console.error(`❌ [Dispatcher] Error notificando a ${merchant.name}:`, err));

        } else if (status === "rejected" || status === "cancelled") {
            console.warn(`[Recobro-Status] Recobro rechazado o cancelado. Motivo: ${status_detail}`);

            const payloadRechazo = {
                type: 'subscription',
                is_renewal: true,
                id_subscription: orderRow.mp_payment_id, 
                plan_id: preapprovalPlanId,
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

/**
 * Maneja los pagos regulares (compras únicas).
 * Actualiza el estado de la orden y notifica al Merchant.
 */
async function handleRegularPayment(mpPayment, paymentId) {
    const { status, status_detail, transaction_amount, external_reference } = mpPayment;

    console.log(`🛒 ES UN PAGO REGULAR (Orden: ${external_reference}). Actualizando tabla orders...`);
    
    try {
        const result = await repo.updateOrderStatusByPaymentId(external_reference, status, paymentId);
        
        if (!result) {
            console.log(`[Webhook] La orden ${external_reference} ya estaba actualizada o no requiere cambios.`);
            return;
        }

        const orderRow = await ordersRepo.getOrderById(external_reference);
        if (!orderRow) return;

        const isFirstPaymentOfSubscription = orderRow.type === 'subscription';  

        if (isFirstPaymentOfSubscription) {
            console.log(`[Webhook] Primer cobro de la suscripción ${external_reference} guardado. Omitiendo notificación duplicada.`);
            return; 
        }

        const merchant = await merchantRepo.getMerchantById(orderRow.merchant_id);
        if (!merchant) return;

        const payloadNotificacion = {
            type: 'payment', // Especificamos que es un pago único
            id_payment: paymentId,
            status: status,
            status_detail: status_detail,
            amount: transaction_amount,
            fecha: new Date().toISOString(),
            local_go_id: external_reference,
            email: orderRow.email,
            name: orderRow.full_name
        };

        notifyMerchants(merchant.webhook_url, payloadNotificacion, merchant.webhook_secret)
            .then(res => console.log(`📡 [Dispatcher] Merchant Pago Único notificado (Status: ${res.status})`))
            .catch(err => console.error(`❌ Error notificando pago único:`, err));

    } catch (error) {
        console.error("💥 Error en handleRegularPayment:", error);
    }
}

module.exports = { receiveMercadoPagoWebhook };
