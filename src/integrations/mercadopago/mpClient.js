const { PreApproval, default: MercadoPagoConfig, PreApprovalPlan } = require("mercadopago");

// src/integrations/mercadopago/mpClient.js
const BASE_URL = "https://api.mercadopago.com";

const fetchFn = global.fetch ? global.fetch.bind(global) : require("node-fetch");

function getTokenOrThrow(isSubscription = false) {
  const token = isSubscription 
        ? process.env.MP_ACCESS_TOKEN2
        : process.env.MP_ACCESS_TOKEN;
  if (!token) {
    const err = new Error("MercadoPago access token missing: set MP_ACCESS_TOKEN env");
    err.status = 500;
    throw err;
  }
  return token;
}

/* function getTokenOrThrow() {
  const token = process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN2;
  if (!token) {
    const err = new Error("MercadoPago access token missing: set MP_ACCESS_TOKEN env");
    err.status = 500;
    throw err;
  }
  return token;
} */

// Función auxiliar para esperar (Sleep)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mpHeaders({ idempotencyKey, isSubscription = false } = {}) {
  const token = getTokenOrThrow(isSubscription);
/* console.log("Using MP access token of length:", token); */
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };

  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

  // Log seguro (sin token completo)
  const prefix = token.slice(0, 12);
  /* console.log("MP token prefix:", prefix, "len:", token.length); */

  return headers;
}

async function mpRequest(method, path, body, opts = {}) {
  const res = await fetchFn(`${BASE_URL}${path}`, {
    method,
    headers: mpHeaders(opts),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const requestId =
      res.headers.get("x-request-id") ||
      res.headers.get("x-mp-request-id") ||
      res.headers.get("x-correlation-id");

    const err = new Error(`MercadoPago ${method} ${path} failed (${res.status})`);
    err.status = res.status;
    err.payload = data;
    err.requestId = requestId || null;

    console.error("[MP ERROR]", {
      status: res.status,
      path,
      requestId: err.requestId,
      payload: JSON.stringify(data, null, 2),
    });

    throw err;
  }

  return data;
}

async function createCustomer(
  { email, first_name, last_name, identification, metadata },
  { idempotencyKey } = {}
) {
  return mpRequest(
    "POST",
    "/v1/customers",
    { email, first_name, last_name, identification, metadata },
    { idempotencyKey }
  );
}

// GET /v1/customers/search?email=...
async function searchCustomerByEmail(email) {
  if (!email) return null;
  const q = encodeURIComponent(email);
  
  try {
    // Usamos el mpRequest que ya tienes definido
    const response = await mpRequest("GET", `/v1/customers/search?email=${q}`);
    
    // Mercado Pago devuelve { results: [...] }
    if (response && response.results && response.results.length > 0) {
      return response; // Devolvemos el objeto completo para mantener compatibilidad
    }
    return { results: [] };
  } catch (error) {
    console.error(`[MP Client] Falló la búsqueda para ${email}:`, error.message);
    // Si falla la búsqueda, devolvemos una estructura vacía para no romper el código superior
    return { results: [] };
  }
}

async function searchSubscriptionCustomerByEmail(email) {
  if (!email) return null;
  const q = encodeURIComponent(email);
  
  try {
    // 💡 LA CLAVE: Pasamos el 4to argumento { isSubscription: true }
    // Esto activa MP_ACCESS_TOKEN2 en getTokenOrThrow
    const response = await mpRequest(
        "GET", 
        `/v1/customers/search?email=${q}`,
        null, // Body es null en GET
        { isSubscription: true } // Options
    );
    
    if (response && response.results && response.results.length > 0) {
      console.log(`[MP Sub] Usuario encontrado en cuenta suscripciones: ${email}`);
      return response;
    }
    return { results: [] };
  } catch (error) {
    console.error(`[MP Sub Client] Falló la búsqueda (Sub) para ${email}:`, error.message);
    return { results: [] };
  }
}

async function createSubscriptionCustomer(
  { email, first_name, last_name, identification, metadata },
  { idempotencyKey } = {}
) {
  return mpRequest(
    "POST",
    "/v1/customers",
    { email, first_name, last_name, identification, metadata },
    { idempotencyKey, isSubscription: false } // <--- Usa el Token 2
  );
}

// POST /v1/customers/{customer_id}/cards con { token }
async function saveCardToCustomer(customerId, token) {
  return mpRequest(
    "POST",
    `/v1/customers/${customerId}/cards`,
    { token }
  );
}

// POST /v1/payments
async function createPayment(
  {
    token,
    transaction_amount,
    description,
    installments,
    payment_method_id,
    payer,
    currency_id,
    external_reference,
  },
  { idempotencyKey } = {}
) {
  if (currency_id) {
    const err = new Error("currency_id is not supported in this payment request");
    err.status = 400;
    throw err;
  }
  return mpRequest(
    "POST",
    "/v1/payments",
    {
      token,
      transaction_amount,
      description,
      installments,
      payment_method_id,
      payer,
      external_reference,
    },
    { idempotencyKey }
  );
}

// GET /v1/payment_methods/search?bin=...
async function searchPaymentMethodsByBin(bin) {
  const q = encodeURIComponent(bin);
  const publicKey = process.env.MP_PUBLIC_KEY;
  if (!publicKey) {
    const err = new Error("MercadoPago public key missing: set MP_PUBLIC_KEY env");
    err.status = 500;
    throw err;
  }
  return mpRequest("GET", `/v1/payment_methods/search?bin=${q}&public_key=${encodeURIComponent(publicKey)}`);
}

// GET v1/payments/{id}
async function getPaymentFromMP(paymentId) {
  return mpRequest("GET", `/v1/payments/${paymentId}`)
}

// GET /preapproval/{id}
async function getSubscriptionFromMP(preapprovalId) {
  return mpRequest("GET", `/preapproval/${preapprovalId}`)
}

// POST v1/payments/{id}/refunds
async function createRefund(paymentId, amount = null, opts = {}) {
  const body = amount ? { amount } : {};
  return mpRequest(
    "POST",
    `/v1/payments/${paymentId}/refunds`,
    body,
    opts
  );
}

async function getRefundFromMP(refundId) {  
  return mpRequest("GET", "/v1/refunds/" + refundId);  
} 

// PUT v1/payments/{payment_id}
async function cancelPayment(paymentId, opts = {}) {
  return mpRequest(
    "PUT",
    `/v1/payments/${paymentId}`,   
    { status: "cancelled" },
    opts
  );
}

// GET v1/chargebacks/{id}
async function getChargeback(chargebackId) {
  return mpRequest("GET", `/v1/chargebacks/${chargebackId}`);
}

const client = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN2
});

