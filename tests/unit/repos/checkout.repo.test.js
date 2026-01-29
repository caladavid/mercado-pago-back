const { upsertUser, upsertProduct, createOrder, createOrderItem } = require('../../../src/modules/one_time_checkout/repos/checkout.repo');  
  
describe('checkout.repo', () => {  
  let mockClient;  
  
  beforeEach(() => {  
    mockClient = {  
      query: jest.fn()  
    };  
    jest.clearAllMocks();  
  });  
  
  describe('upsertUser', () => {  
    it('debe crear usuario nuevo', async () => {  
      const mockUser = {  
        id: 1,  
        email: 'test@example.com',  
        full_name: 'John Doe',  
        doc_type: 'CI',  
        doc_number: '12345678'  
      };  
  
      mockClient.query.mockResolvedValue({ rows: [mockUser] });  
  
      const result = await upsertUser(mockClient, {  
        email: 'test@example.com',  
        fullName: 'John Doe',  
        docType: 'CI',  
        docNumber: '12345678'  
      });  
  
      expect(mockClient.query).toHaveBeenCalledWith(  
        expect.stringContaining('INSERT INTO users'),  
        ['test@example.com', 'John Doe', 'CI', '12345678']  
      );  
      expect(result).toEqual(mockUser);  
    });  
  
    it('debe actualizar usuario existente', async () => {  
      const mockUser = {  
        id: 1,  
        email: 'test@example.com',  
        full_name: 'John Updated',  
        doc_type: 'CI',  
        doc_number: '12345678'  
      };  
  
      mockClient.query.mockResolvedValue({ rows: [mockUser] });  
  
      const result = await upsertUser(mockClient, {  
        email: 'test@example.com',  
        fullName: 'John Updated',  
        docType: null,  
        docNumber: null  
      });  
  
      expect(mockClient.query).toHaveBeenCalledWith(  
        expect.stringContaining('ON CONFLICT (email) DO UPDATE'),  
        ['test@example.com', 'John Updated', null, null]  
      );  
      expect(result).toEqual(mockUser);  
    });  
  });  
  
  describe('upsertProduct', () => {  
    it('debe crear producto nuevo', async () => {  
      const mockProduct = {  
        id: 1,  
        sku: 'PROD-001',  
        name: 'Test Product',  
        price: '1500.00',  
        currency: 'UYU',  
        active: true  
      };  
  
      mockClient.query.mockResolvedValue({ rows: [mockProduct] });  
  
      const result = await upsertProduct(mockClient, {  
        sku: 'PROD-001',  
        name: 'Test Product',  
        price: 1500,  
        currency: 'UYU'  
      });  
  
      expect(mockClient.query).toHaveBeenCalledWith(  
        expect.stringContaining('INSERT INTO products'),  
        ['Test Product', 'PROD-001', 1500, 'UYU']  
      );  
      expect(result).toEqual(mockProduct);  
    });  
  
    it('debe actualizar producto existente', async () => {  
      const mockProduct = {  
        id: 1,  
        sku: 'PROD-001',  
        name: 'Updated Product',  
        price: '2000.00',  
        currency: 'UYU',  
        active: true  
      };  
  
      mockClient.query.mockResolvedValue({ rows: [mockProduct] });  
  
      const result = await upsertProduct(mockClient, {  
        sku: 'PROD-001',  
        name: 'Updated Product',  
        price: 2000,  
        currency: 'UYU'  
      });  
  
      expect(mockClient.query).toHaveBeenCalledWith(  
        expect.stringContaining('ON CONFLICT (sku) DO UPDATE'),  
        ['Updated Product', 'PROD-001', 2000, 'UYU']  
      );  
      expect(result).toEqual(mockProduct);  
    });  
  });  
  
  describe('createOrder', () => {  
    it('debe crear orden con external_reference', async () => {  
      const mockOrder = {  
        id: 123,  
        user_id: 42,  
        status: 'pending',  
        total_amount: '1500.00',  
        currency: 'UYU',  
        external_reference: 'test-merchant:550e8400-e29b-41d4-a716-446655440000'  
      };  
  
      mockClient.query.mockResolvedValue({ rows: [mockOrder] });  
  
      const result = await createOrder(mockClient, {  
        userId: 42,  
        totalAmount: 1500,  
        currency: 'UYU',  
        merchantSlug: 'test-merchant'  
      });  
  
      expect(mockClient.query).toHaveBeenCalledWith(  
        expect.stringContaining('INSERT INTO orders'),  
        [42, 1500, 'UYU', expect.stringMatching(/^test-merchant:[a-f0-9-]{36}$/)]  
      );  
      expect(result).toEqual(mockOrder);  
    });  
  });  
  
  describe('createOrderItem', () => {  
    it('debe crear item de orden correctamente', async () => {  
      const mockOrderItem = {  
        id: 456,  
        order_id: 789,  
        product_id: 123,  
        qty: 1,  
        unit_price: '1500.00',  
        line_total: '1500.00'  
      };  
  
      mockClient.query.mockResolvedValue({ rows: [mockOrderItem] });  
  
      const result = await createOrderItem(mockClient, {  
        orderId: 789,  
        productId: 123,  
        qty: 1,  
        unitPrice: 1500  
      });  
  
      expect(mockClient.query).toHaveBeenCalledWith(  
        expect.stringContaining('INSERT INTO order_items'),  
        [789, 123, 1, 1500, 1500] // ← lineTotal como número, no string  
      );  
      expect(result).toEqual(mockOrderItem);  
    });  
  
    it('debe calcular line_total correctamente', async () => {  
      const mockOrderItem = {  
        id: 456,  
        order_id: 789,  
        product_id: 123,  
        qty: 2,  
        unit_price: '750.00',  
        line_total: '1500.00'  
      };  
  
      mockClient.query.mockResolvedValue({ rows: [mockOrderItem] });  
  
      const result = await createOrderItem(mockClient, {  
        orderId: 789,  
        productId: 123,  
        qty: 2,  
        unitPrice: 750  
      });  
  
      expect(mockClient.query).toHaveBeenCalledWith(  
        expect.stringContaining('INSERT INTO order_items'),  
        [789, 123, 2, 750, 1500] // ← 2 * 750 = 1500  
      );  
      expect(result).toEqual(mockOrderItem);  
    });  
  
    it('debe manejar errores de base de datos', async () => {  
      mockClient.query.mockRejectedValue(new Error('Database connection failed'));  
  
      await expect(createOrderItem(mockClient, {  
        orderId: 789,  
        productId: 123,  
        qty: 1,  
        unitPrice: 1500  
      })).rejects.toThrow('Database connection failed');  
    });  
  });  
});