// 1. Paste your Firebase web app config here
//    (Firebase console → Project settings → General → Your apps → SDK setup and configuration → Config).
//    These values are safe to commit: they identify your project, they don't grant access.
//    Access is controlled by firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyDv22JkxmTVRVVOgawxezHpUNkyyxd4x4M",
  authDomain: "leissailing.firebaseapp.com",
  projectId: "leissailing",
  storageBucket: "leissailing.firebasestorage.app",
  messagingSenderId: "597534407317",
  appId: "1:597534407317:web:4b6ac90d3d4df191f4799c",
  measurementId: "G-7Z29QDRE58"
};

// 2. The name shown in the header and browser tab.
export const SITE_NAME = "leissailing";

// 3. Logins are username + password. Firebase Auth needs an email address, so
//    each username becomes "<username>@<USERNAME_DOMAIN>". No email is ever sent.
//    If you change this, change the matching domain in firestore.rules (signedIn()).
export const USERNAME_DOMAIN = "users.example.com";
