// src/services/firebaseService.ts
import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  doc, 
  updateDoc, 
  deleteDoc,
  query,
  orderBy,
  Timestamp 
} from "firebase/firestore";
import { Workspace, ImageFile, GenerationResult } from "../types";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ============================================
// 🔹 ImgBB 이미지 업로드
// ============================================

const IMGBB_API_KEY = import.meta.env.VITE_IMGBB_API_KEY || "";

/**
 * Base64 이미지를 ImgBB에 업로드하고 URL 반환
 */
async function uploadImageToImgBB(base64Data: string, name?: string): Promise<string> {
  if (!IMGBB_API_KEY) {
    throw new Error("ImgBB API key is not configured. Please set VITE_IMGBB_API_KEY in your environment.");
  }

  // data:image/png;base64,xxxx 형식에서 base64 부분만 추출
  let cleanBase64 = base64Data;
  if (base64Data.includes(',')) {
    cleanBase64 = base64Data.split(',')[1];
  }

  const formData = new FormData();
  formData.append('key', IMGBB_API_KEY);
  formData.append('image', cleanBase64);
  if (name) {
    formData.append('name', name);
  }

  const response = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('ImgBB upload failed:', errorText);
    throw new Error(`ImgBB upload failed: ${response.status}`);
  }

  const result = await response.json();
  
  if (!result.success) {
    throw new Error(result.error?.message || 'ImgBB upload failed');
  }

  return result.data.display_url;
}

/**
 * ImageFile 객체를 ImgBB에 업로드하고 URL로 변환된 객체 반환
 */
async function uploadImageFile(
  imageFile: ImageFile,
  prefix: string
): Promise<ImageFile> {
  // 이미 외부 URL인 경우 (ImgBB URL 등) 그대로 반환
  if (!imageFile.base64 && imageFile.url && !imageFile.url.startsWith('data:')) {
    // file 속성 제거 (Firestore에 저장 불가)
    const { file, ...rest } = imageFile as any;
    return rest;
  }

  // base64 데이터가 있으면 업로드
  const dataToUpload = imageFile.base64 || imageFile.url;
  if (!dataToUpload) {
    const { file, ...rest } = imageFile as any;
    return rest;
  }

  const fileName = `${prefix}_${Date.now()}`;
  const downloadUrl = await uploadImageToImgBB(dataToUpload, fileName);

  // base64와 file 제거하고 URL로 대체
  return {
    id: imageFile.id,
    url: downloadUrl,
    name: imageFile.name,
    mimeType: imageFile.mimeType,
    // base64, file은 제외 (ImgBB URL 사용)
  };
}

/**
 * GenerationResult의 이미지를 ImgBB에 업로드
 */
async function uploadGenerationResult(
  result: GenerationResult,
  index: number
): Promise<GenerationResult> {
  // 이미 외부 URL인 경우 그대로 반환
  if (!result.imageUrl.startsWith('data:')) {
    return result;
  }

  const fileName = `result_${index}_${Date.now()}`;
  const downloadUrl = await uploadImageToImgBB(result.imageUrl, fileName);

  return {
    ...result,
    imageUrl: downloadUrl,
  };
}

// ============================================
// 🔹 프로젝트 저장/불러오기
// ============================================

/**
 * 프로젝트 저장 (이미지는 ImgBB, 메타데이터는 Firestore)
 */
export async function saveProject(
  project: Workspace,
  onProgress?: (status: string) => void
): Promise<string> {
  try {
    const projectId = project.id || Math.random().toString(36).substr(2, 9);
    
    // 1. 베이스 이미지 업로드
    onProgress?.('베이스 이미지 업로드 중...');
    let uploadedBaseImage: ImageFile | null = null;
    if (project.baseImage) {
      uploadedBaseImage = await uploadImageFile(project.baseImage, 'base');
    }
    
    // 2. 제품 이미지들 업로드
    onProgress?.('제품 이미지 업로드 중...');
    const uploadedProductImages: ImageFile[] = [];
    for (let i = 0; i < project.productImages.length; i++) {
      const uploaded = await uploadImageFile(project.productImages[i], `product_${i}`);
      uploadedProductImages.push(uploaded);
    }
    
    // 3. 히스토리 이미지들 업로드
    const uploadedHistory: GenerationResult[] = [];
    for (let i = 0; i < project.history.length; i++) {
      onProgress?.(`생성 결과 업로드 중... (${i + 1}/${project.history.length})`);
      const uploaded = await uploadGenerationResult(project.history[i], i);
      uploadedHistory.push(uploaded);
    }
    
    // 4. Firestore에 메타데이터 저장
    onProgress?.('프로젝트 저장 중...');
    const projectData = {
      id: projectId,
      name: project.name,
      owner: project.owner,
      baseImage: uploadedBaseImage,
      productImages: uploadedProductImages,
      history: uploadedHistory,
      activeVersionIndex: project.activeVersionIndex,
      lastUpdated: Timestamp.now(),
      createdAt: Timestamp.now(),
    };
    
    const docRef = await addDoc(collection(db, "projects"), projectData);
    
    console.log("✅ Project saved successfully:", docRef.id);
    return docRef.id;
    
  } catch (error) {
    console.error("❌ Error saving project:", error);
    throw error;
  }
}

/**
 * 모든 프로젝트 불러오기
 */
export async function fetchProjects(): Promise<Workspace[]> {
  try {
    const q = query(collection(db, "projects"), orderBy("lastUpdated", "desc"));
    const snapshot = await getDocs(q);
    
    const projects = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        // Timestamp를 number로 변환
        lastUpdated: data.lastUpdated?.toMillis?.() || data.lastUpdated || Date.now(),
        createdAt: data.createdAt?.toMillis?.() || data.createdAt || Date.now(),
      } as Workspace;
    });
    
    console.log(`✅ Fetched ${projects.length} projects`);
    return projects;
    
  } catch (error) {
    console.error("❌ Error fetching projects:", error);
    throw error;
  }
}

/**
 * 프로젝트 업데이트
 */
export async function updateProject(docId: string, updates: Partial<Workspace>): Promise<void> {
  try {
    const docRef = doc(db, "projects", docId);
    await updateDoc(docRef, {
      ...updates,
      lastUpdated: Timestamp.now(),
    });
    console.log("✅ Project updated:", docId);
  } catch (error) {
    console.error("❌ Error updating project:", error);
    throw error;
  }
}

/**
 * 프로젝트 삭제 (Firestore 문서만 삭제, ImgBB 이미지는 유지됨)
 */
export async function deleteProject(docId: string): Promise<void> {
  try {
    // Firestore 문서 삭제
    // 참고: ImgBB는 무료 플랜에서 이미지 삭제 API를 제공하지 않음
    await deleteDoc(doc(db, "projects", docId));
    console.log("✅ Project deleted:", docId);
    
  } catch (error) {
    console.error("❌ Error deleting project:", error);
    throw error;
  }
}

// 호환성을 위해 기존 함수명도 유지
export const saveProjectToCloud = saveProject;
export const fetchProjectsFromCloud = fetchProjects;