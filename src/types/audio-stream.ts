export interface AudioChunk {
  id: string;
  buffer: Buffer;
  timestamp: number;
  duration: number;
  wordCount?: number;
}

export interface TranscriptionResult {
  id: string;
  text: string;
  timestamp: number;
  confidence?: number;
  isQuestion: boolean;
  originalChunkId: string;
}

export interface DetectedQuestion {
  id: string;
  text: string;
  timestamp: number;
  isRefined: boolean;
  refinedText?: string;
  confidence?: number;
  originalTranscriptionId: string;
}

export interface QuestionBatch {
  id: string;
  questions: DetectedQuestion[];
  timestamp: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface AudioStreamState {
  isListening: boolean;
  isProcessing: boolean;
  currentChunk?: AudioChunk;
  lastActivityTime: number;
  questionBuffer: DetectedQuestion[];
  batchProcessor: {
    lastBatchTime: number;
    isProcessing: boolean;
    pendingQuestions: DetectedQuestion[];
  };
}

export interface AudioStreamConfig {
  sampleRate: number;
  chunkDuration: number; // in milliseconds
  silenceThreshold: number; // in milliseconds
  maxWords: number;
  questionDetectionEnabled: boolean;
  batchInterval: number; // in milliseconds
  maxBatchSize: number;
}

export interface AudioStreamEvents {
  'chunk-recorded': AudioChunk;
  'transcription-completed': TranscriptionResult;
  'question-detected': DetectedQuestion;
  'batch-processed': DetectedQuestion[];
  'error': Error;
  'state-changed': AudioStreamState;
}