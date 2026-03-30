export type LogLevel = 'info' | 'warn' | 'error' | 'critical';
export type LogSource = 'frontend' | 'backend' | 'webhook' | 'cron';

export interface ISaveLog {
    level?: LogLevel;
    source: LogSource;
    context: string;
    message: string;
    metadata?: Record<string, any>;
}

export interface IFrontendLogRequest {
    message: string;
    stack?: string;
    metadata?: any;
    userEmail?: string;
    context: string;
    level?: LogLevel;
}