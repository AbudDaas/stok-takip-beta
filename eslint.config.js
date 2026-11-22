// ESLint yapılandırması — artık gerçek ES modülleri (import/export) için.

module.exports = [
  {
    files: ["js/**/*.js"],
    ignores: ["js/*-config.js", "js/i18n.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        Notification: "readonly",
        SpeechSynthesisUtterance: "readonly",
        SpeechRecognition: "readonly",
        webkitSpeechRecognition: "readonly",
        speechSynthesis: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        File: "readonly",
        Blob: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        QRCode: "readonly",
        L: "readonly",
        Image: "readonly",
        CustomEvent: "readonly",
        performance: "readonly",
        XLSX: "readonly",
        confirm: "readonly",
        firebase: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        requestAnimationFrame: "readonly",
        caches: "readonly",
        Html5Qrcode: "readonly",
        Uint8Array: "readonly",
        chainConfig: "readonly",
        bulkScanConfig: "readonly",
        imageConfig: "readonly",
        pushConfig: "readonly",
        adminConfig: "readonly",
        firebaseConfig: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-undef": "error",
      "no-console": "off",
      eqeqeq: ["warn", "smart"],
      "no-var": "error"
    }
  }
];
