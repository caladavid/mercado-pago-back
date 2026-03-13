import { Response } from 'express';
import { TenantRequest } from './transactions.controller'; // O de donde venga tu interfaz
import { customerRepo } from '../repos/customer.repo';



export const customerController = {
  
  // 👥 1. Obtener listado de clientes
  getCustomers: async (req: TenantRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant?.id;
      
      console.log(`📍 [CustomerController IN] Buscando clientes para Merchant:`, merchantId);

      if (!merchantId) {
        res.status(401).json({ ok: false, error: "No autorizado" });
        return;
      }

      const { limit, offset } = req.query;

      // LLAMADA AL REPO REAL
      const data = await customerRepo.getMerchantCustomers(merchantId, {
        limit: limit ? Number(limit) : 20,
        offset: offset ? Number(offset) : 0
      });
      
      console.log(`📍 [CustomerController OUT] Clientes encontrados:`, data.length);

      // 🚨 ¡Adiós al data: [] quemado!
      res.json({ 
        ok: true, 
        count: data.length, 
        data: data 
      });

    } catch (e: any) {
      console.error("❌ Error en getCustomers:", e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  },

  // 👤 2. Obtener historial de UN cliente específico
  getCustomerHistory: async (req: TenantRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant?.id;
      const { userId } = req.params;

      console.log(`📍 [CustomerHistory IN] Buscando compras del usuario ${userId} para Merchant:`, merchantId);

      if (!merchantId) {
        res.status(401).json({ ok: false, error: "No autorizado" });
        return;
      }

      // LLAMADA AL REPO REAL
      const data = await customerRepo.getHistoryByUser(merchantId, userId as string);
      
      console.log(`📍 [CustomerHistory OUT] Compras encontradas:`, data.length);

      res.json({ ok: true, count: data.length, data });

    } catch (e: any) {
      console.error("❌ Error en getCustomerHistory:", e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
};