const { z } = require("zod");
const crypto = require("crypto");
const { withTransaction } = require("../../../shared/db/withTransaction");
const {
  createPayment,
  searchPaymentMethodsByBin,
  createCustomer,
  searchCustomerByEmail,
} = require("../../../integrations/mercadopago/mpClient");
const mpCustomersRepo = require("../repos/mpCustomers.repo");

const PayBodySchema = z.object({
  mp_card_token: z.string().min(10).optional(),
  token: z.string().min(10).optional(),
  payment_method_id: z.string().min(2).optional(),
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
      payment_method_id,
      bin,
      transaction_amount,
      installments,
      description,
      idempotency_key,
      payer,
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
      console.log("[PAY] resolved payment_method_id:", resolvedPaymentMethodId);
      const cardToken = mp_card_token || token;
      if (!cardToken) {
        const err = new Error("token required");
        err.status = 400;
        throw err;
      }

      const mpPayload = {
        token: cardToken,
        transaction_amount: Number(transaction_amount || row.total_amount),
        description: description || `Checkout ${row.external_reference}`,
        installments: installments || 1,
        payer: {
          email: payerEmail,
          first_name: payer.first_name,
          last_name: payer.last_name,
          ...(identification ? { identification } : {}),
        },
      };
      if (resolvedPaymentMethodId) {
        mpPayload.payment_method_id = resolvedPaymentMethodId;
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
         SET status = $1, mp_merchant_order_id = COALESCE($2, mp_merchant_order_id)
         WHERE id = $3`,
        [nextOrderStatus, payment.order?.id || null, row.order_id]
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
}

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
