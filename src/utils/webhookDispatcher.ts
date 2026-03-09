import axios from 'axios';
import crypto from 'crypto';

export interface EnrollmentPayload {
  id?: number;
  type: 'subscription' | 'one_time';
  id_subscription: number;
  name: string;
  email: string;
  status: string;
  amount: string | number;
  fecha?: string;
  local_go_id: string | null;
}

export interface DispatcherResponse {
  success: boolean;
  status?: number;
  error?: string;
}

export async function notifyMerchants(tenantUrl: string, payload: EnrollmentPayload, secretToken: string): Promise<DispatcherResponse> {
    try {
        
        const signature = crypto
            .createHmac('sha256', secretToken)
            .update(JSON.stringify(payload))
            .digest('hex');

        const response = await axios.post(tenantUrl, payload, {
            headers: {
                'X-Gateway-Signature': signature,
                'Content-Type': 'application/json',
                'User-Agent': 'MP-Payment/1.0'
            },
            timeout: 5000 
        });

        return {
            success: true,
            status: response.status
        }

    } catch (error: any) {

    console.error(`❌ [Dispatcher Error] Fallo al notificar a ${tenantUrl}:`, error.message);
    
    return {
      success: false,
      status: error.response?.status,
      error: error.message
    };
    }
}