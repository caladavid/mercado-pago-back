const { withTransaction } = require('../../../src/shared/db/withTransaction');  
const { pool } = require('../../../src/db/pool');  
  
// Mock del pool  
jest.mock('../../../src/db/pool');  
  
describe('withTransaction', () => {  
  let mockClient;  
  
  beforeEach(() => {  
    mockClient = {  
      query: jest.fn(),  
      release: jest.fn()  
    };  
    jest.clearAllMocks();  
  });  
  
  describe('Casos de éxito', () => {  
    it('debe ejecutar transacción completa con COMMIT', async () => {  
      pool.connect.mockResolvedValue(mockClient);  
      mockClient.query  
        .mockResolvedValueOnce({}) // BEGIN  
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Callback  
  
      const callback = jest.fn().mockResolvedValue({ rows: [{ id: 1 }] });  
        
      const result = await withTransaction(callback);  
  
      expect(pool.connect).toHaveBeenCalled();  
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');  
      expect(callback).toHaveBeenCalledWith(mockClient);  
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');  
      expect(mockClient.release).toHaveBeenCalled();  
      expect(result).toEqual({ rows: [{ id: 1 }] });  
    });  
  
    it('debe retornar valor del callback', async () => {  
      pool.connect.mockResolvedValue(mockClient);  
      mockClient.query.mockResolvedValue({});  
  
      const callback = jest.fn().mockReturnValue('test result');  
        
      const result = await withTransaction(callback);  
  
      expect(result).toBe('test result');  
    });  
  });  
  
  describe('Manejo de errores', () => {  
    it('debe hacer ROLLBACK cuando el callback falla', async () => {  
      pool.connect.mockResolvedValue(mockClient);  
      mockClient.query  
        .mockResolvedValueOnce({}) // BEGIN  
        .mockResolvedValue({}); // ROLLBACK  
  
      const error = new Error('Database error');  
      const callback = jest.fn().mockRejectedValue(error);  
  
      await expect(withTransaction(callback)).rejects.toThrow('Database error');  
  
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');  
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');  
      expect(mockClient.release).toHaveBeenCalled();  
    });  
  
    it('debe hacer ROLLBACK cuando BEGIN falla', async () => {  
      pool.connect.mockResolvedValue(mockClient);  
      mockClient.query.mockRejectedValueOnce(new Error('BEGIN failed'));  
  
      await expect(withTransaction(jest.fn())).rejects.toThrow('BEGIN failed');  
  
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');  
      expect(mockClient.release).toHaveBeenCalled();  
    });  
  
    it('debe liberar cliente incluso si release falla', async () => {  
      pool.connect.mockResolvedValue(mockClient);  
      mockClient.query  
        .mockResolvedValueOnce({}) // BEGIN  
        .mockResolvedValue({}); // COMMIT  
      mockClient.release.mockImplementation(() => {  
        throw new Error('Release failed');  
      });  
  
      const callback = jest.fn().mockResolvedValue('success');  
  
      // No debería lanzar error si release falla  
      await expect(withTransaction(callback)).resolves.toBe('success');  
        
      expect(mockClient.release).toHaveBeenCalled();  
    });  
  });  
});