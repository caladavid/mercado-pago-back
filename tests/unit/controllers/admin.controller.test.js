const request = require('supertest');  
const {app} = require('../../../src/app');  
const { pool } = require('../../../src/db/pool');  
const jwt = require('jsonwebtoken');  
const bcrypt = require("bcryptjs");
  
// Mock del pool de PostgreSQL  
jest.mock('../../../src/db/pool');  

jest.mock('bcryptjs');  
  
describe('Admin Controllers', () => {  
  let adminToken;  
  
  beforeEach(() => {  
    // Mock de admin token para tests autenticados  
    adminToken = jwt.sign(  
      { admin_user_id: 1, email: 'admin@test.com' },  
      process.env.JWT_SECRET  
    );  
    jest.clearAllMocks();  
  });  
  
  describe('POST /admin/login', () => {  
    it('debe autenticar con credenciales válidas', async () => {  
      const mockUser = {  
        id: 1,  
        email: 'admin@test.com',  
        password_hash: '$2a$10$hashedpassword',  
        is_active: true  
      };  
  
      bcrypt.compare.mockResolvedValue(true); 
      pool.query.mockResolvedValue({ rows: [mockUser] });  
  
      const response = await request(app)  
        .post('/admin/login')  
        .send({  
          email: 'admin@test.com',  
          password: 'password123'  
        });  
  
      expect(response.status).toBe(200);  
      expect(response.body).toHaveProperty('token');  
      expect(pool.query).toHaveBeenCalledWith(  
        expect.stringContaining('SELECT id, email, password_hash'),  
        ['admin@test.com']  
      );  
    });  
  
    it('debe rechazar email inválido', async () => {  
      const response = await request(app)  
        .post('/admin/login')  
        .send({  
          email: 'invalid-email',  
          password: 'password123'  
        });  
  
      expect(response.status).toBe(400);  
      expect(response.body).toHaveProperty('error');  
    });  
  
    it('debe rechazar contraseña muy corta', async () => {  
      const response = await request(app)  
        .post('/admin/login')  
        .send({  
          email: 'admin@test.com',  
          password: '123'  
        });  
  
      expect(response.status).toBe(400);  
      expect(response.body).toHaveProperty('error');  
    });  
  
    it('debe rechazar credenciales incorrectas', async () => {  
      pool.query.mockResolvedValue({ rows: [] });  
  
      const response = await request(app)  
        .post('/admin/login')  
        .send({  
          email: 'admin@test.com',  
          password: 'wrongpassword'  
        });  
  
      expect(response.status).toBe(401);  
      expect(response.body.error).toBe('Invalid credentials');  
    });  
  
    it('debe rechazar admin inactivo', async () => {  
      const mockUser = {  
        id: 1,  
        email: 'admin@test.com',  
        password_hash: '$2a$10$hashedpassword',  
        is_active: false  
      };  
  
      pool.query.mockResolvedValue({ rows: [mockUser] });  
  
      const response = await request(app)  
        .post('/admin/login')  
        .send({  
          email: 'admin@test.com',  
          password: 'password123'  
        });  
  
      expect(response.status).toBe(403);  
      expect(response.body.error).toBe('Admin disabled');  
    });  
  });  
  
  describe('POST /admin/merchants', () => {  
    it('debe crear merchant con autenticación válida', async () => {  
      const mockMerchant = {  
        id: 1,  
        name: 'Test Merchant',  
        slug: 'test-merchant',  
        status: 'active',  
        created_at: new Date()  
      };  
  
      pool.query.mockResolvedValue({ rows: [mockMerchant] });  
  
      const response = await request(app)  
        .post('/admin/merchants')  
        .set('Authorization', `Bearer ${adminToken}`)  
        .send({  
          name: 'Test Merchant',  
          slug: 'test-merchant'  
        });  
  
      expect(response.status).toBe(201);  
      expect(response.body.name).toBe('Test Merchant');  
      expect(response.body.slug).toBe('test-merchant');  
    });  
  
    it('debe rechazar nombre muy corto', async () => {  
      const response = await request(app)  
        .post('/admin/merchants')  
        .set('Authorization', `Bearer ${adminToken}`)  
        .send({  
          name: 'A',  
          slug: 'test-merchant'  
        });  
  
      expect(response.status).toBe(400);  
      expect(response.body).toHaveProperty('error');  
    });  
  
    it('debe rechazar slug muy corto', async () => {  
      const response = await request(app)  
        .post('/admin/merchants')  
        .set('Authorization', `Bearer ${adminToken}`)  
        .send({  
          name: 'Test Merchant',  
          slug: 'A'  
        });  
  
      expect(response.status).toBe(400);  
      expect(response.body).toHaveProperty('error');  
    });  
  
    it('debe manejar errores de base de datos al crear merchant', async () => {  
      pool.query.mockRejectedValue(new Error('Database connection failed'));  
  
      const response = await request(app)  
        .post('/admin/merchants')  
        .set('Authorization', `Bearer ${adminToken}`)  
        .send({  
          name: 'Test Merchant',  
          slug: 'test-merchant'  
        });  
  
      expect(response.status).toBe(500);  
    });  
  });  
  
  describe('POST /admin/merchants/:merchantId/api-keys', () => {  
    it('debe crear API key con autenticación válida', async () => {  
      const mockMerchant = {  
        id: 1,  
        slug: 'test-merchant',  
        status: 'active'  
      };  
  
      pool.query  
        .mockResolvedValueOnce({ rows: [mockMerchant] }) // Verificar merchant  
        .mockResolvedValueOnce({}); // Insert API key  
  
      const response = await request(app)  
        .post('/admin/merchants/1/api-keys')  
        .set('Authorization', `Bearer ${adminToken}`)  
        .send({  
          name: 'prod-key',  
          env: 'live'  
        });  
  
      expect(response.status).toBe(201);  
      expect(response.body).toHaveProperty('token');  
      expect(response.body).toHaveProperty('merchant_id', "1");  
      expect(response.body).toHaveProperty('key_prefix');  
      expect(response.body.token).toMatch(/^mpw_live_[a-f0-9-]{36}$/);  
    });  
  
    it('debe crear API key con valores por defecto', async () => {  
      const mockMerchant = {  
        id: 1,  
        slug: 'test-merchant',  
        status: 'active'  
      };  
  
      pool.query  
        .mockResolvedValueOnce({ rows: [mockMerchant] })  
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); 
  
      const response = await request(app)  
        .post('/admin/merchants/1/api-keys')  
        .set('Authorization', `Bearer ${adminToken}`)  
        .send({}); // Sin campos - debe usar defaults  
  
      expect(response.status).toBe(201);  
      expect(pool.query).toHaveBeenNthCalledWith(2,    
      expect.stringContaining('INSERT INTO admin_portal.merchant_api_keys'),    
      expect.arrayContaining([    
        "1", // merchant_id como string  
        "prod-key",   
        expect.stringMatching("mpw_live_"),  
        expect.any(String), // key_hash    
        "{}", // scopes como string  
        true 
      ])  
    ); 
    });  
  
    it('debe rechazar si merchant no existe', async () => {  
      pool.query.mockResolvedValue({ rows: [] });  
  
      const response = await request(app)  
        .post('/admin/merchants/999/api-keys')  
        .set('Authorization', `Bearer ${adminToken}`)  
        .send({  
          name: 'prod-key'  
        });  
  
      expect(response.status).toBe(404);  
      expect(response.body.error).toBe('Merchant not found');  
    });  
  
    it('debe rechazar sin autenticación', async () => {  
      const response = await request(app)  
        .post('/admin/merchants/1/api-keys')  
        .send({  
          name: 'prod-key'  
        });  
  
      expect(response.status).toBe(401);  
    });  
  
    it('debe rechazar nombre muy corto', async () => {  
      const mockMerchant = { id: 1, slug: 'test', status: 'active' };  
      pool.query.mockResolvedValue({ rows: [mockMerchant] });  
  
      const response = await request(app)  
        .post('/admin/merchants/1/api-keys')  
        .set('Authorization', `Bearer ${adminToken}`)  
        .send({  
          name: 'A'  
        });  
  
      expect(response.status).toBe(400);  
      expect(response.body).toHaveProperty('error');  
    });  
  
    it('debe rechazar env inválido', async () => {  
      const mockMerchant = { id: 1, slug: 'test', status: 'active' };  
      pool.query.mockResolvedValue({ rows: [mockMerchant] });  
  
      const response = await request(app)  
        .post('/admin/merchants/1/api-keys')  
        .set('Authorization', `Bearer ${adminToken}`)  
        .send({  
          name: 'prod-key',  
          env: 'invalid'  
        });  
  
      expect(response.status).toBe(400);  
      expect(response.body).toHaveProperty('error');  
    });  
  
    it('debe manejar errores de base de datos', async () => {  
      pool.query.mockRejectedValue(new Error('Database error'));  
  
      const response = await request(app)  
        .post('/admin/merchants/1/api-keys')  
        .set('Authorization', `Bearer ${adminToken}`)  
        .send({  
          name: 'prod-key'  
        });  
  
      expect(response.status).toBe(500);  
    });  
  });  
});