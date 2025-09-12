import React, { useState, useCallback } from 'react';
import { DocumentUploadManager } from './DocumentUploadManager';
import { ProcessingStatusTracker } from './ProcessingStatusTracker';
import { QAReviewInterface } from './QAReviewInterface';
import { ArrowLeft, FileText, CheckCircle, AlertCircle } from 'lucide-react';

type ProcessingStage = 'upload' | 'processing' | 'review' | 'completed';

interface QAItem {
  id: string;
  question: string;
  answer: string;
  questionType: 'factual' | 'conceptual' | 'application' | 'analytical';
  qualityScore: number;
  sourceSegment: string;
  approved?: boolean;
  edited?: boolean;
  originalQuestion?: string;
  originalAnswer?: string;
}

interface ReviewSuggestion {
  type: 'quality' | 'coverage' | 'diversity';
  message: string;
  items: string[];
}

interface DocumentProcessingPageProps {
  onBackToCollections: () => void;
  onCollectionCreated: (collectionId: string) => void;
}

export const DocumentProcessingPage: React.FC<DocumentProcessingPageProps> = ({
  onBackToCollections,
  onCollectionCreated
}) => {
  const [currentStage, setCurrentStage] = useState<ProcessingStage>('upload');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [qaItems, setQAItems] = useState<QAItem[]>([]);
  const [suggestions, setSuggestions] = useState<ReviewSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleUploadComplete = useCallback(async (buffer: ArrayBuffer, name: string, options?: any) => {
    try {
      setError(null);
      setIsLoading(true);
      setFileName(name);
      setCurrentStage('processing');

      // Validate file first
      const validation = await window.electronAPI.documentValidate(buffer, name);
      if (!validation.valid) {
        throw new Error(validation.error || 'File validation failed');
      }

      // Start processing with progress tracking
      const result = await window.electronAPI.documentProcess(
        buffer, 
        name, 
        options,
        (status) => {
          console.log('Processing progress:', status);
          // Progress updates are handled by ProcessingStatusTracker
        }
      );

      setSessionId(result.sessionId);
      
    } catch (err: any) {
      console.error('Document processing error:', err);
      setError(err.message || 'Failed to process document');
      setCurrentStage('upload');
    } finally {\n      setIsLoading(false);\n    }\n  }, []);\n\n  const handleProcessingComplete = useCallback(async (collectionId: string) => {\n    try {\n      setError(null);\n      setIsLoading(true);\n      \n      if (!sessionId) {\n        throw new Error('No session ID available');\n      }\n\n      // Get review data\n      const reviewData = await window.electronAPI.documentGetReviewData(sessionId);\n      setQAItems(reviewData.generatedQAs);\n      setSuggestions(reviewData.suggestions);\n      setCurrentStage('review');\n      \n    } catch (err: any) {\n      console.error('Error loading review data:', err);\n      setError(err.message || 'Failed to load review data');\n    } finally {\n      setIsLoading(false);\n    }\n  }, [sessionId]);\n\n  const handleProcessingError = useCallback((error: string) => {\n    setError(error);\n    setCurrentStage('upload');\n  }, []);\n\n  const handleProcessingCancel = useCallback(async () => {\n    try {\n      if (sessionId) {\n        await window.electronAPI.documentCancelProcessing(sessionId);\n      }\n      setCurrentStage('upload');\n      setSessionId(null);\n      setError(null);\n    } catch (err: any) {\n      console.error('Error cancelling processing:', err);\n      setError(err.message || 'Failed to cancel processing');\n    }\n  }, [sessionId]);\n\n  const handleToggleApproval = useCallback((itemId: string, approved: boolean) => {\n    setQAItems(prev => prev.map(item => \n      item.id === itemId ? { ...item, approved } : item\n    ));\n  }, []);\n\n  const handleApproveAll = useCallback((itemIds: string[]) => {\n    setQAItems(prev => prev.map(item => \n      itemIds.includes(item.id) ? { ...item, approved: true } : item\n    ));\n  }, []);\n\n  const handleRejectAll = useCallback((itemIds: string[]) => {\n    setQAItems(prev => prev.map(item => \n      itemIds.includes(item.id) ? { ...item, approved: false } : item\n    ));\n  }, []);\n\n  const handleEditItem = useCallback((itemId: string, question: string, answer: string) => {\n    setQAItems(prev => prev.map(item => \n      item.id === itemId ? { \n        ...item, \n        question, \n        answer, \n        edited: true,\n        originalQuestion: item.originalQuestion || item.question,\n        originalAnswer: item.originalAnswer || item.answer\n      } : item\n    ));\n  }, []);\n\n  const handleFinalize = useCallback(async (\n    approvedItems: string[], \n    collectionName: string, \n    description: string\n  ) => {\n    try {\n      setError(null);\n      setIsLoading(true);\n      \n      if (!sessionId) {\n        throw new Error('No session ID available');\n      }\n\n      const result = await window.electronAPI.documentFinalizeCollection(\n        sessionId,\n        approvedItems,\n        collectionName,\n        description\n      );\n\n      if (result.success && result.collectionId) {\n        setCurrentStage('completed');\n        onCollectionCreated(result.collectionId);\n      } else {\n        throw new Error(result.error || 'Failed to create collection');\n      }\n    } catch (err: any) {\n      console.error('Error finalizing collection:', err);\n      setError(err.message || 'Failed to create collection');\n    } finally {\n      setIsLoading(false);\n    }\n  }, [sessionId, onCollectionCreated]);\n\n  const handleSaveDraft = useCallback(() => {\n    // TODO: Implement draft saving\n    console.log('Save draft not yet implemented');\n  }, []);\n\n  const renderStageIndicator = () => {\n    const stages = [\n      { key: 'upload', label: 'Upload', icon: FileText },\n      { key: 'processing', label: 'Processing', icon: AlertCircle },\n      { key: 'review', label: 'Review', icon: CheckCircle },\n      { key: 'completed', label: 'Complete', icon: CheckCircle }\n    ];\n\n    return (\n      <div className=\"flex items-center justify-center mb-8\">\n        {stages.map((stage, index) => {\n          const Icon = stage.icon;\n          const isActive = currentStage === stage.key;\n          const isCompleted = stages.findIndex(s => s.key === currentStage) > index;\n          const isAccessible = stages.findIndex(s => s.key === currentStage) >= index;\n          \n          return (\n            <React.Fragment key={stage.key}>\n              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${\n                isActive ? 'bg-blue-100 text-blue-700' :\n                isCompleted ? 'bg-green-100 text-green-700' :\n                isAccessible ? 'bg-gray-100 text-gray-500' :\n                'bg-gray-50 text-gray-400'\n              }`}>\n                <Icon size={16} />\n                <span className=\"text-sm font-medium\">{stage.label}</span>\n              </div>\n              {index < stages.length - 1 && (\n                <div className={`w-8 h-0.5 mx-2 ${\n                  isCompleted ? 'bg-green-300' : 'bg-gray-200'\n                }`} />\n              )}\n            </React.Fragment>\n          );\n        })}\n      </div>\n    );\n  };\n\n  return (\n    <div className=\"min-h-screen bg-gray-50\">\n      {/* Header */}\n      <div className=\"bg-white border-b border-gray-200 px-6 py-4\">\n        <div className=\"max-w-6xl mx-auto flex items-center justify-between\">\n          <div className=\"flex items-center gap-4\">\n            <button\n              onClick={onBackToCollections}\n              className=\"flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-colors\"\n            >\n              <ArrowLeft size={20} />\n              Back to Collections\n            </button>\n            <div className=\"w-px h-6 bg-gray-300\" />\n            <div>\n              <h1 className=\"text-xl font-semibold text-gray-900\">\n                Create Document-Based Collection\n              </h1>\n              {fileName && (\n                <p className=\"text-sm text-gray-600 mt-1\">\n                  Processing: {fileName}\n                </p>\n              )}\n            </div>\n          </div>\n        </div>\n      </div>\n\n      <div className=\"max-w-6xl mx-auto py-8\">\n        {/* Stage Indicator */}\n        {renderStageIndicator()}\n\n        {/* Error Display */}\n        {error && (\n          <div className=\"mb-6 bg-red-50 border border-red-200 rounded-lg p-4\">\n            <div className=\"flex items-start gap-2\">\n              <AlertCircle className=\"text-red-500 mt-0.5 flex-shrink-0\" size={16} />\n              <div>\n                <h3 className=\"font-medium text-red-900\">Processing Error</h3>\n                <p className=\"text-red-700 mt-1\">{error}</p>\n              </div>\n            </div>\n          </div>\n        )}\n\n        {/* Stage Content */}\n        {currentStage === 'upload' && (\n          <DocumentUploadManager\n            onUploadComplete={handleUploadComplete}\n            isLoading={isLoading}\n          />\n        )}\n\n        {currentStage === 'processing' && sessionId && (\n          <ProcessingStatusTracker\n            sessionId={sessionId}\n            onProcessingComplete={handleProcessingComplete}\n            onProcessingError={handleProcessingError}\n            onCancel={handleProcessingCancel}\n          />\n        )}\n\n        {currentStage === 'review' && (\n          <QAReviewInterface\n            sessionId={sessionId!}\n            qaItems={qaItems}\n            suggestions={suggestions}\n            onApproveAll={handleApproveAll}\n            onRejectAll={handleRejectAll}\n            onToggleApproval={handleToggleApproval}\n            onEditItem={handleEditItem}\n            onFinalize={handleFinalize}\n            onSaveDraft={handleSaveDraft}\n            isLoading={isLoading}\n          />\n        )}\n\n        {currentStage === 'completed' && (\n          <div className=\"text-center py-12\">\n            <CheckCircle className=\"mx-auto text-green-500 mb-4\" size={64} />\n            <h2 className=\"text-2xl font-bold text-gray-900 mb-2\">\n              Collection Created Successfully!\n            </h2>\n            <p className=\"text-gray-600 mb-6\">\n              Your document has been processed and the Q&A collection is ready to use.\n            </p>\n            <div className=\"flex gap-4 justify-center\">\n              <button\n                onClick={onBackToCollections}\n                className=\"px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors\"\n              >\n                View All Collections\n              </button>\n              <button\n                onClick={() => {\n                  setCurrentStage('upload');\n                  setSessionId(null);\n                  setFileName('');\n                  setQAItems([]);\n                  setSuggestions([]);\n                  setError(null);\n                }}\n                className=\"px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors\"\n              >\n                Process Another Document\n              </button>\n            </div>\n          </div>\n        )}\n      </div>\n    </div>\n  );\n};