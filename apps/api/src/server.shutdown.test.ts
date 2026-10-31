import { describe, expect, it, vi } from 'vitest';
import { installGracefulShutdown } from './server.js';

describe('graceful shutdown', () => {
  it('closes the app once when a termination signal arrives', async () => {
    const handlers = new Map<string, () => Promise<void>>();
    const once = vi.spyOn(process, 'once').mockImplementation(((signal: string, handler: () => Promise<void>) => { handlers.set(signal, handler); return process; }) as typeof process.once);
    const off = vi.spyOn(process, 'off').mockImplementation((() => process) as typeof process.off);
    const close = vi.fn().mockResolvedValue(undefined);
    const remove = installGracefulShutdown({ close, addHook: vi.fn(), listen: vi.fn() });
    await handlers.get('SIGTERM')!();
    await handlers.get('SIGTERM')!();
    expect(close).toHaveBeenCalledTimes(1);
    remove();
    expect(off).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    once.mockRestore(); off.mockRestore();
  });
});
