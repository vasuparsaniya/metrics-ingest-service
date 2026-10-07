/** Session-only policy: avoid measured JIT overhead; never alter server-wide settings. */
export const postgresSessionOptions = '-c timezone=UTC -c jit=off';
