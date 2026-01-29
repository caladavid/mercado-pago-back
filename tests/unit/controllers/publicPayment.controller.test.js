const { payCheckout } = require('../../../src/modules/one_time_checkout/controllers/publicPayment.controller');
const { withTransaction } = require('../../../src/shared/db/withTransaction');
const mpCustomersRepo = require('../../../src/modules/one_time_checkout/repos/mpCustomers.repo');
const {
  createPayment,
  searchPaymentMethodsByBin,
  createCustomer,
  searchCustomerByEmail,
} = require('../../../src/integrations/mercadopago/mpClient');

// Mock de dependencias
jest.mock('../../../src/shared/db/withTransaction');
jest.mock('../../../src/modules/one_time_checkout/repos/mpCustomers.repo');
jest.mock('../../../src/integrations/mercadopago/mpClient');

describe('publicPayment.controller - payCheckout', () => {
  let mockReq, mockRes, mockNext;
  let mockTx;

  beforeEach(() => {
    mockTx = {
      query: jest.fn()
    };

    withTransaction.mockImplementation(async (callback) => {
      return await callback(mockTx);
    });

    mockReq = {
      params: { external_reference: 'test-ref-123' },
      headers: { 'x-idempotency-key': 'test-key' },
      body: {
        mp_card_token: 'valid_token_123456',
        payer: { email: 'test@example.com' }
      }
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe('Validación del request body', () => {
    it('debe rechazar si no hay payer.email', async () => {
      mockReq.body = {
        mp_card_token: 'valid_token_123456',
        payer: { first_name: 'John' }
      };

      await payCheckout(mockReq, mockRes, mockNext);

      // Zod validation fails directly in the controller using res.status(400)
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: "Invalid body"
      }));
    });

    it('debe aceptar request body válido mínimo', async () => {
      mockReq.body = {
        mp_card_token: 'valid_token_123456',
        payer: { email: 'test@example.com' }
      };

      const mockOrder = {
        order_id: 123,
        order_status: 'pending',
        total_amount: '100.00',
        currency: 'UYU',
        external_reference: 'test-ref-123',
        user_id: 1,
        email: 'test@example.com'
      };

      mockTx.query.mockResolvedValue({ rows: [mockOrder] });

      await payCheckout(mockReq, mockRes, mockNext);

      expect(withTransaction).toHaveBeenCalled();
    });
  });

  describe('Casos de éxito', () => {
    it('debe procesar pago correctamente', async () => {
      const mockOrder = {
        order_id: 123,
        order_status: 'pending',
        total_amount: '100.00',
        currency: 'UYU',
        external_reference: 'test-ref-123',
        user_id: 1,
        email: 'test@example.com'
      };

      const mockPayment = {
        id: 'pay_123456',
        status: 'approved',
        status_detail: 'accredited',
        transaction_amount: 100,
        currency_id: 'UYU',
        payment_method_id: 'visa',
        payment_type_id: 'credit_card'
      };

      mockTx.query
        .mockResolvedValueOnce({ rows: [mockOrder] }) // SELECT order
        .mockResolvedValueOnce({}) // UPDATE users
        .mockResolvedValueOnce({ rows: [] }) // check mp_customer
        .mockResolvedValueOnce({}) // INSERT mp_customer
        .mockResolvedValueOnce({}) // UPDATE orders
        .mockResolvedValueOnce({}); // INSERT payments

      mpCustomersRepo.findByUserId.mockResolvedValue(null);
      searchCustomerByEmail.mockResolvedValue({ results: [] });
      createCustomer.mockResolvedValue({ id: 'cust_123' });
      mpCustomersRepo.insertMpCustomer.mockResolvedValue({ id: 1 });
      createPayment.mockResolvedValue(mockPayment);

      await payCheckout(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        ok: true,
        payment: expect.objectContaining({ id: 'pay_123456' })
      });
    });
  });

  describe('Idempotency Key Validation', () => {
    it('debe rechazar si no hay idempotency key', async () => {
      mockReq.headers = {}; // Remove header

      // --- CORRECCIÓN: ---
      // Debemos mockear la respuesta de la DB, porque el controlador
      // busca la orden ANTES de validar la idempotency key.
      const mockOrder = {
        order_id: 123,
        order_status: 'pending',
        total_amount: '100.00',
        user_id: 1,
        email: 'test@example.com',
        external_reference: 'ref-123'
      };
      
      // Configuramos que la DB responda algo válido
      mockTx.query.mockResolvedValue({ rows: [mockOrder] });
      // -------------------

      await payCheckout(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
        message: "X-Idempotency-Key is required",
        status: 400
      }));
    });
  });

  describe('Casos de error (Logica de Negocio)', () => {
    it('debe retornar 404 si checkout no encontrado', async () => {
      mockTx.query.mockResolvedValue({ rows: [] }); // No rows found

      await payCheckout(mockReq, mockRes, mockNext);

      // CORRECCIÓN: Verificamos mockNext con error 404
      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
        message: "Checkout not found",
        status: 404
      }));
    });

    it('debe retornar 409 si checkout no está pending', async () => {
      const mockOrder = {
        order_id: 123,
        order_status: 'paid', // Status incorrecto
        user_id: 1,
        email: 'test@example.com'
      };
      mockTx.query.mockResolvedValue({ rows: [mockOrder] });

      await payCheckout(mockReq, mockRes, mockNext);

      // CORRECCIÓN: Verificamos mockNext con error 409
      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
        message: "Checkout is not pending",
        status: 409
      }));
    });

    it('debe rechazar si no hay token de pago', async () => {
        // Simulamos body sin token
        mockReq.body = { payer: { email: 'test@example.com' } }; 
        const mockOrder = { order_id: 123, order_status: 'pending', user_id: 1, email: 'test@example.com' };
        
        mockTx.query.mockResolvedValueOnce({ rows: [mockOrder] })
                    .mockResolvedValueOnce({})
                    .mockResolvedValueOnce({ rows: [{id: 1}] }); // customer found
        
        mpCustomersRepo.findByUserId.mockResolvedValue({ id: 1 });

        await payCheckout(mockReq, mockRes, mockNext);

        // CORRECCIÓN: Verificamos mockNext con error 400
        expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
            message: "token required",
            status: 400
        }));
    });
  });

  describe('Order Status Mapping', () => {
    it('debe mapear rejected a failed', async () => {
        const mockOrder = { order_id: 123, order_status: 'pending', user_id: 1, email: 'test@example.com' };
        
        mockTx.query.mockResolvedValueOnce({ rows: [mockOrder] })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [{id: 1}] })
            .mockResolvedValueOnce({}) // update
            .mockResolvedValueOnce({}); // insert

        mpCustomersRepo.findByUserId.mockResolvedValue({ id: 1 });
        createPayment.mockResolvedValue({ id: 'pay_rej', status: 'rejected' });

        await payCheckout(mockReq, mockRes, mockNext);

        expect(mockTx.query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE orders'),
            expect.arrayContaining(['failed', expect.any(String), 123])
        );
    });
  });
});