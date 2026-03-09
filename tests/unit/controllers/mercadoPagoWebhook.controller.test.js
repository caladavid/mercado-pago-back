const { receiveMercadoPagoWebhook } = require('../../../src/modules/webhooks/controllers/mercadoPagoWebhook.controller');
const repo = require('../../../src/modules/webhooks/repos/webhookEvents.repo');
// 1. Importamos el cliente de MP para mockearlo
const { getPaymentFromMP } = require('../../../src/integrations/mercadopago/mpClient');
const crypto = require('crypto');

// 2. Mockeamos las dependencias
jest.mock('../../../src/modules/webhooks/repos/webhookEvents.repo');
jest.mock('../../../src/integrations/mercadopago/mpClient'); // <--- IMPORTANTE: Evita llamar a la API real
jest.mock('crypto');

describe('mercadoPagoWebhook.controller - receiveMercadoPagoWebhook', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.insertWebhookEvent.mockResolvedValue({ id: 1 });

    // 3. Configuramos el mock de MP por defecto para que no falle
    if (getPaymentFromMP && getPaymentFromMP.mockResolvedValue) {
        getPaymentFromMP.mockResolvedValue({
            id: 'pay_123456',
            status: 'approved',
            external_reference: 'order_123'
        });
    }

    const mockHmac = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('mocked_signature_hash')
    };
    crypto.createHmac.mockReturnValue(mockHmac);

    mockReq = {
      headers: {
        "x-request-id": "test-req-id",
        "x-signature": "ts=123456,v1=mocked_signature_hash" 
      },
      body: {}
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    mockNext = jest.fn();
  });

  it('debe procesar webhook payload válido', async () => {
    const webhookPayload = {
      type: 'payment',
      action: 'payment.created',
      data: { id: 'pay_123456' },
      date_created: '2024-01-01T12:00:00Z'
    };
    mockReq.body = webhookPayload;

    await receiveMercadoPagoWebhook(mockReq, mockRes, mockNext);

    expect(repo.insertWebhookEvent).toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });

  describe('Casos de éxito', () => {
    it('debe procesar e insertar evento', async () => {
      const webhookPayload = {
        type: 'payment',
        action: 'payment.created',
        data: { id: 'pay_123456' }
      };
      mockReq.body = webhookPayload;

      await (mockReq, mockRes, mockNext);

      expect(repo.insertWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({
        dataId: 'pay_123456',
        provider: 'mercadopago'
      }));
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('debe manejar payload sin data.id (usando payment_id)', async () => {
      mockReq.body = {
        type: 'payment',
        data: { payment_id: 'pay_Alt_123' }
      };

      await receiveMercadoPagoWebhook(mockReq, mockRes, mockNext);

      expect(repo.insertWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({
        dataId: 'pay_Alt_123'
      }));
    });
  });

  describe('Casos de error', () => {
    it('debe manejar errores del repositorio', async () => {
      mockReq.body = { data: { id: '123' } };
      const error = new Error('Database connection failed');
      repo.insertWebhookEvent.mockRejectedValue(error);

      await receiveMercadoPagoWebhook(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('debe rechazar payload nulo', async () => {
        mockReq.body = null;
        await receiveMercadoPagoWebhook(mockReq, mockRes, mockNext);
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({ error: "Invalid webhook payload" });
    });
  });
});