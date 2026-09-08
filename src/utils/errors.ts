export class HttpError extends Error { constructor(public status: number, message: string, public code = 'ERROR') { super(message); } }
export const assert = (condition: unknown, status: number, message: string, code?: string): asserts condition => { if (!condition) throw new HttpError(status, message, code); };
