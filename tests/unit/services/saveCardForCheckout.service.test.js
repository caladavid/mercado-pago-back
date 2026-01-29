const { saveCardForCheckout } = require('../../../src/modules/one_time_checkout/services/saveCardForCheckout.service');  
const mpCustomersRepo = require('../../../src/modules/one_time_checkout/repos/mpCustomers.repo');  
const paymentInstrumentsRepo = require('../../../src/modules/one_time_checkout/repos/paymentInstruments.repo');  
const {  
  createCustomer,  
  searchCustomerByEmail,  
  saveCardToCustomer,  
} = require('../../../src/integrations/mercadopago/mpClient');  
  
jest.mock('../../../src/modules/one_time_checkout/repos/mpCustomers.repo');  
jest.mock('../../../src/modules/one_time_checkout/repos/paymentInstruments.repo');  
jest.mock('../../../src/integrations/mercadopago/mpClient');  
  
describe('saveCardForCheckout service', () => {  
  let mockTx;  
  
  beforeEach(() => {  
    mockTx = {  
      query: jest.fn()  
    };  
    jest.clearAllMocks();  
  });  
  
  describe('Validación inicial', () => {  
    it('debe rechazar checkout no encontrado', async () => {  
      mockTx.query.mockResolvedValue({ rows: [] });  
  
      await expect(saveCardForCheckout({  
        externalReference: 'nonexistent',  
        mpCardToken: 'valid_token_123456',  
        payer: { email: 'test@example.com' }  
      }, mockTx)).rejects.toThrow('Checkout not found');  
    });  
  
    it('debe rechazar checkout no pending', async () => {  
      mockTx.query.mockResolvedValue({  
        rows: [{  
          order_id: 123,  
          order_status: 'paid',  
          user_id: 1,  
          email: 'test@example.com'  
        }]  
      });  
  
      await expect(saveCardForCheckout({  
        externalReference: 'test-ref',  
        mpCardToken: 'valid_token_123456',  
        payer: { email: 'test@example.com' }  
      }, mockTx)).rejects.toThrow('Checkout is not pending');  
    });  
  });  
  
  describe('Reconciliación de emails', () => {  
    it('debe rechazar email mismatch', async () => {  
      mockTx.query.mockResolvedValue({  
        rows: [{  
          order_id: 123,  
          order_status: 'pending',  
          user_id: 1,  
          email: 'different@example.com'  
        }]  
      });  
  
      await expect(saveCardForCheckout({  
        externalReference: 'test-ref',  
        mpCardToken: 'valid_token_123456',  
        payer: { email: 'test@example.com' }  
      }, mockTx)).rejects.toThrow('payer.email does not match checkout user email');  
    });  
  
    it('debe permitir emails iguales', async () => {  
      const mockOrder = {  
        order_id: 123,  
        order_status: 'pending',  
        user_id: 1,  
        email: 'test@example.com'  
      };  
  
      mockTx.query.mockResolvedValue({ rows: [mockOrder] });  
        
      // Mock customer exists  
      mpCustomersRepo.findByUserId.mockResolvedValue({   
        id: 1,   
        mp_customer_id: 'cust_123'   
      });  
        
      // Mock card saving  
      saveCardToCustomer.mockResolvedValue({  
        id: 'card_123',  
        payment_method: { id: 'visa' },  
        last_four_digits: '4242',  
        expiration_month: 12,  
        expiration_year: 2025  
      });  
        
      // Mock instrument insertion  
      paymentInstrumentsRepo.insertCardInstrument.mockResolvedValue({  
        id: 1,  
        brand: 'visa',  
        last4: '4242',  
        exp_month: 12,  
        exp_year: 2025  
      });  
  
      const result = await saveCardForCheckout({  
        externalReference: 'test-ref',  
        mpCardToken: 'valid_token_123456',  
        payer: { email: 'test@example.com' }  
      }, mockTx);  
  
      expect(result).toEqual({  
        instrument_id: 1,  
        brand: 'visa',  
        last4: '4242',  
        exp_month: 12,  
        exp_year: 2025  
      });  
    });  
  });  
  
  describe('Creación de customer MP', () => {  
    it('debe crear nuevo customer si no existe', async () => {  
      const mockOrder = {  
        order_id: 123,  
        order_status: 'pending',  
        user_id: 1,  
        email: 'test@example.com'  
      };  
  
      mockTx.query.mockResolvedValue({ rows: [mockOrder] });  
        
      // No customer exists  
      mpCustomersRepo.findByUserId.mockResolvedValue(null);  
        
      // Search returns empty  
      searchCustomerByEmail.mockResolvedValue({ results: [] });  
        
      // Create customer returns new customer  
      createCustomer.mockResolvedValue({  
        id: 'new_cust_123',  
        email: 'test@example.com'  
      });  
        
      // Insert returns customer row  
      mpCustomersRepo.insertMpCustomer.mockResolvedValue({  
        id: 1,  
        mp_customer_id: 'new_cust_123'  
      });  
        
      // Mock card saving  
      saveCardToCustomer.mockResolvedValue({  
        id: 'card_123',  
        payment_method: { id: 'visa' },  
        last_four_digits: '4242',  
        expiration_month: 12,  
        expiration_year: 2025  
      });  
        
      // Mock instrument insertion  
      paymentInstrumentsRepo.insertCardInstrument.mockResolvedValue({  
        id: 1,  
        brand: 'visa',  
        last4: '4242',  
        exp_month: 12,  
        exp_year: 2025  
      });  
  
      const result = await saveCardForCheckout({  
        externalReference: 'test-ref',  
        mpCardToken: 'valid_token_123456',  
        payer: { email: 'test@example.com' }  
      }, mockTx);  
  
      expect(createCustomer).toHaveBeenCalled();  
      expect(mpCustomersRepo.insertMpCustomer).toHaveBeenCalled();  
      expect(result.instrument_id).toBe(1);  
    });  
  
    it('debe usar customer existente si se encuentra', async () => {  
      const mockOrder = {  
        order_id: 123,  
        order_status: 'pending',  
        user_id: 1,  
        email: 'test@example.com'  
      };  
  
      mockTx.query.mockResolvedValue({ rows: [mockOrder] });  
        
      // No customer in local DB  
      mpCustomersRepo.findByUserId.mockResolvedValue(null);  
        
      // But customer exists in MP  
      searchCustomerByEmail.mockResolvedValue({   
        results: [{ id: 'existing_cust_123' }]   
      });  
        
      // Insert returns customer row  
      mpCustomersRepo.insertMpCustomer.mockResolvedValue({  
        id: 1,  
        mp_customer_id: 'existing_cust_123'  
      });  
        
      // Mock card saving  
      saveCardToCustomer.mockResolvedValue({  
        id: 'card_123',  
        payment_method: { id: 'visa' },  
        last_four_digits: '4242',  
        expiration_month: 12,  
        expiration_year: 2025  
      });  
        
      // Mock instrument insertion  
      paymentInstrumentsRepo.insertCardInstrument.mockResolvedValue({  
        id: 1,  
        brand: 'visa',  
        last4: '4242',  
        exp_month: 12,  
        exp_year: 2025  
      });  
  
      const result = await saveCardForCheckout({  
        externalReference: 'test-ref',  
        mpCardToken: 'valid_token_123456',  
        payer: { email: 'test@example.com' }  
      }, mockTx);  
  
      expect(searchCustomerByEmail).toHaveBeenCalledWith('test@example.com');  
      expect(createCustomer).not.toHaveBeenCalled();  
      expect(result.instrument_id).toBe(1);  
    });  
  });  
  
  describe('Tokenización de tarjeta', () => {  
    it('debe guardar tarjeta en customer MP', async () => {  
      const mockOrder = {  
        order_id: 123,  
        order_status: 'pending',  
        user_id: 1,  
        email: 'test@example.com'  
      };  
  
      mockTx.query.mockResolvedValue({ rows: [mockOrder] });  
        
      // Customer exists  
      mpCustomersRepo.findByUserId.mockResolvedValue({   
        id: 1,   
        mp_customer_id: 'cust_123'   
      });  
        
      // Mock card saving  
      saveCardToCustomer.mockResolvedValue({  
        id: 'card_123',  
        payment_method: { id: 'visa' },  
        last_four_digits: '4242',  
        expiration_month: 12,  
        expiration_year: 2025  
      });  
        
      // Mock instrument insertion  
      paymentInstrumentsRepo.insertCardInstrument.mockResolvedValue({  
        id: 1,  
        brand: 'visa',  
        last4: '4242',  
        exp_month: 12,  
        exp_year: 2025  
      });  
  
      const result = await saveCardForCheckout({  
        externalReference: 'test-ref',  
        mpCardToken: 'valid_token_123456',  
        payer: { email: 'test@example.com' }  
      }, mockTx);  
  
      expect(saveCardToCustomer).toHaveBeenCalledWith('cust_123', 'valid_token_123456');  
      expect(paymentInstrumentsRepo.insertCardInstrument).toHaveBeenCalled();  
      expect(result).toEqual({  
        instrument_id: 1,  
        brand: 'visa',  
        last4: '4242',  
        exp_month: 12,  
        exp_year: 2025  
      });  
    });  
  });  
  
  describe('Manejo de errores', () => {  
    it('debe propagar errores de Mercado Pago', async () => {  
      mockTx.query.mockResolvedValue({  
        rows: [{  
          order_id: 123,  
          order_status: 'pending',  
          user_id: 1,  
          email: 'test@example.com'  
        }]  
      });  
  
      mpCustomersRepo.findByUserId.mockResolvedValue({ id: 1, mp_customer_id: 'cust_123' });  
      saveCardToCustomer.mockRejectedValue(new Error('MP API Error'));  
  
      await expect(saveCardForCheckout({  
        externalReference: 'test-ref',  
        mpCardToken: 'valid_token_123456',  
        payer: { email: 'test@example.com' }  
      }, mockTx)).rejects.toThrow('MP API Error');  
    });  
  
    it('debe manejar errores de base de datos', async () => {  
      mockTx.query.mockRejectedValue(new Error('Database connection failed'));  
  
      await expect(saveCardForCheckout({  
        externalReference: 'test-ref',  
        mpCardToken: 'valid_token_123456',  
        payer: { email: 'test@example.com' }  
      }, mockTx)).rejects.toThrow('Database connection failed');  
    });  
  });  
});