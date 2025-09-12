import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"
import * as fs from "fs"
import * as path from "path"

export interface ParsedDocument {
  id: string
  originalName: string
  mimeType: string
  size: number
  content: string
  extractedText: string
  metadata: DocumentMetadata
  segments: DocumentSegment[]
  processingTime: number
}

export interface DocumentMetadata {
  title?: string
  author?: string
  pages?: number
  wordCount: number
  language?: string
  extractedAt: string
  fileType: 'pdf' | 'image' | 'text'
}

export interface DocumentSegment {
  id: string
  content: string
  segmentType: SegmentationType
  order: number
  metadata: SegmentMetadata
  confidence: number
}

export interface SegmentMetadata {
  wordCount: number
  heading?: string
  level?: number
  topics: string[]
  summary: string
}

export type SegmentationType = 'semantic' | 'structural' | 'size_based'

export interface SegmentationOptions {
  strategy: SegmentationType | 'auto'
  maxChunkSize?: number
  minChunkSize?: number
  overlapSize?: number
  preserveStructure?: boolean
  targetQuestionCount?: number
}

export interface GeneratedQA {
  question: string
  answer: string
  questionType: QuestionType
  confidence: number
  tags: string[]
  sourceSegmentId: string
}

export type QuestionType = 'factual' | 'conceptual' | 'application' | 'analytical'

export interface QualityScore {
  overall: number
  relevance: number
  clarity: number
  completeness: number
  uniqueness: number
}

export class DocumentParsingService {
  private model: GenerativeModel
  private readonly MAX_FILE_SIZE = 15 * 1024 * 1024 // 15MB

