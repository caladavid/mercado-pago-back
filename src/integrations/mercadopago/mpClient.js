// src/integrations/mercadopago/mpClient.js
const BASE_URL = "https://api.mercadopago.com";

const fetchFn = global.fetch ? global.fetch.bind(global) : require("node-fetch");

function getTokenOrThrow() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    const err = new Error("MercadoPago access token missing: set MP_ACCESS_TOKEN env");
    err.status = 500;
    throw err;
  }
  return token;
}

function mpHeaders({ idempotencyKey } = {}) {
  const token = getTokenOrThrow();
console.log("Using MP access token of length:", token);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };

  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

  // Log seguro (sin token completo)
  const prefix = token.slice(0, 12);
  console.log("MP token prefix:", prefix, "len:", token.length);

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
  const q = encodeURIComponent(email);
  return mpRequest("GET", `/v1/customers/search?email=${q}`);
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

module.exports = {
  createCustomer,
  searchCustomerByEmail,
  saveCardToCustomer,
  createPayment,
  searchPaymentMethodsByBin,
};
