import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { QuestionDetector } from "./QuestionDetector";
import {
  AudioChunk,
  AudioStreamState,
  AudioStreamConfig,
  AudioStreamEvents,
  TranscriptionResult,
  DetectedQuestion
} from "../src/types/audio-stream";

export class AudioStreamProcessor extends EventEmitter {
  private state: AudioStreamState;
  private config: AudioStreamConfig;
  private questionDetector: QuestionDetector;
  private openai: OpenAI;
  
  // Audio processing
  private currentAudioData: Float32Array[] = [];
  private lastSilenceTime: number = 0;
  private wordCount: number = 0;
  private tempBuffer: Float32Array | null = null;
  private lastChunkTime: number = 0;
  private accumulatedSamples: number = 0;

  // Japanese filler words and patterns to remove
  private readonly fillerWords = new Set([
    'えー', 'あー', 'うー', 'んー', 'そのー', 'あのー', 'えーっと', 'あーと',
    'まあ', 'なんか', 'ちょっと', 'やっぱり', 'やっぱ', 'だから', 'でも',
    'うん', 'はい', 'そう', 'ですね', 'ですが', 'ただ', 'まず', 'それで',
    'というか', 'てか', 'なので', 'けど', 'けれど', 'しかし', 'でも',
    'ー', '〜', 'う〜ん', 'え〜', 'あ〜', 'そ〜', 'ん〜'
  ]);

  private readonly questionStarters = new Set([
    'どう', 'どの', 'どこ', 'いつ', 'なぜ', 'なん', '何', 'だれ', '誰',
    'どちら', 'どれ', 'いくら', 'いくつ', 'どのよう', 'どんな'
  ]);

