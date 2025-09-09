import { DetectedQuestion, TranscriptionResult } from "../src/types/audio-stream";
import { v4 as uuidv4 } from "uuid";

export class QuestionDetector {
  // Japanese question detection pattern based on memory requirements
  private readonly questionPattern = /(？|か|ですか|でしょうか|ませんか|なぜ|どうやって|どこ|いつ)/;
  
  // Additional patterns for broader question detection
  private readonly englishQuestionPattern = /(\?|what|how|why|when|where|who|which|can|could|should|would|will|is|are|do|does|did)/i;
  
  constructor() {}

  /**
   * Analyzes transcribed text to detect if it contains questions
   * Can return multiple questions if the text contains multiple question patterns
   */
  public detectQuestion(transcription: TranscriptionResult): DetectedQuestion | null {
    const text = transcription.text.trim();
    
    if (!text || text.length < 3) {
      return null;
    }

    // Check for Japanese question patterns (primary)
    const hasJapaneseQuestion = this.questionPattern.test(text);
    
    // Check for English question patterns (secondary)
    const hasEnglishQuestion = this.englishQuestionPattern.test(text);
    
    if (hasJapaneseQuestion || hasEnglishQuestion) {
      // Split on common delimiters that separate multiple questions
      const questions = this.splitMultipleQuestions(text);
      
      if (questions.length > 1) {
        console.log(`[QuestionDetector] Detected multiple questions in one transcription: ${questions.join(' | ')}`);
      }
      
      // For now, return the combined text as one question
      // The refinement process will handle splitting and cleaning them up
      return {
        id: uuidv4(),
        text: text,
        timestamp: transcription.timestamp,
        confidence: transcription.confidence
      };
    }

    return null;
  }

  /**
   * Helper method to identify if text contains multiple questions
   */
  private splitMultipleQuestions(text: string): string[] {
    // Common delimiters for multiple questions in Japanese
    const delimiters = [
      '。', // Japanese period
      '？', // Japanese question mark
      '?',  // English question mark  
      'それから', // "and then"
      'あと', // "after that"
      'つぎに', // "next"
      '次に', // "next"
    ];
    
    // Simple split on common delimiters
    let parts = [text];
    for (const delimiter of delimiters) {
      const newParts: string[] = [];
      for (const part of parts) {
        newParts.push(...part.split(delimiter).map(p => p.trim()).filter(p => p.length > 0));
      }
      parts = newParts;
    }
    
    // Filter out parts that are too short to be meaningful questions
    return parts.filter(part => part.length >= 5);
  }

  /**
   * Batch processes multiple questions for potential duplicates and quality
   */
  public preprocessQuestions(questions: DetectedQuestion[]): DetectedQuestion[] {
    if (questions.length === 0) return [];

    // Remove very short questions (likely noise)
    const filtered = questions.filter(q => q.text.length >= 5);
    
    // Simple deduplication based on text similarity
    const deduplicated: DetectedQuestion[] = [];
    
    for (const question of filtered) {
      const isDuplicate = deduplicated.some(existing => 
        this.calculateSimilarity(question.text, existing.text) > 0.8
      );
      
      if (!isDuplicate) {
        deduplicated.push(question);
      }
    }

    return deduplicated;
  }

  /**
   * Simple text similarity calculation for deduplication
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const normalize = (str: string) => str.toLowerCase().replace(/\s+/g, ' ').trim();
    
    const a = normalize(text1);
    const b = normalize(text2);
    
    if (a === b) return 1.0;
    
    // Simple character-based similarity
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Validates if a question is worth processing
   */
  public isValidQuestion(question: DetectedQuestion): boolean {
    const text = question.text.trim();
    
    // Minimum length check
    if (text.length < 5) return false;
    
    // Check if it's not just noise or common phrases
    const noisePatterns = [
      /^(あ|え|お|う|ん)+$/,  // Just sound expressions
      /^(hello|hi|hey|test)$/i,  // Common non-questions
      /^\s*$/ // Empty or whitespace only
    ];
    
    return !noisePatterns.some(pattern => pattern.test(text));
  }
}