async function createPreApproval(payload) {
  // 💡 TIP DE ORO: Agrega un log para ver con qué token estás intentando autorizar
  const tokenHint = process.env.MP_ACCESS_TOKEN2 ? process.env.MP_ACCESS_TOKEN2.substring(0, 15) : 'NULL';
  console.log(`[MP] Intentando crear suscripción con Token: ${tokenHint}...`);

  const preapproval = new PreApproval(client);
  
  try {
    return await preapproval.create({ 
      body: payload
    });
  } catch (error) {
    // 🛑 AQUÍ ESTABA EL "UNDEFINED":
    console.error("❌ ERROR EN SUSCRIPCIÓN (RAW):", JSON.stringify(error, null, 2)); 
    
    // A veces el error real está en error.cause o error.response.data
    if (error.cause) console.error("❌ CAUSA:", JSON.stringify(error.cause, null, 2));
    
    throw error;
  }
}

async function createPreApprovalPlan(planData) {
  const preapprovalPlan = new PreApprovalPlan(client);

  try {
    return await preapprovalPlan.create({ 
      body: planData
    })
  } catch (error) {
    console.error("❌ ERROR al crear Plan:", JSON.stringify(error, null, 2));
    throw error;
  }
}

// GET v1/customers/{id}/cards
async function getCustomerCards(customerId) {
  return mpRequest("GET", `/v1/customers/${customerId}/cards`);
}


// POST v1/customers/{id}/cards
async function createCustomerCards(customerId, token, attempt = 1) {
  // Según la doc que pasaste: solo necesitamos el token.
  // MP detecta automáticamente si es Visa, Master, Débito o Crédito.
  const payload = {
    token: token,
  };

  console.log(`📦 [Postman Style] Enviando SOLO token a MP para el cliente ${customerId}`);

  console.log(`📦 [MP Client] Intentando guardar tarjeta (Intento ${attempt})...`);

  try {
    return await mpRequest("POST", `/v1/customers/${customerId}/cards`, payload);
  } catch (error) {
    // 🧠 ESTRATEGIA DE REINTENTO:
    // Si MP da error 500 (Internal Error) o 409 (Conflicto temporal)
    // y es el primer intento, esperamos 1.5 segundos y probamos de nuevo.
    if (attempt === 1 && (error.status >= 500 || error.status === 409)) {
      console.warn(`⚠️ [MP Retry] Falló el guardado (Status ${error.status}). Reintentando en 1.5s...`);
      
      await sleep(1500); // Esperamos a que MP se "despierte"
      
      // Llamada recursiva (Intento 2)
      return createCustomerCards(customerId, token, 2);
    }
    
    // Si falla en el segundo intento o es otro error, lanzamos el error normal
    throw error;
  }
}
// DELETE v1/customers/{customer_id}/cards/{id}
async function deleteCustomerCards(customerId, cardId) {
  return mpRequest("DELETE", `/v1/customers/${customerId}/cards/${cardId}`);
}

// DELETE v1/customers/{customer_id}/cards/{id}
async function createTokenFromCardId(cardId, securityCode = null) {
  const body = { 
    card_id: cardId 
  };
  
  // Si tuvieras el CVV (seguridad) lo mandarías aquí
  if (securityCode) {
    body.security_code = securityCode; 
  }

  return mpRequest("POST", "/v1/card_tokens", body);
}

// PUT /preapproval/{id} -> Para cancelar suscripciones
async function cancelPreApproval(preapprovalId) {
  console.log(`🚫 [MP Client] Cancelando suscripción: ${preapprovalId}`);
  
  return mpRequest(
    "PUT", 
    `/preapproval/${preapprovalId}`, 
    { status: "cancelled" }, // 👈 El payload mágico
    { isSubscription: true } // ⚠️ MUY IMPORTANTE: Usar el token de suscripciones
  );
}


module.exports = {
  createCustomer,
  searchCustomerByEmail,
  saveCardToCustomer,
  createPayment,
  searchPaymentMethodsByBin,
  getPaymentFromMP,
  getRefundFromMP,
  createRefund,  
  cancelPayment,  
  getChargeback,  
  createPreApproval,
  getSubscriptionFromMP,
  createPreApprovalPlan,
  getCustomerCards,
  createCustomerCards,
  deleteCustomerCards,
  createTokenFromCardId,
  searchSubscriptionCustomerByEmail,
  createSubscriptionCustomer,
  cancelPreApproval,
};
