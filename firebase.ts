import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { 
  getFirestore,
  doc as originalDoc,
  setDoc as originalSetDoc,
  getDoc as originalGetDoc,
  onSnapshot as originalOnSnapshot,
  collection as originalCollection,
  query as originalQuery,
  where as originalWhere,
  deleteDoc as originalDeleteDoc,
  updateDoc as originalUpdateDoc,
  getDocFromServer as originalGetDocFromServer
} from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

// Initialize Firebase SDK
console.log('Firebase Init Config:', {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
  hasApiKey: !!firebaseConfig.apiKey,
  apiKeyLength: firebaseConfig.apiKey?.length,
  apiKeyStart: firebaseConfig.apiKey?.slice(0, 5)
});
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const firebaseAuth = getAuth();
let simulatedUser: any = {
  uid: 'matheus_farias',
  email: 'matheus@barbershop.com',
  displayName: 'Matheus Farias'
};
let onAuthStateCallbacks: Array<(user: any) => void> = [];

export const setSimulatedUser = (user: any) => {
  simulatedUser = user;
  onAuthStateCallbacks.forEach(cb => cb(user));
};

export const auth = new Proxy(firebaseAuth, {
  get(target, prop, receiver) {
    if (prop === 'currentUser') {
      return simulatedUser || firebaseAuth.currentUser;
    }
    if (prop === 'onAuthStateChanged') {
      return (cb: (user: any) => void) => {
        onAuthStateCallbacks.push(cb);
        // Call back immediately with the active simulated user or real user
        cb(simulatedUser || firebaseAuth.currentUser);
        
        const unsub = firebaseAuth.onAuthStateChanged((user) => {
          if (!simulatedUser) {
            cb(user);
          }
        });
        return () => {
          unsub();
          onAuthStateCallbacks = onAuthStateCallbacks.filter(c => c !== cb);
        };
      };
    }
    if (prop === 'signOut') {
      return async () => {
        simulatedUser = null;
        onAuthStateCallbacks.forEach(cb => cb(null));
        return firebaseAuth.signOut();
      };
    }
    const val = Reflect.get(target, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  }
}) as any;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: (auth.currentUser?.providerData || []).map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      }))
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// ===============================================================
// VIRTUAL FIRESTORE database FOR OFFLINE DEMO MODE
// ===============================================================

const listeners: { [path: string]: Array<(snapshot: any) => void> } = {};

