import React, { useState, useEffect } from 'react';
import { CheckCircle, AlertCircle, XCircle, Clock, Loader2, FileText, Zap, Brain, Eye, X } from 'lucide-react';

interface ProcessingStep {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  progress?: number;
  details?: string;
  estimatedTime?: number;
}

interface ProcessingStatusTrackerProps {
  sessionId: string;
  onProcessingComplete: (collectionId: string) => void;
  onProcessingError: (error: string) => void;
  onCancel: () => void;
  initialSteps?: ProcessingStep[];
}

const DEFAULT_STEPS: ProcessingStep[] = [
  {
    id: 'upload',
    name: 'File Upload',
    description: 'Uploading document to secure storage',
    status: 'completed',
    progress: 100
  },
  {
    id: 'parsing',
    name: 'Document Parsing',
    description: 'Extracting text and images from document',
    status: 'pending',
    estimatedTime: 30
  },
  {
    id: 'segmentation',
    name: 'Content Segmentation',
    description: 'Breaking document into logical sections',
    status: 'pending',
    estimatedTime: 20
  },
  {
    id: 'qa-generation',
    name: 'Q&A Generation',
    description: 'Creating questions and answers using AI',
    status: 'pending',
    estimatedTime: 60
  },
  {
    id: 'quality-scoring',
    name: 'Quality Assessment',
    description: 'Evaluating and scoring generated content',
    status: 'pending',
    estimatedTime: 15
  },
  {
    id: 'finalization',
    name: 'Preparing Review',
    description: 'Organizing content for user review',
    status: 'pending',
    estimatedTime: 5
  }
];

