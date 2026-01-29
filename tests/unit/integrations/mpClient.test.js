const mockFetch = jest.fn();  
global.fetch = mockFetch;  
  
const {  
  createCustomer,  
  searchCustomerByEmail,  
  saveCardToCustomer,  
  createPayment,  
  searchPaymentMethodsByBin,  
} = require('../../../src/integrations/mercadopago/mpClient');  
  
describe('MercadoPago Client', () => {  
  beforeEach(() => {  
    // Configurar variables de entorno  
    process.env.MP_ACCESS_TOKEN = 'test_access_token_12345';  
    process.env.MP_PUBLIC_KEY = 'test_public_key_67890';  
      
    // Limpiar mocks antes de cada test  
    mockFetch.mockClear();  
  });  
  
  describe('createCustomer', () => {  
    it('debe crear customer con datos válidos', async () => {  
      const responseData = {  
        id: 'customer_123',  
        email: 'test@example.com',  
        first_name: 'John',  
        last_name: 'Doe'  
      };  
  
      const mockResponse = {  
        ok: true,  
        status: 200,  
        headers: {  
          get: jest.fn()  
        },  
        text: jest.fn().mockResolvedValue(JSON.stringify(responseData)),  
        json: jest.fn().mockResolvedValue(responseData)  
      };  
        
      mockFetch.mockResolvedValue(mockResponse);  
  
      const result = await createCustomer({  
        email: 'test@example.com',  
        first_name: 'John',  
        last_name: 'Doe'  
      });  
  
      expect(mockFetch).toHaveBeenCalledWith(  
        'https://api.mercadopago.com/v1/customers',  
        {  
          method: 'POST',  
          headers: {  
            'Content-Type': 'application/json',  
            'Accept': 'application/json',  
            'Authorization': 'Bearer test_access_token_12345'  
          },  
          body: JSON.stringify({  
            email: 'test@example.com',  
            first_name: 'John',  
            last_name: 'Doe'  
          })  
        }  
      );  
      expect(result).toEqual(responseData);  
    });  
  
    it('debe incluir idempotency key cuando se proporciona', async () => {  
      const responseData = { id: 'customer_123' };  
      const mockResponse = {  
        ok: true,  
        status: 200,  
        headers: { get: jest.fn() },  
        text: jest.fn().mockResolvedValue(JSON.stringify(responseData)),  
        json: jest.fn().mockResolvedValue(responseData)  
      };  
        
      mockFetch.mockResolvedValue(mockResponse);  
  
      await createCustomer({  
        email: 'test@example.com',  
        first_name: 'John'  
      }, { idempotencyKey: 'test-key-123' });  
  
      expect(mockFetch).toHaveBeenCalledWith(  
        'https://api.mercadopago.com/v1/customers',  
        expect.objectContaining({  
          headers: expect.objectContaining({  
            'X-Idempotency-Key': 'test-key-123'  
          })  
        })  
      );  
    });  
  });  
  
  describe('searchCustomerByEmail', () => {  
    it('debe buscar customer por email', async () => {  
      const responseData = {  
        results: [{ id: 'customer_123', email: 'test@example.com' }]  
      };  
        
      const mockResponse = {  
        ok: true,  
        status: 200,  
        headers: { get: jest.fn() },  
        text: jest.fn().mockResolvedValue(JSON.stringify(responseData)),  
        json: jest.fn().mockResolvedValue(responseData)  
      };  
        
      mockFetch.mockResolvedValue(mockResponse);  
  
      const result = await searchCustomerByEmail('test@example.com');  
  
      expect(mockFetch).toHaveBeenCalledWith(  
        'https://api.mercadopago.com/v1/customers/search?email=test%40example.com',  
        expect.objectContaining({  
          method: 'GET'  
        })  
      );  
      expect(result).toEqual(responseData);  
    });  
  });  
  
  describe('saveCardToCustomer', () => {  
    it('debe guardar tarjeta para customer', async () => {  
      const responseData = {  
        id: 'card_123',  
        customer_id: 'customer_123',  
        token: 'card_token_456'  
      };  
        
      const mockResponse = {  
        ok: true,  
        status: 200,  
        headers: { get: jest.fn() },  
        text: jest.fn().mockResolvedValue(JSON.stringify(responseData)),  
        json: jest.fn().mockResolvedValue(responseData)  
      };  
        
      mockFetch.mockResolvedValue(mockResponse);  
  
      const result = await saveCardToCustomer('customer_123', 'card_token_456');  
  
      expect(mockFetch).toHaveBeenCalledWith(  
        'https://api.mercadopago.com/v1/customers/customer_123/cards',  
        expect.objectContaining({  
          method: 'POST',  
          body: JSON.stringify({ token: 'card_token_456' })  
        })  
      );  
      expect(result).toEqual(responseData);  
    });  
  });  
  
  describe('createPayment', () => {  
    it('debe crear pago con datos válidos', async () => {  
      const responseData = {  
        id: 'payment_123',  
        status: 'approved',  
        transaction_amount: 100  
      };  
        
      const mockResponse = {  
        ok: true,  
        status: 200,  
        headers: { get: jest.fn() },  
        text: jest.fn().mockResolvedValue(JSON.stringify(responseData)),  
        json: jest.fn().mockResolvedValue(responseData)  
      };  
        
      mockFetch.mockResolvedValue(mockResponse);  
  
      const paymentData = {  
        token: 'card_token_456',  
        transaction_amount: 100,  
        description: 'Test payment',  
        payment_method_id: 'visa',  
        payer: { email: 'test@example.com' }  
      };  
  
      const result = await createPayment(paymentData);  
  
      expect(mockFetch).toHaveBeenCalledWith(  
        'https://api.mercadopago.com/v1/payments',  
        expect.objectContaining({  
          method: 'POST',  
          body: JSON.stringify(paymentData)  
        })  
      );  
      expect(result).toEqual(responseData);  
    });  
  
    it('debe rechazar currency_id', async () => {  
      await expect(createPayment({  
        token: 'card_token_456',  
        transaction_amount: 100,  
        currency_id: 'USD'  
      })).rejects.toThrow('currency_id is not supported in this payment request');  
    });  
  });  
  
  describe('searchPaymentMethodsByBin', () => {  
    it('debe buscar métodos de pago por BIN', async () => {  
      const responseData = {  
        results: [{ id: 'visa', name: 'Visa' }]  
      };  
        
      const mockResponse = {  
        ok: true,  
        status: 200,  
        headers: { get: jest.fn() },  
        text: jest.fn().mockResolvedValue(JSON.stringify(responseData)),  
        json: jest.fn().mockResolvedValue(responseData)  
      };  
        
      mockFetch.mockResolvedValue(mockResponse);  
  
      const result = await searchPaymentMethodsByBin('123456');  
  
      expect(mockFetch).toHaveBeenCalledWith(  
        'https://api.mercadopago.com/v1/payment_methods/search?bin=123456&public_key=test_public_key_67890',  
        expect.objectContaining({  
          method: 'GET'  
        })  
      );  
      expect(result).toEqual(responseData);  
    });  
  
    it('debe lanzar error si falta MP_PUBLIC_KEY', async () => {  
      delete process.env.MP_PUBLIC_KEY;  
        
      await expect(searchPaymentMethodsByBin('123456'))  
        .rejects.toThrow('MercadoPago public key missing: set MP_PUBLIC_KEY env');  
    });  
  });  
  
  describe('Manejo de errores', () => {  
    it('debe manejar respuesta de error 403', async () => {  
      const mockResponse = {  
        ok: false,  
        status: 403,  
        headers: {  
          get: jest.fn((header) => {  
            if (header === 'x-request-id') return 'req-123';  
            return null;  
          })  
        },  
        text: jest.fn().mockResolvedValue(JSON.stringify({  
          message: 'Forbidden',  
          error: 'Unauthorized'  
        })),  
        json: jest.fn().mockResolvedValue({  
          message: 'Forbidden',  
          error: 'Unauthorized'  
        })  
      };  
        
      mockFetch.mockResolvedValue(mockResponse);  
  
      await expect(createCustomer({  
        email: 'test@example.com',  
        first_name: 'John',  
        last_name: 'Doe'  
      })).rejects.toThrow('MercadoPago POST /v1/customers failed (403)');  
    });  
  
    it('debe manejar error de red', async () => {  
      mockFetch.mockRejectedValue(new Error('Network error'));  
  
      await expect(createCustomer({  
        email: 'test@example.com',  
        first_name: 'John',  
        last_name: 'Doe'  
      })).rejects.toThrow('Network error');  
    });  
  
    it('debe manejar respuesta JSON inválida', async () => {  
      const mockResponse = {  
        ok: true,  
        status: 200,  
        headers: { get: jest.fn() },  
        text: jest.fn().mockResolvedValue('invalid json'),  
        json: jest.fn().mockRejectedValue(new Error('Unexpected token'))  
      };  
        
      mockFetch.mockResolvedValue(mockResponse);  
  
      const result = await createCustomer({  
        email: 'test@example.com',  
        first_name: 'John',  
        last_name: 'Doe'  
      });  
  
      expect(result).toEqual({ raw: 'invalid json' });  
    });  
  });  
});