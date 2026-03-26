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

      res.json({  
        data 
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
      const identifier = (req.params.userId as string);

      console.log(`📍 [CustomerHistory IN] Buscando compras del usuario ${identifier} para Merchant:`, merchantId);

      if (!merchantId) {
        res.status(401).json({ ok: false, error: "No autorizado" });
        return;
      }

      let allTransactions = [];

      const isEmail = identifier.includes('@');

      if (isEmail) {
        console.log(`📧 Detectado formato de Email. Buscando por correo...`);
        allTransactions = await customerRepo.getHistoryByEmail(merchantId, identifier.trim().toLowerCase());
      } else {
        console.log(`🆔 Detectado formato de UUID. Buscando por ID...`);
        allTransactions = await customerRepo.getHistoryByUser(merchantId, identifier);
      }
      
      console.log(`📍 [CustomerHistory OUT] Compras encontradas:`, allTransactions.length);

      const pagos_unicos = allTransactions.filter((tx: any) => 
        !tx.plan_id && !tx.subscription_id && tx.type !== 'subscription'
      );

      const suscripciones = allTransactions.filter((tx: any) => 
        tx.plan_id || tx.subscription_id || tx.type === 'subscription'
      );

      res.json({ 
          pagos_unicos,
          suscripciones
      });

    } catch (e: any) {
      console.error("❌ Error en getCustomerHistory:", e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
};