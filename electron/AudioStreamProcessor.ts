import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { QuestionDetector } from "./QuestionDetector";
import { LLMHelper } from "./LLMHelper";
import {
  AudioChunk,
  AudioStreamState,
  AudioStreamConfig,
  AudioStreamEvents,
  TranscriptionResult,
  DetectedQuestion,
  QuestionBatch
} from "../src/types/audio-stream";

export class AudioStreamProcessor extends EventEmitter {
  private state: AudioStreamState;
  private config: AudioStreamConfig;
  private questionDetector: QuestionDetector;
  private openai: OpenAI;
  private llmHelper: LLMHelper | null = null;
  
  // Batch processing
  private batchTimeout: NodeJS.Timeout | null = null;
  private lastBatchTime: number = 0;
  
  // Audio processing
  private currentAudioData: Float32Array[] = [];
  private lastSilenceTime: number = 0;
  private wordCount: number = 0;
  private tempBuffer: Float32Array | null = null;

  constructor(openaiApiKey: string, config?: Partial<AudioStreamConfig>) {
    super();
    
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.questionDetector = new QuestionDetector();
    
    // Default configuration
    this.config = {
      sampleRate: 16000,
      chunkDuration: 1000, // 1 second chunks for processing
      silenceThreshold: 800, // 800ms silence threshold from memory
      maxWords: 40, // 40 words max per chunk from memory
      questionDetectionEnabled: true,
      batchInterval: 30000, // 30 seconds batch processing
      maxBatchSize: 5,
      ...config
    };

    this.state = {
      isListening: false,
      isProcessing: false,
      lastActivityTime: 0,
      questionBuffer: [],
      batchProcessor: {
        lastBatchTime: 0,
        isProcessing: false,
        pendingQuestions: []
      }
    };

    this.setupBatchProcessor();
  }

  /**
   * Set LLMHelper for question refinement
   */
  public setLLMHelper(llmHelper: LLMHelper): void {
    this.llmHelper = llmHelper;
  }

