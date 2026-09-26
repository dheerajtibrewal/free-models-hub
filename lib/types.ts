/** Shapes shared between the API routes and the client. */
export interface QuotaResponse {
  visitor: { used: number; limit: number; remaining: number };
  tasks: Array<{ slug: string; available: boolean; reason?: string }>;
  degraded: boolean;
  resetsAt: string;
}
