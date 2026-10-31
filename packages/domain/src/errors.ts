import type { RagErrorCode } from './types.js';
export class RagError extends Error { constructor(public readonly code:RagErrorCode, message:string, public readonly status=400){super(message)} }
export const validationError=(m:string)=>new RagError('VALIDATION_ERROR',m,400);
export const notFoundError=(m:string)=>new RagError('NOT_FOUND',m,404);
export const unsupportedMediaTypeError=(m:string)=>new RagError('UNSUPPORTED_MEDIA_TYPE',m,415);
export const repositoryError=(m:string)=>new RagError('REPOSITORY_ERROR',m,500);
export const embeddingProviderError=(m:string)=>new RagError('EMBEDDING_PROVIDER_ERROR',m,502);
export const generationProviderError=(m:string)=>new RagError('GENERATION_PROVIDER_ERROR',m,502);
export const dimensionMismatchError=(m:string)=>new RagError('DIMENSION_MISMATCH',m,409);
export function toErrorEnvelope(e:unknown){if(e&&typeof e==='object'&&'statusCode' in e&&typeof (e as {statusCode:unknown}).statusCode==='number'){const x=e as {statusCode:number;message?:string};return {status:x.statusCode,error:{code:'VALIDATION_ERROR',message:x.message??'Invalid request'}}}const err=e instanceof RagError?e:new RagError('INTERNAL_ERROR',e instanceof Error?e.message:'Unexpected error',500);return {status:err.status,error:{code:err.code,message:err.message}}}
