// src/modules/one_time_checkout/controllers/publicCards.controller.js
const { z } = require("zod");
const repo = require("../repos/cardsRead.repo");
const mpRepo = require("../repos/mpCustomers.repo");
const mpClient = require("../../../integrations/mercadopago/mpClient")

const { withTransaction } = require("../../../shared/db/withTransaction");
const { saveCardForCheckout } = require("../services/saveCardForCheckout.service");
const { getCheckoutByExternalReference } = require("../repos/checkoutRead.repo");
const { pool } = require("../../../db/pool");


const SaveCardBodySchema = z.object({
  mp_card_token: z.string().min(10),
  payer: z
    .object({
      email: z.string().email().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      doc_type: z.string().optional(),
      doc_number: z.string().optional(),
    })
    .optional(),
});

async function findMpCustomerSmart(ref) {
  // 1. Obtenemos datos de la orden (incluyendo email y user_id)
  const checkoutData = await getCheckoutByExternalReference(ref);
  if (!checkoutData || !checkoutData.order) return null;

  const { order } = checkoutData;
  const userId = order.user_id || order.customer_id;
  const email = order.email;

  // 2. Intentamos buscar por User ID
  let mpCustomer = await mpRepo.findByUserId(userId);

  // 3. 🧠 EL FIX: Si falla por ID, buscamos por Email
  if ((!mpCustomer || !mpCustomer.mp_customer_id) && email) {
      console.log(`🔎 [ListCards] UserID falló, buscando por email: ${email}`);
      mpCustomer = await mpRepo.findByEmail(email);
  }

  return mpCustomer;
}

/* async function listCards(req, res, next) {
  try {
    // OJO: el router usa :external_reference
    const ref = decodeURIComponent(req.params.external_reference);

    const userId = await repo.getUserIdByExternalReference(ref);
    if (!userId) return res.status(404).json({ error: "checkout not found" });

    const cards = await repo.listActiveCardsByUserId(userId);

    return res.json({
      cards: cards.map((c) => ({
        id: c.id,
        brand: c.brand,
        last4: c.last4,
        exp_month: c.exp_month,
        exp_year: c.exp_year,
        status: c.status,
      })),
    });
  } catch (e) {
    next(e);
  }
} */

async function listCards(req, res, next) {
  try {
    // OJO: el router usa :external_reference
    const ref = decodeURIComponent(req.params.external_reference);

    /* const userId = await repo.getUserIdByExternalReference(ref);
    if (!userId) {
      return res.status(404).json({ error: "checkout not found" });
    } */

    const mpCustomer = await findMpCustomerSmart(ref)

    // Si no tiene cuenta en MP asociada, devolvemos lista vacía
    if (!mpCustomer || !mpCustomer.mp_customer_id) {
      console.error("ℹUsuario sin customer ID en MP.");
      return res.json({ cards: [] });
    }

    if (mpCustomer.mp_customer_id.startsWith('bypass_')) {
      console.warn("⚠️ [ListCards] Detectado ID de Bypass, devolviendo lista vacía.");
      return res.json({ cards: [] });
    }

    try {
      const mpResponse = await mpClient.getCustomerCards(mpCustomer.mp_customer_id)
  
      /* const cards = await repo.listActiveCardsByUserId(userId); */
  
      return res.json({
        cards: mpResponse.map((c) => ({
          id: c.id,
          brand: c.payment_method?.name || c.issuer?.name || "Tarjeta",
          last4: c.last_four_digits,
          exp_month: c.expiration_month,
          exp_year: c.expiration_year,
          status: "active",
          payment_method: c.payment_method
        })),
      });
      
    } catch (error) {
      if (error.status === 404 || error.status === 401) {
        console.warn(`⚠️ [ListCards] El ID ${mpCustomer.mp_customer_id} es inválido o de otro entorno (Status: ${error.status}). Devolviendo lista vacía.`);
        return res.json({ cards: [] }); 
      }
      // Si es otro tipo de error (500, etc), que lo maneje el catch de afuera
      throw error;
    }

  } catch (e) {
    next(e);
  }
}

async function saveCard(req, res, next) {
  try {
    // OJO: el router usa :external_reference
    const externalReference = decodeURIComponent(req.params.external_reference);

    const parsed = SaveCardBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid body", details: parsed.error.flatten() });
    }

    const { mp_card_token, payer } = parsed.data;

    const result = await withTransaction(async (tx) => {
      return saveCardForCheckout(
        { externalReference, mpCardToken: mp_card_token, payer },
        tx
      );
    });

    return res.status(201).json({ ok: true, card: result });
  } catch (e) {
    next(e);
  }
}

async function deleteCard(req, res, next) {
  try {
    const externalReference = decodeURIComponent(req.params.external_reference);

    const card_id = req.params.card_id;
    if (!card_id) {
      return res.status(404).json({ error: "Falta el ID de la tarjeta" });
    }

    /* const userId = await repo.getUserIdByExternalReference(externalReference);
    if (!userId) {
       return res.status(404).json({ error: "Checkout no encontrado" });
    } */
    const customerRow = await findMpCustomerSmart(externalReference);
    
    if (!customerRow || !customerRow.mp_customer_id) {
       return res.status(404).json({ error: "El usuario no tiene un Customer ID asociado" });
    }

    const customer_id = customerRow.mp_customer_id;

    await mpClient.deleteCustomerCards(customer_id, card_id);

    await pool.query(
      `DELETE FROM payment_instruments WHERE mp_card_id = $1`, 
      [card_id]
    );

    console.log(`✅ [Vault] Tarjeta ${card_id} eliminada de MP y de la BD local.`);

    return res.json({ ok: true, message: "Tarjeta eliminada correctamente" });
  } catch (error) {
    next(error);
  }
}

module.exports = { listCards, saveCard, deleteCard };
