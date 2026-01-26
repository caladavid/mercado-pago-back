// src/modules/one_time_checkout/services/saveCardForCheckout.service.js
const crypto = require("crypto");
const {
  createCustomer,
  searchCustomerByEmail,
  saveCardToCustomer,
} = require("../../../integrations/mercadopago/mpClient");
const mpCustomersRepo = require("../repos/mpCustomers.repo");
const paymentInstrumentsRepo = require("../repos/paymentInstruments.repo");
const { fi } = require("zod/v4/locales");

// En Chile MP suele manejar RUT u "Otro". Si llega CI, lo omitimos para no romper. :contentReference[oaicite:2]{index=2}
function normalizeIdentification(docTypeRaw, docNumberRaw) {
  const type = (docTypeRaw || "").trim().toUpperCase();
  const number = (docNumberRaw || "").trim();

  if (!type || !number) return undefined;

  // Permitir solo tipos “seguros” (ajusta según tu país si cambias de site).
  const allowed = new Set(["RUT", "OTRO", "OTRO"]); // "Otro" suele ser "Otro" en docs, pero en API a veces es "Otro"/"OTRO"
  // Nota: si MP espera "Otro" literal, puedes enviar "Otro". Aquí mandamos "OTRO" por consistencia.
  // Si te da error por case, cambia a "Otro".

  if (!allowed.has(type)) {
    console.warn(`[MP] Skipping identification type '${type}' (not allowed for this site)`);
    return undefined;
  }

  return { type: type === "OTRO" ? "Otro" : type, number };
}

function splitName(fullName) {
  const name = (fullName || "").trim();
  if (!name) return { first: undefined, last: undefined };
  const parts = name.split(/\s+/);
  return {
    first: parts[0] || undefined,
    last: parts.slice(1).join(" ") || undefined,
  };
}

async function saveCardForCheckout({ externalReference, mpCardToken, payer }, tx) {
  // Normaliza externalReference por si viene URL-encoded (ej: %3A)
  const extRef = decodeURIComponent(externalReference || "");

  // 1) Buscar order + user
  const { rows } = await tx.query(
    `SELECT
        o.id as order_id,
        o.status as order_status,
        o.user_id,
        u.email,
        u.full_name,
        u.doc_type,
        u.doc_number
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE o.external_reference = $1
     LIMIT 1`,
    [extRef]
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

  if (!mpCardToken || String(mpCardToken).length < 10) {
    const err = new Error("Invalid mpCardToken");
    err.status = 400;
    throw err;
  }

  console.log("Saving card for user_id:", row);

  // 2) Email: fuente de verdad = DB; front solo complementa si DB está vacío
  const dbEmail = (row.email || "").trim().toLowerCase();
  const frontEmail = (payer?.email || "").trim().toLowerCase();

  let email = dbEmail;
  if (!email) {
    if (!frontEmail) {
      const err = new Error("Missing user email");
      err.status = 400;
      throw err;
    }
    email = frontEmail;
    await tx.query(`UPDATE users SET email = $1 WHERE id = $2`, [email, row.user_id]);
  } else if (frontEmail && frontEmail !== email) {
    const err = new Error("payer.email does not match checkout user email");
    err.status = 409;
    throw err;
  }

  // 3) Persistir doc si viene del front y DB no lo tenía
  if (payer?.doc_type && payer?.doc_number && (!row.doc_type || !row.doc_number)) {
    await tx.query(
      `UPDATE users
       SET doc_type = COALESCE($1, doc_type),
           doc_number = COALESCE($2, doc_number)
       WHERE id = $3`,
      [payer.doc_type, payer.doc_number, row.user_id]
    );
  }

// 4) Asegurar mp_customer en DB
  let mpCustomerRow = await mpCustomersRepo.findByUserId(row.user_id, tx);

  if (!mpCustomerRow) {
    console.log("Creating MP customer with email:", email);

    // [CORREGIDO] Definir nombres: Prioridad Front (payer) > Base de datos > Default
    const { first: dbFirst, last: dbLast } = splitName(row.full_name || "");
    const first_name = payer?.first_name || dbFirst || "Usuario";
    const last_name = payer?.last_name || dbLast || "Cliente";

    // [CORREGIDO] Construir objeto identificación
    // MP requiere esto para validar tarjetas de crédito/débito
    const docType = payer?.doc_type || row.doc_type || "CI"; // Default a CI si es Uruguay
    const docNumber = payer?.doc_number || row.doc_number;
    console.log("Using identification:", { docType, docNumber });
    const identification = docNumber ? {
      type: docType,
      number: docNumber
    } : undefined;

    // (Opcional pero recomendado) buscar customer por email para no duplicar
    let customerId = null;
    let customer;
    try {
      const search = await searchCustomerByEmail(email);
      const first = search?.results?.[0];
      
      // Si encontramos uno, lo usamos
      if (first?.id) {
        customer = first;
        customerId = first.id;
        console.log("[MP] searchCustomerByEmail found existing:", customerId);
      }
    } catch (e) {
      // Si falla el search, no bloqueamos: intentamos crear igual
      console.warn("[MP] searchCustomerByEmail failed, will try createCustomer:", e.status);
    }

    if (customerId) {
      console.log("[MP] Reusing existing customer ID:", customerId);
      // Nota: Si el customer existente no tenía DNI, podrías necesitar hacer un updateCustomer aquí,
      // pero por ahora asumimos que reutilizamos lo que hay.
    } else {
      const idempotencyKey = crypto.randomUUID();
      console.log("Creating new customer in MP with ident:", identification);
      
      customer = await createCustomer(
        {
          email,
          first_name,
          last_name,
          identification, // <--- ESTO ES LO QUE FALTABA
          metadata: { source: "mp_billing" },
        },
        { idempotencyKey }
      );
    }

    mpCustomerRow = await mpCustomersRepo.insertMpCustomer(
      {
        user_id: row.user_id,
        mp_customer_id: customer.id,
        email: customer.email || email,
        raw_mp: customer,
      },
      tx
    );
  }
  console.log("MP Customer Row:", mpCustomerRow);
  // 5) Guardar tarjeta en MP (asociada al customer) usando el token
  const cardIdempotencyKey = crypto.randomUUID();
  console.log("mpCardToken:", mpCardToken);
  console.log("Saving card to MP customer ID:", mpCustomerRow.mp_customer_id);
  console.log("Using idempotency key for card:", cardIdempotencyKey);
  const card = await saveCardToCustomer(
    mpCustomerRow.mp_customer_id,
    mpCardToken
  );

  // 6) Persistir referencia de tarjeta en tu DB
  const instrument = await paymentInstrumentsRepo.insertCardInstrument(
    {
      user_id: row.user_id,
      mp_customer_row_id: mpCustomerRow.id,
      mp_card_id: card.id,
      brand: card.payment_method?.id || card.payment_method?.name || null,
      last4: card.last_four_digits || null,
      exp_month: card.expiration_month || null,
      exp_year: card.expiration_year || null,
      raw_mp: card,
    },
    tx
  );

  return {
    instrument_id: instrument.id,
    brand: instrument.brand,
    last4: instrument.last4,
    exp_month: instrument.exp_month,
    exp_year: instrument.exp_year,
  };
}

module.exports = { saveCardForCheckout };
