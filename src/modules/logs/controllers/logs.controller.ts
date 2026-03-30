import { NextFunction, Request, Response } from "express";

const repo = require("../repo/logs.repo");

interface FrontendLogBody {
    message: string;
    stack?: string;
    metadata?: any;
    userEmail?: string;
    context?: string;
    level?: 'error' | 'warn' | 'info';
}

async function receiveFrontendLog(
    req: Request<{}, {}, FrontendLogBody>, 
    res: Response, 
    next: NextFunction
): Promise<void> {
    try {
        const { 
            message, 
            stack, 
            metadata, 
            userEmail, 
            context, 
            level = 'error' 
        } = req.body;

        console.log(`\n🚨 [FRONTEND ${level.toUpperCase()}] ${context || 'general'}: ${message}`);

        await repo.saveLog({
            level,
            source: 'frontend',
            context: context || 'general_frontend',
            message,
            metadata: {
                user_email: userEmail,
                stack_trace: stack,
                raw_data: metadata
            }
        });

        res.status(200).json({ ok: true });
    } catch (error: any) {
        console.error("❌ Error interno en receiveFrontendLog:", error);
        
        // Manejo de error compatible con TS
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        res.status(500).json({ 
            ok: false, 
            error: errorMessage 
        }); 
    }
}

module.exports = { receiveFrontendLog };