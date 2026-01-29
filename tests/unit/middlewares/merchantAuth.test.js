const { merchantAuth } = require('../../../src/middlewares/merchantAuth');  
const { pool } = require('../../../src/db/pool');  
const { hashToken, makePrefix } = require('../../../src/utils/merchantKeys');  
  
// Mock del pool de PostgreSQL  
jest.mock('../../../src/db/pool');  
jest.mock('../../../src/utils/merchantKeys');  
  
// Mock de console.error  
const originalConsoleError = console.error;  
beforeAll(() => {  
  console.error = jest.fn();  
});  
  
afterAll(() => {  
  console.error = originalConsoleError;  
});  
  
describe('merchantAuth middleware', () => {  
  let mockReq, mockRes, mockNext;  
  
  beforeEach(() => {  
    mockReq = {  
      headers: {},  
      body: {}, // ← CORRECCIÓN: Agregar body inicializado  
    };  
    mockRes = {  
      status: jest.fn().mockReturnThis(), // ← CORRECCIÓN: Método mock  
      json: jest.fn()                     // ← CORRECCIÓN: Método mock  
    };  
    mockNext = jest.fn();  
        
    // Reset mocks  
    jest.clearAllMocks();  
  });  
  
  describe('Casos de éxito', () => {  
    it('debe autenticar merchant con token válido', async () => {  
      const token = 'mpw_live_550e8400-e29b-41d4-a716-446655440000';  
      const keyHash = 'hashed_token_123';  
      const keyPrefix = 'mpw_live_550';  
          
      hashToken.mockReturnValue(keyHash);  
      makePrefix.mockReturnValue(keyPrefix);  
          
      const mockRow = {  
        api_key_id: 1,  
        api_key_active: true,  
        scopes: { payments: true },  
        merchant_id: 123,  
        merchant_slug: 'test-merchant',  
        merchant_status: 'active'  
      };  
          
      pool.query.mockResolvedValue({ rows: [mockRow] });  
          
      mockReq.headers.authorization = `Bearer ${token}`;  
          
      await merchantAuth(mockReq, mockRes, mockNext);  
          
      expect(hashToken).toHaveBeenCalledWith(token);  
      expect(pool.query).toHaveBeenCalledWith(  
        expect.stringContaining('SELECT'),  
        [keyHash]  
      );  
      expect(mockReq.merchant).toEqual({  
        id: 123,  
        slug: 'test-merchant',  
        apiKeyId: 1,  
        scopes: { payments: true },  
        tokenPrefix: keyPrefix  
      });  
      expect(mockNext).toHaveBeenCalled();  
    });  
  
    it('debe actualizar last_used_at del API key', async () => {  
      const token = 'mpw_live_test-token';  
      const keyHash = 'hashed_123';  
          
      hashToken.mockReturnValue(keyHash);  
      pool.query  
        .mockResolvedValueOnce({     
          rows: [{  
            api_key_id: 1,  
            api_key_active: true,  
            scopes: {},  
            merchant_id: 123,  
            merchant_slug: 'test',  
            merchant_status: 'active'  
          }]  
        })  
        .mockResolvedValueOnce({});  
          
      mockReq.headers.authorization = `Bearer ${token}`;  
          
      await merchantAuth(mockReq, mockRes, mockNext);  
          
      expect(pool.query).toHaveBeenCalledTimes(2);  
      expect(pool.query).toHaveBeenNthCalledWith(2,  
        'UPDATE admin_portal.merchant_api_keys SET last_used_at = now() WHERE id = $1',  
        [1]  
      );  
    });  
  });  
  
  describe('Casos de error - Header Authorization', () => {  
    it('debe rechazar si no hay header Authorization', async () => {  
      await merchantAuth(mockReq, mockRes, mockNext);  
          
      expect(mockRes.status).toHaveBeenCalledWith(401);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Missing Bearer token" });  
    });  
  
    it('debe rechazar si header no empieza con "Bearer "', async () => {  
      mockReq.headers.authorization = 'Basic token123';  
          
      await merchantAuth(mockReq, mockRes, mockNext);  
          
      expect(mockRes.status).toHaveBeenCalledWith(401);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Missing Bearer token" });  
    });  
  
    it('debe rechazar si el token está vacío', async () => {  
      mockReq.headers.authorization = 'Bearer ';  
          
      await merchantAuth(mockReq, mockRes, mockNext);  
          
      expect(mockRes.status).toHaveBeenCalledWith(401);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Empty token" });  
    });  
  });  
  
  describe('Casos de error - Validación de Token', () => {  
    it('debe rechazar token no encontrado en BD', async () => {  
      const token = 'mpw_live_invalid';  
      const keyHash = 'hashed_invalid';  
          
      hashToken.mockReturnValue(keyHash);  
      pool.query.mockResolvedValue({ rows: [] });  
          
      mockReq.headers.authorization = `Bearer ${token}`;  
          
      await merchantAuth(mockReq, mockRes, mockNext);  
          
      expect(mockRes.status).toHaveBeenCalledWith(401);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Invalid token" });  
    });  
  
    it('debe rechazar si API key está desactivado', async () => {  
      const token = 'mpw_live_disabled';  
      const keyHash = 'hashed_disabled';  
          
      hashToken.mockReturnValue(keyHash);  
      pool.query.mockResolvedValue({     
        rows: [{  
          api_key_id: 1,  
          api_key_active: false,  
          scopes: {},  
          merchant_id: 123,  
          merchant_slug: 'test',  
          merchant_status: 'active'  
        }]  
      });  
          
      mockReq.headers.authorization = `Bearer ${token}`;  
          
      await merchantAuth(mockReq, mockRes, mockNext);  
          
      expect(mockRes.status).toHaveBeenCalledWith(401);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Token disabled" });  
    });  
  
    it('debe rechazar si merchant está suspendido', async () => {  
      const token = 'mpw_live_suspended';  
      const keyHash = 'hashed_suspended';  
          
      hashToken.mockReturnValue(keyHash);  
      pool.query.mockResolvedValue({     
        rows: [{  
          api_key_id: 1,  
          api_key_active: true,  
          scopes: {},  
          merchant_id: 123,  
          merchant_slug: 'test',  
          merchant_status: 'suspended'  
        }]  
      });  
          
      mockReq.headers.authorization = `Bearer ${token}`;  
          
      await merchantAuth(mockReq, mockRes, mockNext);  
          
      expect(mockRes.status).toHaveBeenCalledWith(403);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Merchant suspended" });  
    });  
  
    it('debe rechazar si hay slug mismatch', async () => {  
      const token = 'mpw_live_mismatch';  
      const keyHash = 'hashed_mismatch';  
          
      hashToken.mockReturnValue(keyHash);  
      pool.query.mockResolvedValue({     
        rows: [{  
          api_key_id: 1,  
          api_key_active: true,  
          scopes: {},  
          merchant_id: 123,  
          merchant_slug: 'correct-slug',  
          merchant_status: 'active'  
        }]  
      });  
          
      mockReq.headers.authorization = `Bearer ${token}`;  
      mockReq.body.slug = 'wrong-slug'; // ← Ahora funciona porque body está inicializado  
          
      await merchantAuth(mockReq, mockRes, mockNext);  
          
      expect(mockRes.status).toHaveBeenCalledWith(403);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Slug mismatch" });  
    });  
  });  
  
  describe('Casos de error - Base de Datos', () => {  
    it('debe manejar errores de base de datos', async () => {  
      const token = 'mpw_live_error';  
      const keyHash = 'hashed_error';  
          
      hashToken.mockReturnValue(keyHash);  
      pool.query.mockRejectedValue(new Error('Database connection failed'));  
          
      mockReq.headers.authorization = `Bearer ${token}`;  
          
      await merchantAuth(mockReq, mockRes, mockNext);  
          
      expect(mockRes.status).toHaveBeenCalledWith(500);  
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Server error" });  
    });  
  });  
});