import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"
import { DocumentSegment, GeneratedQA, QuestionType, QualityScore } from "./DocumentParsingService"

export interface QAGenerationOptions {
  questionsPerSegment: number
  questionTypes: QuestionType[]
  minQualityScore: number
  includeMetadata: boolean
  language: 'ja' | 'en' | 'auto'
}

export interface QAGenerationResult {
  qaPairs: GeneratedQA[]
  totalGenerated: number
  averageQuality: number
  processingTime: number
  metadata: {
    segmentsProcessed: number
    questionsFiltered: number
    qualityDistribution: Record<QuestionType, number>
  }
}

export class QAGenerationService {
  private model: GenerativeModel

  constructor(apiKey: string) {
    const genAI = new GoogleGenerativeAI(apiKey)
    this.model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })
  }

  public async generateQAsFromSegments(
    segments: DocumentSegment[],
    options: QAGenerationOptions
  ): Promise<QAGenerationResult> {
    const startTime = Date.now()
    const allQAs: GeneratedQA[] = []
    let totalGenerated = 0
    let questionsFiltered = 0
    const qualityDistribution: Record<QuestionType, number> = {
      factual: 0,
      conceptual: 0,
      application: 0,
      analytical: 0
    }

    for (const segment of segments) {
      try {
        const qas = await this.generateQAsForSegment(segment, options)
        totalGenerated += qas.length

        // Filter by quality score
        const filteredQAs = await this.filterByQuality(qas, options.minQualityScore)
        questionsFiltered += qas.length - filteredQAs.length

        // Update quality distribution
        filteredQAs.forEach(qa => {
          qualityDistribution[qa.questionType]++
        })

        allQAs.push(...filteredQAs)
      } catch (error) {
        console.error(`Error generating Q&As for segment ${segment.id}:`, error)
        continue
      }
    }

    const averageQuality = allQAs.length > 0 
      ? allQAs.reduce((sum, qa) => sum + qa.confidence, 0) / allQAs.length 
      : 0

    return {
      qaPairs: allQAs,
      totalGenerated,
      averageQuality,
      processingTime: Date.now() - startTime,
      metadata: {
        segmentsProcessed: segments.length,
        questionsFiltered,
        qualityDistribution
      }
    }
  }

  private async generateQAsForSegment(
    segment: DocumentSegment,
    options: QAGenerationOptions
  ): Promise<GeneratedQA[]> {
    const questionTypesStr = options.questionTypes.join(', ')
    const language = options.language === 'auto' ? this.detectLanguage(segment.content) : options.language

    const prompt = this.buildGenerationPrompt(segment, options, questionTypesStr, language)

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const parsed = JSON.parse(this.cleanJsonResponse(response.text()))

      const qaPairs: GeneratedQA[] = []
      
      for (const qa of parsed.questions) {
        const qualityScore = await this.evaluateQAQuality(qa, segment.content)
        
        qaPairs.push({
          question: qa.question,
          answer: qa.answer,
          questionType: qa.type as QuestionType,
          confidence: qualityScore.overall,
          tags: qa.tags || [],
          sourceSegmentId: segment.id
        })
      }

      return qaPairs
    } catch (error) {
      console.error('Error generating Q&As for segment:', error)
      return []
    }
  }

  private buildGenerationPrompt(
    segment: DocumentSegment,
    options: QAGenerationOptions,
    questionTypesStr: string,
    language: string
  ): string {
    const languageInstruction = language === 'ja' 
      ? 'Generate questions and answers in Japanese (日本語)'
      : 'Generate questions and answers in English'

    return `You are an expert at creating high-quality question-answer pairs for educational and interview preparation purposes.

${languageInstruction}

Create ${options.questionsPerSegment} diverse questions from this text segment, using these question types: ${questionTypesStr}

Question Types Explained:
- factual: Direct facts, dates, names, definitions (What, When, Where, Who)
- conceptual: Understanding of concepts, theories, relationships (Why, How does X relate to Y)
- application: How to apply knowledge, practical use cases (How would you use, What would happen if)
- analytical: Analysis, evaluation, comparison (Compare, Analyze, Evaluate)

Text Segment:
${segment.content}

Segment Context:
- Topics: ${segment.metadata.topics.join(', ')}
- Summary: ${segment.metadata.summary}

Return JSON format:
{
  "questions": [
    {
      "question": "question text",
      "answer": "detailed answer based on the segment",
      "type": "factual|conceptual|application|analytical",
      "tags": ["tag1", "tag2"],
      "reasoning": "why this question is valuable"
    }
  ]
}

Requirements:
- Questions must be answerable from the provided text segment
- Answers should be comprehensive but concise
- Include relevant tags for categorization
- Ensure questions are interview/study appropriate
- Vary difficulty levels appropriately`
  }

  public async evaluateQAQuality(qa: any, sourceText: string): Promise<QualityScore> {
    const prompt = `Evaluate the quality of this question-answer pair based on the source text.

Question: ${qa.question}
Answer: ${qa.answer}
Source Text: ${sourceText.substring(0, 1000)}...

Rate each aspect from 0.0 to 1.0:
{
  "relevance": "how relevant is the Q&A to the source text",
  "clarity": "how clear and well-written are the question and answer", 
  "completeness": "how complete is the answer",
  "uniqueness": "how unique/non-obvious is this question"
}

Return only the JSON object with numerical scores.`

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const scores = JSON.parse(this.cleanJsonResponse(response.text()))
      
      const overall = (scores.relevance + scores.clarity + scores.completeness + scores.uniqueness) / 4
      
      return {
        overall: Math.min(Math.max(overall, 0), 1),
        relevance: Math.min(Math.max(scores.relevance, 0), 1),
        clarity: Math.min(Math.max(scores.clarity, 0), 1),
        completeness: Math.min(Math.max(scores.completeness, 0), 1),
        uniqueness: Math.min(Math.max(scores.uniqueness, 0), 1)
      }
    } catch (error) {
      console.error('Error evaluating Q&A quality:', error)
      return {
        overall: 0.5,
        relevance: 0.5,
        clarity: 0.5,
        completeness: 0.5,
        uniqueness: 0.5
      }
    }
  }

  private async filterByQuality(qas: GeneratedQA[], minQualityScore: number): Promise<GeneratedQA[]> {
    return qas.filter(qa => qa.confidence >= minQualityScore)
  }

  public async optimizeQASet(qas: GeneratedQA[], maxItems: number): Promise<GeneratedQA[]> {
    if (qas.length <= maxItems) {
      return qas.sort((a, b) => b.confidence - a.confidence)
    }

    // Ensure diversity in question types
    const typeGroups: Record<QuestionType, GeneratedQA[]> = {
      factual: [],
      conceptual: [],
      application: [],
      analytical: []
    }

    qas.forEach(qa => {
      typeGroups[qa.questionType].push(qa)
    })

    // Sort each group by quality
    Object.keys(typeGroups).forEach(type => {
      typeGroups[type as QuestionType].sort((a, b) => b.confidence - a.confidence)
    })

    // Select balanced representation
    const itemsPerType = Math.floor(maxItems / 4)
    const remainder = maxItems % 4
    const result: GeneratedQA[] = []

    Object.entries(typeGroups).forEach(([type, items], index) => {
      const count = itemsPerType + (index < remainder ? 1 : 0)
      result.push(...items.slice(0, count))
    })

    // Fill remaining slots with highest quality items
    if (result.length < maxItems) {
      const remaining = qas
        .filter(qa => !result.includes(qa))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, maxItems - result.length)
      
      result.push(...remaining)
    }

    return result.sort((a, b) => b.confidence - a.confidence)
  }

  public async generateQuestionVariations(qa: GeneratedQA, count: number = 3): Promise<GeneratedQA[]> {
    const prompt = `Create ${count} variations of this question that test the same knowledge in different ways:

Original Question: ${qa.question}
Answer: ${qa.answer}
Question Type: ${qa.questionType}

Generate variations that:
- Test the same underlying knowledge
- Use different phrasing or approach
- Maintain the same question type
- Have the same answer

Return JSON:
{
  "variations": [
    {
      "question": "variation text",
      "answer": "same or adapted answer",
      "reasoning": "what makes this variation valuable"
    }
  ]
}`

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const parsed = JSON.parse(this.cleanJsonResponse(response.text()))

      return parsed.variations.map((variation: any) => ({
        question: variation.question,
        answer: variation.answer,
        questionType: qa.questionType,
        confidence: qa.confidence * 0.9, // Slightly lower confidence for variations
        tags: qa.tags,
        sourceSegmentId: qa.sourceSegmentId
      }))
    } catch (error) {
      console.error('Error generating question variations:', error)
      return []
    }
  }

  private detectLanguage(text: string): 'ja' | 'en' {
    // Simple heuristic - check for Japanese characters
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/
    return japaneseRegex.test(text) ? 'ja' : 'en'
  }

  private cleanJsonResponse(text: string): string {
    return text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '').trim()
  }

  public getDefaultOptions(): QAGenerationOptions {
    return {
      questionsPerSegment: 3,
      questionTypes: ['factual', 'conceptual', 'application'],
      minQualityScore: 0.6,
      includeMetadata: true,
      language: 'auto'
    }
  }

  public async generateCollectionSummary(qas: GeneratedQA[]): Promise<string> {
    if (qas.length === 0) return "Empty collection"

    const typeDistribution = qas.reduce((acc, qa) => {
      acc[qa.questionType] = (acc[qa.questionType] || 0) + 1
      return acc
    }, {} as Record<QuestionType, number>)

    const avgQuality = qas.reduce((sum, qa) => sum + qa.confidence, 0) / qas.length

    const prompt = `Create a brief summary for a Q&A collection with these characteristics:

Total Questions: ${qas.length}
Question Types Distribution:
${Object.entries(typeDistribution).map(([type, count]) => `- ${type}: ${count}`).join('\n')}

Average Quality Score: ${avgQuality.toFixed(2)}

Sample Questions:
${qas.slice(0, 3).map(qa => `- ${qa.question}`).join('\n')}

Generate a 2-3 sentence summary describing what this collection covers and its educational value.`

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      return response.text().trim()
    } catch (error) {
      console.error('Error generating collection summary:', error)
      return `Collection of ${qas.length} questions covering various topics with ${avgQuality.toFixed(1)} average quality score.`
    }
  }
}