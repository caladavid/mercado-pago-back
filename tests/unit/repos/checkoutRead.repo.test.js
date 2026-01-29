const { getCheckoutByExternalReference } = require('../../../src/modules/one_time_checkout/repos/checkoutRead.repo');  
const { pool } = require('../../../src/db/pool');  
  
// Mock del pool de PostgreSQL  
jest.mock('../../../src/db/pool');  
  
describe('checkoutRead.repo', () => {  
  let mockPool;  
  
  beforeEach(() => {  
    mockPool = {  
      query: jest.fn()  
    };  
    // Mockear el pool exportado  
    pool.query = mockPool.query;  
    jest.clearAllMocks();  
  });  
  
  describe('getCheckoutByExternalReference', () => {  
    it('debe retornar checkout completo cuando existe', async () => {  
      const mockOrder = {  
        id: 1,  
        status: 'pending',  
        total_amount: '100.00',  
        currency: 'UYU',  
        external_reference: 'test-ref-123',  
        created_at: '2024-01-01T12:00:00Z',  
        email: 'test@example.com',  
        full_name: 'Test User',  
        doc_type: 'CI',  
        doc_number: '12345678'  
      };  
  
      const mockItems = [  
        {  
          id: 1,  
          qty: 2,  
          unit_price: '50.00',  
          line_total: '100.00',  
          sku: 'PROD-001',  
          name: 'Test Product'  
        }  
      ];  
  
      mockPool.query  
        .mockResolvedValueOnce({ rows: [mockOrder] })  
        .mockResolvedValueOnce({ rows: mockItems });  
  
      const result = await getCheckoutByExternalReference('test-ref-123');  
  
      expect(result).toEqual({  
        order: mockOrder,  
        items: mockItems  
      });  
  
      // Verificar la primera consulta (orden + usuario) - patrón más específico  
      expect(mockPool.query).toHaveBeenNthCalledWith(1,   
        expect.stringContaining('FROM orders o'),   
        ['test-ref-123']   
      );  
  
      // Verificar la segunda consulta (items) - patrón más específico  
      expect(mockPool.query).toHaveBeenNthCalledWith(2,   
        expect.stringContaining('FROM order_items oi'),   
        [1]   
      );  
    });  
  
    it('debe retornar null cuando no existe', async () => {  
      mockPool.query.mockResolvedValue({ rows: [] });  
  
      const result = await getCheckoutByExternalReference('nonexistent-ref');  
  
      expect(result).toBeNull();  
  
      expect(mockPool.query).toHaveBeenCalledWith(  
        expect.stringContaining('FROM orders o'), // Patrón simple que funcionará  
        ['nonexistent-ref']  
      );  
    });  
  
    it('debe manejar errores de base de datos', async () => {  
      mockPool.query.mockRejectedValue(new Error('Database connection failed'));  
  
      await expect(getCheckoutByExternalReference('test-ref'))  
        .rejects.toThrow('Database connection failed');  
    });  
  });  
});