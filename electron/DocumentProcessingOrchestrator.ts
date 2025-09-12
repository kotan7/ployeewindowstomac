import { DocumentParsingService, ParsedDocument, SegmentationOptions } from './DocumentParsingService'
import { QAGenerationService, QAGenerationOptions, QAGenerationResult } from './QAGenerationService'
import { QnAService, QnACollection } from './QnAService'

export interface DocumentProcessingOptions {
  segmentation: SegmentationOptions
  qaGeneration: QAGenerationOptions
  collection: {
    name?: string
    description?: string
    autoApprove: boolean
    maxQuestions?: number
  }
}

export interface ProcessingStatus {
  stage: 'parsing' | 'segmenting' | 'generating' | 'evaluating' | 'saving' | 'complete' | 'error'
  progress: number
  message: string
  details?: any
}

export interface DocumentProcessingResult {
  success: boolean
  collection?: QnACollection
  document: ParsedDocument
  qaResult: QAGenerationResult
  processingTime: number
  error?: string
  review?: {
    needsReview: boolean
    suggestedEdits: Array<{
      itemId: string
      suggestion: string
      reason: string
    }>
  }
}

export class DocumentProcessingOrchestrator {
  private documentParser: DocumentParsingService
  private qaGenerator: QAGenerationService
  private qnaService: QnAService | null = null
  private statusCallback?: (status: ProcessingStatus) => void

  constructor(apiKey: string, qnaService?: QnAService) {
    this.documentParser = new DocumentParsingService(apiKey)
    this.qaGenerator = new QAGenerationService(apiKey)
    this.qnaService = qnaService || null
  }

  public setQnAService(qnaService: QnAService) {
    this.qnaService = qnaService
  }

  public setStatusCallback(callback: (status: ProcessingStatus) => void) {
    this.statusCallback = callback
  }

  public async processDocumentFromFile(
    filePath: string,
    userId: string,
    options: DocumentProcessingOptions
  ): Promise<DocumentProcessingResult> {
    const startTime = Date.now()

    try {
      this.updateStatus('parsing', 10, 'Parsing document and extracting text...')
      
      const document = await this.documentParser.parseDocument(filePath, options.segmentation)
      
      return await this.completeProcessing(document, userId, options, startTime)
    } catch (error) {
      console.error('Error processing document from file:', error)
      this.updateStatus('error', 0, `Error: ${(error as any).message}`)
      
      return {
        success: false,
        document: null as any,
        qaResult: null as any,
        processingTime: Date.now() - startTime,
        error: (error as any).message
      }
    }
  }

  public async processDocumentFromBuffer(
    buffer: Uint8Array | ArrayBuffer,
    fileName: string,
    mimeType: string,
    userId: string,
    options: DocumentProcessingOptions
  ): Promise<DocumentProcessingResult> {
    const startTime = Date.now()

    try {
      this.updateStatus('parsing', 10, 'Parsing document and extracting text...')
      
      const document = await this.documentParser.parseFromBuffer(
        buffer, 
        fileName, 
        mimeType, 
        options.segmentation
      )
      
      return await this.completeProcessing(document, userId, options, startTime)
    } catch (error) {
      console.error('Error processing document from buffer:', error)
      this.updateStatus('error', 0, `Error: ${(error as any).message}`)
      
      return {
        success: false,
        document: null as any,
        qaResult: null as any,
        processingTime: Date.now() - startTime,
        error: (error as any).message
      }
    }
  }

  private async completeProcessing(
    document: ParsedDocument,
    userId: string,
    options: DocumentProcessingOptions,
    startTime: number
  ): Promise<DocumentProcessingResult> {
    try {
      this.updateStatus('generating', 40, 'Generating questions and answers...', {
        segments: document.segments.length,
        strategy: document.segments[0]?.segmentType
      })
      
      const qaResult = await this.qaGenerator.generateQAsFromSegments(
        document.segments,
        options.qaGeneration
      )

      this.updateStatus('evaluating', 70, 'Evaluating and optimizing questions...')
      
      // Optimize the Q&A set if maxQuestions is specified
      if (options.collection.maxQuestions && qaResult.qaPairs.length > options.collection.maxQuestions) {
        qaResult.qaPairs = await this.qaGenerator.optimizeQASet(
          qaResult.qaPairs,
          options.collection.maxQuestions
        )
      }

      let collection: QnACollection | undefined
      let needsReview = !options.collection.autoApprove

      if (options.collection.autoApprove && this.qnaService) {
        this.updateStatus('saving', 90, 'Creating collection and saving questions...')
        
        collection = await this.qnaService.createCollectionFromDocument(
          userId,
          document,
          qaResult,
          options.collection.name,
          options.collection.description
        )
      }

      // Generate review suggestions if needed
      const review = needsReview ? await this.generateReviewSuggestions(qaResult) : undefined

      this.updateStatus('complete', 100, 'Document processing complete!')

      return {
        success: true,
        collection,
        document,
        qaResult,
        processingTime: Date.now() - startTime,
        review
      }
    } catch (error) {
      console.error('Error in document processing:', error)
      this.updateStatus('error', 0, `Error: ${(error as any).message}`)
      
      return {
        success: false,
        document,
        qaResult: null as any,
        processingTime: Date.now() - startTime,
        error: (error as any).message
      }
    }
  }

