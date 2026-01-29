const { createCheckout } = require('../../../src/modules/one_time_checkout/controllers/merchantCheckout.controller');  
const { withTransaction } = require('../../../src/shared/db/withTransaction');  
const repo = require('../../../src/modules/one_time_checkout/repos/checkout.repo');  
  
// Mock de dependencias  
jest.mock('../../../src/shared/db/withTransaction');  
jest.mock('../../../src/modules/one_time_checkout/repos/checkout.repo');  
  
describe('merchantCheckout.controller - createCheckout', () => {  
  let mockReq, mockRes, mockNext;  
  
  beforeEach(() => {  
    mockReq = {  
      merchant: { slug: 'test-merchant' },  
      body: {},  
      protocol: 'https',  
      get: jest.fn().mockReturnValue('example.com')  
    };  
    mockRes = {  
      status: jest.fn().mockReturnThis(),  
      json: jest.fn()  
    };  
    mockNext = jest.fn();  
    jest.clearAllMocks();  
  });  
  
  describe('Casos de éxito', () => {  
    it('debe crear checkout con datos válidos', async () => {  
      const requestBody = {  
        buyer: {  
          email: 'test@example.com',  
          full_name: 'John Doe',  
          doc_type: 'CI',  
          doc_number: '12345678'  
        },  
        item: {  
          sku: 'PROD-001',  
          title: 'Test Product',  
          amount: 100.50,  
          currency: 'UYU'  
        }  
      };  
  
      mockReq.body = requestBody;  
  
      const mockResult = {  
        user: { id: 1 },  
        order: {   
          id: 123,   
          external_reference: '550e8400-e29b-41d4-a716-446655440000',  
          status: 'pending'  
        }  
      };  
  
      withTransaction.mockImplementation((callback) => Promise.resolve(mockResult));  
  
      await createCheckout(mockReq, mockRes, mockNext);  
  
      expect(withTransaction).toHaveBeenCalled();  
      expect(mockRes.status).toHaveBeenCalledWith(201);  
      expect(mockRes.json).toHaveBeenCalledWith({  
        order_id: 123,  
        external_reference: '550e8400-e29b-41d4-a716-446655440000',  
        status: 'pending',  
        checkout_url: 'https://example.com/checkout/550e8400-e29b-41d4-a716-446655440000'  
      });  
    });  
  
    it('debe usar PUBLIC_CHECKOUT_BASE_URL si está configurada', async () => {  
      process.env.PUBLIC_CHECKOUT_BASE_URL = 'https://checkout.example.com';  
        
      mockReq.body = {  
        buyer: { email: 'test@example.com' },  
        item: { sku: 'PROD-001', title: 'Test', amount: 100, currency: 'UYU' }  
      };  
  
      withTransaction.mockResolvedValue({  
        user: { id: 1 },  
        order: { id: 123, external_reference: 'ref-123', status: 'pending' }  
      });  
  
      await createCheckout(mockReq, mockRes, mockNext);  
  
      expect(mockRes.json).toHaveBeenCalledWith(  
        expect.objectContaining({  
          checkout_url: 'https://checkout.example.com/checkout/ref-123'  
        })  
      );  
  
      delete process.env.PUBLIC_CHECKOUT_BASE_URL;  
    });  
  });  
  
  describe('Validación de autenticación', () => {  
    it('debe rechazar si no hay merchant autenticado', async () => {  
      mockReq.merchant = null;  
  
      await createCheckout(mockReq, mockRes, mockNext);  
  
      expect(mockRes.status).toHaveBeenCalledWith(401);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "merchant not authenticated" });  
    });  
  
    it('debe rechazar si no hay slug en merchant', async () => {  
      mockReq.merchant = {};  
  
      await createCheckout(mockReq, mockRes, mockNext);  
  
      expect(mockRes.status).toHaveBeenCalledWith(401);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "merchant not authenticated" });  
    });  
  });  
  
  describe('Validación del request body', () => {  
    it('debe rechazar si no hay buyer.email', async () => {  
      mockReq.body = {  
        buyer: {},  
        item: { sku: 'PROD-001', title: 'Test', amount: 100, currency: 'UYU' }  
      };  
  
      await createCheckout(mockReq, mockRes, mockNext);  
  
      expect(mockRes.status).toHaveBeenCalledWith(400);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "buyer.email required" });  
    });  
  
    it('debe rechazar si no hay item.sku', async () => {  
      mockReq.body = {  
        buyer: { email: 'test@example.com' },  
        item: { title: 'Test', amount: 100, currency: 'UYU' }  
      };  
  
      await createCheckout(mockReq, mockRes, mockNext);  
  
      expect(mockRes.status).toHaveBeenCalledWith(400);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "item.sku and item.title required" });  
    });  
  
    it('debe rechazar si no hay item.title', async () => {  
      mockReq.body = {  
        buyer: { email: 'test@example.com' },  
        item: { sku: 'PROD-001', amount: 100, currency: 'UYU' }  
      };  
  
      await createCheckout(mockReq, mockRes, mockNext);  
  
      expect(mockRes.status).toHaveBeenCalledWith(400);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "item.sku and item.title required" });  
    });  
  
    it('debe rechazar si amount es null', async () => {  
      mockReq.body = {  
        buyer: { email: 'test@example.com' },  
        item: { sku: 'PROD-001', title: 'Test', amount: null, currency: 'UYU' }  
      };  
  
      await createCheckout(mockReq, mockRes, mockNext);  
  
      expect(mockRes.status).toHaveBeenCalledWith(400);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "item.amount must be > 0" });  
    });  
  
    it('debe rechazar si amount es <= 0', async () => {  
      mockReq.body = {  
        buyer: { email: 'test@example.com' },  
        item: { sku: 'PROD-001', title: 'Test', amount: 0, currency: 'UYU' }  
      };  
  
      await createCheckout(mockReq, mockRes, mockNext);  
  
      expect(mockRes.status).toHaveBeenCalledWith(400);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "item.amount must be > 0" });  
    });  
  
    it('debe rechazar si no hay currency', async () => {  
      mockReq.body = {  
        buyer: { email: 'test@example.com' },  
        item: { sku: 'PROD-001', title: 'Test', amount: 100 }  
      };  
  
      await createCheckout(mockReq, mockRes, mockNext);  
  
      expect(mockRes.status).toHaveBeenCalledWith(400);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "item.currency required (e.g. UYU)" });  
    });  
  });  
  
  describe('Manejo de errores', () => {  
    it('debe pasar errores al middleware de error', async () => {  
      mockReq.body = {  
        buyer: { email: 'test@example.com' },  
        item: { sku: 'PROD-001', title: 'Test', amount: 100, currency: 'UYU' }  
      };  
  
      const error = new Error('Database error');  
      withTransaction.mockRejectedValue(error);  
  
      await createCheckout(mockReq, mockRes, mockNext);  
  
      expect(mockNext).toHaveBeenCalledWith(error);  
    });  
  });  
});