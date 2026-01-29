const { generateMerchantToken, hashToken, makePrefix } = require('../../../src/utils/merchantKeys');  
  
describe('merchantKeys utils', () => {  
  beforeEach(() => {  
    process.env.API_KEY_PEPPER = 'test-pepper';  
  });  
  
  describe('generateMerchantToken', () => {  
    it('debe generar token live por defecto', () => {  
      const token = generateMerchantToken();  
      expect(token).toMatch(/^mpw_live_[a-f0-9-]{36}$/);  
    });  
  
    it('debe generar token test cuando se especifica', () => {  
      const token = generateMerchantToken({ env: 'test' });  
      expect(token).toMatch(/^mpw_test_[a-f0-9-]{36}$/);  
    });  
  
    it('debe generar tokens únicos', () => {  
      const token1 = generateMerchantToken();  
      const token2 = generateMerchantToken();  
      expect(token1).not.toBe(token2);  
    });  
  });  
  
  describe('makePrefix', () => {  
    it('debe extraer prefijo de 12 caracteres por defecto', () => {  
      const token = 'mpw_live_550e8400-e29b-41d4-a716-446655440000';  
      const prefix = makePrefix(token);  
      expect(prefix).toBe('mpw_live_550');  
    });  
  
    it('debe extraer prefijo con longitud personalizada', () => {  
      const token = 'mpw_live_550e8400-e29b-41d4-a716-446655440000';  
      const prefix = makePrefix(token, 8);  
      expect(prefix).toBe('mpw_live');  
    });  
  
    it('debe manejar token corto', () => {  
      const token = 'short';  
      const prefix = makePrefix(token, 10);  
      expect(prefix).toBe('short');  
    });  
  });  
  
  describe('hashToken', () => {  
    it('debe generar hash consistente', () => {  
      const token = 'mpw_live_test-token';  
      const hash1 = hashToken(token);  
      const hash2 = hashToken(token);  
      expect(hash1).toBe(hash2);  
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);  
    });  
  
    it('debe generar hashes diferentes para tokens diferentes', () => {  
      const hash1 = hashToken('token1');  
      const hash2 = hashToken('token2');  
      expect(hash1).not.toBe(hash2);  
    });  
  
    it('debe lanzar error si no hay API_KEY_PEPPER', () => {  
      delete process.env.API_KEY_PEPPER;  
      expect(() => hashToken('test')).toThrow('Missing API_KEY_PEPPER');  
    });  
  });  
});