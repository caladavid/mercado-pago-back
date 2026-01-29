const request = require('supertest');  
  
// Forzar recarga del módulo app para evitar caché persistente  
delete require.cache[require.resolve('../../../src/app')];  
const { app } = require('../../../src/app');  
  
const { withTransaction } = require('../../../src/shared/db/withTransaction');  
const { saveCardForCheckout } = require('../../../src/modules/one_time_checkout/services/saveCardForCheckout.service');  
const { getUserIdByExternalReference, listActiveCardsByUserId } = require('../../../src/modules/one_time_checkout/repos/cardsRead.repo');  
  
// Montar rutas de checkout para tests  
app.use(require('../../../src/modules/one_time_checkout/routes'));  
  
// Mock de dependencias  
jest.mock('../../../src/shared/db/withTransaction');  
jest.mock('../../../src/modules/one_time_checkout/services/saveCardForCheckout.service');  
jest.mock('../../../src/modules/one_time_checkout/repos/cardsRead.repo');  
  
describe('publicCards.controller', () => {  
  let mockTx, mockReq, mockRes, mockNext;  
  
  beforeEach(() => {  
    mockTx = {  
      query: jest.fn()  
    };  
    mockReq = {  
      params: {},  
      body: {}  
    };  
    mockRes = {  
      status: jest.fn().mockReturnThis(),  
      json: jest.fn()  
    };  
    mockNext = jest.fn();  
        
    jest.clearAllMocks();  
  });  
  
  describe('listCards', () => {  
    it('debe retornar 404 si checkout no existe', async () => {  
      getUserIdByExternalReference.mockResolvedValue(null);  
  
      const response = await request(app)  
        .get('/checkout/invalid-ref/cards');  
  
      console.log('🔍 DEBUG listCards - Response status:', response.status);  
      console.log('🔍 DEBUG listCards - Response body:', response.body);  
  
      expect(response.status).toBe(404);  
      expect(response.body).toEqual({ error: "checkout not found" });  
    });  
  
    it('debe listar tarjetas existentes', async () => {  
      getUserIdByExternalReference.mockResolvedValue(123);  
      listActiveCardsByUserId.mockResolvedValue([  
        {  
          id: 1,  
          brand: 'visa',  
          last4: '1234',  
          exp_month: 12,  
          exp_year: 2025,  
          status: 'active'  
        }  
      ]);  
  
      const response = await request(app)  
        .get('/checkout/test-ref-123/cards');  
  
      expect(response.status).toBe(200);  
      expect(response.body).toEqual({  
        cards: [{  
          id: 1,  
          brand: 'visa',  
          last4: '1234',  
          exp_month: 12,  
          exp_year: 2025,  
          status: 'active'  
        }]  
      });  
    });  
  });  
  
  describe('saveCard', () => {  
    it('debe retornar 404 si checkout no existe', async () => {  
      const checkoutNotFoundError = new Error("Checkout not found");  
      checkoutNotFoundError.status = 404;  
  
      // CORRECCIÓN: Simplificar el mock de withTransaction  
      withTransaction.mockImplementation(async (callback) => {  
        return await callback(mockTx);  
      });  
  
      saveCardForCheckout.mockRejectedValue(checkoutNotFoundError);  
  
      const response = await request(app)  
        .post('/checkout/invalid-ref/add_cards')  
        .send({  
          mp_card_token: 'card_token_123456'  
        });  
  
      console.log('🔍 DEBUG saveCard - Response status:', response.status);  
      console.log('🔍 DEBUG saveCard - Response body:', response.body);  
  
      expect(response.status).toBe(404);  
      expect(response.body).toEqual({ error: "Checkout not found" });  
    });  
  
    it('debe guardar tarjeta exitosamente', async () => {  
      withTransaction.mockImplementation(async (callback) => {  
        return await callback(mockTx);  
      });  
  
      saveCardForCheckout.mockResolvedValue({  
        instrument_id: 1,  
        brand: 'visa',  
        last4: '4242',  
        exp_month: 12,  
        exp_year: 2025  
      });  
  
      const response = await request(app)  
        .post('/checkout/test-ref-123/add_cards')  
        .send({  
          mp_card_token: 'card_token_123456'  
        });  
  
      expect(response.status).toBe(201);  
      expect(response.body).toEqual({  
        ok: true,  
        card: {  
          instrument_id: 1,  
          brand: 'visa',  
          last4: '4242',  
          exp_month: 12,  
          exp_year: 2025  
        }  
      });  
    });  
  
    it('debe manejar errores del servicio', async () => {  
      withTransaction.mockImplementation(async (callback) => {  
        return await callback();  
      });  
      saveCardForCheckout.mockRejectedValue(new Error('Service error'));  
  
      const response = await request(app)  
        .post('/checkout/test-ref-123/add_cards')  
        .send({  
          mp_card_token: 'card_token_123456'  
        });  
  
      expect(response.status).toBe(500);  
    });  
  });  
});