# Supabase Schema Updates for Document-Based QnA Collections

## Overview
This document contains the required database schema changes to support document-based QnA collections in the CueMe2 system.

## Database Schema Changes

### 1. Update qna_collections Table

Add support for document metadata:

```sql
-- Add source_document column to track document-based collections
ALTER TABLE qna_collections 
ADD COLUMN source_document JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN qna_collections.source_document IS 'Metadata for collections created from uploaded documents';
```

**source_document JSON Structure:**
```json
{
  "original_name": "document.pdf",
  "file_type": "pdf",
  "size": 1048576,
  "processing_time": 45000,
  "segmentation_strategy": "semantic",
  "auto_generated": true
}
```

### 2. Update qna_items Table

Add support for source tracking and quality scores:

```sql
-- Add source_metadata column to track auto-generated items
ALTER TABLE qna_items 
ADD COLUMN source_metadata JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN qna_items.source_metadata IS 'Metadata for Q&A items generated from documents';
```

**source_metadata JSON Structure:**
```json
{
  "segment_id": "abc123",
  "question_type": "factual",
  "confidence": 0.85,
  "auto_generated": true,
  "quality_scores": {
    "relevance": 0.9,
    "clarity": 0.8,
    "completeness": 0.85,
    "uniqueness": 0.7
  }
}
```

### 3. Performance Indexes

Add indexes for better query performance:

```sql
-- Index for filtering document-based collections
CREATE INDEX idx_qna_collections_source_document 
ON qna_collections USING GIN (source_document);

-- Index for filtering auto-generated items
CREATE INDEX idx_qna_items_source_metadata 
ON qna_items USING GIN (source_metadata);

-- Index for filtering by auto-generated flag
CREATE INDEX idx_qna_items_auto_generated 
ON qna_items ((source_metadata->>'auto_generated'));

-- Index for filtering by question type
CREATE INDEX idx_qna_items_question_type 
ON qna_items ((source_metadata->>'question_type'));
```

### 4. Useful Queries

#### Get all document-based collections
```sql
SELECT 
  id,
  name,
  description,
  source_document->>'original_name' as original_filename,
  source_document->>'file_type' as file_type,
  (source_document->>'size')::bigint as file_size_bytes,
  created_at
FROM qna_collections 
WHERE source_document IS NOT NULL
ORDER BY created_at DESC;
```

#### Get collection analytics
```sql
SELECT 
  c.id,
  c.name,
  COUNT(i.id) as total_questions,
  COUNT(CASE WHEN i.source_metadata->>'auto_generated' = 'true' THEN 1 END) as auto_generated_count,
  COUNT(CASE WHEN i.source_metadata->>'auto_generated' != 'true' OR i.source_metadata IS NULL THEN 1 END) as manual_count,
  AVG((i.source_metadata->>'confidence')::float) as avg_confidence,
  COUNT(CASE WHEN i.source_metadata->>'question_type' = 'factual' THEN 1 END) as factual_count,
  COUNT(CASE WHEN i.source_metadata->>'question_type' = 'conceptual' THEN 1 END) as conceptual_count,
  COUNT(CASE WHEN i.source_metadata->>'question_type' = 'application' THEN 1 END) as application_count,
  COUNT(CASE WHEN i.source_metadata->>'question_type' = 'analytical' THEN 1 END) as analytical_count
FROM qna_collections c
LEFT JOIN qna_items i ON c.id = i.collection_id
WHERE c.id = $1
GROUP BY c.id, c.name;
```

#### Get high-quality questions
```sql
SELECT 
  id,
  question,
  answer,
  source_metadata->>'question_type' as question_type,
  (source_metadata->>'confidence')::float as confidence
FROM qna_items 
WHERE collection_id = $1
  AND (source_metadata->>'confidence')::float > 0.8
ORDER BY (source_metadata->>'confidence')::float DESC;
```

#### Get questions by type
```sql
SELECT 
  source_metadata->>'question_type' as question_type,
  COUNT(*) as count,
  AVG((source_metadata->>'confidence')::float) as avg_confidence
FROM qna_items 
WHERE collection_id = $1
  AND source_metadata->>'question_type' IS NOT NULL
GROUP BY source_metadata->>'question_type'
ORDER BY count DESC;
```

