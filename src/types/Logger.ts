/**
 * Matches the interface of most loggers such as Winston and Pino
 */
export interface Logger {
  info: (details: Record<string, any>) => any
  error: (details: Record<string, any>) => any
}
