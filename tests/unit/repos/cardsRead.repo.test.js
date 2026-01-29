const { listActiveCardsByUserId, getUserIdByExternalReference } = require('../../../src/modules/one_time_checkout/repos/cardsRead.repo');  
const { pool } = require('../../../src/db/pool');  
  
// Mock del pool de PostgreSQL  
jest.mock('../../../src/db/pool');  
  
describe('cardsRead.repo', () => {  
  let mockPool;  
  
  beforeEach(() => {  
    mockPool = {  
      query: jest.fn()  
    };  
    pool.query = mockPool.query;  
    jest.clearAllMocks();  
  });  
  
  describe('listActiveCardsByUserId', () => {  
    it('debe retornar tarjetas activas para un usuario', async () => {  
      const mockCards = [  
        {  
          id: 1,  
          brand: 'visa',  
          last4: '4242',  
          exp_month: 12,  
          exp_year: 2025,  
          mp_card_id: 'card_123',  
          status: 'active',  
          created_at: new Date()  
        }  
      ];  
  
      mockPool.query.mockResolvedValue({ rows: mockCards });  
  
      const result = await listActiveCardsByUserId(123);  
  
      expect(mockPool.query).toHaveBeenCalledWith(        
        expect.stringMatching(/SELECT\s+id,\s+brand,\s+last4,\s+exp_month,\s+exp_year,\s+mp_card_id,\s+status,\s+created_at\s+FROM\s+payment_instruments/),        
        [123]        
      );  
      expect(result).toEqual(mockCards);  
    });  
  
    it('debe manejar errores de base de datos', async () => {  
      mockPool.query.mockRejectedValue(new Error('Database error'));  
  
      await expect(listActiveCardsByUserId(123)).rejects.toThrow('Database error');  
    });  
  });  
  
  describe('getUserIdByExternalReference', () => {  
    it('debe retornar user_id para external_reference válido', async () => {  
      const mockResult = { rows: [{ user_id: 456 }] };  
      mockPool.query.mockResolvedValue(mockResult);  
  
      const result = await getUserIdByExternalReference('ref-123');  
  
      expect(mockPool.query).toHaveBeenCalledWith(  
        expect.stringMatching(/SELECT\s+user_id\s+FROM\s+orders\s+WHERE\s+external_reference\s+=\s+\$1/),  
        ['ref-123']  
      );  
      expect(result).toBe(456);  
    });  
  
    it('debe retornar null si no encuentra el checkout', async () => {  
      mockPool.query.mockResolvedValue({ rows: [] });  
  
      const result = await getUserIdByExternalReference('invalid-ref');  
  
      expect(result).toBeNull();  
    });  
  });  
});