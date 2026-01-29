const { insertCardInstrument } = require('../../../src/modules/one_time_checkout/repos/paymentInstruments.repo');  
  
describe('paymentInstruments.repo', () => {  
  let mockTx;  
  
  beforeEach(() => {  
    mockTx = {  
      query: jest.fn()  
    };  
    jest.clearAllMocks();  
  });  
  
  describe('insertCardInstrument', () => {  
    it('debe insertar instrumento de tarjeta correctamente', async () => {  
      const mockResult = {  
        id: 123,  
        user_id: 42,  
        mp_customer_row_id: 17,  
        mp_card_id: '1234567890',  
        brand: 'visa',  
        last4: '4532',  
        exp_month: 12,  
        exp_year: 2025,  
        status: 'active',  
        raw_mp: { id: '1234567890' }  
      };  
  
      mockTx.query.mockResolvedValue({ rows: [mockResult] });  
  
      const result = await insertCardInstrument({  
        user_id: 42,  
        mp_customer_row_id: 17,  
        mp_card_id: '1234567890',  
        brand: 'visa',  
        last4: '4532',  
        exp_month: 12,  
        exp_year: 2025,  
        raw_mp: { id: '1234567890' }  
      }, mockTx);  
  
      expect(mockTx.query).toHaveBeenCalledWith(  
        expect.stringContaining('INSERT INTO payment_instruments'),  
        [42, 17, '1234567890', 'visa', '4532', 12, 2025, { id: '1234567890' }]  
      );  
      expect(result).toEqual(mockResult);  
    });  
  
    it('debe manejar errores de base de datos', async () => {  
      mockTx.query.mockRejectedValue(new Error('Database connection failed'));  
  
      await expect(insertCardInstrument({  
        user_id: 42,  
        mp_customer_row_id: 17,  
        mp_card_id: '1234567890',  
        brand: 'visa',  
        last4: '4532',  
        exp_month: 12,  
        exp_year: 2025,  
        raw_mp: { id: '1234567890' }  
      }, mockTx)).rejects.toThrow('Database connection failed');  
    });  
  });  
});