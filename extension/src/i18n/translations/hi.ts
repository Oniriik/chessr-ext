import { Translations } from '../types';

export const hi: Translations = {
  app: {
    name: 'Chessr',
  },

  player: {
    myColor: 'मेरा रंग',
    turn: 'बारी',
    white: 'सफ़ेद',
    black: 'काला',
    lastGamePlayed: 'अंतिम खेला गया खेल',
  },

  analysis: {
    eval: 'मूल्यांकन',
    centipawns: 'सेंटीपॉन',
    move: 'चाल',
    mateIn: 'मात में',
    reanalyze: 'पुनः विश्लेषण करें',
  },

  elo: {
    title: 'लक्ष्य ELO',
    display: 'Chess.com प्रदर्शन',
    antiCheat: 'ELO यादृच्छिकीकरण ±100',
    fullStrength: 'पूर्ण शक्ति मोड',
    fullStrengthDesc: 'अधिकतम-शक्ति सुझावों के लिए ELO सीमा अक्षम करें (2000+ ELO पर उपलब्ध)',
  },

  personalities: {
    title: 'व्यक्तित्व',
    Default: {
      label: 'इंजन',
      description: 'न्यूनतम गलतियों के साथ इंजन की तरह खेलता है।',
    },
    Aggressive: {
      label: 'आक्रामक',
      description: 'बेरहमी से हमला करता है, सक्रिय मोहरों को पसंद करता है, रानी के खेल की ओर झुकाव।',
    },
    Defensive: {
      label: 'रक्षात्मक',
      description: 'राजा की सुरक्षा और ठोस स्थिति को सबसे ऊपर रखता है।',
    },
    Active: {
      label: 'सक्रिय',
      description: 'खुली स्थितियों और अच्छी तरह से रखे गए मोहरों की ओर झुकाव।',
    },
    Positional: {
      label: 'स्थितिगत',
      description: 'ठोस खेल, चालबाज़ी, अधिक बंद स्थितियाँ।',
    },
    Endgame: {
      label: 'अंत खेल',
      description: 'प्यादे को बढ़ावा देकर जीतने के लिए खेलना पसंद करता है।',
    },
    Beginner: {
      label: 'शुरुआती',
      description: 'मूल बातें नहीं समझता, शह और कब्जा करने की कोशिश करता है।',
    },
    Human: {
      label: 'मानव',
      description: 'मजबूत मानव खिलाड़ियों की तरह खेलने के लिए अनुकूलित।',
    },
  },

  engine: {
    title: 'इंजन सेटिंग्स',
    riskTaking: 'जोखिम लेना',
    riskTakingDesc: 'जीतने की संभावनाओं के लिए स्वीकृत जोखिम स्तर',
    skill: 'कौशल',
    skillDesc: 'इंजन की खेल शक्ति स्तर',
    timePerMove: 'समय',
    analysisLines: 'विश्लेषण लाइनें',
  },

  display: {
    title: 'प्रदर्शन',
    showArrows: 'तीर दिखाएं',
    showEvalBar: 'मूल्यांकन बार दिखाएं',
    evalBarMode: 'प्रदर्शन मोड',
    evalBarModeEval: 'मूल्यांकन',
    evalBarModeWinrate: '% जीत',
    blunderThreshold: 'गंभीर गलती सीमा',
  },

  suggestions: {
    title: 'सुझाव',
    numberOfSuggestions: 'सुझावों की संख्या',
    useSameColor: 'वही रंग उपयोग करें',
    firstSuggestion: 'पहला सुझाव',
    secondSuggestion: 'दूसरा सुझाव',
    thirdSuggestion: 'तीसरा सुझाव',
    singleColor: 'सुझाव रंग',
    showQualityLabels: 'गुणवत्ता लेबल दिखाएं',
    showQualityLabelsDesc: 'तीरों पर सर्वश्रेष्ठ/सुरक्षित/जोखिम भरा लेबल प्रदर्शित करें',
    showEffectLabels: 'प्रभाव लेबल दिखाएं',
    showEffectLabelsDesc: 'तीरों पर मात/शह/कब्जा/पदोन्नति लेबल प्रदर्शित करें',
  },

  openings: {
    title: 'शुरुआत',
    nextMove: 'अगली चाल',
    completed: 'शुरुआत पूरी हुई',
    detected: 'शुरुआत पता चली',
    waitingForWhite: 'सफ़ेद की पहली चाल का इंतजार...',
    noOpening: 'कोई शुरुआत उपलब्ध नहीं',
  },

  settings: {
    title: 'सेटिंग्स',
    language: 'भाषा',
    automatic: 'स्वचालित',
    french: 'Français',
    english: 'English',
    spanish: 'Español',
    russian: 'Русский',
    german: 'Deutsch',
    portuguese: 'Português',
    hindi: 'हिन्दी',
    detected: 'पता चला',
  },

  advanced: {
    title: 'उन्नत',
    showAlwaysBestMoveFirst: 'हमेशा सबसे अच्छी चाल पहले दिखाएं',
    showAlwaysBestMoveFirstDesc: 'पहला सुझाव हमेशा इंजन की सबसे अच्छी चाल है।',
    allowBrilliant: 'शानदार चालों की अनुमति दें',
    allowBrilliantDesc: 'मजबूत स्थितियों के लिए सामग्री का त्याग करने वाली चालें दिखाएं।',
  },

  feedback: {
    title: 'चाल विवरण',
    showSuggestions: 'विस्तृत सुझाव दिखाएं',
    showSuggestionsDesc: 'चालों, प्रभावों और गुणवत्ता के साथ सुझाव कार्ड प्रदर्शित करें',
    showRollingAccuracy: 'खेल के आंकड़े दिखाएं',
    showRollingAccuracyDesc: 'पूरे खेल के लिए सटीकता और चाल वर्गीकरण के साथ विजेट प्रदर्शित करें',
  },

  badges: {
    best: 'सर्वश्रेष्ठ',
    safe: 'सुरक्षित',
    risky: 'जोखिम भरा',
    human: 'मानव',
    alt: 'वैकल्पिक',
    promotion: 'पदोन्नति',
    mate: 'मात',
    check: 'शह',
    capture: 'कब्जा',
    lowRisk: 'कम जोखिम',
    mediumRisk: 'मध्यम जोखिम',
    highRisk: 'उच्च जोखिम',
  },

  tabs: {
    general: 'सामान्य',
    display: 'प्रदर्शन',
    suggestions: 'सुझाव',
    feedback: 'विवरण',
  },

  version: {
    title: 'अपडेट आवश्यक',
    message: 'आपका Chessr संस्करण अब समर्थित नहीं है। एक्सटेंशन का उपयोग जारी रखने के लिए कृपया अपडेट करें।',
    current: 'वर्तमान',
    required: 'आवश्यक',
    download: 'अपडेट डाउनलोड करें',
  },

  auth: {
    login: 'लॉगिन',
    signup: 'साइन अप',
    forgotPassword: 'पासवर्ड भूल गए',
    loginSubtitle: 'Chessr तक पहुँचने के लिए साइन इन करें',
    signupSubtitle: 'शुरू करने के लिए एक खाता बनाएं',
    resetSubtitle: 'रीसेट करने के लिए अपना ईमेल दर्ज करें',
    email: 'ईमेल',
    emailPlaceholder: 'email@example.com',
    password: 'पासवर्ड',
    passwordPlaceholder: '••••••••',
    confirmPassword: 'पासवर्ड की पुष्टि करें',
    loginButton: 'साइन इन',
    signupButton: 'साइन अप',
    resetButton: 'लिंक भेजें',
    forgotPasswordLink: 'पासवर्ड भूल गए?',
    noAccount: 'खाता नहीं है?',
    signupLink: 'साइन अप करें',
    hasAccount: 'पहले से खाता है?',
    loginLink: 'साइन इन करें',
    backToLogin: 'लॉगिन पर वापस जाएं',
    passwordMismatch: 'पासवर्ड मेल नहीं खाते',
    passwordTooShort: 'पासवर्ड कम से कम 6 अक्षर का होना चाहिए',
    accountCreated: 'खाता बनाया गया!',
    verifyYourEmail: 'अपना ईमेल सत्यापित करें',
    emailSentTo: 'एक ईमेल भेजा गया है:',
    resendEmail: 'ईमेल फिर से भेजें',
    emailResent: 'ईमेल भेजा गया!',
    resetEmailSent: 'रीसेट ईमेल भेजा गया!',
  },
};
