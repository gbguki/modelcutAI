// updated
import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import ImageUploader from './components/ImageUploader';
import { generateFashionImage } from './services/geminiService';
import { fetchProjects, saveProject, updateProject, deleteProject } from './services/firebaseService';
import { AppState, AspectRatio, ImageFile, GenerationResult, Workspace } from './types';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    baseImage: null,
    productImages: [],
    history: [],
    activeVersionIndex: -1,
    isGenerating: false,
    error: null,
    workspaces: [],
    currentWorkspaceId: null,
  });

  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(AspectRatio.SQUARE);
  const [prompt, setPrompt] = useState<string>('');
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [userName, setUserName] = useState<string | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [tempName, setTempName] = useState('');
  
  // 저장/불러오기 관련 상태
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveProgress, setSaveProgress] = useState<string>('');
  
  // 워크스페이스 관리 상태
  const [currentWorkspaceName, setCurrentWorkspaceName] = useState<string>('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const timelineEndRef = useRef<HTMLDivElement>(null);

  // Load saved user name
  useEffect(() => {
    const savedName = localStorage.getItem('vfa_user_name');
    if (!savedName) {
      setShowUserModal(true);
    } else {
      setUserName(savedName);
    }
  }, []);

  // Load projects from Firebase
  useEffect(() => {
    const loadProjects = async () => {
      setIsLoadingProjects(true);
      try {
        const data = await fetchProjects();
        setState(prev => ({ ...prev, workspaces: data as Workspace[] }));
      } catch (e) {
        console.error('Failed to load projects:', e);
      } finally {
        setIsLoadingProjects(false);
      }
    };
    loadProjects();
  }, []);

  // Scroll timeline to end
  useEffect(() => {
    if (state.history.length > 0) {
      timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state.history.length]);
  
  // 저장 성공 메시지 자동 숨김
  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  const currentResult = state.activeVersionIndex >= 0 ? state.history[state.activeVersionIndex] : null;

  // 현재 워크스페이스 정보 가져오기
  const currentWorkspace = state.workspaces.find(ws => ws.id === state.currentWorkspaceId);

  const handleGenerate = async () => {
    if (!state.baseImage || state.productImages.length === 0) {
      setState(prev => ({ ...prev, error: '베이스 이미지와 제품 이미지를 등록해주세요.' }));
      return;
    }

    setState(prev => ({ ...prev, isGenerating: true, error: null }));

    try {
      const result = await generateFashionImage(state.baseImage, state.productImages, {
        aspectRatio,
        prompt,
        previousImage: currentResult?.imageUrl
      });

      const newVersion: GenerationResult = {
        id: Math.random().toString(36).substr(2, 9),
        imageUrl: result.imageUrl,
        summary: result.summary,
        prompt: prompt,
        timestamp: Date.now(),
        aspectRatio: aspectRatio,
        grounding: result.groundingChunks || null
      };

      setState(prev => {
        const newHistory = [...prev.history, newVersion];
        return {
          ...prev,
          history: newHistory,
          activeVersionIndex: newHistory.length - 1,
          isGenerating: false
        };
      });
      setPrompt('');
      setHasUnsavedChanges(true);
    } catch (err: any) {
      setState(prev => ({ ...prev, isGenerating: false, error: err.message || 'Error generating image.' }));
    }
  };

  // 저장 여부 확인 후 액션 실행
  const confirmAction = (action: () => void) => {
    if (hasUnsavedChanges && (state.baseImage || state.history.length > 0)) {
      setPendingAction(() => action);
      setShowUnsavedWarning(true);
    } else {
      action();
    }
  };

  const handleNewProject = () => {
    confirmAction(() => {
      setState(prev => ({
        ...prev,
        baseImage: null,
        productImages: [],
        history: [],
        activeVersionIndex: -1,
        currentWorkspaceId: null,
        error: null
      }));
      setPrompt('');
      setCurrentWorkspaceName('');
      setHasUnsavedChanges(false);
    });
  };

  // 새로 저장
  const handleSaveNew = async () => {
    if (!newWorkspaceName.trim()) {
      setSaveError('워크스페이스 이름을 입력해주세요.');
      return;
    }
    if (!userName) {
      setSaveError('사용자 이름이 필요합니다.');
      return;
    }
    if (!state.baseImage && state.history.length === 0) {
      setSaveError('저장할 콘텐츠가 없습니다.');
      return;
    }
    
    setIsSaving(true);
    setSaveError(null);
    setSaveProgress('준비 중...');
    
    try {
      const newWs: Workspace = {
        id: Math.random().toString(36).substr(2, 9),
        name: newWorkspaceName,
        baseImage: state.baseImage,
        productImages: state.productImages,
        history: state.history,
        activeVersionIndex: state.activeVersionIndex,
        lastUpdated: Date.now(),
        owner: userName,
      };
      
      const docId = await saveProject(newWs, (status) => setSaveProgress(status));
      
      setSaveProgress('목록 새로고침 중...');
      const updatedProjects = await fetchProjects();
      
      setState(prev => ({
        ...prev,
        workspaces: updatedProjects as Workspace[],
        currentWorkspaceId: docId
      }));
      
      setCurrentWorkspaceName(newWorkspaceName);
      setNewWorkspaceName('');
      setSaveSuccess(true);
      setHasUnsavedChanges(false);
      setSaveProgress('');
      
    } catch (error: any) {
      console.error('Save error:', error);
      setSaveError(error.message || '저장 중 오류가 발생했습니다.');
      setSaveProgress('');
    } finally {
      setIsSaving(false);
    }
  };

  // 현재 워크스페이스 업데이트
  const handleUpdateCurrent = async () => {
    if (!state.currentWorkspaceId || !currentWorkspace) {
      setSaveError('업데이트할 워크스페이스가 없습니다.');
      return;
    }
    
    setIsSaving(true);
    setSaveError(null);
    setSaveProgress('준비 중...');
    
    try {
      const updatedWs: Workspace = {
        ...currentWorkspace,
        baseImage: state.baseImage,
        productImages: state.productImages,
        history: state.history,
        activeVersionIndex: state.activeVersionIndex,
        lastUpdated: Date.now(),
      };
      
      await updateProject(state.currentWorkspaceId, updatedWs, (status) => setSaveProgress(status));
      
      setSaveProgress('목록 새로고침 중...');
      const updatedProjects = await fetchProjects();
      
      setState(prev => ({
        ...prev,
        workspaces: updatedProjects as Workspace[],
      }));
      
      setSaveSuccess(true);
      setHasUnsavedChanges(false);
      setSaveProgress('');
      
    } catch (error: any) {
      console.error('Update error:', error);
      setSaveError(error.message || '업데이트 중 오류가 발생했습니다.');
      setSaveProgress('');
    } finally {
      setIsSaving(false);
    }
  };

  // 워크스페이스 불러오기
  const loadWorkspace = (ws: Workspace) => {
    confirmAction(() => {
      setState(prev => {
        const baseImage: ImageFile | null = ws.baseImage ?? null;
        const productImages: ImageFile[] = Array.isArray(ws.productImages) ? ws.productImages : [];
        const history: GenerationResult[] = Array.isArray(ws.history) ? ws.history : [];
        const activeVersionIndex: number = typeof ws.activeVersionIndex === 'number' ? ws.activeVersionIndex : -1;

        return {
          ...prev,
          baseImage,
          productImages,
          history,
          activeVersionIndex,
          currentWorkspaceId: ws.id ?? null,
        };
      });
      setCurrentWorkspaceName(ws.name);
      setHasUnsavedChanges(false);
      setShowWorkspaceModal(false);
    });
  };
  
  // 워크스페이스 삭제
  const handleDeleteWorkspace = async (wsId: string) => {
    try {
      await deleteProject(wsId);
      
      setState(prev => ({
        ...prev,
        workspaces: prev.workspaces.filter(w => w.id !== wsId),
        currentWorkspaceId: prev.currentWorkspaceId === wsId ? null : prev.currentWorkspaceId
      }));
      
      if (state.currentWorkspaceId === wsId) {
        setCurrentWorkspaceName('');
      }
      
      setShowDeleteConfirm(null);
    } catch (error) {
      console.error('Delete error:', error);
      setSaveError('삭제 중 오류가 발생했습니다.');
    }
  };
  
  // 프로젝트 목록 새로고침
  const refreshProjects = async () => {
    setIsLoadingProjects(true);
    try {
      const data = await fetchProjects();
      setState(prev => ({ ...prev, workspaces: data as Workspace[] }));
    } catch (e) {
      console.error('Failed to refresh projects:', e);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  // 모달 닫기
  const handleCloseModal = () => {
    setShowWorkspaceModal(false);
    setSaveError(null);
    setSaveSuccess(false);
    setSaveProgress('');
    setNewWorkspaceName('');
  };

  const getAspectRatioClass = (ratio: AspectRatio) => {
    switch (ratio) {
      case AspectRatio.SQUARE: return 'aspect-square';
      case AspectRatio.PORTRAIT_4_5: return 'aspect-[4/5]';
      case AspectRatio.MOBILE_9_16: return 'aspect-[9/16]';
      default: return 'aspect-square';
    }
  };

  const handleRegisterUser = () => {
    if (!tempName.trim()) return;
    localStorage.setItem('vfa_user_name', tempName.trim());
    setUserName(tempName.trim());
    setShowUserModal(false);
  };

  return (
    <div className="h-screen bg-[#050505] flex flex-col overflow-hidden">
      <Header title="ModelCut AI" />

      {/* Top Bar */}
      <div className="mt-[48px] px-4 py-2 flex justify-between items-center border-b border-white/5 bg-[#080808] shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
            <span className="text-[8px] text-gray-500 font-bold tracking-[0.2em] uppercase">Cloud</span>
          </div>
          <div className="h-3 w-px bg-white/10"></div>
          <span className="text-[10px] font-bold text-white tracking-tight flex items-center gap-1.5">
            <i className="fas fa-user text-gray-600 text-xs"></i>
            {userName || 'Anonymous'}
          </span>
          
          {/* 현재 워크스페이스 표시 */}
          {currentWorkspaceName && (
            <>
              <div className="h-3 w-px bg-white/10"></div>
              <span className="text-[10px] text-blue-400 flex items-center gap-1.5">
                <i className="fas fa-folder-open text-xs"></i>
                {currentWorkspaceName}
                {hasUnsavedChanges && <span className="text-yellow-400">*</span>}
              </span>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={handleNewProject} className="px-4 py-1.5 glass rounded-lg text-[10px] font-bold hover:bg-white/10 transition-all tracking-[0.05em] uppercase">New</button>
          <button onClick={() => setShowWorkspaceModal(true)} className="px-4 py-1.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-[10px] font-bold transition-all tracking-[0.05em] uppercase text-white">
            <i className="fas fa-cloud mr-1.5"></i>
            워크스페이스
          </button>
        </div>
      </div>

      {/* Main UI */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel */}
        <div className="w-80 border-r border-white/5 bg-[#070707] p-6 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em]">베이스 이미지</h3>
            {state.baseImage ? (
              <div className="relative group">
                <img 
                  src={state.baseImage.url} 
                  alt="Base" 
                  className="w-full rounded-xl object-cover"
                />
                <button
                  onClick={() => {
                    setState(prev => ({ ...prev, baseImage: null }));
                    setHasUnsavedChanges(true);
                  }}
                  className="absolute top-2 right-2 w-8 h-8 bg-black/60 hover:bg-red-500/80 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                >
                  <i className="fas fa-times text-white text-sm"></i>
                </button>
              </div>
            ) : (
              <ImageUploader
                onUpload={(files: ImageFile[]) => {
                  if (files.length > 0) {
                    setState(prev => ({ ...prev, baseImage: files[0] }));
                    setHasUnsavedChanges(true);
                  }
                }}
                label="베이스 이미지 업로드"
              />
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em]">제품 이미지</h3>
            <div className="grid grid-cols-2 gap-2">
              {state.productImages.map((img, idx) => (
                <div key={idx} className="relative group">
                  <img 
                    src={img.url} 
                    alt={`Product ${idx + 1}`}
                    className="w-full aspect-square rounded-lg object-cover"
                  />
                  <button
                    onClick={() => {
                      setState(prev => ({
                        ...prev,
                        productImages: prev.productImages.filter((_, i) => i !== idx)
                      }));
                      setHasUnsavedChanges(true);
                    }}
                    className="absolute top-1 right-1 w-6 h-6 bg-black/60 hover:bg-red-500/80 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <i className="fas fa-times text-white text-xs"></i>
                  </button>
                </div>
              ))}
              {state.productImages.length < 4 && (
                <ImageUploader
                  onUpload={(files: ImageFile[]) => {
                    if (files.length > 0) {
                      setState(prev => ({ 
                        ...prev, 
                        productImages: [...prev.productImages, files[0]] 
                      }));
                      setHasUnsavedChanges(true);
                    }
                  }}
                  label="+"
                  compact
                />
              )}
            </div>
          </div>

          {/* 프롬프트 입력 */}
          <div className="space-y-4 pt-4 border-t border-white/5">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em]">프롬프트</h3>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="프롬프트를 입력하세요..."
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-white/20 resize-none"
              rows={4}
              disabled={state.isGenerating}
            />
          </div>

          {/* 종횡비 선택 */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em]">종횡비</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: AspectRatio.SQUARE, label: '1:1', size: '1080×1080' },
                { value: AspectRatio.PORTRAIT_4_5, label: '4:5', size: '1080×1350' },
                { value: AspectRatio.MOBILE_9_16, label: '9:16', size: '1080×1920' }
              ].map((ratio) => (
                <button
                  key={ratio.value}
                  onClick={() => setAspectRatio(ratio.value)}
                  className={`py-3 rounded-xl font-bold transition-all text-xs ${
                    aspectRatio === ratio.value
                      ? 'bg-white text-black'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  <div>{ratio.label}</div>
                  <div className="text-[10px] opacity-70 mt-1">{ratio.size}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 생성 버튼 */}
          <button
            onClick={handleGenerate}
            disabled={state.isGenerating || !state.baseImage || state.productImages.length === 0}
            className="w-full py-4 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {state.isGenerating ? (
              <i className="fas fa-spinner fa-spin"></i>
            ) : (
              '이미지 생성'
            )}
          </button>

          {state.error && (
            <div className="px-4 py-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 text-sm">
              {state.error}
            </div>
          )}
        </div>

        {/* Center Panel - 생성 결과 */}
        <div className="flex-1 flex flex-col bg-[#050505]">
          <div className="flex-1 flex items-center justify-center p-8">
            {currentResult ? (
              <div className={`max-w-2xl w-full ${getAspectRatioClass(currentResult.aspectRatio || aspectRatio)}`}>
                <div className="relative w-full h-full rounded-2xl overflow-hidden glass border border-white/10">
                  <img 
                    src={currentResult.imageUrl} 
                    alt="Generated" 
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-600">
                <i className="fas fa-image text-6xl mb-4 opacity-20"></i>
                <p className="text-sm">이미지를 생성하세요</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - 히스토리 */}
        <div className="w-80 border-l border-white/5 bg-[#070707] p-6 overflow-y-auto custom-scrollbar">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em] mb-4">히스토리</h3>
          {state.history.length === 0 ? (
            <div className="text-center text-gray-600 py-8">
              <i className="fas fa-history text-3xl mb-2 opacity-20"></i>
              <p className="text-xs">생성된 버전이 없습니다</p>
            </div>
          ) : (
            <div className="space-y-3">
              {state.history.map((result, idx) => (
                <button
                  key={result.id || idx}
                  onClick={() => setState(prev => ({ ...prev, activeVersionIndex: idx }))}
                  className={`w-full rounded-xl overflow-hidden border transition-all ${
                    state.activeVersionIndex === idx
                      ? 'border-white/30 ring-2 ring-white/20'
                      : 'border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className={`${getAspectRatioClass(result.aspectRatio || aspectRatio)} w-full`}>
                    <img 
                      src={result.imageUrl} 
                      alt={`Version ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {result.prompt && (
                    <div className="p-2 bg-black/40 text-xs text-gray-400 truncate">
                      {result.prompt}
                    </div>
                  )}
                </button>
              ))}
              <div ref={timelineEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* 워크스페이스 모달 */}
      {showWorkspaceModal && (
        <div className="fixed inset-0 bg-black/95 z-[999] flex flex-col items-center justify-center p-4">
          <div className="glass p-8 rounded-2xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold uppercase tracking-[0.2em]">워크스페이스</h2>
              <button
                onClick={handleCloseModal}
                className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-lg transition-all"
              >
                <i className="fas fa-times text-gray-400"></i>
              </button>
            </div>
            
            {/* 현재 워크스페이스 정보 */}
            {currentWorkspace && (
              <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-blue-400 uppercase tracking-wider mb-1">현재 워크스페이스</div>
                    <div className="font-bold text-white">{currentWorkspace.name}</div>
                  </div>
                  {hasUnsavedChanges && (
                    <span className="text-xs text-yellow-400 flex items-center gap-1">
                      <i className="fas fa-exclamation-circle"></i>
                      변경사항 있음
                    </span>
                  )}
                </div>
                <button
                  onClick={handleUpdateCurrent}
                  disabled={isSaving || !hasUnsavedChanges}
                  className="w-full mt-3 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-lg transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i>
                      {saveProgress || '업데이트 중...'}
                    </>
                  ) : (
                    <>
                      <i className="fas fa-save"></i>
                      현재 워크스페이스 업데이트
                    </>
                  )}
                </button>
              </div>
            )}
            
            {/* 새로 저장 섹션 */}
            <div className="mb-6 p-4 bg-white/5 rounded-xl">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.15em] mb-3">새 워크스페이스로 저장</h3>
              <input
                type="text"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="워크스페이스 이름"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white mb-3 focus:outline-none focus:border-white/30 text-sm"
                onKeyPress={(e) => e.key === 'Enter' && !isSaving && handleSaveNew()}
                disabled={isSaving}
              />
              
              {saveError && (
                <div className="mb-3 px-3 py-2 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-xs">
                  <i className="fas fa-exclamation-circle mr-2"></i>
                  {saveError}
                </div>
              )}
              
              {saveSuccess && (
                <div className="mb-3 px-3 py-2 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 text-xs">
                  <i className="fas fa-check-circle mr-2"></i>
                  저장되었습니다!
                </div>
              )}
              
              <button
                onClick={handleSaveNew}
                disabled={isSaving || !newWorkspaceName.trim()}
                className="w-full py-2.5 bg-white text-black font-bold rounded-lg hover:bg-gray-200 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSaving && !currentWorkspace ? (
                  <>
                    <i className="fas fa-spinner fa-spin"></i>
                    {saveProgress || '저장 중...'}
                  </>
                ) : (
                  <>
                    <i className="fas fa-plus"></i>
                    새로 저장
                  </>
                )}
              </button>
            </div>
            
            {/* 저장된 워크스페이스 목록 */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.15em]">저장된 워크스페이스</h3>
                <button
                  onClick={refreshProjects}
                  disabled={isLoadingProjects}
                  className="text-xs text-gray-500 hover:text-white transition-all flex items-center gap-1"
                >
                  <i className={`fas fa-sync-alt ${isLoadingProjects ? 'fa-spin' : ''}`}></i>
                  새로고침
                </button>
              </div>
              
              {isLoadingProjects ? (
                <div className="flex-1 flex items-center justify-center">
                  <i className="fas fa-spinner fa-spin text-2xl text-gray-600"></i>
                </div>
              ) : state.workspaces.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-center text-gray-600">
                  <div>
                    <i className="fas fa-folder-open text-3xl mb-2 opacity-30"></i>
                    <p className="text-xs">저장된 워크스페이스가 없습니다</p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                  {state.workspaces.map((ws) => (
                    <div
                      key={ws.id}
                      className={`group relative rounded-xl transition-all ${
                        ws.id === state.currentWorkspaceId 
                          ? 'bg-blue-500/20 border border-blue-500/30' 
                          : 'bg-white/5 border border-white/5 hover:border-white/20'
                      }`}
                    >
                      <button
                        onClick={() => loadWorkspace(ws)}
                        className="w-full px-4 py-3 text-left text-sm"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-white truncate pr-8 flex items-center gap-2">
                              {ws.name || 'Unnamed'}
                              {ws.id === state.currentWorkspaceId && (
                                <span className="text-[10px] text-blue-400 font-normal">(현재)</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                              <span className="flex items-center gap-1">
                                <i className="fas fa-user text-[10px]"></i>
                                {ws.owner || 'Unknown'}
                              </span>
                              <span>•</span>
                              <span>{ws.history?.length || 0}개 버전</span>
                            </div>
                            {ws.lastUpdated && (
                              <div className="text-[10px] text-gray-600 mt-1">
                                {new Date(ws.lastUpdated).toLocaleDateString('ko-KR', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                      
                      {/* 삭제 버튼 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDeleteConfirm(ws.id || null);
                        }}
                        className="absolute top-3 right-3 w-7 h-7 bg-transparent hover:bg-red-500/80 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                        title="삭제"
                      >
                        <i className="fas fa-trash text-xs text-red-400 hover:text-white"></i>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/80 z-[1000] flex items-center justify-center p-4">
          <div className="glass p-6 rounded-2xl max-w-sm w-full">
            <div className="text-center mb-6">
              <i className="fas fa-exclamation-triangle text-4xl text-red-400 mb-4"></i>
              <h3 className="text-lg font-bold mb-2">워크스페이스 삭제</h3>
              <p className="text-sm text-gray-400">
                이 워크스페이스를 삭제하시겠습니까?<br/>
                이 작업은 되돌릴 수 없습니다.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="flex-1 py-3 bg-white/10 text-white font-bold rounded-xl hover:bg-white/20 transition-all"
              >
                취소
              </button>
              <button
                onClick={() => handleDeleteWorkspace(showDeleteConfirm)}
                className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-all"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 저장하지 않음 경고 모달 */}
      {showUnsavedWarning && (
        <div className="fixed inset-0 bg-black/80 z-[1000] flex items-center justify-center p-4">
          <div className="glass p-6 rounded-2xl max-w-sm w-full">
            <div className="text-center mb-6">
              <i className="fas fa-exclamation-circle text-4xl text-yellow-400 mb-4"></i>
              <h3 className="text-lg font-bold mb-2">저장하지 않은 변경사항</h3>
              <p className="text-sm text-gray-400">
                저장하지 않은 변경사항이 있습니다.<br/>
                계속하시겠습니까?
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowUnsavedWarning(false);
                  setPendingAction(null);
                }}
                className="flex-1 py-3 bg-white/10 text-white font-bold rounded-xl hover:bg-white/20 transition-all"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setShowUnsavedWarning(false);
                  if (pendingAction) {
                    pendingAction();
                    setPendingAction(null);
                  }
                }}
                className="flex-1 py-3 bg-yellow-500 text-black font-bold rounded-xl hover:bg-yellow-400 transition-all"
              >
                저장 안 함
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Registration Modal */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black/95 z-[999] flex flex-col items-center justify-center">
          <div className="glass p-12 rounded-[40px] max-w-sm w-full text-center">
            <h2 className="text-xl font-bold uppercase tracking-[0.3em] mb-6">Welcome!</h2>
            <p className="text-[10px] text-gray-500 uppercase mb-8 tracking-[0.2em]">
              Enter your name to use ModelCut AI
            </p>
            <input
              type="text"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              placeholder="Your name"
              className="w-full px-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-white text-center font-bold uppercase tracking-widest focus:outline-none mb-8"
              onKeyPress={(e) => e.key === 'Enter' && handleRegisterUser()}
            />
            <button
              onClick={handleRegisterUser}
              className="w-full py-4 bg-white text-black font-bold uppercase rounded-2xl tracking-[0.2em]"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
