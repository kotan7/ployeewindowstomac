import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MessageSquare, Clock, Sparkles } from 'lucide-react';
import { DetectedQuestion, AudioStreamState } from '../../types/audio-stream';

interface QuestionSidePanelProps {
  questions: DetectedQuestion[];
  audioStreamState: AudioStreamState | null;
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
  isSelected: boolean;
  onClick: () => void;
}

const QuestionItem: React.FC<QuestionItemProps> = ({ 
  question, 
  isSelected,
  onClick
}) => {
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
    <div 
      className={`morphism-dropdown border rounded-lg p-3 cursor-pointer transition-all ${
        isSelected 
          ? 'border-blue-400/50 bg-blue-500/10' 
          : 'border-white/10 hover:border-white/20'
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-3 h-3 text-emerald-400" />
        <span className="text-[10px] text-white/50 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTimestamp(question.timestamp)}
        </span>
      </div>
      <p className="text-xs text-white/90 leading-relaxed">
        {displayText}
      </p>
    </div>
  );
};

const QuestionSidePanel: React.FC<QuestionSidePanelProps> = ({
  questions,
  audioStreamState,
  onAnswerQuestion,
  responseMode = { type: "plain" },
  className = ""
}) => {
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [generatingAnswer, setGeneratingAnswer] = useState(false);
  const [currentAnswer, setCurrentAnswer] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Map<string, string>>(new Map());

  // Filter to only show refined questions
  const refinedQuestions = useMemo(() => {
    const seen = new Set<string>();
    const result: DetectedQuestion[] = [];
    
    for (const q of questions) {
      const refined: string | undefined = (q as any).refinedText;
      // Only include questions that have been refined
      if (refined && refined.trim().length > 0) {
        const norm = refined.toLowerCase().replace(/\s+/g, ' ');
        if (!seen.has(norm)) {
          seen.add(norm);
          result.push(q);
        }
      }
    }
    
    // Sort by timestamp, newest first
    return result.sort((a, b) => b.timestamp - a.timestamp);
  }, [questions]);

  const handleQuestionClick = async (question: DetectedQuestion) => {
    setSelectedQuestionId(question.id);
    
    // Check if we already have an answer cached
    const cachedAnswer = answers.get(question.id);
    if (cachedAnswer) {
      setCurrentAnswer(cachedAnswer);
      return;
    }

    // Generate new answer
    setGeneratingAnswer(true);
    setCurrentAnswer(null);
    
    try {
      const collectionId = responseMode.type === "qna" ? responseMode.collectionId : undefined;
      const result = await onAnswerQuestion(question, collectionId);
      
      // Cache the answer
      setAnswers(prev => {
        const next = new Map(prev);
        next.set(question.id, result.response);
        return next;
      });
      
      setCurrentAnswer(result.response);
    } catch (error) {
      console.error('Failed to answer question:', error);
      setCurrentAnswer("回答の生成中にエラーが発生しました。");
    } finally {
      setGeneratingAnswer(false);
    }
  };

  const isListening = audioStreamState?.isListening || false;

  if (refinedQuestions.length === 0 && !isListening) {
    return null; // Don't show panel if no questions and not listening
  }

  return (
    <div className={`w-full ${className}`}>
      {/* Two Panel Layout */}
      <div className="flex gap-4 h-80">
        {/* Left Panel - Questions */}
        <div className="flex-1 liquid-glass chat-container p-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium text-white/90">
              検出された質問
            </span>
            {refinedQuestions.length > 0 && (
              <span className="bg-blue-500/20 text-blue-300 text-xs px-2 py-0.5 rounded-full">
                {refinedQuestions.length}
              </span>
            )}
            {isListening && (
              <div className="ml-auto flex items-center gap-1">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-[10px] text-emerald-400">リスニング中</span>
              </div>
            )}
          </div>
          
          {refinedQuestions.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="w-8 h-8 text-white/30 mx-auto mb-2" />
              <p className="text-xs text-white/50">
                質問を検出中...
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {refinedQuestions.map((question) => (
                <QuestionItem
                  key={question.id}
                  question={question}
                  isSelected={selectedQuestionId === question.id}
                  onClick={() => handleQuestionClick(question)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right Panel - Answer */}
        <div className="flex-1 liquid-glass chat-container p-4">
          <div className="flex items-center gap-2 mb-3">
            <img src="/logo.png" alt="CueMe Logo" className="w-4 h-4" />
            <span className="text-sm font-medium text-white/90">AI回答</span>
          </div>
          
          {!selectedQuestionId ? (
            <div className="text-center py-8">
              <p className="text-xs text-white/50">
                左の質問をクリックして回答を表示
              </p>
            </div>
          ) : generatingAnswer ? (
            <div className="flex items-center gap-2 py-8">
              <div className="animate-spin rounded-full h-4 w-4 border border-white/30 border-t-white/70" />
              <span className="text-xs text-white/70">回答を生成中...</span>
            </div>
          ) : currentAnswer ? (
            <div className="text-xs text-white/80 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
              {currentAnswer}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-xs text-white/50">
                回答の生成に失敗しました
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuestionSidePanel;