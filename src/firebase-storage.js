import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { doc, getFirestore, onSnapshot, setDoc } from "firebase/firestore";

const appId = "ashrinuseva-production";

// This Firebase web configuration is the existing public client identifier.
const firebaseConfig = {
  apiKey: "AIzaSyC5-eKe4v_X2uPYss0FU0FxwvrzMDcbPAQ",
  authDomain: "ashrinuseva.firebaseapp.com",
  projectId: "ashrinuseva",
  storageBucket: "ashrinuseva.firebasestorage.app",
  messagingSenderId: "1058011263523",
  appId: "1:1058011263523:web:ec7ed7a67fe86987d4f796"
};

const isFirebaseConfigured =
  firebaseConfig.apiKey &&
  !firebaseConfig.apiKey.includes("Dummy") &&
  !firebaseConfig.apiKey.includes("הכנס_כאן");

window.isFirebaseConfigured = isFirebaseConfigured;

let db = null;
let auth = null;

try {
  if (isFirebaseConfigured) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
  }
} catch {
  console.log("Cloud sync initialized in local fallback mode.");
}

window.cloudStorage = {
  async initAuth() {
    if (!auth) return null;

    try {
      const credential = await signInAnonymously(auth);
      return credential.user;
    } catch (error) {
      console.warn("Cloud auth notice:", error);
      return null;
    }
  },

  listenData(callback) {
    if (!db || !auth) return;

    const documentReference = doc(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      "systemData",
      "mainStore"
    );

    onSnapshot(
      documentReference,
      (snapshot) => {
        if (snapshot.exists()) callback(snapshot.data());
      },
      (error) => console.log("Cloud sync snapshot notice:", error)
    );
  },

  async saveData(data) {
    if (!db || !auth) return;

    try {
      const documentReference = doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "systemData",
        "mainStore"
      );
      await setDoc(documentReference, data, { merge: true });
    } catch (error) {
      console.warn("Cloud save notice:", error);
    }
  }
};
