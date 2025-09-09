import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, ChevronUp, MessageSquare, Clock, Sparkles, ExternalLink } from 'lucide-react';
import { DetectedQuestion, AudioStreamState } from '../../types/audio-stream';

interface QuestionSidePanelProps {
  questions: DetectedQuestion[];
  audioStreamState: AudioStreamState | null;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onAnswerQuestion: (question: DetectedQuestion, collectionId?: string) => Promise<{ response: string; timestamp: number }>;
  responseMode?: {
    type: "plain" | "qna";
    collectionId?: string;
    collectionName?: string;
  };
  className?: string;
}

interface QuestionItemProps {
  question: DetectedQuestion;
  onAnswer: (question: DetectedQuestion) => Promise<void>;
  isGenerating: boolean;
  answer?: string;
}

const QuestionItem: React.FC<QuestionItemProps> = ({ 
  question, 
  onAnswer, 
  isGenerating,
  answer 
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [localAnswer, setLocalAnswer] = useState<string | null>(answer || null);

  const handleClick = async () => {
    if (localAnswer) {
      setIsExpanded(!isExpanded);
    } else {
      try {
        await onAnswer(question);
        // Answer will be set via parent component
      } catch (error) {
        console.error('Failed to get answer:', error);
      }
    }
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ja-JP', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const refined = (question as any).refinedText as string | undefined;
  const displayText = refined && refined.trim().length > 0 
    ? refined 
    : question.text;

  return (
    <div className="morphism-dropdown border border-white/10 rounded-lg p-3 hover:border-white/20 transition-colors">
      {/* Question Header */}
      <div 
        className="flex items-start justify-between cursor-pointer"
        onClick={handleClick}
      >
        <div className="flex-1 pr-2">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-3 h-3 text-blue-400" />
            <span className="text-[10px] text-white/50 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimestamp(question.timestamp)}
            </span>
            {refined && (
              <Sparkles className="w-3 h-3 text-emerald-400" />
            )}
          </div>
          <p className="text-xs text-white/90 leading-relaxed">
            {displayText}
          </p>
        </div>
        
        <div className="flex items-center gap-1">
          {isGenerating ? (
            <div className="animate-spin rounded-full h-3 w-3 border border-white/30 border-t-white/70" />
          ) : localAnswer ? (
            isExpanded ? (
              <ChevronUp className="w-4 h-4 text-white/50" />
            ) : (
              <ChevronDown className="w-4 h-4 text-white/50" />
            )
          ) : (
            <ExternalLink className="w-3 h-3 text-white/40" />
          )}
        </div>
      </div>

      {/* Answer Section */}
      {localAnswer && isExpanded && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="flex items-center gap-2 mb-2">
            <img src="/logo.png" alt="CueMe Logo" className="w-3 h-3" />
            <span className="text-[10px] text-emerald-400 font-medium">AI回答</span>
          </div>
          <div className="text-xs text-white/80 leading-relaxed whitespace-pre-wrap">
            {localAnswer}
          </div>
        </div>
      )}
    </div>
  );
};

const QuestionSidePanel: React.FC<QuestionSidePanelProps> = ({
  questions,
  audioStreamState,
  isCollapsed,
  onToggleCollapse,
  onAnswerQuestion,
  responseMode = { type: "plain" },
  className = ""
}) => {
  const [generatingAnswers, setGeneratingAnswers] = useState<Set<string>>(new Set());
  const [answers, setAnswers] = useState<Map<string, string>>(new Map());
  const panelRef = useRef<HTMLDivElement>(null);

  // Deduplicate questions by normalized refinedText || text
  const uniqueQuestions = useMemo(() => {
    const seen = new Set<string>();
    const result: DetectedQuestion[] = [];
    for (const q of questions) {
      const refined: string | undefined = (q as any).refinedText;
      const base = (refined && refined.trim().length > 0 ? refined : q.text).trim();
      const norm = base.toLowerCase().replace(/\s+/g, ' ');
      if (!seen.has(norm)) {
        seen.add(norm);
        result.push(q);
      }
    }
    return result;
  }, [questions]);

  // Auto-expand when first question is detected
  useEffect(() => {
    if (uniqueQuestions.length > 0 && isCollapsed) {
      onToggleCollapse();
    }
  }, [uniqueQuestions.length, isCollapsed, onToggleCollapse]);

  const handleAnswerQuestion = async (question: DetectedQuestion) => {
    if (generatingAnswers.has(question.id)) return;

    setGeneratingAnswers(prev => new Set(prev).add(question.id));

    try {
      const collectionId = responseMode.type === "qna" ? responseMode.collectionId : undefined;
      const result = await onAnswerQuestion(question, collectionId);
      setAnswers(prev => {
        const next = new Map(prev);
        next.set(question.id, result.response);
        return next;
      });
      
      // Note: Answer will be set by the parent component after successful response
      // This component receives answers via props or callbacks
      
    } catch (error) {
      console.error('Failed to answer question:', error);
      // Handle error - maybe set an error state for this question
    } finally {
      setGeneratingAnswers(prev => {
        const newSet = new Set(prev);
        newSet.delete(question.id);
        return newSet;
      });
    }
  };

  const isListening = audioStreamState?.isListening || false;
  const isProcessing = audioStreamState?.isProcessing || false;

  return (
    <div className={`w-full max-w-md ${className}`} ref={panelRef}>
      {/* Panel Header */}
      <div 
        className="liquid-glass chat-container p-3 cursor-pointer flex items-center justify-between"
        onClick={onToggleCollapse}
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-white/90">
            検出された質問
          </span>
          {uniqueQuestions.length > 0 && (
            <span className="bg-blue-500/20 text-blue-300 text-xs px-2 py-0.5 rounded-full">
              {uniqueQuestions.length}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Status Indicator */}
          {isListening && (
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[10px] text-emerald-400">
                {isProcessing ? "処理中" : "リスニング中"}
              </span>
            </div>
          )}
          
          {/* Collapse Toggle */}
          {isCollapsed ? (
            <ChevronDown className="w-4 h-4 text-white/50" />
          ) : (
            <ChevronUp className="w-4 h-4 text-white/50" />
          )}
        </div>
      </div>

      {/* Panel Content */}
      {!isCollapsed && (
        <div className="mt-2">
          {uniqueQuestions.length === 0 ? (
            <div className="liquid-glass chat-container p-4 text-center">
              <MessageSquare className="w-8 h-8 text-white/30 mx-auto mb-2" />
              <p className="text-xs text-white/50">
                {isListening 
                  ? "質問を検出中..." 
                  : "リスニングを開始すると質問が表示されます"}
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {uniqueQuestions
                .slice()
                .reverse() // Show newest questions first
                .map((question) => (
                  <QuestionItem
                    key={question.id}
                    question={question}
                    onAnswer={handleAnswerQuestion}
                    isGenerating={generatingAnswers.has(question.id)}
                    answer={answers.get(question.id)}
                  />
                ))}
            </div>
          )}

          {/* Processing Indicator */}
          {isProcessing && (
            <div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <div className="flex items-center gap-2 text-xs text-blue-300">
                <div className="animate-spin rounded-full h-3 w-3 border border-blue-300/30 border-t-blue-300" />
                <span>音声を解析中...</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default QuestionSidePanel;