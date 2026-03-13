import { Request, Response } from 'express';
import config from '../../../config/env'; 
import * as mpClient from '../../../integrations/mercadopago/mpClient';

interface HealthResponse {
    status: string;
    environment: string | undefined;
    is_dev_mode: boolean;
    mercadopago: {
        token_type: "PRODUCCIÓN (Real)" | "TEST (Sandbox)" | "DESCONOCIDO";
        public_key_prefix: string;
        api_connection: "CONNECTED" | "FAILED";
    };
}

export const checkMPStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const token = config.mpAccessToken || "";
        const isProdToken = token.startsWith("APP_USR");
        const isTestToken = token.startsWith("TEST");

        // 2. Intento de conexión ligera a la API de MP
        let apiConnected: "CONNECTED" | "FAILED" = "FAILED";
        
        try {
            // Buscamos un pago inexistente solo para ver si la API nos reconoce el Token
            await mpClient.getPaymentFromMP("check-connection");
            apiConnected = "CONNECTED";
        } catch (error: any) {
            // Si el error es 404, significa que el token es válido pero el recurso no existe (¡estamos conectados!)
            if (error.status === 404 || error.status === 401) {
                apiConnected = "CONNECTED";
            } else {
                console.error("❌ MP Connection Error:", error.message);
                apiConnected = "FAILED";
            }
        }

        const response: HealthResponse = {
            status: "OK",
            environment: process.env.NODE_ENV,
            is_dev_mode: config.isDev,
            mercadopago: {
                token_type: isProdToken ? "PRODUCCIÓN (Real)" : isTestToken ? "TEST (Sandbox)" : "DESCONOCIDO",
                public_key_prefix: config.mpPublicKey ? config.mpPublicKey.substring(0, 15) : "MISSING",
                api_connection: apiConnected
            }
        };

        res.status(200).json(response);
    } catch (error: any) {
        res.status(500).json({
            status: "ERROR",
            message: error.message
        });
    }
};