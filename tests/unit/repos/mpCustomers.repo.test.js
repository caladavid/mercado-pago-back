const { findByUserId, insertMpCustomer } = require('../../../src/modules/one_time_checkout/repos/mpCustomers.repo');  
  
describe('mpCustomers.repo', () => {  
  let mockPool;  
  
  beforeEach(() => {  
    mockPool = {  
      query: jest.fn()  
    };  
    jest.clearAllMocks();  
  });  
  
  describe('findByUserId', () => {  
    it('debe encontrar customer por user_id', async () => {  
      const mockCustomer = {  
        id: 1,  
        user_id: 123,  
        mp_customer_id: 'cust_123456',  
        email: 'test@example.com'  
      };  
      mockPool.query.mockResolvedValue({ rows: [mockCustomer] });  
  
      const result = await findByUserId(123, mockPool);  
  
      expect(mockPool.query).toHaveBeenCalledWith(  
        expect.stringContaining('SELECT * FROM mp_customers WHERE user_id = $1'),  
        [123]  
      );  
      expect(result).toEqual(mockCustomer);  
    });  
  
    it('debe retornar null cuando no existe', async () => {  
      mockPool.query.mockResolvedValue({ rows: [] });  
  
      const result = await findByUserId(999, mockPool);  
  
      expect(result).toBeNull();  
    });  
  
    it('debe usar pool por defecto si no se proporciona client', async () => {  
      const { pool } = require('../../../src/db/pool');  
      pool.query = jest.fn().mockResolvedValue({ rows: [] });  
  
      await findByUserId(123);  
  
      expect(pool.query).toHaveBeenCalled();  
    });  
  });  
  
  describe('insertMpCustomer', () => {  
    it('debe insertar nuevo customer', async () => {  
      const mockCustomer = {  
        id: 2,  
        user_id: 123,  
        mp_customer_id: 'cust_789012',  
        email: 'new@example.com'  
      };  
      mockPool.query.mockResolvedValue({ rows: [mockCustomer] });  
  
      const result = await insertMpCustomer({  
        user_id: 123,  
        mp_customer_id: 'cust_789012',  
        email: 'new@example.com',  
        raw_mp: { id: 'cust_789012' }  
      }, mockPool);  
  
      expect(mockPool.query).toHaveBeenCalledWith(  
        expect.stringContaining('INSERT INTO mp_customers'),  
        [123, 'cust_789012', 'new@example.com', { id: 'cust_789012' }]  
      );  
      expect(result).toEqual(mockCustomer);  
    });  
  
    it('debe almacenar raw_mp como JSONB', async () => {  
      const rawMpData = {  
        id: 'cust_789012',  
        date_created: '2024-01-01T12:00:00Z',  
        email: 'new@example.com'  
      };  
      mockPool.query.mockResolvedValue({ rows: [{ id: 2 }] });  
  
      await insertMpCustomer({  
        user_id: 123,  
        mp_customer_id: 'cust_789012',  
        email: 'new@example.com',  
        raw_mp: rawMpData  
      }, mockPool);  
  
      expect(mockPool.query).toHaveBeenCalledWith(  
        expect.any(String),  
        [123, 'cust_789012', 'new@example.com', rawMpData]  
      );  
    });  
  
    it('debe usar pool por defecto si no se proporciona client', async () => {  
      const { pool } = require('../../../src/db/pool');  
      pool.query = jest.fn().mockResolvedValue({ rows: [{ id: 2 }] });  
  
      await insertMpCustomer({  
        user_id: 123,  
        mp_customer_id: 'cust_789012',  
        email: 'new@example.com',  
        raw_mp: {}  
      });  
  
      expect(pool.query).toHaveBeenCalled();  
    });  
  });  
});