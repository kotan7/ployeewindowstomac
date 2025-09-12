import React, { useState, useEffect, useMemo } from 'react';
import { Check, X, Edit3, Eye, Search, Filter, Download, Save, CheckCircle, AlertCircle, Star } from 'lucide-react';

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

interface QAReviewInterfaceProps {
  sessionId: string;
  qaItems: QAItem[];
  suggestions: ReviewSuggestion[];
  onApproveAll: (itemIds: string[]) => void;
  onRejectAll: (itemIds: string[]) => void;
  onToggleApproval: (itemId: string, approved: boolean) => void;
  onEditItem: (itemId: string, question: string, answer: string) => void;
  onFinalize: (approvedItems: string[], collectionName: string, description: string) => void;
  onSaveDraft: () => void;
  isLoading?: boolean;
}

interface FilterState {
  questionType: string;
  qualityRange: [number, number];
  approvalStatus: 'all' | 'approved' | 'rejected' | 'pending';
  searchQuery: string;
}

export const QAReviewInterface: React.FC<QAReviewInterfaceProps> = ({
  sessionId,
  qaItems,
  suggestions,
  onApproveAll,
  onRejectAll,
  onToggleApproval,
  onEditItem,
  onFinalize,
  onSaveDraft,
  isLoading = false
}) => {
  const [filters, setFilters] = useState<FilterState>({
    questionType: 'all',
    qualityRange: [0, 1],
    approvalStatus: 'all',
    searchQuery: ''
  });
  
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ question: '', answer: '' });
  const [showSourceModal, setShowSourceModal] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [collectionName, setCollectionName] = useState('');
  const [collectionDescription, setCollectionDescription] = useState('');
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);

  // Filter and search logic
  const filteredItems = useMemo(() => {
    return qaItems.filter(item => {
      // Question type filter
      if (filters.questionType !== 'all' && item.questionType !== filters.questionType) {
        return false;
      }
      
      // Quality score filter
      if (item.qualityScore < filters.qualityRange[0] || item.qualityScore > filters.qualityRange[1]) {
        return false;
      }
      
      // Approval status filter
      if (filters.approvalStatus !== 'all') {
        const isApproved = item.approved === true;
        const isRejected = item.approved === false;
        const isPending = item.approved === undefined;
        
        if (filters.approvalStatus === 'approved' && !isApproved) return false;
        if (filters.approvalStatus === 'rejected' && !isRejected) return false;
        if (filters.approvalStatus === 'pending' && !isPending) return false;
      }
      
      // Search query filter
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        return (
          item.question.toLowerCase().includes(query) ||
          item.answer.toLowerCase().includes(query) ||
          item.sourceSegment.toLowerCase().includes(query)
        );
      }
      
      return true;
    });
  }, [qaItems, filters]);

  // Statistics
  const stats = useMemo(() => {
    const total = qaItems.length;
    const approved = qaItems.filter(item => item.approved === true).length;
    const rejected = qaItems.filter(item => item.approved === false).length;
    const pending = qaItems.filter(item => item.approved === undefined).length;
    const avgQuality = qaItems.reduce((sum, item) => sum + item.qualityScore, 0) / total;
    
    return { total, approved, rejected, pending, avgQuality };
  }, [qaItems]);

  const handleSelectAll = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(item => item.id)));
    }
  };

  const handleBulkApprove = () => {
    onApproveAll(Array.from(selectedItems));
    setSelectedItems(new Set());
  };

  const handleBulkReject = () => {
    onRejectAll(Array.from(selectedItems));
    setSelectedItems(new Set());
  };

  const handleEditStart = (item: QAItem) => {
    setEditingItem(item.id);
    setEditForm({
      question: item.question,
      answer: item.answer
    });
  };

  const handleEditSave = () => {
    if (editingItem) {
      onEditItem(editingItem, editForm.question, editForm.answer);
      setEditingItem(null);
    }
  };

  const handleEditCancel = () => {
    setEditingItem(null);
    setEditForm({ question: '', answer: '' });
  };

  const getQualityColor = (score: number) => {
    if (score >= 0.8) return 'text-green-600 bg-green-100';
    if (score >= 0.6) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  const getQuestionTypeIcon = (type: string) => {
    switch (type) {
      case 'factual': return '📚';
      case 'conceptual': return '💡';
      case 'application': return '🔧';
      case 'analytical': return '🧠';
      default: return '❓';
    }
  };

  const handleFinalize = () => {
    const approvedItemIds = qaItems
      .filter(item => item.approved === true)
      .map(item => item.id);
    
    onFinalize(approvedItemIds, collectionName, collectionDescription);
    setShowFinalizeModal(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Loading Q&A items...</span>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header with Statistics */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Review Generated Q&As</h2>
            <p className="text-gray-600 mt-1">Review and approve the auto-generated questions and answers</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onSaveDraft}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <Save size={16} />
              Save Draft
            </button>
            <button
              onClick={() => setShowFinalizeModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              disabled={stats.approved === 0}
            >
              <CheckCircle size={16} />
              Finalize Collection ({stats.approved})
            </button>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-sm text-gray-600">Total Items</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{stats.approved}</div>
            <div className="text-sm text-gray-600">Approved</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">{stats.rejected}</div>
            <div className="text-sm text-gray-600">Rejected</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            <div className="text-sm text-gray-600">Pending</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{(stats.avgQuality * 100).toFixed(0)}%</div>
            <div className="text-sm text-gray-600">Avg Quality</div>
          </div>
        </div>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">💡 Review Suggestions</h3>
          <div className="space-y-2">
            {suggestions.map((suggestion, index) => (
              <div key={index} className="flex items-start gap-2">
                <AlertCircle size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-blue-800">{suggestion.message}</span>
                  {suggestion.items.length > 0 && (
                    <div className="text-sm text-blue-700 mt-1">
                      Affected items: {suggestion.items.slice(0, 3).join(', ')}
                      {suggestion.items.length > 3 && ` and ${suggestion.items.length - 3} more`}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow-sm border p-4">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-gray-400" />
            <input
              type="text"
              placeholder="Search questions, answers, or content..."
              value={filters.searchQuery}
              onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
              className="border border-gray-300 rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors text-sm"
          >
            <Filter size={16} />
            Filters
          </button>

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleSelectAll}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {selectedItems.size === filteredItems.length ? 'Deselect All' : 'Select All'}
            </button>
            
            {selectedItems.size > 0 && (
              <>
                <button
                  onClick={handleBulkApprove}
                  className="flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors text-sm"
                >
                  <Check size={14} />
                  Approve ({selectedItems.size})
                </button>
                <button
                  onClick={handleBulkReject}
                  className="flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors text-sm"
                >
                  <X size={14} />
                  Reject ({selectedItems.size})
                </button>
              </>
            )}
          </div>
        </div>

        {/* Advanced Filters */}
        {showFilters && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Question Type</label>
              <select
                value={filters.questionType}
                onChange={(e) => setFilters(prev => ({ ...prev, questionType: e.target.value }))}
                className="w-full border border-gray-300 rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Types</option>
                <option value="factual">📚 Factual</option>
                <option value="conceptual">💡 Conceptual</option>
                <option value="application">🔧 Application</option>
                <option value="analytical">🧠 Analytical</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Approval Status</label>
              <select
                value={filters.approvalStatus}
                onChange={(e) => setFilters(prev => ({ ...prev, approvalStatus: e.target.value as any }))}
                className="w-full border border-gray-300 rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Status</option>
                <option value="approved">✅ Approved</option>
                <option value="rejected">❌ Rejected</option>
                <option value="pending">⏳ Pending</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quality Score</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={filters.qualityRange[0]}
                  onChange={(e) => setFilters(prev => ({ 
                    ...prev, 
                    qualityRange: [parseFloat(e.target.value), prev.qualityRange[1]] 
                  }))}
                  className="flex-1"
                />
                <span className="text-xs text-gray-600 min-w-[60px]">
                  {(filters.qualityRange[0] * 100).toFixed(0)}%-100%
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Q&A Items List */}
      <div className="space-y-4">
        {filteredItems.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Search size={48} className="mx-auto mb-4 text-gray-300" />
            <p>No Q&A items match your current filters.</p>
          </div>
        ) : (
          filteredItems.map((item) => (
            <div
              key={item.id}
              className={`bg-white rounded-lg shadow-sm border p-6 transition-all ${
                selectedItems.has(item.id) ? 'ring-2 ring-blue-500 bg-blue-50' : ''
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedItems.has(item.id)}
                    onChange={(e) => {
                      const newSelected = new Set(selectedItems);
                      if (e.target.checked) {
                        newSelected.add(item.id);
                      } else {
                        newSelected.delete(item.id);
                      }
                      setSelectedItems(newSelected);
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  
                  <div className="flex items-center gap-2">
                    <span className="text-lg" title={item.questionType}>
                      {getQuestionTypeIcon(item.questionType)}
                    </span>
                    <span className="text-sm text-gray-600 capitalize">{item.questionType}</span>
                  </div>
                  
                  <div className={`px-2 py-1 rounded-full text-xs font-medium ${getQualityColor(item.qualityScore)}`}>
                    <Star size={12} className="inline mr-1" />
                    {(item.qualityScore * 100).toFixed(0)}%
                  </div>
                  
                  {item.edited && (
                    <div className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                      Edited
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowSourceModal(item.id)}
                    className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    title="View source segment"
                  >
                    <Eye size={16} />
                  </button>
                  
                  <button
                    onClick={() => handleEditStart(item)}
                    className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Edit Q&A"
                  >
                    <Edit3 size={16} />
                  </button>
                  
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => onToggleApproval(item.id, true)}
                      className={`p-2 rounded-lg transition-colors ${
                        item.approved === true
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-400 hover:bg-green-100 hover:text-green-700'
                      }`}
                      title="Approve"
                    >
                      <Check size={16} />
                    </button>
                    
                    <button
                      onClick={() => onToggleApproval(item.id, false)}
                      className={`p-2 rounded-lg transition-colors ${
                        item.approved === false
                          ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-700'
                      }`}
                      title="Reject"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              </div>
              
              {editingItem === item.id ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Question</label>
                    <textarea
                      value={editForm.question}
                      onChange={(e) => setEditForm(prev => ({ ...prev, question: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={2}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Answer</label>
                    <textarea
                      value={editForm.answer}
                      onChange={(e) => setEditForm(prev => ({ ...prev, answer: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={3}
                    />
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={handleEditSave}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                    >
                      Save Changes
                    </button>
                    <button
                      onClick={handleEditCancel}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="font-medium text-gray-900 mb-1">Question:</div>
                    <div className="text-gray-700 leading-relaxed">{item.question}</div>
                  </div>
                  
                  <div>
                    <div className="font-medium text-gray-900 mb-1">Answer:</div>
                    <div className="text-gray-700 leading-relaxed">{item.answer}</div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Source Modal */}
      {showSourceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Source Segment</h3>
                <button
                  onClick={() => setShowSourceModal(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {qaItems.find(item => item.id === showSourceModal)?.sourceSegment}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Finalize Modal */}
      {showFinalizeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Finalize Collection</h3>
                <button
                  onClick={() => setShowFinalizeModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Collection Name *
                  </label>
                  <input
                    type="text"
                    value={collectionName}
                    onChange={(e) => setCollectionName(e.target.value)}
                    placeholder="Enter collection name..."
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={collectionDescription}
                    onChange={(e) => setCollectionDescription(e.target.value)}
                    placeholder="Describe this collection..."
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                </div>
                
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-sm text-blue-800">
                    <strong>{stats.approved}</strong> approved Q&A pairs will be added to your collection.
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleFinalize}
                  disabled={!collectionName.trim()}
                  className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  Create Collection
                </button>
                <button
                  onClick={() => setShowFinalizeModal(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};