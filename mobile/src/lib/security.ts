import { collection, setDoc, query, where, getDocs, serverTimestamp, doc, getDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Blocks a user using a deterministic ID for easy rule checking.
 */
export const blockUser = async (currentUserId: string, targetUserId: string) => {
  try {
    const blockId = `${currentUserId}_${targetUserId}`;
    await setDoc(doc(db, 'blocks', blockId), {
      blockedById: currentUserId,
      blockedUserId: targetUserId,
      timestamp: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error("Blocking error:", error);
    return false;
  }
};

export const unblockUser = async (currentUserId: string, targetUserId: string) => {
  try {
    const blockId = `${currentUserId}_${targetUserId}`;
    await deleteDoc(doc(db, 'blocks', blockId));
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Checks if targetUserId has blocked currentUserId.
 */
export const isBlockedBy = async (currentUserId: string, targetUserId: string) => {
  const blockId = `${targetUserId}_${currentUserId}`;
  const snap = await getDoc(doc(db, 'blocks', blockId));
  return snap.exists();
};

/**
 * Checks if currentUserId has blocked targetUserId.
 */
export const hasBlocked = async (currentUserId: string, targetUserId: string) => {
  const blockId = `${currentUserId}_${targetUserId}`;
  const snap = await getDoc(doc(db, 'blocks', blockId));
  return snap.exists();
};