  constructor(apiKey: string) {
    const genAI = new GoogleGenerativeAI(apiKey)
    this.model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })
  }

  public async parseDocument(filePath: string, options?: SegmentationOptions): Promise<ParsedDocument> {
    const startTime = Date.now()
    
    try {
      // Validate file size
      const stats = await fs.promises.stat(filePath)
      if (stats.size > this.MAX_FILE_SIZE) {
        throw new Error(`File size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size of 15MB`)
      }

      const fileName = path.basename(filePath)
      const mimeType = this.getMimeType(fileName)
      const fileBuffer = await fs.promises.readFile(filePath)

      // Extract text based on file type
      const extractedText = await this.extractText(fileBuffer, mimeType, fileName)
      
      // Generate metadata
      const metadata = await this.generateMetadata(extractedText, mimeType, stats.size)
      
      // Segment the document
      const segments = await this.segmentDocument(extractedText, options || { strategy: 'auto' })
      
      const processingTime = Date.now() - startTime

      return {
        id: this.generateId(),
        originalName: fileName,
        mimeType,
        size: stats.size,
        content: fileBuffer.toString('base64'),
        extractedText,
        metadata,
        segments,
        processingTime
      }
    } catch (error) {
      console.error('Error parsing document:', error)
      throw error
    }
  }

  public async parseFromBuffer(
    buffer: Buffer, 
    fileName: string, 
    mimeType: string,
    options?: SegmentationOptions
  ): Promise<ParsedDocument> {
    const startTime = Date.now()
    
    try {
      // Validate file size
      if (buffer.length > this.MAX_FILE_SIZE) {
        throw new Error(`File size (${(buffer.length / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size of 15MB`)
      }

      // Extract text based on file type
      const extractedText = await this.extractText(buffer, mimeType, fileName)
      
      // Generate metadata
      const metadata = await this.generateMetadata(extractedText, mimeType, buffer.length)
      
      // Segment the document
      const segments = await this.segmentDocument(extractedText, options || { strategy: 'auto' })
      
      const processingTime = Date.now() - startTime

      return {
        id: this.generateId(),
        originalName: fileName,
        mimeType,
        size: buffer.length,
        content: buffer.toString('base64'),
        extractedText,
        metadata,
        segments,
        processingTime
      }
    } catch (error) {
      console.error('Error parsing document from buffer:', error)
      throw error
    }
  }

  private async extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
    if (mimeType.startsWith('image/')) {
      return await this.extractTextFromImage(buffer, mimeType)
    } else if (mimeType === 'application/pdf') {
      return await this.extractTextFromPDF(buffer)
    } else if (mimeType.startsWith('text/')) {
      return buffer.toString('utf-8')
    } else {
      throw new Error(`Unsupported file type: ${mimeType}`)
    }
  }

  private async extractTextFromImage(buffer: Buffer, mimeType: string): Promise<string> {
    try {
      const imageData = {
        inlineData: {
          data: buffer.toString('base64'),
          mimeType
        }
      }

      const prompt = `Extract all text from this image. If the image contains Japanese text, preserve it exactly. 
      If the image contains tables, format them clearly. 
      If the image contains diagrams or charts, describe their content.
      Return only the extracted text content without any additional commentary.`

      const result = await this.model.generateContent([prompt, imageData])
      const response = await result.response
      return response.text().trim()
    } catch (error) {
      console.error('Error extracting text from image:', error)
      throw new Error('Failed to extract text from image')
    }
  }

  private async extractTextFromPDF(buffer: Buffer): Promise<string> {
    try {
      // For PDF processing, we'll use Gemini's vision capabilities
      // Convert PDF pages to images and process each page
      const pdfData = {
        inlineData: {
          data: buffer.toString('base64'),
          mimeType: 'application/pdf'
        }
      }

      const prompt = `Extract all text from this PDF document. Preserve the structure and formatting. 
      If there are tables, format them clearly. 
      If there are headers and sections, preserve the hierarchy.
      Return only the extracted text content.`

      const result = await this.model.generateContent([prompt, pdfData])
      const response = await result.response
      return response.text().trim()
    } catch (error) {
      console.error('Error extracting text from PDF:', error)
      throw new Error('Failed to extract text from PDF')
    }
  }

  public async segmentDocument(text: string, options: SegmentationOptions): Promise<DocumentSegment[]> {
    const strategy = options.strategy === 'auto' ? await this.chooseOptimalStrategy(text) : options.strategy
    
    switch (strategy) {
      case 'semantic':
        return await this.segmentBySemantic(text, options)
      case 'structural':
        return await this.segmentByStructural(text, options)
      case 'size_based':
        return await this.segmentBySize(text, options)
      default:
        return await this.segmentBySemantic(text, options)
    }
  }

  private async chooseOptimalStrategy(text: string): Promise<SegmentationType> {
    const prompt = `Analyze this text and determine the best segmentation strategy:

Text to analyze:
${text.substring(0, 2000)}...

Choose from:
1. "semantic" - if the text has clear topics and themes that should be grouped by meaning
2. "structural" - if the text has clear headings, sections, or hierarchical structure  
3. "size_based" - if the text is uniform without clear structure and should be split by size

Respond with only one word: semantic, structural, or size_based`

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const strategy = response.text().trim().toLowerCase()
      
      if (['semantic', 'structural', 'size_based'].includes(strategy)) {
        return strategy as SegmentationType
      }
      
      return 'semantic' // Default fallback
    } catch (error) {
      console.error('Error choosing segmentation strategy:', error)
      return 'semantic' // Default fallback
    }
  }

  private async segmentBySemantic(text: string, options: SegmentationOptions): Promise<DocumentSegment[]> {
    const prompt = `Segment this text into meaningful chunks based on topics and semantic content. 
    Each segment should contain related ideas and concepts.
    Target ${options.targetQuestionCount || 10} segments.
    
    Return JSON in this format:
    {
      "segments": [
        {
          "content": "segment text",
          "topics": ["topic1", "topic2"],
          "summary": "brief summary",
          "heading": "optional heading"
        }
      ]
    }

    Text to segment:
    ${text}`

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const parsed = JSON.parse(this.cleanJsonResponse(response.text()))
      
      return parsed.segments.map((seg: any, index: number) => ({
        id: this.generateId(),
        content: seg.content,
        segmentType: 'semantic' as SegmentationType,
        order: index,
        metadata: {
          wordCount: seg.content.split(' ').length,
          heading: seg.heading,
          topics: seg.topics || [],
          summary: seg.summary || ''
        },
        confidence: 0.8 // TODO: Implement confidence scoring
      }))
    } catch (error) {
      console.error('Error in semantic segmentation:', error)
      return this.segmentBySize(text, options) // Fallback
    }
  }

  private async segmentByStructural(text: string, options: SegmentationOptions): Promise<DocumentSegment[]> {
    const prompt = `Segment this text based on its structural elements like headings, sections, paragraphs.
    Preserve the document's natural structure and hierarchy.
    
    Return JSON in this format:
    {
      "segments": [
        {
          "content": "segment text",
          "heading": "section heading",
          "level": 1,
          "topics": ["topic1"],
          "summary": "brief summary"
        }
      ]
    }

    Text to segment:
    ${text}`

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const parsed = JSON.parse(this.cleanJsonResponse(response.text()))
      
      return parsed.segments.map((seg: any, index: number) => ({
        id: this.generateId(),
        content: seg.content,
        segmentType: 'structural' as SegmentationType,
        order: index,
        metadata: {
          wordCount: seg.content.split(' ').length,
          heading: seg.heading,
          level: seg.level,
          topics: seg.topics || [],
          summary: seg.summary || ''
        },
        confidence: 0.9 // Structural segmentation is usually more reliable
      }))
    } catch (error) {
      console.error('Error in structural segmentation:', error)
      return this.segmentBySize(text, options) // Fallback
    }
  }

  private async segmentBySize(text: string, options: SegmentationOptions): Promise<DocumentSegment[]> {
    const maxChunkSize = options.maxChunkSize || 1000
    const overlapSize = options.overlapSize || 100
    const words = text.split(' ')
    const segments: DocumentSegment[] = []
    
    for (let i = 0; i < words.length; i += maxChunkSize - overlapSize) {
      const chunk = words.slice(i, i + maxChunkSize).join(' ')
      
      // Generate summary for this chunk
      const summary = await this.generateChunkSummary(chunk)
      
      segments.push({
        id: this.generateId(),
        content: chunk,
        segmentType: 'size_based',
        order: segments.length,
        metadata: {
          wordCount: chunk.split(' ').length,
          topics: [], // TODO: Extract topics
          summary
        },
        confidence: 0.7
      })
    }
    
    return segments
  }

  private async generateChunkSummary(text: string): Promise<string> {
    const prompt = `Provide a brief 1-2 sentence summary of this text chunk:

${text.substring(0, 500)}...`

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      return response.text().trim()
    } catch (error) {
      console.error('Error generating chunk summary:', error)
      return 'Summary unavailable'
    }
  }

  private async generateMetadata(text: string, mimeType: string, size: number): Promise<DocumentMetadata> {
    const prompt = `Analyze this document text and extract metadata in JSON format:

{
  "title": "document title if identifiable",
  "author": "author if mentioned", 
  "language": "detected language (e.g., 'ja', 'en')",
  "wordCount": ${text.split(' ').length}
}

Text to analyze:
${text.substring(0, 1000)}...`

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const parsed = JSON.parse(this.cleanJsonResponse(response.text()))
      
      return {
        title: parsed.title,
        author: parsed.author,
        wordCount: text.split(' ').length,
        language: parsed.language,
        extractedAt: new Date().toISOString(),
        fileType: this.getFileType(mimeType)
      }
    } catch (error) {
      console.error('Error generating metadata:', error)
      return {
        wordCount: text.split(' ').length,
        extractedAt: new Date().toISOString(),
        fileType: this.getFileType(mimeType)
      }
    }
  }

  private getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase()
    switch (ext) {
      case '.pdf': return 'application/pdf'
      case '.png': return 'image/png'
      case '.jpg':
      case '.jpeg': return 'image/jpeg'
      case '.txt': return 'text/plain'
      case '.md': return 'text/markdown'
      default: return 'application/octet-stream'
    }
  }

  private getFileType(mimeType: string): 'pdf' | 'image' | 'text' {
    if (mimeType === 'application/pdf') return 'pdf'
    if (mimeType.startsWith('image/')) return 'image'
    return 'text'
  }

  private cleanJsonResponse(text: string): string {
    return text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '').trim()
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }
}