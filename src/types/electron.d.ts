export import { AudioStreamState, DetectedQuestion } from './audio-stream'
import { DocumentProcessingOptions, DocumentProcessingResult, ProcessingStatus } from '../../electron/DocumentProcessingOrchestrator'

interface ElectronAPI {
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>
  deleteScreenshot: (path: string) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (callback: (data: { path: string; preview: string }) => void) => () => void
  onSolutionsReady: (callback: (solutions: string) => void) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void
  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
  takeScreenshot: () => Promise<void>
  moveWindowLeft: () => Promise<void>
  moveWindowRight: () => Promise<void>
  moveWindowUp: () => Promise<void>
  moveWindowDown: () => Promise<void>
  analyzeAudioFromBase64: (data: string, mimeType: string, collectionId?: string) => Promise<{ text: string; timestamp: number }>
  analyzeAudioFile: (path: string, collectionId?: string) => Promise<{ text: string; timestamp: number }>
  quitApp: () => Promise<void>
  invoke: (channel: string, ...args: any[]) => Promise<any>
  
  // Auth methods
  authSignIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  authSignUp: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  authSignOut: () => Promise<{ success: boolean; error?: string }>
  authGetState: () => Promise<{ user: any | null; session: any | null; isLoading: boolean }>
  authResetPassword: (email: string) => Promise<{ success: boolean; error?: string }>
  onAuthStateChange: (callback: (state: { user: any | null; session: any | null; isLoading: boolean }) => void) => () => void
  
  // Audio Stream methods
  audioStreamStart: () => Promise<{ success: boolean; error?: string }>
  audioStreamStop: () => Promise<{ success: boolean; error?: string }>
  audioStreamProcessChunk: (audioData: Buffer) => Promise<{ success: boolean; error?: string }>
  audioStreamGetState: () => Promise<AudioStreamState>
  audioStreamGetQuestions: () => Promise<DetectedQuestion[]>
  audioStreamClearQuestions: () => Promise<{ success: boolean; error?: string }>
  audioStreamAnswerQuestion: (questionText: string, collectionId?: string) => Promise<{ response: string; timestamp: number }>
  
  // Audio Stream event listeners
  onAudioQuestionDetected: (callback: (question: DetectedQuestion) => void) => () => void
  onAudioBatchProcessed: (callback: (questions: DetectedQuestion[]) => void) => () => void
  onAudioStreamStateChanged: (callback: (state: AudioStreamState) => void) => () => void
  onAudioStreamError: (callback: (error: string) => void) => () => void
  
  // Document Processing methods
  documentValidate: (buffer: ArrayBuffer, fileName: string) => Promise<{
    valid: boolean
    error?: string
    fileSize?: number
    fileType?: string
  }>
  documentProcess: (buffer: ArrayBuffer, fileName: string, options?: DocumentProcessingOptions, progressCallback?: (status: ProcessingStatus) => void) => Promise<DocumentProcessingResult>
  documentFinalizeCollection: (sessionId: string, approvedItems: string[], collectionName?: string, collectionDescription?: string) => Promise<{
    success: boolean
    collectionId?: string
    error?: string
  }>
  documentGetReviewData: (sessionId: string) => Promise<{
    sessionId: string
    collectionId?: string
    generatedQAs: Array<{
      id: string
      question: string
      answer: string
      questionType: 'factual' | 'conceptual' | 'application' | 'analytical'
      qualityScore: number
      sourceSegment: string
      approved?: boolean
    }>
    suggestions: Array<{
      type: 'quality' | 'coverage' | 'diversity'
      message: string
      items: string[]
    }>
  }>
  documentCancelProcessing: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  
  // Document Processing event listeners
  onDocumentProcessingProgress: (callback: (status: ProcessingStatus) => void) => () => void
    mimeType?: string
    estimatedProcessingTime?: number
  }>
  documentProcess: (
    buffer: ArrayBuffer,
    fileName: string,
    mimeType: string,
    options: DocumentProcessingOptions
  ) => Promise<DocumentProcessingResult>
  documentGetDefaultOptions: () => Promise<DocumentProcessingOptions>
  documentFinalizeCollection: (
    documentResult: DocumentProcessingResult,
    reviewedQAs: any[],
    collectionName: string,
    collectionDescription?: string
  ) => Promise<{ success: boolean; collection: any }>
  
  // QnA Collection methods
  qnaGetDocumentCollections: () => Promise<any[]>
  qnaGetCollectionAnalytics: (collectionId: string) => Promise<{
    totalQuestions: number
    questionTypeDistribution: Record<string, number>
    averageQuality: number
    autoGeneratedCount: number
    manualCount: number
  }>
  
  // Document Processing event listeners
  onDocumentProcessingStatus: (callback: (status: ProcessingStatus) => void) => () => void
}
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
} 