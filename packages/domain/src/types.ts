export interface IngestCommandRequest { content: string; source_path: string; source_name?: string; tag?: string | null }
export interface IngestFileResult { file_id:string; source_path:string; source_name:string; chunk_count:number; updated_at:string; tag:string|null }
export type DocumentSummary = IngestFileResult;
export interface DeleteFileResult { file_id:string; source_path:string; deleted_chunks:number }
export interface SetTagResult { file_id:string|null; source_path:string; tag:string|null }
export interface ChatSource { file_id:string; source_path:string; chunk_index:number; similarity:number; snippet:string }
export type RagErrorCode='VALIDATION_ERROR'|'NOT_FOUND'|'DIMENSION_MISMATCH'|'EMBEDDING_PROVIDER_ERROR'|'GENERATION_PROVIDER_ERROR'|'REPOSITORY_ERROR'|'UNSUPPORTED_MEDIA_TYPE'|'INTERNAL_ERROR';
export interface ChatNotice { code:RagErrorCode; message:string; reason?:string }
export interface ChatGenerationResult { answer:string; sources:ChatSource[]; notice?:ChatNotice }
export interface BatchSummary<T> { succeeded:T[]; failed:{source_path:string;error:string}[]; has_failures:boolean }
export interface SseEvent { event:'sources'|'token'|'notice'|'error'|'done'; data: Record<string, unknown> }
export interface PublicConfig { jiraBaseUrl: string | null }
export const DEFAULT_CHUNK_SIZE=1000, DEFAULT_CHUNK_OVERLAP=200, DEFAULT_TOP_K=5, TAG_PATTERN=/^[a-z0-9][a-z0-9._-]{0,63}$/;
export function deriveTag(path:string):string|null { const first=path.split('/')[0]; return first && !first.includes('.') ? first.toLowerCase() : null }
export function normalizeTag(raw:string):string|null { const tag=raw.trim().toLowerCase().replace(/\s+/g,'-').slice(0,64); return tag || null }
