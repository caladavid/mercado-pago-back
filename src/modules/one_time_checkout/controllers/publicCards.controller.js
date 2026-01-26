// src/modules/one_time_checkout/controllers/publicCards.controller.js
const { z } = require("zod");
const repo = require("../repos/cardsRead.repo");
const { withTransaction } = require("../../../shared/db/withTransaction");
const { saveCardForCheckout } = require("../services/saveCardForCheckout.service");

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

async function listCards(req, res, next) {
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

module.exports = { listCards, saveCard };