## Migration Script

Run this complete migration script in your Supabase SQL editor:

```sql
-- Migration: Add document-based QnA collection support
-- Date: 2024-01-XX
-- Description: Adds support for collections created from uploaded documents

BEGIN;

-- Add source_document column to qna_collections
ALTER TABLE qna_collections 
ADD COLUMN IF NOT EXISTS source_document JSONB DEFAULT NULL;

-- Add source_metadata column to qna_items
ALTER TABLE qna_items 
ADD COLUMN IF NOT EXISTS source_metadata JSONB DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN qna_collections.source_document IS 'Metadata for collections created from uploaded documents';
COMMENT ON COLUMN qna_items.source_metadata IS 'Metadata for Q&A items generated from documents';

-- Create performance indexes
CREATE INDEX IF NOT EXISTS idx_qna_collections_source_document 
ON qna_collections USING GIN (source_document);

CREATE INDEX IF NOT EXISTS idx_qna_items_source_metadata 
ON qna_items USING GIN (source_metadata);

CREATE INDEX IF NOT EXISTS idx_qna_items_auto_generated 
ON qna_items ((source_metadata->>'auto_generated'))
WHERE source_metadata IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_qna_items_question_type 
ON qna_items ((source_metadata->>'question_type'))
WHERE source_metadata IS NOT NULL;

COMMIT;
```

## Rollback Script

If you need to rollback these changes:

```sql
-- Rollback script for document-based QnA collection support
BEGIN;

-- Drop indexes
DROP INDEX IF EXISTS idx_qna_items_question_type;
DROP INDEX IF EXISTS idx_qna_items_auto_generated;
DROP INDEX IF EXISTS idx_qna_items_source_metadata;
DROP INDEX IF EXISTS idx_qna_collections_source_document;

-- Remove columns
ALTER TABLE qna_items DROP COLUMN IF EXISTS source_metadata;
ALTER TABLE qna_collections DROP COLUMN IF EXISTS source_document;

COMMIT;
```

## Testing the Schema

After applying the migration, test with these queries:

```sql
-- Test inserting a document-based collection
INSERT INTO qna_collections (id, user_id, name, description, source_document)
VALUES (
  gen_random_uuid(),
  'your-user-id',
  'Test Document Collection',
  'Generated from test.pdf',
  '{"original_name": "test.pdf", "file_type": "pdf", "size": 1024, "processing_time": 30000, "segmentation_strategy": "semantic", "auto_generated": true}'::jsonb
);

-- Test inserting auto-generated Q&A items
INSERT INTO qna_items (id, collection_id, question, answer, tags, embedding, source_metadata)
VALUES (
  gen_random_uuid(),
  'your-collection-id',
  'What is the main topic?',
  'The main topic is...',
  ARRAY['topic', 'main'],
  '[0.1, 0.2, 0.3]'::vector, -- Replace with actual embedding
  '{"segment_id": "seg_001", "question_type": "factual", "confidence": 0.85, "auto_generated": true, "quality_scores": {"relevance": 0.9, "clarity": 0.8, "completeness": 0.85, "uniqueness": 0.7}}'::jsonb
);

-- Verify the data
SELECT * FROM qna_collections WHERE source_document IS NOT NULL;
SELECT * FROM qna_items WHERE source_metadata IS NOT NULL;
```

## Notes

1. **Backward Compatibility**: These changes are fully backward compatible. Existing collections and items will continue to work normally.

2. **NULL Values**: Collections and items created manually (not from documents) will have NULL values in the new columns.

3. **Performance**: The GIN indexes will provide efficient querying for JSON fields, but may slightly impact insert performance.

4. **Storage**: JSON columns are stored efficiently in PostgreSQL and don't significantly impact storage size.

5. **Future Extensions**: The JSON structure allows for easy addition of new metadata fields without schema changes.

Run this migration when you're ready to deploy the document processing feature to production.