export const ProcessingStatusTracker: React.FC<ProcessingStatusTrackerProps> = ({
  sessionId,
  onProcessingComplete,
  onProcessingError,
  onCancel,
  initialSteps = DEFAULT_STEPS
}) => {
  const [steps, setSteps] = useState<ProcessingStep[]>(initialSteps);
  const [currentStep, setCurrentStep] = useState<string>('parsing');
  const [overallProgress, setOverallProgress] = useState(0);
  const [startTime, setStartTime] = useState<Date>(new Date());
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number>(0);
  const [processingStats, setProcessingStats] = useState({
    documentsProcessed: 0,
    segmentsCreated: 0,
    questionsGenerated: 0,
    averageQuality: 0
  });
  const [showDetails, setShowDetails] = useState(false);
  const [logs, setLogs] = useState<Array<{ timestamp: Date; message: string; type: 'info' | 'warning' | 'error' }>>([]);

  // Simulate processing progress (in real implementation, this would come from WebSocket)
  useEffect(() => {
    const processSteps = async () => {
      for (let i = 1; i < steps.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate delay
        
        // Update current step to in-progress
        setCurrentStep(steps[i].id);
        setSteps(prev => prev.map(step => 
          step.id === steps[i].id 
            ? { ...step, status: 'in-progress', progress: 0 }
            : step
        ));
        
        // Add log entry
        setLogs(prev => [...prev, {
          timestamp: new Date(),
          message: `Started ${steps[i].name}`,
          type: 'info'
        }]);
        
        // Simulate progress for current step
        for (let progress = 0; progress <= 100; progress += 10) {
          await new Promise(resolve => setTimeout(resolve, steps[i].estimatedTime! * 10)); // Simulate work
          
          setSteps(prev => prev.map(step => 
            step.id === steps[i].id 
              ? { ...step, progress }
              : step
          ));
          
          // Update overall progress
          const completedSteps = i - 1;
          const currentStepProgress = progress / 100;
          const newOverallProgress = ((completedSteps + currentStepProgress) / (steps.length - 1)) * 100;
          setOverallProgress(newOverallProgress);
          
          // Update estimated time remaining
          const elapsed = (new Date().getTime() - startTime.getTime()) / 1000;
          const totalEstimated = steps.slice(1).reduce((sum, step) => sum + (step.estimatedTime || 0), 0);
          const remaining = Math.max(0, totalEstimated - elapsed);
          setEstimatedTimeRemaining(remaining);
        }
        
        // Mark step as completed
        setSteps(prev => prev.map(step => 
          step.id === steps[i].id 
            ? { ...step, status: 'completed', progress: 100 }
            : step
        ));
        
        // Update processing stats (simulate)
        if (steps[i].id === 'parsing') {
          setProcessingStats(prev => ({ ...prev, documentsProcessed: 1 }));
        } else if (steps[i].id === 'segmentation') {
          setProcessingStats(prev => ({ ...prev, segmentsCreated: Math.floor(Math.random() * 10) + 5 }));
        } else if (steps[i].id === 'qa-generation') {
          setProcessingStats(prev => ({ ...prev, questionsGenerated: Math.floor(Math.random() * 20) + 15 }));
        } else if (steps[i].id === 'quality-scoring') {
          setProcessingStats(prev => ({ ...prev, averageQuality: 0.75 + Math.random() * 0.2 }));
        }
        
        setLogs(prev => [...prev, {
          timestamp: new Date(),
          message: `Completed ${steps[i].name}`,
          type: 'info'
        }]);
      }
      
      // Processing complete
      setTimeout(() => {
        onProcessingComplete('mock-collection-id');
      }, 500);
    };
    
    processSteps();
  }, []);

  const getStepIcon = (step: ProcessingStep) => {
    switch (step.status) {
      case 'completed':
        return <CheckCircle className="text-green-500" size={20} />;
      case 'in-progress':
        return <Loader2 className="text-blue-500 animate-spin" size={20} />;
      case 'failed':
        return <XCircle className="text-red-500" size={20} />;
      default:
        return <Clock className="text-gray-400" size={20} />;
    }
  };

  const getStepVisualIcon = (stepId: string) => {
    switch (stepId) {
      case 'upload':
        return <FileText className="text-blue-500" size={16} />;
      case 'parsing':
        return <FileText className="text-purple-500" size={16} />;
      case 'segmentation':
        return <Zap className="text-yellow-500" size={16} />;
      case 'qa-generation':
        return <Brain className="text-green-500" size={16} />;
      case 'quality-scoring':
        return <Eye className="text-orange-500" size={16} />;
      case 'finalization':
        return <CheckCircle className="text-teal-500" size={16} />;
      default:
        return <Clock className="text-gray-400" size={16} />;
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  };

  const elapsedTime = (new Date().getTime() - startTime.getTime()) / 1000;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Processing Document</h2>
            <p className="text-gray-600 mt-1">Converting your document into Q&A collection</p>
          </div>
          <button
            onClick={onCancel}
            className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
          >
            <X size={16} />
            Cancel
          </button>
        </div>

        {/* Overall Progress */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700">Overall Progress</span>
            <span className="text-sm text-gray-600">{Math.round(overallProgress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>

        {/* Time Information */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-lg font-semibold text-gray-900">{formatTime(elapsedTime)}</div>
            <div className="text-sm text-gray-600">Elapsed</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-gray-900">{formatTime(estimatedTimeRemaining)}</div>
            <div className="text-sm text-gray-600">Remaining</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-blue-600">{processingStats.questionsGenerated}</div>
            <div className="text-sm text-gray-600">Questions</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-green-600">
              {processingStats.averageQuality > 0 ? `${(processingStats.averageQuality * 100).toFixed(0)}%` : '-'}
            </div>
            <div className="text-sm text-gray-600">Avg Quality</div>
          </div>
        </div>
      </div>

      {/* Processing Steps */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Processing Steps</h3>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </button>
        </div>

        <div className="space-y-4">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-start gap-4">
              <div className="flex-shrink-0 mt-1">
                {getStepIcon(step)}
              </div>
              
              <div className="flex-grow min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {getStepVisualIcon(step.id)}
                  <h4 className="font-medium text-gray-900">{step.name}</h4>
                  {step.status === 'in-progress' && step.progress !== undefined && (
                    <span className="text-sm text-blue-600 ml-auto">{step.progress}%</span>
                  )}
                </div>
                
                <p className="text-sm text-gray-600 mb-2">{step.description}</p>
                
                {step.status === 'in-progress' && step.progress !== undefined && (
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div 
                      className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${step.progress}%` }}
                    />
                  </div>
                )}
                
                {step.details && showDetails && (
                  <div className="mt-2 p-2 bg-gray-50 rounded text-sm text-gray-700">
                    {step.details}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Processing Statistics */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Processing Statistics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{processingStats.documentsProcessed}</div>
            <div className="text-sm text-gray-600">Documents</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">{processingStats.segmentsCreated}</div>
            <div className="text-sm text-gray-600">Segments</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{processingStats.questionsGenerated}</div>
            <div className="text-sm text-gray-600">Questions</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-600">
              {processingStats.averageQuality > 0 ? `${(processingStats.averageQuality * 100).toFixed(0)}%` : '-'}
            </div>
            <div className="text-sm text-gray-600">Quality</div>
          </div>
        </div>
      </div>

      {/* Processing Logs */}
      {showDetails && (
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Processing Log</h3>
          <div className="max-h-64 overflow-y-auto space-y-2">
            {logs.map((log, index) => (
              <div key={index} className="flex items-start gap-3 text-sm">
                <span className="text-gray-500 font-mono text-xs mt-0.5 flex-shrink-0">
                  {log.timestamp.toLocaleTimeString()}
                </span>
                <span className={`flex-shrink-0 mt-0.5 ${
                  log.type === 'error' ? 'text-red-500' : 
                  log.type === 'warning' ? 'text-yellow-500' : 
                  'text-blue-500'
                }`}>
                  {log.type === 'error' ? '❌' : log.type === 'warning' ? '⚠️' : 'ℹ️'}
                </span>
                <span className="text-gray-700">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <div className="text-blue-600 mt-0.5">💡</div>
          <div>
            <h4 className="font-medium text-blue-900 mb-1">Processing Tips</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Larger documents may take longer to process</li>
              <li>• Quality scores help identify the best Q&A pairs</li>
              <li>• You can review and edit all generated content before finalizing</li>
              <li>• Processing can be cancelled at any time without losing progress</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};