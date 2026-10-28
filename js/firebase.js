// Loads the Firebase SDK from Google's CDN. To upgrade, change the version in these three URLs.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import * as authSdk from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import * as fsSdk from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

export const configured = !String(firebaseConfig.apiKey || "").startsWith("PASTE");

export const app = initializeApp(firebaseConfig);
export const auth = authSdk.getAuth(app);
export const db = fsSdk.getFirestore(app);
export { authSdk, fsSdk };