const triggerListeners = (path: string) => {
  if (listeners[path]) {
    if (path.split('/').length === 2) {
      // Root user
      const userData = localStorage.getItem('simdb_user_offline_demo');
      const val = userData ? JSON.parse(rawOr(userData, '{}')) : getInitialUserData();
      listeners[path].forEach(cb => cb({
        exists: () => true,
        data: () => val
      }));
    } else {
      const collPath = path.replace(/\//g, '_');
      const data = getMockCollectionData(collPath);
      const snap = {
        docs: data.map((d: any) => ({
          id: d.id,
          data: () => d
        }))
      };
      listeners[path].forEach(cb => cb(snap));
    }
  }
};

const rawOr = (val: any, fallback: string): string => val || fallback;

const getInitialUserData = () => ({
  username: 'admin',
  shopName: 'Barbearia Matheus Farias',
  phone: '',
  profileImage: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?q=80&w=400&h=400&auto=format&fit=crop",
  monthlyGoal: 5000,
  marketing_msg: "",
  campaign_goal: "",
  privacy_mode: false,
  migrated: true
});

const getMockCollectionData = (collPath: string): any[] => {
  const raw = localStorage.getItem(`simdb_${collPath}`);
  if (!raw) {
    // Return some initial setup data
    if (collPath.endsWith('_services')) {
      return [
        { id: '1', name: 'Corte Social', price: 35, duration: 30 },
        { id: '2', name: 'Degradê Especial', price: 45, duration: 45 },
        { id: '3', name: 'Barba Terapia', price: 25, duration: 25 },
        { id: '4', name: 'Corte + Barba (Combo)', price: 55, duration: 60 },
        { id: '5', name: 'Sobrancelha', price: 15, duration: 15 },
        { id: '6', name: 'Pigmentação Cabelo/Barba', price: 30, duration: 30 },
        { id: '7', name: 'Selagem Térmica', price: 80, duration: 90 },
        { id: '8', name: 'Luzes / Platinado', price: 90, duration: 120 },
      ];
    }
    return [];
  }
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const saveMockCollectionData = (collPath: string, data: any[]) => {
  localStorage.setItem(`simdb_${collPath}`, JSON.stringify(data));
};

export function doc(database: any, ...pathSegments: string[]) {
  const fullPath = pathSegments.join('/');
  const isOffline = fullPath.includes('offline_demo') || pathSegments[1] === 'offline_demo';
  const ref = originalDoc(database, ...pathSegments as [string, ...string[]]);
  
  (ref as any).isOffline = isOffline;
  (ref as any).customPath = fullPath;
  return ref;
}

export function collection(database: any, ...pathSegments: string[]) {
  const fullPath = pathSegments.join('/');
  const isOffline = fullPath.includes('offline_demo') || pathSegments[1] === 'offline_demo';
  const ref = originalCollection(database, ...pathSegments as [string, ...string[]]);
  
  (ref as any).isOffline = isOffline;
  (ref as any).customPath = fullPath;
  return ref;
}

export function query(queryRef: any, ...queryConstraints: any[]) {
  const isOffline = queryRef.isOffline;
  const ref = originalQuery(queryRef, ...queryConstraints);
  (ref as any).isOffline = isOffline;
  (ref as any).customPath = queryRef.customPath;
  return ref;
}

export function where(fieldPath: string, opStr: any, value: any) {
  return originalWhere(fieldPath, opStr, value);
}

export async function getDoc(docRef: any) {
  if (docRef.isOffline) {
    const path = docRef.customPath;
    const segments = path.split('/');
    
    if (segments.length === 2) {
      const userData = localStorage.getItem('simdb_user_offline_demo');
      const val = userData ? JSON.parse(userData) : getInitialUserData();
      return {
        exists: () => true,
        data: () => val
      };
    } else {
      const collPath = segments.slice(0, -1).join('_');
      const docId = segments[segments.length - 1];
      const items = getMockCollectionData(collPath);
      const matched = items.find((i: any) => i.id === docId);
      return {
        exists: () => !!matched,
        data: () => matched
      };
    }
  }
  return originalGetDoc(docRef);
}

export async function getDocFromServer(docRef: any) {
  if (docRef.isOffline) {
    return getDoc(docRef);
  }
  return originalGetDocFromServer(docRef);
}

export async function setDoc(docRef: any, data: any, options?: any) {
  if (docRef.isOffline) {
    const path = docRef.customPath;
    const segments = path.split('/');
    
    if (segments.length === 2) {
      let current = {};
      const raw = localStorage.getItem('simdb_user_offline_demo');
      if (raw) {
        try {
          current = JSON.parse(raw);
        } catch {}
      }
      const merged = options?.merge ? { ...current, ...data } : data;
      localStorage.setItem('simdb_user_offline_demo', JSON.stringify(merged));
      triggerListeners(path);
    } else {
      const collPath = segments.slice(0, -1).join('_');
      const collKey = segments.slice(0, -1).join('/');
      const docId = segments[segments.length - 1];
      const items = getMockCollectionData(collPath);
      
      const idx = items.findIndex((i: any) => i.id === docId);
      if (idx >= 0) {
        items[idx] = options?.merge ? { ...items[idx], ...data } : data;
      } else {
        items.push({ id: docId, ...data });
      }
      saveMockCollectionData(collPath, items);
      triggerListeners(collKey);
    }
    return;
  }
  return originalSetDoc(docRef, data, options);
}

export async function updateDoc(docRef: any, data: any) {
  if (docRef.isOffline) {
    return setDoc(docRef, data, { merge: true });
  }
  return originalUpdateDoc(docRef, data);
}

export async function deleteDoc(docRef: any) {
  if (docRef.isOffline) {
    const path = docRef.customPath;
    const segments = path.split('/');
    if (segments.length > 2) {
      const collPath = segments.slice(0, -1).join('_');
      const collKey = segments.slice(0, -1).join('/');
      const docId = segments[segments.length - 1];
      let items = getMockCollectionData(collPath);
      items = items.filter((i: any) => i.id !== docId);
      saveMockCollectionData(collPath, items);
      triggerListeners(collKey);
    }
    return;
  }
  return originalDeleteDoc(docRef);
}

export function onSnapshot(reference: any, onNext: any, onError?: any) {
  if (reference.isOffline) {
    const path = reference.customPath;
    
    if (!listeners[path]) {
      listeners[path] = [];
    }
    listeners[path].push(onNext);
    
    setTimeout(() => {
      if (path.split('/').length === 2) {
        const userData = localStorage.getItem('simdb_user_offline_demo');
        const val = userData ? JSON.parse(userData) : getInitialUserData();
        onNext({
          exists: () => true,
          data: () => val
        });
      } else {
        const collPath = path.replace(/\//g, '_');
        const items = getMockCollectionData(collPath);
        onNext({
          docs: items.map((item: any) => ({
            id: item.id,
            data: () => item
          }))
        });
      }
    }, 0);
    
    return () => {
      listeners[path] = listeners[path].filter(cb => cb !== onNext);
    };
  }
  return originalOnSnapshot(reference, onNext, onError);
}