  constructor(openaiApiKey: string, config?: Partial<AudioStreamConfig>) {
    super();
    
    // Validate OpenAI API key
    if (!openaiApiKey || openaiApiKey.trim() === '') {
      throw new Error('OpenAI API key is required for AudioStreamProcessor');
    }
    
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.questionDetector = new QuestionDetector();
    
    // Simplified configuration - removed batching
    this.config = {
      sampleRate: 16000,
      chunkDuration: 1000,
      silenceThreshold: 800,
      maxWords: 40,
      questionDetectionEnabled: true,
      batchInterval: 0, // Not used anymore
      maxBatchSize: 0, // Not used anymore
      ...config
    };

    // Simplified state - removed batch processor
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

    console.log('[AudioStreamProcessor] Initialized with immediate question refinement');
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
  public async processAudioChunk(audioData: Buffer): Promise<void> {
    if (!this.state.isListening) {
      console.log('[AudioStreamProcessor] Not listening, ignoring audio chunk');
      return;
    }

    try {
      console.log('[AudioStreamProcessor] Processing audio chunk of size:', audioData.length);
      
      // Convert Buffer to Float32Array
      const float32Array = new Float32Array(audioData.length / 2);
      for (let i = 0; i < float32Array.length; i++) {
        const sample = audioData.readInt16LE(i * 2);
        float32Array[i] = sample / 32768.0;
      }
      
      // Add to current audio accumulation
      this.currentAudioData.push(float32Array);
      this.accumulatedSamples += float32Array.length;
      this.state.lastActivityTime = Date.now();
      
      // Initialize last chunk time if not set
      if (this.lastChunkTime === 0) {
        this.lastChunkTime = Date.now();
      }
      
      // Check if we should create a chunk based on duration or word count
      const shouldCreateChunk = await this.shouldCreateChunk();
      
      if (shouldCreateChunk) {
        console.log('[AudioStreamProcessor] Creating and processing chunk');
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
    
    // Calculate time since last chunk
    const timeSinceLastChunk = now - this.lastChunkTime;
    
    // Calculate accumulated audio duration (assuming 16kHz sample rate)
    const accumulatedDuration = (this.accumulatedSamples / this.config.sampleRate) * 1000;
    
    // Create chunk if:
    // 1. We have accumulated enough audio (5+ seconds) OR
    // 2. We haven't created a chunk in a while (10+ seconds) OR  
    // 3. Word count exceeds limit
    const shouldCreateByDuration = accumulatedDuration >= 5000;
    const shouldCreateByTime = timeSinceLastChunk >= 10000;
    const shouldCreateByWords = this.wordCount >= this.config.maxWords;
    
    const shouldCreate = shouldCreateByDuration || shouldCreateByTime || shouldCreateByWords;
    
    if (shouldCreate) {
      console.log('[AudioStreamProcessor] Creating chunk - Duration:', accumulatedDuration.toFixed(0), 'ms, Time since last:', timeSinceLastChunk.toFixed(0), 'ms, Words:', this.wordCount);
    }
    
    return shouldCreate;
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
      
      const chunk: AudioChunk = {
        id: uuidv4(),
        data: combinedArray,
        timestamp: Date.now(),
        duration: this.calculateDuration(combinedArray.length),
        wordCount: this.wordCount
      };

      // Reset accumulation
      this.currentAudioData = [];
      this.wordCount = 0;
      this.accumulatedSamples = 0;
      this.lastChunkTime = Date.now();
      
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
    if (!this.config.questionDetectionEnabled) {
      console.log('[AudioStreamProcessor] Question detection disabled, skipping transcription');
      return;
    }

    try {
      console.log('[AudioStreamProcessor] Starting transcription for chunk:', {
        id: chunk.id,
        duration: chunk.duration,
        dataLength: chunk.data.length,
        timestamp: chunk.timestamp
      });
      
      this.state.isProcessing = true;
      this.emit('state-changed', { ...this.state });

      // Convert to PCM buffer for Whisper API
      const pcmBuffer = Buffer.alloc(chunk.data.length * 2);
      for (let i = 0; i < chunk.data.length; i++) {
        const sample = Math.max(-1, Math.min(1, chunk.data[i]));
        const value = Math.floor(sample < 0 ? sample * 32768 : sample * 32767);
        pcmBuffer.writeInt16LE(value, i * 2);
      }
      
      console.log('[AudioStreamProcessor] Created PCM buffer, size:', pcmBuffer.length);
      const tempFilePath = await this.createTempAudioFile(pcmBuffer);
      console.log('[AudioStreamProcessor] Created WAV file:', tempFilePath);
      
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: "whisper-1",
        language: "ja",
        response_format: "json",
        temperature: 0.2
      });
      
      console.log('[AudioStreamProcessor] Whisper transcription result:', {
        text: transcription.text,
        textLength: transcription.text?.length || 0
      });

      // Clean up temp file
      await this.cleanupTempFile(tempFilePath);

      const result: TranscriptionResult = {
        id: uuidv4(),
        text: transcription.text || "",
        timestamp: chunk.timestamp,
        confidence: 1.0,
        isQuestion: false,
        originalChunkId: chunk.id
      };

      this.emit('transcription-completed', result);

      // Detect and immediately refine questions
      if (result.text.trim()) {
        console.log('[AudioStreamProcessor] Processing transcription for questions:', result.text);
        await this.detectAndRefineQuestions(result);
      } else {
        console.log('[AudioStreamProcessor] No text in transcription result');
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
   * Detect questions and immediately refine them algorithmically
   */
  private async detectAndRefineQuestions(transcription: TranscriptionResult): Promise<void> {
    try {
      const detectedQuestion = this.questionDetector.detectQuestion(transcription);
      
      if (detectedQuestion && this.questionDetector.isValidQuestion(detectedQuestion)) {
        console.log('[AudioStreamProcessor] Question detected:', detectedQuestion.text);
        
        // Immediately refine the question algorithmically
        const refinedText = this.refineQuestionAlgorithmically(detectedQuestion.text);
        
        // Create refined question object
        const refinedQuestion: DetectedQuestion & { refinedText?: string } = {
          ...detectedQuestion,
          refinedText: refinedText
        };
        
        // Add to question buffer
        this.state.questionBuffer.push(refinedQuestion);
        
        // Emit immediately - no batching delay
        this.emit('question-detected', refinedQuestion);
        this.emit('state-changed', { ...this.state });
        
        console.log('[AudioStreamProcessor] Question refined and emitted:', {
          original: detectedQuestion.text,
          refined: refinedText
        });
      }
      
    } catch (error) {
      console.error('[AudioStreamProcessor] Question detection error:', error);
      this.emit('error', error as Error);
    }
  }

  /**
   * Algorithmically refine question text by removing fillers and cleaning up
   */
  private refineQuestionAlgorithmically(text: string): string {
    console.log('[AudioStreamProcessor] Starting algorithmic refinement for:', text);
    
    try {
      let refined = text.toLowerCase().trim();
      
      // Step 1: Remove common Japanese filler words
      const words = refined.split(/[\s、。！？]+/).filter(word => word.length > 0);
      const cleanedWords = words.filter(word => !this.fillerWords.has(word));
      
      // Step 2: Remove repetitive patterns (like "あのあの", "えーえー")
      const deduplicatedWords: string[] = [];
      let lastWord = '';
      for (const word of cleanedWords) {
        if (word !== lastWord || !this.fillerWords.has(word)) {
          deduplicatedWords.push(word);
        }
        lastWord = word;
      }
      
      // Step 3: Rejoin and clean up spacing
      refined = deduplicatedWords.join(' ');
      
      // Step 4: Remove multiple spaces and normalize
      refined = refined.replace(/\s+/g, ' ').trim();
      
      // Step 5: Remove trailing particles that don't add meaning to questions
      refined = refined.replace(/[、。！？\s]*$/, '');
      refined = refined.replace(/\s*(です|ます|だ|である|でしょう|かな|よね)?\s*$/i, '');
      
      // Step 6: Ensure question ends appropriately
      if (!refined.endsWith('？') && !refined.endsWith('?')) {
        // Check if it's actually a question by looking for question words
        const hasQuestionWord = Array.from(this.questionStarters).some(starter => 
          refined.includes(starter)
        );
        
        if (hasQuestionWord || this.looksLikeQuestion(refined)) {
          refined += '？';
        }
      }
      
      // Step 7: Capitalize first character if it's a Latin character
      if (refined.length > 0 && /[a-zA-Z]/.test(refined[0])) {
        refined = refined[0].toUpperCase() + refined.slice(1);
      }
      
      // Fallback: if we cleaned too much, return original
      if (refined.length < 3 || refined.replace(/[？?]/g, '').trim().length < 2) {
        console.log('[AudioStreamProcessor] Refinement too aggressive, using original');
        return text;
      }
      
      console.log('[AudioStreamProcessor] Algorithmic refinement complete:', {
        original: text,
        refined: refined,
        removedWords: words.length - cleanedWords.length
      });
      
      return refined;
      
    } catch (error) {
      console.error('[AudioStreamProcessor] Error in algorithmic refinement:', error);
      return text; // Return original on error
    }
  }

  /**
   * Check if text structure looks like a question
   */
  private looksLikeQuestion(text: string): boolean {
    // Check for interrogative patterns in Japanese
    const questionPatterns = [
      /どう.*/, /どの.*/, /どこ.*/, /いつ.*/, /なぜ.*/, /なん.*/, /何.*/, 
      /だれ.*/, /誰.*/, /どちら.*/, /どれ.*/, /いくら.*/, /いくつ.*/,
      /.*ですか/, /.*ますか/, /.*でしょうか/, /.*かしら/, /.*のか/
    ];
    
    return questionPatterns.some(pattern => pattern.test(text));
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
    this.emit('state-changed', { ...this.state });
  }

  /**
   * Helper methods for audio processing
   */
  private calculateDuration(sampleCount: number): number {
    return (sampleCount / this.config.sampleRate) * 1000;
  }

  private async createTempAudioFile(buffer: Buffer): Promise<string> {
    const tempPath = path.join(os.tmpdir(), `audio_${Date.now()}.wav`);
    
    // WAV file parameters
    const sampleRate = this.config.sampleRate;
    const channels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = buffer.length;
    const fileSize = 36 + dataSize;
    
    // Create WAV header (44 bytes total)
    const header = Buffer.alloc(44);
    let offset = 0;
    
    // RIFF Header
    header.write('RIFF', offset); offset += 4;
    header.writeUInt32LE(fileSize, offset); offset += 4;
    header.write('WAVE', offset); offset += 4;
    
    // Format Chunk
    header.write('fmt ', offset); offset += 4;
    header.writeUInt32LE(16, offset); offset += 4;
    header.writeUInt16LE(1, offset); offset += 2;
    header.writeUInt16LE(channels, offset); offset += 2;
    header.writeUInt32LE(sampleRate, offset); offset += 4;
    header.writeUInt32LE(byteRate, offset); offset += 4;
    header.writeUInt16LE(blockAlign, offset); offset += 2;
    header.writeUInt16LE(bitsPerSample, offset); offset += 2;
    
    // Data Chunk Header
    header.write('data', offset); offset += 4;
    header.writeUInt32LE(dataSize, offset);
    
    // Combine header and PCM data
    const wavFile = Buffer.concat([header, buffer]);
    
    await fs.promises.writeFile(tempPath, wavFile);
    return tempPath;
  }

  private async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      console.warn('[AudioStreamProcessor] Failed to cleanup temp file:', filePath);
    }
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    this.removeAllListeners();
    this.currentAudioData = [];
    this.state.questionBuffer = [];
  }
}