  /**
   * Start always-on audio listening
   */
  public async startListening(): Promise<void> {
    if (this.state.isListening) {
      console.log('[AudioStreamProcessor] Already listening');
      return;
    }

    try {
      this.state.isListening = true;
      this.state.lastActivityTime = Date.now();
      this.emit('state-changed', { ...this.state });
      
      console.log('[AudioStreamProcessor] Started listening for audio');
      
      // Note: Actual audio capture will be handled by the renderer process
      // This service processes the audio chunks received via IPC
      
    } catch (error) {
      this.state.isListening = false;
      console.error('[AudioStreamProcessor] Failed to start listening:', error);
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Stop audio listening
   */
  public async stopListening(): Promise<void> {
    if (!this.state.isListening) {
      console.log('[AudioStreamProcessor] Not currently listening');
      return;
    }

    try {
      this.state.isListening = false;
      this.state.isProcessing = false;
      
      // Clear any pending audio data
      this.currentAudioData = [];
      this.wordCount = 0;
      
      // Process any remaining questions in batch
      if (this.state.batchProcessor.pendingQuestions.length > 0) {
        await this.processBatch();
      }
      
      this.emit('state-changed', { ...this.state });
      console.log('[AudioStreamProcessor] Stopped listening');
      
    } catch (error) {
      console.error('[AudioStreamProcessor] Error stopping listening:', error);
      this.emit('error', error as Error);
    }
  }

  /**
   * Process audio data chunk received from renderer
   */
  public async processAudioChunk(audioData: Float32Array): Promise<void> {
    if (!this.state.isListening) return;

    try {
      // Add to current audio accumulation
      this.currentAudioData.push(audioData);
      this.state.lastActivityTime = Date.now();
      
      // Check if we should create a chunk based on duration or word count
      const shouldCreateChunk = await this.shouldCreateChunk();
      
      if (shouldCreateChunk) {
        await this.createAndProcessChunk();
      }
      
    } catch (error) {
      console.error('[AudioStreamProcessor] Error processing audio chunk:', error);
      this.emit('error', error as Error);
      this.state.isListening = false;
      this.emit('state-changed', { ...this.state });
    }
  }

  /**
   * Determine if we should create a new chunk
   */
  private async shouldCreateChunk(): Promise<boolean> {
    const now = Date.now();
    const silenceDuration = now - this.state.lastActivityTime;
    
    // Create chunk if silence exceeds threshold OR word count exceeds limit
    return silenceDuration > this.config.silenceThreshold || this.wordCount >= this.config.maxWords;
  }

  /**
   * Create chunk from accumulated audio data and process it
   */
  private async createAndProcessChunk(): Promise<void> {
    if (this.currentAudioData.length === 0) return;

    try {
      // Combine all Float32Arrays
      const totalLength = this.currentAudioData.reduce((acc, arr) => acc + arr.length, 0);
      const combinedArray = new Float32Array(totalLength);
      let offset = 0;
      
      for (const array of this.currentAudioData) {
        combinedArray.set(array, offset);
        offset += array.length;
      }
      
      // Convert to 16-bit PCM Buffer for Whisper API
      const pcmBuffer = Buffer.alloc(combinedArray.length * 2);
      for (let i = 0; i < combinedArray.length; i++) {
        const sample = Math.max(-1, Math.min(1, combinedArray[i]));
        const value = Math.floor(sample < 0 ? sample * 32768 : sample * 32767);
        pcmBuffer.writeInt16LE(value, i * 2);
      }
      
      const chunk: AudioChunk = {
        id: uuidv4(),
        data: combinedArray,
        timestamp: Date.now(),
        duration: this.calculateDuration(pcmBuffer),
        wordCount: this.wordCount
      };

      // Reset accumulation
      this.currentAudioData = [];
      this.wordCount = 0;
      
      this.emit('chunk-recorded', chunk);
      
      // Process chunk for transcription
      await this.transcribeChunk(chunk);
      
    } catch (error) {
      console.error('[AudioStreamProcessor] Error creating chunk:', error);
      this.emit('error', error as Error);
      this.state.isListening = false;
      this.emit('state-changed', { ...this.state });
    }
  }

  /**
   * Transcribe audio chunk using OpenAI Whisper
   */
  private async transcribeChunk(chunk: AudioChunk): Promise<void> {
    if (!this.config.questionDetectionEnabled) return;

    try {
      this.state.isProcessing = true;
      this.emit('state-changed', { ...this.state });

      // Convert buffer to temporary file for Whisper API
      const pcmBuffer = Buffer.alloc(chunk.data.length * 2);
      for (let i = 0; i < chunk.data.length; i++) {
        const sample = Math.max(-1, Math.min(1, chunk.data[i]));
        const value = Math.floor(sample < 0 ? sample * 32768 : sample * 32767);
        pcmBuffer.writeInt16LE(value, i * 2);
      }
      const tempFilePath = await this.createTempAudioFile(pcmBuffer);
      
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: "whisper-1",
        language: "ja", // Japanese language preference from memory
        response_format: "json",
        temperature: 0.2
      });

      // Clean up temp file
      await this.cleanupTempFile(tempFilePath);

      const result: TranscriptionResult = {
        id: uuidv4(),
        text: transcription.text || "",
        timestamp: chunk.timestamp,
        confidence: 1.0, // Whisper doesn't provide confidence scores
        isQuestion: false, // Will be determined by question detector
        originalChunkId: chunk.id
      };

      this.emit('transcription-completed', result);

      // Detect questions in transcription
      if (result.text.trim()) {
        await this.detectQuestions(result);
      }

    } catch (error) {
      console.error('[AudioStreamProcessor] Transcription error:', error);
      this.emit('error', error as Error);
    } finally {
      this.state.isProcessing = false;
      this.emit('state-changed', { ...this.state });
    }
  }

  /**
   * Detect questions in transcription
   */
  private async detectQuestions(transcription: TranscriptionResult): Promise<void> {
    try {
      const detectedQuestion = this.questionDetector.detectQuestion(transcription);
      
      if (detectedQuestion && this.questionDetector.isValidQuestion(detectedQuestion)) {
        // Add to question buffer
        this.state.questionBuffer.push(detectedQuestion);
        
        // Add to pending batch
        this.state.batchProcessor.pendingQuestions.push(detectedQuestion);
        
        this.emit('question-detected', detectedQuestion);
        this.emit('state-changed', { ...this.state });
        
        console.log('[AudioStreamProcessor] Question detected:', detectedQuestion.text);
      }
      
    } catch (error) {
      console.error('[AudioStreamProcessor] Question detection error:', error);
      this.emit('error', error as Error);
    }
  }