  private async generateReviewSuggestions(qaResult: QAGenerationResult): Promise<{
    needsReview: boolean
    suggestedEdits: Array<{
      itemId: string
      suggestion: string
      reason: string
    }>
  }> {
    const suggestedEdits = []
    
    // Check for low-quality questions
    const lowQualityThreshold = 0.6
    const lowQualityItems = qaResult.qaPairs.filter(qa => qa.confidence < lowQualityThreshold)
    
    for (const item of lowQualityItems) {
      suggestedEdits.push({
        itemId: item.sourceSegmentId,
        suggestion: 'Consider revising this question for better clarity and relevance',
        reason: `Quality score (${item.confidence.toFixed(2)}) is below recommended threshold`
      })
    }

    // Check for duplicate or very similar questions
    const duplicates = this.findSimilarQuestions(qaResult.qaPairs)
    for (const duplicate of duplicates) {
      suggestedEdits.push({
        itemId: duplicate.id,
        suggestion: 'This question appears similar to others. Consider merging or differentiating.',
        reason: 'Potential duplicate content detected'
      })
    }

    return {
      needsReview: suggestedEdits.length > 0 || qaResult.averageQuality < 0.7,
      suggestedEdits
    }
  }

  private findSimilarQuestions(qaPairs: any[]): Array<{ id: string }> {
    // Simple similarity detection based on question length and first few words
    const similar = []
    
    for (let i = 0; i < qaPairs.length; i++) {
      for (let j = i + 1; j < qaPairs.length; j++) {
        const q1 = qaPairs[i].question.toLowerCase()
        const q2 = qaPairs[j].question.toLowerCase()
        
        // Simple heuristic: similar if they start with same words and similar length
        const words1 = q1.split(' ').slice(0, 3).join(' ')
        const words2 = q2.split(' ').slice(0, 3).join(' ')
        const lengthDiff = Math.abs(q1.length - q2.length) / Math.max(q1.length, q2.length)
        
        if (words1 === words2 && lengthDiff < 0.3) {
          similar.push({ id: qaPairs[j].sourceSegmentId })
        }
      }
    }
    
    return similar
  }

  private updateStatus(stage: ProcessingStatus['stage'], progress: number, message: string, details?: any) {
    if (this.statusCallback) {
      this.statusCallback({
        stage,
        progress,
        message,
        details
      })
    }
  }

  public getDefaultOptions(): DocumentProcessingOptions {
    return {
      segmentation: {
        strategy: 'auto',
        targetQuestionCount: 15
      },
      qaGeneration: this.qaGenerator.getDefaultOptions(),
      collection: {
        autoApprove: false,
        maxQuestions: 20
      }
    }
  }

  public async validateFile(buffer: Uint8Array | ArrayBuffer, fileName: string): Promise<{
    valid: boolean
    error?: string
    mimeType?: string
    estimatedProcessingTime?: number
  }> {
    try {
      // Check file size
      const maxSize = 15 * 1024 * 1024 // 15MB
      const bufferLength = buffer instanceof ArrayBuffer ? buffer.byteLength : buffer.length
      if (bufferLength > maxSize) {
        return {
          valid: false,
          error: `File size (${(bufferLength / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size of 15MB`
        }
      }

      // Check file type
      const ext = fileName.toLowerCase().split('.').pop()
      const supportedTypes = ['pdf', 'png', 'jpg', 'jpeg']
      
      if (!ext || !supportedTypes.includes(ext)) {
        return {
          valid: false,
          error: `Unsupported file type. Supported formats: ${supportedTypes.join(', ')}`
        }
      }

      const mimeTypeMap: Record<string, string> = {
        'pdf': 'application/pdf',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg'
      }

      const mimeType = mimeTypeMap[ext]
      
      // Estimate processing time based on file size and type
      let estimatedTime = 30000 // Base 30 seconds
      if (ext === 'pdf') {
        estimatedTime += (bufferLength / 1024 / 1024) * 10000 // +10s per MB for PDF
      } else {
        estimatedTime += (bufferLength / 1024 / 1024) * 5000 // +5s per MB for images
      }

      return {
        valid: true,
        mimeType,
        estimatedProcessingTime: estimatedTime
      }
    } catch (error) {
      return {
        valid: false,
        error: `File validation error: ${(error as any).message}`
      }
    }
  }
}