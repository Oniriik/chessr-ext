/**
 * Express type extensions
 */

declare namespace Express {
  export interface Request {
    rawBody?: string;
    user?: {
      id: string;
      email: string;
    };
  }
}
