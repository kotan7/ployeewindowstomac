import React, { useState, useCallback } from 'react'
import { Upload, FileText, AlertCircle, CheckCircle, Clock } from 'lucide-react'

interface DocumentUploadManagerProps {
  onUploadComplete?: (result: any) => void
  onError?: (error: string) => void
}

interface ProcessingStatus {
  stage: 'parsing' | 'segmenting' | 'generating' | 'evaluating' | 'saving' | 'complete' | 'error'
  progress: number
  message: string
  details?: any
}

export const DocumentUploadManager: React.FC<DocumentUploadManagerProps> = ({
  onUploadComplete,
  onError
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)
  const [status, setStatus] = useState<ProcessingStatus | null>(null)
  const [result, setResult] = useState<any>(null)
  const [dragActive, setDragActive] = useState(false)

  // Processing options
  const [options, setOptions] = useState({
    segmentation: {
      strategy: 'auto' as 'auto' | 'semantic' | 'structural' | 'size_based',
      targetQuestionCount: 15
    },
    qaGeneration: {
      questionsPerSegment: 3,
      questionTypes: ['factual', 'conceptual', 'application'] as string[],
      minQualityScore: 0.6,
      language: 'auto' as 'auto' | 'ja' | 'en'
    },
    collection: {
      autoApprove: false, // Always false as per requirement
      maxQuestions: 20
    }
  })

  const validateFile = (file: File): boolean => {
    const maxSize = 15 * 1024 * 1024 // 15MB
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg']
    
    if (file.size > maxSize) {
      onError?.('File size exceeds 15MB limit')
      return false
    }
    
    if (!allowedTypes.includes(file.type)) {
      onError?.('Unsupported file type. Please use PDF, PNG, or JPEG files.')
      return false
    }
    
    return true
  }

  const handleFileSelect = (file: File) => {
    if (validateFile(file)) {
      setSelectedFile(file)
      setResult(null)
      setStatus(null)
    }
  }

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0])
    }
  }, [])

  const processDocument = async () => {
    if (!selectedFile) return

    setProcessing(true)
    setStatus({ stage: 'parsing', progress: 0, message: 'Starting document processing...' })

    try {
      // First validate the file
      const validation = await window.electronAPI.documentValidate(
        await selectedFile.arrayBuffer(),
        selectedFile.name
      )

      if (!validation.valid) {
        throw new Error(validation.error)
      }

      // Set up progress listener
      const unsubscribe = window.electronAPI.onDocumentProcessingStatus((newStatus: ProcessingStatus) => {
        setStatus(newStatus)
      })

      // Process the document
      const processingResult = await window.electronAPI.documentProcess(
        await selectedFile.arrayBuffer(),
        selectedFile.name,
        selectedFile.type,
        options
      )

      unsubscribe()

      if (processingResult.success) {
        setResult(processingResult)
        onUploadComplete?.(processingResult)
      } else {
        throw new Error(processingResult.error || 'Processing failed')
      }
    } catch (error: any) {
      console.error('Document processing error:', error)
      setStatus({ stage: 'error', progress: 0, message: error.message })
      onError?.(error.message)
    } finally {
      setProcessing(false)
    }
  }

  const getStageIcon = (stage: ProcessingStatus['stage']) => {
    switch (stage) {
      case 'parsing':
      case 'segmenting':
      case 'generating':
      case 'evaluating':
      case 'saving':
        return <Clock className="w-4 h-4 animate-spin" />
      case 'complete':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />
      default:
        return null
    }
  }

  return (
    <div className="document-upload-manager max-w-2xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6">Upload Document for Q&A Generation</h2>

      {/* File Upload Area */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive
            ? 'border-blue-500 bg-blue-50'
            : selectedFile
            ? 'border-green-500 bg-green-50'
            : 'border-gray-300 hover:border-gray-400'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        {selectedFile ? (
          <div className="space-y-2">
            <FileText className="w-12 h-12 mx-auto text-green-500" />
            <p className="text-lg font-medium">{selectedFile.name}</p>
            <p className="text-sm text-gray-500">
              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
            </p>
            <button
              onClick={() => setSelectedFile(null)}
              className="text-sm text-red-500 hover:text-red-700"
            >
              Remove file
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <Upload className="w-12 h-12 mx-auto text-gray-400" />
            <div>
              <p className="text-lg font-medium">Drop your document here</p>
              <p className="text-sm text-gray-500">or click to browse</p>
            </div>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              className="hidden"
              id="file-input"
            />
            <label
              htmlFor="file-input"
              className="inline-block px-4 py-2 bg-blue-500 text-white rounded cursor-pointer hover:bg-blue-600"
            >
              Choose File
            </label>
            <p className="text-xs text-gray-400">
              Supports PDF, PNG, JPEG files up to 15MB
            </p>
          </div>
        )}
      </div>

      {/* Processing Options */}
      {selectedFile && !processing && !result && (
        <div className="mt-6 space-y-4">
          <h3 className="text-lg font-semibold">Processing Options</h3>
          
          {/* Segmentation Strategy */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Segmentation Strategy
            </label>
            <select
              value={options.segmentation.strategy}
              onChange={(e) => setOptions({
                ...options,
                segmentation: {
                  ...options.segmentation,
                  strategy: e.target.value as any
                }
              })}
              className="w-full p-2 border rounded"
            >
              <option value="auto">Auto (AI chooses best)</option>
              <option value="semantic">Semantic (by meaning)</option>
              <option value="structural">Structural (by headings)</option>
              <option value="size_based">Size-based (uniform chunks)</option>
            </select>
          </div>

          {/* Question Types */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Question Types
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'factual', label: 'Factual (What, When, Where)' },
                { key: 'conceptual', label: 'Conceptual (Why, How)' },
                { key: 'application', label: 'Application (How to use)' },
                { key: 'analytical', label: 'Analytical (Compare, Analyze)' }
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={options.qaGeneration.questionTypes.includes(key)}
                    onChange={(e) => {
                      const types = e.target.checked
                        ? [...options.qaGeneration.questionTypes, key]
                        : options.qaGeneration.questionTypes.filter(t => t !== key)
                      setOptions({
                        ...options,
                        qaGeneration: {
                          ...options.qaGeneration,
                          questionTypes: types
                        }
                      })
                    }}
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Quality Threshold */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Minimum Quality Score: {options.qaGeneration.minQualityScore}
            </label>
            <input
              type="range"
              min="0.3"
              max="0.9"
              step="0.1"
              value={options.qaGeneration.minQualityScore}
              onChange={(e) => setOptions({
                ...options,
                qaGeneration: {
                  ...options.qaGeneration,
                  minQualityScore: parseFloat(e.target.value)
                }
              })}
              className="w-full"
            />
          </div>

          <button
            onClick={processDocument}
            disabled={processing}
            className="w-full py-3 bg-green-500 text-white rounded font-medium hover:bg-green-600 disabled:opacity-50"
          >
            Process Document
          </button>
        </div>
      )}

      {/* Processing Status */}
      {status && (
        <div className="mt-6 p-4 border rounded">
          <div className="flex items-center space-x-2 mb-2">
            {getStageIcon(status.stage)}
            <span className="font-medium">
              {status.stage.charAt(0).toUpperCase() + status.stage.slice(1)}
            </span>
          </div>
          <p className="text-sm text-gray-600">{status.message}</p>
          {status.progress > 0 && (
            <div className="mt-2">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${status.progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">{status.progress}% complete</p>
            </div>
          )}
        </div>
      )}

      {/* Success Message */}
      {result && result.success && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded">
          <div className="flex items-center space-x-2 mb-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <span className="font-medium text-green-800">
              Document processed successfully!
            </span>
          </div>
          <p className="text-sm text-green-700">
            Generated {result.qaResult.qaPairs.length} questions in {(result.processingTime / 1000).toFixed(1)} seconds.
            Ready for review.
          </p>
        </div>
      )}
    </div>
  )
}