// AI coach: schemas, snapshot builder, tool executor. Imported as '@diet/core/coach'
// (a separate entry so the main '@diet/core' stays free of zod for code that never talks to the coach).
export * from './schema';
export * from './types';
export * from './context';
export * from './execute';
export * from './tools';
export * from './client';
export * from './plangen';
