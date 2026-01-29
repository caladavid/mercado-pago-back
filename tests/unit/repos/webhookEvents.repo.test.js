const { insertWebhookEvent } = require('../../../src/modules/webhooks/repos/webhookEvents.repo');  
const { pool } = require('../../../src/db/pool');  
  
jest.mock('../../../src/db/pool');  
  
describe('webhookEvents.repo', () => {  
  let mockPool;  
  
  beforeEach(() => {  
    mockPool = {  
      query: jest.fn()  
    };  
    pool.query = mockPool.query;  
    jest.clearAllMocks();  
  });  
  
  describe('insertWebhookEvent', () => {  
    it('debe insertar evento de webhook correctamente', async () => {  
      const mockResult = {  
        id: 123,  
        provider: 'mercadopago',  
        topic: 'payment',  
        action: 'payment.created'  
      };  
      mockPool.query.mockResolvedValue({ rows: [mockResult] });  
  
      const eventData = {  
        provider: 'mercadopago',  
        topic: 'payment',  
        action: 'payment.created',  
        mpEventId: 'evt_123',  
        payload: { id: 'pay_456', status: 'approved' }  
      };  
  
      const result = await insertWebhookEvent(eventData);  
  
      expect(mockPool.query).toHaveBeenCalledWith(  
        expect.stringContaining('INSERT INTO webhook_events'),  
        expect.arrayContaining([  
          'mercadopago',  
          'payment',  
          'payment.created',  
          'evt_123',  
          expect.any(String), // received_at  
          { id: 'pay_456', status: 'approved' },  
          'pending'  
        ])  
      );  
      expect(result).toEqual(mockResult);  
    });  
  
    it('debe manejar errores de base de datos', async () => {  
      mockPool.query.mockRejectedValue(new Error('Database connection failed'));  
  
      const eventData = {  
        provider: 'mercadopago',  
        topic: 'payment',  
        action: 'payment.created',  
        mpEventId: 'evt_123',  
        payload: { id: 'pay_456' }  
      };  
  
      await expect(insertWebhookEvent(eventData)).rejects.toThrow('Database connection failed');  
    });  
  });  
});