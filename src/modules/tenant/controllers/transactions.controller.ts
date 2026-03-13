import { Request, Response } from 'express';
import { transactionsRepo } from '../repos/transactions.repo';


// 🚀 Definimos la interfaz aquí mismo, extendiendo la Request de Express
export interface TenantRequest extends Request {
  merchant?: {
    id: string;
    name?: string;
  };
}

export const transactionController = {
  
    getHistory: async (req: TenantRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant?.id;
      
      // 📍 TRAZA 1: ¿Qué ID recibe el controlador?
      console.log(`📍 [Controlador IN] ID recibido del Middleware:`, merchantId);

      if (!merchantId) {
        res.status(401).json({ ok: false, error: "No autorizado" });
        return;
      }

      const { type, status, limit, offset } = req.query;
      const filters = { 
        type: type as string, 
        status: status as string, 
        limit: limit ? Number(limit) : 50, 
        offset: offset ? Number(offset) : 0 
      };

      // 📍 TRAZA 2: ¿Qué filtros le vamos a mandar al repo?
      console.log(`📍 [Controlador] Llamando al Repo con filtros:`, filters);

      // LLAMADA AL REPOSITORIO
      const allTransactions = await transactionsRepo.getMerchantHistory(merchantId, filters);
      
      // 📍 TRAZA 3: ¿Qué devolvió el repo?
      console.log(`📍 [Controlador OUT] Registros devueltos por el Repo:`, allTransactions?.length);

      const pagos_unicos = allTransactions.filter((tx: any) => 
      !tx.plan_id && !tx.subscription_id && tx.type !== 'subscription'
    );

    const suscripciones = allTransactions.filter((tx: any) => 
      tx.plan_id || tx.subscription_id || tx.type === 'subscription'
    );

      res.json({ 
        ok: true, 
        count: allTransactions?.length || 0, 
        data: {
          pagos_unicos,
          suscripciones
        }
      });
      
    } catch (e: any) {
      console.error("❌ Error en getHistory Controller:", e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  },

  getTransactionDetail: async (req: TenantRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant?.id;
      const { id } = req.params;

      console.log(`📍 [TransactionDetail IN] Buscando compra ${id} para Merchant:`, merchantId);

      if (!merchantId) {
        res.status(401).json({ ok: false, error: "No autorizado" });
        return;
      }

      // LLAMADA AL REPO REAL
      const data = await transactionsRepo.getTransactionById(id as string, merchantId);

      // Si data es null, significa que no existe o es de otro Merchant
      if (!data) {
        console.log(`⚠️ [TransactionDetail OUT] Compra no encontrada o acceso denegado.`);
        res.status(404).json({ ok: false, error: "Transacción no encontrada" });
        return;
      }

      console.log(`📍 [TransactionDetail OUT] Compra encontrada con éxito.`);
      
      // Devolvemos el objeto real
      res.json({ ok: true, data });
      
    } catch (e: any) {
      console.error("❌ Error en getTransactionDetail:", e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  },
};