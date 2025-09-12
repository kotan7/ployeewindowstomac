import { SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { ParsedDocument, GeneratedQA } from './DocumentParsingService'
import { QAGenerationResult } from './QAGenerationService'

export interface QnACollection {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
  qna_count?: number
  // Document-based collection metadata
  source_document?: {
    original_name: string
    file_type: 'pdf' | 'image' | 'text'
    size: number
    processing_time: number
    segmentation_strategy: string
    auto_generated: boolean
  }
}

export interface QnAItem {
  id: string
  collection_id: string
  question: string
  answer: string
  tags: string[] | null
  created_at: string
  updated_at: string
  // Document-based item metadata
  source_metadata?: {
    segment_id: string
    question_type: 'factual' | 'conceptual' | 'application' | 'analytical'
    confidence: number
    auto_generated: boolean
    quality_scores?: {
      relevance: number
      clarity: number
      completeness: number
      uniqueness: number
    }
  }
}

export interface SearchResult {
  id: string
  question: string
  answer: string
  tags: string[]
  similarity: number
}

export class QnAService {
  private supabase: SupabaseClient
  private openai: OpenAI

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient
    
    // Initialize OpenAI client
    const openaiApiKey = process.env.OPENAI_API_KEY
    
    if (!openaiApiKey) {
      console.error('Missing OpenAI configuration. Please set OPENAI_API_KEY environment variable.')
      console.warn('QnA functionality will not work until proper OpenAI credentials are provided.')
    }
    
    this.openai = new OpenAI({
      apiKey: openaiApiKey || 'placeholder-key',
    })
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: text.replace(/\\n/g, ' '),
      })
      
      return response.data[0].embedding
    } catch (error) {
      console.error('Error generating embedding:', error)
      throw new Error('Failed to generate embedding')
    }
  }

  public async getUserCollections(userId: string): Promise<QnACollection[]> {
    try {
      const { data, error } = await this.supabase
        .from('qna_collections')
        .select(`
          *,
          qna_items(count)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) throw error

      const collectionsWithCount = data?.map(collection => ({
        ...collection,
        qna_count: collection.qna_items?.[0]?.count || 0
      })) || []

      return collectionsWithCount
    } catch (error) {
      console.error('Error fetching collections:', error)
      throw error
    }
  }

  public async getCollection(collectionId: string): Promise<QnACollection | null> {
    try {
      const { data, error } = await this.supabase
        .from('qna_collections')
        .select('*')
        .eq('id', collectionId)
        .single()

      if (error) throw error

      return data
    } catch (error) {
      console.error('Error fetching collection:', error)
      return null
    }
  }

  public async getCollectionItems(collectionId: string): Promise<QnAItem[]> {
    try {
      const { data, error } = await this.supabase
        .from('qna_items')
        .select('*')
        .eq('collection_id', collectionId)
        .order('created_at', { ascending: false })

      if (error) throw error

      return data || []
    } catch (error) {
      console.error('Error fetching collection items:', error)
      throw error
    }
  }

  public async searchQnAItems(
    query: string,
    collectionId: string,
    matchThreshold: number = 0.8,
    matchCount: number = 5
  ): Promise<SearchResult[]> {
    try {
      // Generate embedding for the search query
      const queryEmbedding = await this.generateEmbedding(query)
      
      // Use the Postgres function for vector similarity search
      const { data, error } = await this.supabase.rpc('search_qna_items', {
        query_embedding: queryEmbedding,
        collection_id_filter: collectionId,
        match_threshold: matchThreshold,
        match_count: matchCount
      })

      if (error) {
        console.error('Search error:', error)
        throw error
      }

      return data || []
    } catch (error) {
      console.error('Error searching QnA items:', error)
      throw error
    }
  }

  public async findRelevantAnswers(
    question: string,
    collectionId: string,
    threshold: number = 0.7
  ): Promise<{
    hasRelevantAnswers: boolean
    answers: SearchResult[]
    bestMatch?: SearchResult
  }> {
    try {
      const results = await this.searchQnAItems(question, collectionId, threshold, 3)
      
      const hasRelevantAnswers = results.length > 0
      const bestMatch = results.length > 0 ? results[0] : undefined
      
      return {
        hasRelevantAnswers,
        answers: results,
        bestMatch
      }
    } catch (error) {
      console.error('Error finding relevant answers:', error)
      return {
        hasRelevantAnswers: false,
        answers: []
      }
    }
  }

  public formatRAGContext(results: SearchResult[]): string {
    if (results.length === 0) return ''
    
    const context = results
      .map((result, index) => {
        return `Context ${index + 1} (similarity: ${result.similarity.toFixed(2)}):\nQ: ${result.question}\nA: ${result.answer}`
      })
      .join('\n\n---\n\n')
      
    return `Based on the following relevant information from your knowledge base:\n\n${context}\n\nPlease provide a comprehensive answer:`
  }

  public async createCollection(
    userId: string,
    name: string,
    description?: string,
    sourceDocument?: {
      original_name: string
      file_type: 'pdf' | 'image' | 'text'
      size: number
      processing_time: number
      segmentation_strategy: string
      auto_generated: boolean
    }
  ): Promise<QnACollection> {
    try {
      const insertData: any = {
        user_id: userId,
        name,
        description
      }

      if (sourceDocument) {
        insertData.source_document = sourceDocument
      }

      const { data, error } = await this.supabase
        .from('qna_collections')
        .insert(insertData)
        .select()
        .single()

      if (error) throw error

      return data
    } catch (error) {
      console.error('Error creating collection:', error)
      throw error
    }
  }

  public async addQnAItem(
    collectionId: string,
    question: string,
    answer: string,
    tags?: string[]
  ): Promise<QnAItem> {
    try {
      // Generate embedding for the question
      const embedding = await this.generateEmbedding(question)

      const { data, error } = await this.supabase
        .from('qna_items')
        .insert({
          collection_id: collectionId,
          question,
          answer,
          tags,
          embedding
        })
        .select()
        .single()

      if (error) throw error

      return data
    } catch (error) {
      console.error('Error adding QnA item:', error)
      throw error
    }
  }

  public async updateQnAItem(
    itemId: string,
    updates: {
      question?: string
      answer?: string
      tags?: string[]
    }
  ): Promise<QnAItem> {
    try {
      let updateData: any = { ...updates }

      // If question is being updated, regenerate embedding
      if (updates.question) {
        updateData.embedding = await this.generateEmbedding(updates.question)
      }

      const { data, error } = await this.supabase
        .from('qna_items')
        .update(updateData)
        .eq('id', itemId)
        .select()
        .single()

      if (error) throw error

      return data
    } catch (error) {
      console.error('Error updating QnA item:', error)
      throw error
    }
  }

  public async deleteQnAItem(itemId: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('qna_items')
        .delete()
        .eq('id', itemId)

      if (error) throw error

      return true
    } catch (error) {
      console.error('Error deleting QnA item:', error)
      return false
    }
  }

  public async deleteCollection(collectionId: string): Promise<boolean> {
    try {
      // First delete all items in the collection
      await this.supabase
        .from('qna_items')
        .delete()
        .eq('collection_id', collectionId)

      // Then delete the collection
      const { error } = await this.supabase
        .from('qna_collections')
        .delete()
        .eq('id', collectionId)

      if (error) throw error

      return true
    } catch (error) {
      console.error('Error deleting collection:', error)
      return false
    }
  }

  // === DOCUMENT-BASED COLLECTION METHODS ===

  public async createCollectionFromDocument(
    userId: string,
    document: ParsedDocument,
    qaResult: QAGenerationResult,
    collectionName?: string,
    description?: string
  ): Promise<QnACollection> {
    try {
      const collection = await this.createCollection(
        userId,
        collectionName || `Document: ${document.originalName}`,
        description || `Auto-generated from ${document.originalName} - ${qaResult.qaPairs.length} questions`,
        {
          original_name: document.originalName,
          file_type: document.metadata.fileType,
          size: document.size,
          processing_time: document.processingTime,
          segmentation_strategy: document.segments[0]?.segmentType || 'unknown',
          auto_generated: true
        }
      )

      // Add all Q&A items in bulk
      await this.bulkAddQnAItems(collection.id, qaResult.qaPairs)

      return collection
    } catch (error) {
      console.error('Error creating collection from document:', error)
      throw error
    }
  }

  public async bulkAddQnAItems(
    collectionId: string,
    qaPairs: GeneratedQA[]
  ): Promise<QnAItem[]> {
    try {
      const items = []
      
      // Process in batches to avoid overwhelming the database
      const batchSize = 10
      for (let i = 0; i < qaPairs.length; i += batchSize) {
        const batch = qaPairs.slice(i, i + batchSize)
        const batchItems = await Promise.all(
          batch.map(qa => this.addQnAItemFromGenerated(collectionId, qa))
        )
        items.push(...batchItems)
      }

      return items
    } catch (error) {
      console.error('Error bulk adding Q&A items:', error)
      throw error
    }
  }

  private async addQnAItemFromGenerated(
    collectionId: string,
    qa: GeneratedQA
  ): Promise<QnAItem> {
    try {
      // Generate embedding for the question
      const embedding = await this.generateEmbedding(qa.question)

      const { data, error } = await this.supabase
        .from('qna_items')
        .insert({
          collection_id: collectionId,
          question: qa.question,
          answer: qa.answer,
          tags: qa.tags,
          embedding,
          source_metadata: {
            segment_id: qa.sourceSegmentId,
            question_type: qa.questionType,
            confidence: qa.confidence,
            auto_generated: true
          }
        })
        .select()
        .single()

      if (error) throw error

      return data
    } catch (error) {
      console.error('Error adding Q&A item from generated:', error)
      throw error
    }
  }

  public async getDocumentBasedCollections(userId: string): Promise<QnACollection[]> {
    try {
      const { data, error } = await this.supabase
        .from('qna_collections')
        .select(`
          *,
          qna_items(count)
        `)
        .eq('user_id', userId)
        .not('source_document', 'is', null)
        .order('created_at', { ascending: false })

      if (error) throw error

      const collectionsWithCount = data?.map(collection => ({
        ...collection,
        qna_count: collection.qna_items?.[0]?.count || 0
      })) || []

      return collectionsWithCount
    } catch (error) {
      console.error('Error fetching document-based collections:', error)
      throw error
    }
  }

  public async getCollectionAnalytics(collectionId: string): Promise<{
    totalQuestions: number
    questionTypeDistribution: Record<string, number>
    averageQuality: number
    autoGeneratedCount: number
    manualCount: number
  }> {
    try {
      const items = await this.getCollectionItems(collectionId)
      
      const analytics = {
        totalQuestions: items.length,
        questionTypeDistribution: {} as Record<string, number>,
        averageQuality: 0,
        autoGeneratedCount: 0,
        manualCount: 0
      }

      let totalQuality = 0
      let qualityCount = 0

      items.forEach(item => {
        // Count by generation method
        if (item.source_metadata?.auto_generated) {
          analytics.autoGeneratedCount++
        } else {
          analytics.manualCount++
        }

        // Distribution by question type
        const questionType = item.source_metadata?.question_type || 'manual'
        analytics.questionTypeDistribution[questionType] = 
          (analytics.questionTypeDistribution[questionType] || 0) + 1

        // Quality scoring
        if (item.source_metadata?.confidence) {
          totalQuality += item.source_metadata.confidence
          qualityCount++
        }
      })

      analytics.averageQuality = qualityCount > 0 ? totalQuality / qualityCount : 0

      return analytics
    } catch (error) {
      console.error('Error getting collection analytics:', error)
      throw error
    }
  }

  public async regenerateQuestionsForCollection(
    collectionId: string,
    segmentIds: string[],
    questionTypes: string[]
  ): Promise<number> {
    try {
      // Remove existing auto-generated questions for the specified segments
      const { error: deleteError } = await this.supabase
        .from('qna_items')
        .delete()
        .eq('collection_id', collectionId)
        .in('source_metadata->segment_id', segmentIds)
        .eq('source_metadata->auto_generated', true)

      if (deleteError) throw deleteError

      // This method would be called after regenerating Q&As
      // The actual regeneration would happen in the document processing service
      return segmentIds.length
    } catch (error) {
      console.error('Error regenerating questions:', error)
      throw error
    }
  }
}