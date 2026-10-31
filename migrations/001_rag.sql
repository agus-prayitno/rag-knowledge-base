create extension if not exists vector;
create table if not exists rag_documents (file_id text primary key, source_path text not null unique, source_name text not null, content_hash text not null, chunk_count integer not null check(chunk_count > 0), size_bytes integer not null check(size_bytes >= 0), tag text, updated_at timestamptz not null default now());
create table if not exists rag_chunks (point_id text primary key, file_id text not null references rag_documents(file_id) on delete cascade, chunk_index integer not null, content_hash text not null, text text not null, embedding vector(1536) not null);
create index if not exists rag_chunks_embedding_idx on rag_chunks using hnsw (embedding vector_cosine_ops);