  /**
   * Setup batch processor for question refinement
   */
  private setupBatchProcessor(): void {
    // Process batch every 30 seconds or when max batch size reached
    this.batchTimeout = setInterval(async () => {
      const now = Date.now();
      const timeSinceLastBatch = now - this.lastBatchTime;
      
      if (timeSinceLastBatch >= this.config.batchInterval && 
          this.state.batchProcessor.pendingQuestions.length > 0) {
        await this.processBatch();
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Process batch of questions for refinement using Gemini
   */
  private async processBatch(): Promise<void> {
    if (this.state.batchProcessor.isProcessing || 
        this.state.batchProcessor.pendingQuestions.length === 0) {
      return;
    }

    try {
      this.state.batchProcessor.isProcessing = true;
      this.lastBatchTime = Date.now();
      
      const questionsToProcess = [...this.state.batchProcessor.pendingQuestions];
      this.state.batchProcessor.pendingQuestions = [];
      
      console.log(`[AudioStreamProcessor] Processing batch of ${questionsToProcess.length} questions`);

      if (this.llmHelper) {
        // Use Gemini to refine questions
        const refinedQuestions = await this.refineQuestionsWithGemini(questionsToProcess);
        
        // Update questions with refined text
        refinedQuestions.forEach(refined => {
          const original = this.state.questionBuffer.find(q => q.id === refined.id);
          if (original) {
            original.text = refined.text;
          }
        });
        
        this.emit('batch-processed', refinedQuestions);
        this.emit('state-changed', { ...this.state });
      }
      
    } catch (error) {
      console.error('[AudioStreamProcessor] Batch processing error:', error);
      this.emit('error', error as Error);
    } finally {
      this.state.batchProcessor.isProcessing = false;
    }
  }

  /**
   * Use Gemini to refine and improve question quality
   */
  private async refineQuestionsWithGemini(questions: DetectedQuestion[]): Promise<DetectedQuestion[]> {
    if (!this.llmHelper || questions.length === 0) return questions;

    try {
      // Preprocess questions (deduplication, filtering)
      const preprocessed = this.questionDetector.preprocessQuestions(questions);
      
      const questionTexts = preprocessed.map(q => q.text);
      const prompt = `以下の音声から抽出された文章から質問を抽出し、簡潔で分かりやすい日本語の質問文に書き直してください。

音声テキスト:
${questionTexts.join('\n')}

各質問を一行ずつ、改善された形で返してください。質問でない文章は除外してください。`;

      const result = await this.llmHelper.chatWithGemini(prompt);
      
      // Parse the refined questions
      const refinedTexts = result.split('\n').filter(line => line.trim().length > 0);
      
      return preprocessed.map((question, index) => ({...question,
        refinedText: refinedTexts[index] || question.text
      }));
      
    } catch (error) {
      console.error('[AudioStreamProcessor] Gemini refinement error:', error);
      // Return original questions if refinement fails
      return questions;
    }
  }

  /**
   * Get current state
   */
  public getState(): AudioStreamState {
    return { ...this.state };
  }

  /**
   * Get all detected questions
   */
  public getQuestions(): DetectedQuestion[] {
    return [...this.state.questionBuffer];
  }

  /**
   * Clear question buffer
   */
  public clearQuestions(): void {
    this.state.questionBuffer = [];
    this.state.batchProcessor.pendingQuestions = [];
    this.emit('state-changed', { ...this.state });
  }

  /**
   * Helper methods for audio processing
   */
  private calculateDuration(buffer: Buffer): number {
    // Estimate duration based on buffer size and sample rate
    const bytesPerSample = 2; // 16-bit audio
    const samples = buffer.length / bytesPerSample;
    return (samples / this.config.sampleRate) * 1000; // Return in milliseconds
  }

  private async createTempAudioFile(buffer: Buffer): Promise<string> {
    // Create a temporary audio file for Whisper API
    const tempPath = path.join(os.tmpdir(), `audio_${Date.now()}.wav`);
    await fs.promises.writeFile(tempPath, buffer);
    return tempPath;
  }

  private async cleanupTempFile(filePath: string): Promise<void> {
    // Clean up temporary file
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      // Ignore cleanup errors
      console.warn('[AudioStreamProcessor] Failed to cleanup temp file:', filePath);
    }
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.batchTimeout) {
      clearInterval(this.batchTimeout);
      this.batchTimeout = null;
    }
    
    this.removeAllListeners();
    this.currentAudioData = [];
    this.state.questionBuffer = [];
    this.state.batchProcessor.pendingQuestions = [];
  }
}