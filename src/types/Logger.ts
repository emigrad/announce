/**
 * Matches the interface of most loggers such as Winston and Pino
 */
export interface Logger {
  trace: (message: string, details?: any) => any
  info: (message: string, details?: any) => any
  error: (message: string, details?: any) => any
}
