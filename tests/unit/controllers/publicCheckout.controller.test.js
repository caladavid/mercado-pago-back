const { getCheckout } = require('../../../src/modules/one_time_checkout/controllers/publicCheckout.controller');  
const readRepo = require('../../../src/modules/one_time_checkout/repos/checkoutRead.repo');  
  
jest.mock('../../../src/modules/one_time_checkout/repos/checkoutRead.repo');  
  
describe('publicCheckout.controller - getCheckout', () => {  
  let mockReq, mockRes, mockNext;  
  
  beforeEach(() => {  
    mockReq = {  
      params: { external_reference: 'test-ref-123' }  
    };  
    mockRes = {  
      status: jest.fn().mockReturnThis(),  
      json: jest.fn()  
    };  
    mockNext = jest.fn();  
    jest.clearAllMocks();  
  });  
  
  describe('Casos de éxito', () => {  
    it('debe retornar datos completos del checkout', async () => {  
      const mockData = {  
        order: {  
          id: 123,  
          status: 'pending',  
          total_amount: '100.00',  
          currency: 'UYU',  
          external_reference: 'test-ref-123',  
          created_at: '2024-01-01T12:00:00Z',  
          email: 'test@example.com',  
          full_name: 'John Doe',  
          doc_type: 'CI',  
          doc_number: '12345678'  
        },  
        items: [  
          {  
            sku: 'PROD-001',  
            name: 'Test Product',  
            qty: 1,  
            unit_price: '100.00',  
            line_total: '100.00'  
          }  
        ]  
      };  
  
      readRepo.getCheckoutByExternalReference.mockResolvedValue(mockData);  
  
      await getCheckout(mockReq, mockRes, mockNext);  
  
      expect(readRepo.getCheckoutByExternalReference).toHaveBeenCalledWith('test-ref-123');  
      expect(mockRes.json).toHaveBeenCalledWith({  
        mp_public_key: process.env.MP_PUBLIC_KEY,  
        mp_locale: 'es-UY',  
        order: {  
          id: 123,  
          status: 'pending',  
          total_amount: '100.00',  
          currency: 'UYU',  
          external_reference: 'test-ref-123',  
          created_at: '2024-01-01T12:00:00Z'  
        },  
        buyer_prefill: {  
          email: 'test@example.com',  
          full_name: 'John Doe',  
          doc_type: 'CI',  
          doc_number: '12345678'  
        },  
        items: [  
          {  
            sku: 'PROD-001',  
            title: 'Test Product',  
            qty: 1,  
            unit_price: '100.00',  
            line_total: '100.00'  
          }  
        ]  
      });  
    });  
  
    it('debe usar MP_LOCALE si está configurado', async () => {  
      process.env.MP_LOCALE = 'es-AR';  
        
      readRepo.getCheckoutByExternalReference.mockResolvedValue({  
        order: { id: 123, status: 'pending' },  
        items: []  
      });  
  
      await getCheckout(mockReq, mockRes, mockNext);  
  
      expect(mockRes.json).toHaveBeenCalledWith(  
        expect.objectContaining({  
          mp_locale: 'es-AR'  
        })  
      );  
  
      delete process.env.MP_LOCALE;  
    });  
  });  
  
  describe('Casos de error', () => {  
    it('debe retornar 404 si no se encuentra el checkout', async () => {  
      readRepo.getCheckoutByExternalReference.mockResolvedValue(null);  
  
      await getCheckout(mockReq, mockRes, mockNext);  
  
      expect(mockRes.status).toHaveBeenCalledWith(404);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "checkout not found" });  
    });  
  
    it('debe pasar errores al middleware de error', async () => {  
      const error = new Error('Database error');  
      readRepo.getCheckoutByExternalReference.mockRejectedValue(error);  
  
      await getCheckout(mockReq, mockRes, mockNext);  
  
      expect(mockNext).toHaveBeenCalledWith(error);  
    });  
  });  
});