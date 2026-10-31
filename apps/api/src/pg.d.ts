declare module 'pg' {
  export class Pool {
    constructor(options?: any);
    query(...args: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
    connect(): Promise<{ query(...args: unknown[]): Promise<unknown>; release(): void }>;
    end(): Promise<void>;
  }
}
